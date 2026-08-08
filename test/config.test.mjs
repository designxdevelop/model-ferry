import test from "node:test";
import assert from "node:assert/strict";
import { createLocalToken, LEGACY_LOCAL_TOKEN } from "../src/config.mjs";
import { workingDirectory } from "../src/protocol.mjs";

test("createLocalToken returns a high-entropy hex secret", () => {
  const token = createLocalToken();
  assert.notEqual(token, LEGACY_LOCAL_TOKEN);
  assert.match(token, /^[a-f0-9]{48}$/);
  assert.notEqual(createLocalToken(), token);
});

test("workingDirectory prefers x-opencode-directory and decodes URI encoding", () => {
  const cwd = workingDirectory({
    headers: {
      "x-opencode-directory": encodeURIComponent("/Users/austin/My Project"),
      "x-working-directory": "/tmp/other"
    }
  });
  assert.equal(cwd, "/Users/austin/My Project");
});

test("workingDirectory falls back through known headers", () => {
  const cwd = workingDirectory({
    headers: {
      "x-project-path": "/repo"
    }
  });
  assert.equal(cwd, "/repo");
});
