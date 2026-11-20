import { expect, test } from "bun:test";
import { projectTasks, projectTree, splitProjects } from "./projects.js";

const space = { id: "shop", tabs: [{ id: "assistant-tab" }, { id: "notes-tab" }] };
const assistant = { address: "t1", state: "live", status: "idle", labels: { "herdr.role": "coordinator" } };
const worker = (address, id, extra = {}) => ({
  address, state: "live", status: "working", ...extra,
  labels: { "herdr.task": `shop#${id}`, "herdr.task.space": "shop", ...extra.labels },
});
const tasks = projectTasks([{ slug: "shop", tasks: [
  { id: 1, title: "Add checkout", state: "running" }, { id: 2, title: "Check receipts", state: "ready" },
  { id: 3, title: "Fix inventory", state: "running" }, { id: 4, title: "Old task", state: "done" },
] }], null);
const read = (terminals, overrides = {}) => projectTree({
  spaces: [space], terminals, panes: [], agents: [], assistants: new Map([[space.id, { terminal: assistant }]]),
  tasks: new Map(tasks), now: 1_000_000, ...overrides,
});
const rows = (tree) => tree.get("shop")?.map(({ id, depth, state, title }) => [id, depth, state, title]);

test("an empty project has no agent rows even if it has an Assistant chat slot", () => {
  expect(read([], { assistants: new Map([["shop", { slot: { pane: "chat" } }]]) }).size).toBe(0);
});

test("an Assistant and an ordinary chat agent are sibling rows", () => {
  const other = { address: "t9", state: "live", status: "working", name: "Explore", program: { agent: true }, labels: { "herdr.chat": "notes" } };
  expect(rows(read([other, assistant], { panes: [{ pane: "notes", tab: "notes-tab" }] }))).toEqual([
    ["t1", 0, "idle", "Assistant"], ["t9", 0, "working", "Explore"],
  ]);
});

test("a worker's children stay at their actual depth even with a coordinator label", () => {
  const t2 = worker("t2", 1, { parent: "t1" });
  const t3 = worker("t3", 1, { parent: "t2", status: "blocked", labels: { "herdr.role": "reviewer", "herdr.coordinator": "assistant-tab" } });
  const t4 = { address: "t4", parent: "t3", state: "live", status: "working", program: { agent: true } };
  expect(rows(read([t4, t3, t2, assistant]))).toEqual([
    ["t1", 0, "idle", "Assistant"], ["t2", 1, "working", "Add checkout"],
    ["t3", 2, "needs", "Add checkout"], ["t4", 3, "working", "Add checkout"],
  ]);
});

test("scheduled and Autopilot workers without a coordinator label use their task space", () => {
  expect(rows(read([assistant, worker("auto", 1), worker("scheduled", 2, { status: "idle" })]))).toEqual([
    ["t1", 0, "idle", "Assistant"], ["auto", 1, "working", "Add checkout"], ["scheduled", 1, "ready", "Check receipts"],
  ]);
});

test("a worker follows the restarted Assistant even when its old parent and tab are gone", () => {
  const replacement = { ...assistant, address: "t7" };
  const workerFromBefore = worker("t2", 1, { parent: "t1", labels: { "herdr.coordinator": "old-tab" } });
  expect(rows(read([{ ...assistant, state: "finished" }, workerFromBefore, replacement], {
    assistants: new Map([["shop", { terminal: replacement }]]),
  }))).toEqual([["t7", 0, "idle", "Assistant"], ["t2", 1, "working", "Add checkout"]]);
  expect(rows(read([workerFromBefore], { assistants: new Map([["shop", { slot: { pane: "chat" } }]]) }))).toEqual([
    ["assistant:chat", 0, "stopped", "Assistant"], ["t2", 1, "working", "Add checkout"],
  ]);
});

test("task metadata and parent IDs stay on the worker's machine", () => {
  const remote = { ...space, id: "vm/shop", tabs: space.tabs.map(({ id }) => ({ id: `vm/${id}` })) };
  const remoteAssistant = { ...assistant, address: "vm/t1" };
  const remoteTasks = projectTasks([{ slug: "shop", tasks: [{ id: 1, title: "Remote task", state: "running" }] }], "vm");
  const tree = read([assistant, remoteAssistant, worker("vm/t2", 1, { parent: "t1", state: "finished" })], {
    spaces: [space, remote], assistants: new Map([["shop", { terminal: assistant }], ["vm/shop", { terminal: remoteAssistant }]]),
    tasks: new Map([...tasks, ...remoteTasks]),
  });
  expect(tree.get("shop")).toHaveLength(1);
  expect(tree.get("vm/shop")?.[1]).toMatchObject({ id: "vm/t2", depth: 1, title: "Remote task", state: "stopped" });
});

test("finished tasks leave the Projects tree even if their agent's shell is still live", () => {
  expect(rows(read([assistant, worker("t2", 4)]))).toEqual([["t1", 0, "idle", "Assistant"]]);
});

test("cyclic terminal parents never repeat or hide their rows", () => {
  const a = worker("a", 1, { parent: "b" }), b = worker("b", 3, { parent: "a" });
  expect(rows(read([assistant, a, b]))?.map(([id]) => id)).toEqual(["t1", "a", "b"]);
});

test("folds inactive projects with their worktrees while keeping active worktree groups", () => {
  const root = { w: { id: "root" }, tree: null }, branch = { w: { id: "branch" }, tree: "└─" };
  const idle = { w: { id: "idle" }, tree: null }, idleBranch = { w: { id: "idle-branch" }, tree: "└─" };
  expect(splitProjects([root, branch, idle, idleBranch], (r) => r.w.id === "branch")).toEqual({
    shown: [root, branch], idle: [idle, idleBranch],
  });
});
