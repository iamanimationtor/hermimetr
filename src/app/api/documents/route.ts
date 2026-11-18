import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectDocuments, projects } from "@/db/schema";
import { ApiError, apiFailure, audit, ownedProject, requestBody, requiredUser, uuid } from "@/lib/api";

const MAX_BYTES = 6 * 1024 * 1024;
const mimeFromBytes = (buffer: Buffer) => {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
};

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const id = uuid.parse(new URL(request.url).searchParams.get("id"));
    const [document] = await db.select({ document: projectDocuments }).from(projectDocuments)
      .innerJoin(projects, eq(projectDocuments.projectId, projects.id))
      .where(and(eq(projectDocuments.id, id), eq(projects.ownerId, user.id))).limit(1);
    if (!document) throw new ApiError("فایل یافت نشد.", 404);
    const content = Buffer.from(document.document.contentBase64, "base64");
    return new Response(new Uint8Array(content), { headers: { "Content-Type": document.document.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.document.fileName)}`,
      "Content-Length": String(content.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try { originHost = new URL(origin).host; } catch { throw new ApiError("مبدأ درخواست مجاز نیست.", 403); }
      if (originHost !== (request.headers.get("x-forwarded-host") || new URL(request.url).host)) throw new ApiError("مبدأ درخواست مجاز نیست.", 403);
    }
    // Reject oversized requests before formData() allocates memory. The file-size check below
    // remains authoritative for chunked requests with no Content-Length header.
    const declaredLength = request.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > MAX_BYTES + 128 * 1024) {
      throw new ApiError("حجم درخواست بیش از حد مجاز است.", 413);
    }
    const form = await request.formData();
    const projectId = uuid.parse(form.get("projectId"));
    await ownedProject(projectId, user.id);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) throw new ApiError("فایل باید PDF یا تصویر و حداکثر ۶ مگابایت باشد.");
    const content = Buffer.from(await file.arrayBuffer());
    const mimeType = mimeFromBytes(content);
    if (!mimeType) throw new ApiError("نوع واقعی فایل پشتیبانی نمی‌شود. فقط PDF، PNG و JPG مجازند.");
    const safeName = file.name.replace(/[\\/\x00-\x1F\x7F]/g, "_").slice(0, 255) || "document";
    const version = String(form.get("version") || "نسخه ۱").trim().slice(0, 80);
    const description = String(form.get("description") || "").trim().slice(0, 1000);
    const [document] = await db.insert(projectDocuments).values({ projectId, fileName: safeName, mimeType, sizeBytes: content.length,
      contentBase64: content.toString("base64"), version, description: description || null }).returning({ id: projectDocuments.id, fileName: projectDocuments.fileName });
    await audit(user.id, projectId, "document", document.id, "upload", null, { fileName: document.fileName, version });
    return Response.json({ document }, { status: 201 });
  } catch (error) { return apiFailure(error); }
}

export async function DELETE(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    const id = uuid.parse(body.id);
    const [document] = await db.select({ document: projectDocuments }).from(projectDocuments)
      .innerJoin(projects, eq(projectDocuments.projectId, projects.id))
      .where(and(eq(projectDocuments.id, id), eq(projects.ownerId, user.id))).limit(1);
    if (!document) throw new ApiError("فایل یافت نشد.", 404);
    await db.delete(projectDocuments).where(eq(projectDocuments.id, id));
    await audit(user.id, document.document.projectId, "document", id, "delete", { fileName: document.document.fileName }, null);
    return Response.json({ ok: true });
  } catch (error) { return apiFailure(error); }
}
