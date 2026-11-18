import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPersianDecimal } from "./format";

test("reports preserve large exact amounts and small fractional quantities", () => {
  assert.equal(formatPersianDecimal("12345678901234567890123"), "۱۲٬۳۴۵٬۶۷۸٬۹۰۱٬۲۳۴٬۵۶۷٬۸۹۰٬۱۲۳");
  assert.equal(formatPersianDecimal("9999999999999999.0001"), "۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٫۰۰۰۱");
  assert.equal(formatPersianDecimal("0.0500"), "۰٫۰۵");
  assert.equal(formatPersianDecimal("-42.1250"), "−۴۲٫۱۲۵");
});
