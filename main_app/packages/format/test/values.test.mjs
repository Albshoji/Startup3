import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, classOf, maskSummary, isSecretName } from "../dist/index.js";

test("summarize keeps values short and readable", () => {
  assert.equal(summarize("Pão"), '"Pão"');
  assert.equal(summarize(9.9), "9.9");
  assert.equal(summarize(undefined), "undefined");
  assert.equal(summarize({ nome: "Pão", preco: 9.9 }), '{nome: "Pão", preco: 9.9}');
  assert.equal(summarize([1, 2, 3, 4, 5, 6]), "[1, 2, 3, 4, 5, …]");
  assert.equal(summarize({ a: { b: 1 } }), "{a: [Object]}");
  assert.ok(summarize("x".repeat(500)).length <= 101);
  assert.equal(summarize(function formatarPreco() {}), "[Function formatarPreco]");
  assert.equal(summarize(new Error("falhou")), "[Error: falhou]");
});

test("summarize never touches thenables nor getters", () => {
  let touched = false;
  const thenable = { get then() { touched = true; return undefined; } };
  assert.equal(summarize(thenable), "Promise");
  const withGetter = { get segredo() { touched = true; return 1; } };
  assert.equal(summarize(withGetter), "{segredo: [getter]}");
  assert.equal(touched, false);
  assert.equal(summarize(Promise.resolve(1)), "Promise");
});

test("classOf returns the constructor name", () => {
  assert.equal(classOf("a"), "string");
  assert.equal(classOf([]), "Array");
  assert.equal(classOf(new Map()), "Map");
  assert.equal(classOf(null), "null");
  assert.equal(classOf(Object.create(null)), "Object");
});

test("maskSummary hides secrets, tokens and personal data", () => {
  assert.equal(maskSummary("senha", '"segredo123"'), "[mascarado]");
  assert.equal(maskSummary("dados", '{email: "a@b.com", password: "x"}'), '{email: "[e-mail]", password: "[mascarado]"}');
  assert.equal(maskSummary("t", '"eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl"'), '"[token]"');
  assert.equal(maskSummary("doc", '"123.456.789-09"'), '"[cpf]"');
  assert.equal(maskSummary("c", '"4111 1111 1111 1111"'), '"[cartão]"');
  assert.equal(maskSummary("agora", "1759700000000"), "1759700000000", "timestamps are not cards");
  assert.equal(isSecretName("apiKey"), true);
  assert.equal(isSecretName("telefone", ["Telefone"]), true);
  assert.equal(isSecretName("nome"), false);
});
