import test from "node:test";
import assert from "node:assert/strict";
import { needsRenewal } from "../src/auth.mjs";

const hour = 60 * 60 * 1000;

test("renewal is not needed for env-based auth", () => {
  assert.equal(needsRenewal({ status: "logged-in", via: "env" }, 3 * 24 * hour), false);
});

test("renewal is not needed when logged out", () => {
  assert.equal(needsRenewal({ status: "logged-out" }, 3 * 24 * hour), false);
});

test("renewal is not needed when the key has plenty of life left", () => {
  const auth = { status: "logged-in", via: "sdk", apiKeyExpiresAtMs: Date.now() + 30 * 24 * hour };
  assert.equal(needsRenewal(auth, 3 * 24 * hour), false);
});

test("renewal is needed when the key is inside the renewal window", () => {
  const auth = { status: "logged-in", via: "sdk", apiKeyExpiresAtMs: Date.now() + 24 * hour };
  assert.equal(needsRenewal(auth, 3 * 24 * hour), true);
});

test("renewal is needed after expiry", () => {
  const auth = { status: "logged-in", via: "sdk", apiKeyExpiresAtMs: Date.now() - hour };
  assert.equal(needsRenewal(auth, 3 * 24 * hour), true);
});

test("renewal is not needed when expiry is unknown", () => {
  const auth = { status: "logged-in", via: "sdk" };
  assert.equal(needsRenewal(auth, 3 * 24 * hour), false);
});
