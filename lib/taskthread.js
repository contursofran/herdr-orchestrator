// Open a task in the window's Tasks panel. Shared with the chat and the desktop Projects sidebar.
import { layout, run, setShared } from "herdr";

export const STACK = "tasks", LIST = "tasks-list", THREAD = "tasks-thread";
export const BODY = "tasks-thread-body", CHAT = "tasks-thread-chat", TERM = "tasks-thread-term";

export function findLayoutNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findLayoutNode(child, id);
    if (found) return found;
  }
  return null;
}

export const hasTaskThread = (node) => Boolean(findLayoutNode(node, THREAD));

export function openTaskThread(terminal, task, title, { key = null, openTerminal = false } = {}) {
  setShared("tasks.thread", { terminal, task: task ?? null, title: title ?? null, key, openTerminal, at: Date.now() });
  run("layout.select", { stack: "panel-body", child: STACK });
  run("layout.select", { stack: STACK, child: THREAD });
  if (findLayoutNode(layout(), BODY)) run("layout.select", { stack: BODY, child: CHAT });
  run("layout.show", { id: "panel" });
}
