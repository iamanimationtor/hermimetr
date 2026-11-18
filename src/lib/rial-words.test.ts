import assert from "node:assert/strict";
import test from "node:test";
import { rialToWordsFa } from "./rial-words.js";

test("rialToWordsFa baseline", () => {
  assert.equal(rialToWordsFa("0"), "صفر ریال");
  assert.equal(rialToWordsFa("1"), "یک ریال");
  assert.equal(rialToWordsFa("20"), "بیست ریال");
  assert.equal(rialToWordsFa("100"), "یکصد ریال");
  assert.equal(rialToWordsFa("1234"), "یک هزار و دویست و سی و چهار ریال");
  assert.equal(rialToWordsFa("1000000"), "یک میلیون ریال");
  assert.equal(rialToWordsFa("1234567890").includes("میلیارد"), true);
});
