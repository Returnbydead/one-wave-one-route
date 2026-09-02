import assert from "node:assert/strict";
import test from "node:test";
import { isRice5KgProduct, taskContainsRice5Kg } from "../app/koli-audit-core.mjs";

test("rice filter matches BERAS and 5 KG anywhere in product name", () => {
  assert.equal(isRice5KgProduct("Beras Ramos Premium 5KG"), true);
  assert.equal(isRice5KgProduct("BERAS 5 kg"), true);
  assert.equal(isRice5KgProduct("Beras Premium 25KG"), false);
  assert.equal(isRice5KgProduct("Gula 5KG"), false);
});

test("all koli remain available while rice filter checks their lines", () => {
  assert.equal(taskContainsRice5Kg({ lines: [{ productName: "Minyak 2L" }, { productName: "Beras Setra 5 KG" }] }), true);
  assert.equal(taskContainsRice5Kg({ lines: [{ productName: "Tepung 5KG" }] }), false);
});
