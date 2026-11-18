import assert from "node:assert/strict";
import test from "node:test";
import { pricebookLinkIssue } from "./integrity";

const row = { unit: "مترمکعب", pricebookItemId: "item" };
const price = { pricebookItemId: "item", referenceId: "ref", code: "T01", basis: "official", currency: "IRR", unit: "مترمکعب", amount: "1000.00", confirmed: true };
const evidence = { item: { id: "item", code: "T01", unit: "متر مکعب", unitPriceRial: "1000.00" }, edition: { referenceId: "ref", status: "active" } };
test("matched prices remain consistent with the attested pricebook row", () => {
  assert.equal(pricebookLinkIssue(row, price, evidence), null);
  assert.equal(pricebookLinkIssue(row, price, { ...evidence, edition: { ...evidence.edition, status: "archived" } }), null);
  assert(pricebookLinkIssue(row, { ...price, amount: "1001" }, evidence));
  assert(pricebookLinkIssue(row, { ...price, currency: "IRT" }, evidence));
  assert(pricebookLinkIssue(row, { ...price, referenceId: "other" }, evidence));
  assert(pricebookLinkIssue({ ...row, pricebookItemId: null }, price, undefined));
  assert(pricebookLinkIssue(row, price, undefined));
  assert.equal(pricebookLinkIssue({ ...row, pricebookItemId: null }, { ...price, pricebookItemId: null }, undefined), null);
});
