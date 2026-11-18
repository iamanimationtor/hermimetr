import assert from "node:assert/strict";
import test from "node:test";
import { estimateDraftDisclosure } from "./estimate-disclosure";

test("estimate output discloses excluded drafts without claiming project completeness", () => {
  assert.match(estimateDraftDisclosure({ includedDraftRows: 2 }), /2 ردیف پیش‌نویس.*کنار گذاشته/);
  assert.match(estimateDraftDisclosure({ includedDraftRows: 0 }), /کامل‌بودن دامنه پروژه را تضمین نمی‌کند/);
  for (const value of [undefined, null, -1, 0.5, "0"]) {
    assert.match(estimateDraftDisclosure({ includedDraftRows: value }), /ثبت نشده است/);
  }
});
