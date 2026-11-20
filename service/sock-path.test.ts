// SHEP-141 review: the service's socket stays under the 104/108-byte limit however long the home is, and never in a
// folder another user could have made.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { sockPath } from "./paths.ts";

const base = mkdtempSync("/tmp/herdr-sock-test-");
afterAll(() => { rmSync(base, { recursive: true, force: true }); rmSync("/tmp/herdr-orch-999999", { recursive: true, force: true }); });
const uid = process.getuid!();
const long = `/h/${"x".repeat(64)}/.local/state/herdr-orchestrator/service`;

test("a short state folder keeps the socket there", () => {
  expect(sockPath("/h/u/.local/state/herdr-orchestrator/service", uid, {})).toBe("/h/u/.local/state/herdr-orchestrator/service/service.sock");
});

test("a long one uses the user's runtime folder first", () => {
  expect(sockPath(long, uid, { XDG_RUNTIME_DIR: `/run/user/${uid}` })).toBe(`/run/user/${uid}/herdr-orch-service.sock`);
});

test("then the old short path, when it still leads to the same folder", () => {
  const home = join(base, "h"), data = join(base, "d", "x".repeat(70), "service");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(home, ".herdr"), { recursive: true });
  symlinkSync(data, join(home, ".herdr", "herdr-orchestrator"));
  expect(sockPath(data, uid, {}, home)).toBe(join(home, ".herdr", "herdr-orchestrator", "service.sock"));
});

test("/tmp only when the folder is this user's own, never a link or someone else's", () => {
  const p = sockPath(long, 999_999, {}, "/nonexistent");   // a uid this test can't own: its /tmp folder is refused
  expect(p).toBe(join(long, "service.sock"));
  const mineP = sockPath(long, uid, {}, "/nonexistent");
  expect(Buffer.byteLength(mineP)).toBeLessThan(104);
});
