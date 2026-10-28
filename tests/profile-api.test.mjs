import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("profile API: secure credentials, durable throttling, cross-device revisions and private record isolation", { timeout: 90000 }, () => {
  const result = spawnSync("python3", ["-I", "-B", "-m", "unittest", "discover", "-s", "tests", "-p", "test_profile_api.py", "-v"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
    timeout: 85000,
    maxBuffer: 1_000_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || "Profile API tests failed");
  assert.match(result.stderr, /Ran 13 tests/);
  assert.match(result.stderr, /\bOK\b/);
});
