import { expect, mock, test } from "bun:test";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";
import { fakeHerdr } from "./fake-herdr";

const shared = new Map<string, unknown>();
const reason = "Worker is still quiet after one automatic nudge. Check t1 to decide how to recover.";
const task = { id: 1, ref: "TEST-1", state: "running", status: "needs", needs: "attention", why: reason,
  title: "Fix the build", tab: "tab1", live: [{ address: "t1" }] };
const lists = [{ name: "test", folder: "/test", tasks: [task,
  { ...task, id: 2, ref: "TEST-2", status: "working", needs: null, why: null, attention: "Checks failing" }] }];

mock.module("herdr", () => fakeHerdr({
  appHome: () => "/herdr-app-test", terminals: () => [],
  shared: (key: string) => shared.get(key), setShared: (key: string, value: unknown) => shared.set(key, value),
  exec: async (_cmd: string, args: string[]) => ({ code: 0, stdout: args[0] === "list" ? JSON.stringify(lists) : "", stderr: "" }),
  readTextFile: async () => null,
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());

// This copy uses its own dirs.js cache. local.test.ts sets up the tab bar's cache with a real test home.
const { startInbox, items, countsByTab, reasonOf } = await import("../mods/workspace-status-chat/inbox.js");

test("a quiet worker escalation reaches Needs you and the tab count", async () => {
  const jobs: (() => Promise<void>)[] = [];
  startInbox({ spawn: (job: () => Promise<void>) => jobs.push(job), timer: { every() {} } });
  // The second callback reads tasks. The first is the hook watcher and runs continuously.
  await jobs[1]();
  const got = items();
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ kind: "check", ref: "TEST-1", attention: null, why: reason });
  expect(reasonOf(got[0])).toBe(reason);
  expect(countsByTab().get("tab1")).toBe(1);
});
