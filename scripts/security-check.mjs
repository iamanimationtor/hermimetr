// Focused production API security regression. All data created here is synthetic audit data.
import assert from "node:assert/strict";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
let cookieA = "";
let cookieB = "";
async function request(path, method = "GET", body, owner = "A", extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const cookie = owner === "A" ? cookieA : owner === "B" ? cookieB : "";
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined && !(body instanceof FormData) && !Buffer.isBuffer(body)) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : body instanceof FormData || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  const nextCookie = response.headers.get("set-cookie")?.match(/metra_session=[^;]+/)?.[0];
  if (nextCookie && owner === "A") cookieA = nextCookie;
  if (nextCookie && owner === "B") cookieB = nextCookie;
  return response;
}
async function json(path, method, body, expected, owner = "A", headers) {
  const response = await request(path, method, body, owner, headers);
  const parsed = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(parsed).slice(0, 260)}`);
  return parsed;
}

const unauth = await json("/api/rules", "GET", undefined, 401, "none");
assert.match(unauth.error, /نشست/);
await json("/api/prices", "POST", { title: "x" }, 401, "none");
await json("/api/export?projectId=00000000-0000-4000-8000-000000000000&format=json", "GET", undefined, 401, "none");
console.log("✓ APIs deny unauthenticated access");

const a = await json("/api/workspace", "GET", undefined, 200, "A");
const b = await json("/api/workspace", "GET", undefined, 200, "B");
assert.notEqual(a.user.id, b.user.id);
const project = (await json("/api/projects", "POST", { name: "پروژه ممیزی امنیتی", type: "مسکونی", floors: 1, basements: 0,
  fundingType: "private", pricingBasis: "market", stage: "detailed" }, 201)).project;
const price = (await json("/api/prices", "POST", { title: "بهای آزمایشی", unit: "عدد", basis: "market", amount: "1000",
  currency: "IRR", sourceName: "داده آزمون", priceDate: "1404/01/01", confirmed: true }, 201)).item;
const row = (await json("/api/takeoffs", "POST", { projectId: project.id, title: "ردیف امنیتی", category: "شمارش",
  kind: "count", count: "4", sourceNote: "داده آزمون" }, 201)).item;
await json("/api/projects", "PATCH", { id: project.id, action: "status", status: "archived" }, 404, "B");
await json("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id }, 404, "B");
await json("/api/prices", "DELETE", { id: price.id }, 404, "B");
await json(`/api/export/takeoff?projectId=${project.id}`, "GET", undefined, 404, "B");
assert(!(await json("/api/workspace", "GET", undefined, 200, "B")).projects.some((p) => p.id === project.id));
console.log("✓ cross-account project, takeoff, price and report isolation");

await json("/api/projects", "POST", { name: "X" }, 403, "A", { Origin: "https://malicious.example" });
await json("/api/projects", "POST", { name: "X" }, 403, "A", { Origin: "http://[::1" });
await json("/api/documents", "POST", new FormData(), 403, "A", { Origin: "https://malicious.example" });
console.log("✓ foreign and malformed Origin requests are rejected");

const badForm = new FormData();
badForm.append("projectId", project.id);
badForm.append("file", new Blob(["<html><script>alert(1)</script></html>"], { type: "application/pdf" }), "evil.pdf");
const badFile = await json("/api/documents", "POST", badForm, 400);
assert.match(badFile.error, /نوع واقعی فایل/);
const tooBig = new FormData();
tooBig.append("projectId", project.id);
tooBig.append("file", new Blob([Buffer.alloc(3 * 1024 * 1024 + 129 * 1024)], { type: "application/pdf" }), "huge.pdf");
const oversized = await json("/api/documents", "POST", tooBig, 413);
assert.match(oversized.error, /حجم درخواست/);
// A chunked request has no Content-Length; it must be bounded before multipart parsing too.
const chunked = await fetch(`${base}/api/documents`, {
  method: "POST",
  headers: { Cookie: cookieA, "Content-Type": "multipart/form-data; boundary=test-boundary" },
  body: new ReadableStream({
    start(controller) {
      for (let i = 0; i < 100; i++) controller.enqueue(new Uint8Array(64 * 1024));
      controller.close();
    },
  }),
  duplex: "half",
});
assert.equal(chunked.status, 413, "chunked requests must respect the actual body limit");
const oversizedJson = await fetch(`${base}/api/projects`, {
  method: "POST", headers: { Cookie: cookieA, "Content-Type": "application/json" },
  body: new ReadableStream({ start(controller) {
    for (let i = 0; i < 70; i++) controller.enqueue(new Uint8Array(64 * 1024));
    controller.close();
  } }), duplex: "half",
});
assert.equal(oversizedJson.status, 413, "chunked JSON must be capped before parsing");
const malformed = await request("/api/documents", "POST", Buffer.from("bad multipart"), "A", { "Content-Type": "multipart/form-data; boundary=test" });
assert.equal(malformed.status, 400, "malformed multipart must not produce a server error");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lH8AAAAASUVORK5CYII=", "base64");
const fileForm = new FormData();
fileForm.append("projectId", project.id);
fileForm.append("file", new Blob([png], { type: "image/png" }), "audit.png");
const file = (await json("/api/documents", "POST", fileForm, 201)).document;
const ownFile = await request(`/api/documents?id=${file.id}`);
assert.equal(ownFile.status, 200);
assert.equal(ownFile.headers.get("content-type"), "image/png");
if (process.env.ARENA_PREVIEW !== "1") assert.equal(ownFile.headers.get("x-frame-options")?.toUpperCase(), "SAMEORIGIN");
assert.match(ownFile.headers.get("content-security-policy") || "", /frame-ancestors 'self'/);
assert(Buffer.from(await ownFile.arrayBuffer()).equals(png));
await json(`/api/documents?id=${file.id}`, "GET", undefined, 404, "B");
console.log("✓ MIME sniff, request/file size caps, private file bytes and framing restrictions");

// Use a dedicated IP header to avoid affecting the other regression suites in this single-instance environment.
let denied = false;
for (let i = 0; i < 31; i++) {
  const response = await request("/api/auth", "POST", { action: "login", email: "nobody@example.invalid", password: "WrongPass123" }, "none",
    { "x-forwarded-for": "198.51.100.222" });
  if (response.status === 429) { denied = true; break; }
  assert.equal(response.status, 401);
}
assert(denied, "authentication must rate-limit after 30 attempts in one window");
console.log("✓ authentication rate limit returns 429 after repeated attempts");
console.log("Security check passed.");
