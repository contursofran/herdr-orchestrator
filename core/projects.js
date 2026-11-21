// The desktop Projects tree. Inputs are snapshots of the window's spaces, panes, agents and terminals.
import { chatPane, machineOf } from "./spaces.js";
import { place } from "./tasks.js";

const qualified = (machine, id) => id && (machine && !id.includes("/") ? `${machine}/${id}` : id);
const assistantId = (space, assistant) => assistant?.terminal?.address ?? `assistant:${assistant?.slot?.pane ?? space}`;
export const projectTaskKey = (machine, label) => JSON.stringify([machine ?? null, label]);
const activeTask = (task) => task?.state === "running" || task?.state === "ready";
const roleOf = (terminal) => terminal.labels?.["herdr.role"];
const helper = (terminal) => ["reviewer", "helper"].includes(roleOf(terminal));

const CLAUDE = { name: "Claude Code", icon: "icons/claude.svg", tint: false };
const HARNESSES = new Map([
  ["claude", CLAUDE],
  ["claude-code", CLAUDE],
  ["codex", { name: "Codex", icon: "icons/codex.svg", tint: false }],
]);

function harnessOf(terminal, agent) {
  // A detached agent can have only its launch label until it reports to Herdr.
  for (const program of [agent?.program, terminal.program]) {
    if (program?.agent && program.key !== "agent" && program.icon) return program;
  }
  for (const key of [agent?.app, terminal.status?.app, terminal.labels?.["herdr.agent"]]) {
    const harness = HARNESSES.get(key);
    if (harness) return harness;
  }
  return null;
}

function taskTarget(node) {
  const match = /^([\w.@-]+)#(\d+)$/.exec(node?.taskLabel);
  if (!match) return null;
  const [, slug, id] = match;
  const list = node.knownTask?.list;
  return {
    key: { machine: machineOf(node.terminal.address), slug, id: Number(id), folder: list?.folder ?? null },
    ref: list?.prefix ? `${list.prefix}-${id}` : id,
    title: node.knownTask?.task.title ?? null,
  };
}

// Match the native terminal's task label against the task store on that terminal's machine.
export function projectTasks(lists, machine) {
  return lists.flatMap((list) => list.tasks
    .map((task) => [projectTaskKey(machine, `${list.slug}#${task.id}`), { list, task }]));
}

function statusOf(node, taskPlace) {
  const { terminal, agentStatus } = node;
  if (terminal.state !== "live") return "stopped";
  if (agentStatus === "blocked" || agentStatus === "error") return "needs";
  if (!helper(terminal) && taskPlace?.section === "ready") return "ready";
  if (agentStatus === "working") return "working";
  if (!helper(terminal) && taskPlace?.section === "needs") return "needs";
  if (!helper(terminal) && taskPlace?.section === "working") return "working";
  return "idle";
}

/**
 * A map from space ID to flattened, depth-first agent rows. Assistants are resolved by the window
 * adapter from its tabs and chat slots. A parent edge keeps the closest worker/helper relationship.
 * Detached task workers fall back to the Assistant in their task's space, including after a restart.
 */
export function projectTree({ spaces, terminals, panes, agents, assistants, tasks = new Map(), now = Date.now() }) {
  const ids = new Set(spaces.map((space) => space.id));
  const byTab = new Map(spaces.flatMap((space) => (space.tabs ?? []).map((tab) => [tab.id, space.id])));
  const byPane = new Map(panes.map((pane) => [pane.pane, pane.tab]));
  const visiblePanes = new Map(panes.filter((pane) => pane.terminal).map((pane) => [pane.terminal, pane]));
  const listed = new Map(agents.map((agent) => [agent.address, agent]));
  const primary = new Map([...assistants].filter(([, value]) => value.terminal).map(([space, value]) => [value.terminal.address, space]));
  const nodes = new Map();
  for (const terminal of terminals) {
    const address = terminal.address;
    const machine = machineOf(address);
    const labels = terminal.labels ?? {};
    const agent = listed.get(address);
    const pane = visiblePanes.get(address);
    const task = labels["herdr.task"];
    const taskKey = task ? projectTaskKey(machine, task) : null;
    const knownTask = tasks.get(taskKey);
    const assistant = primary.get(address);
    const agentTab = qualified(machine, agent?.tab);
    const onScreen = byTab.has(pane?.tab) || byTab.has(agentTab);
    const shell = terminal.program?.shell || terminal.program?.key === "shell";
    if (knownTask && !activeTask(knownTask.task)) continue;
    if (!assistant && !agent && !terminal.program?.agent && !labels["herdr.agent"] && !helper(terminal) && !task) continue;
    if (!assistant && shell && !agent && !(task && labels["herdr.agent"])) continue;
    if (terminal.state !== "live" && !onScreen && !knownTask) continue;
    const runs = roleOf(terminal) === "reviewer" ? knownTask?.task.reviewers : knownTask?.task.agents;
    const latest = qualified(machine, runs?.[runs.length - 1]?.address);
    if (terminal.state !== "live" && !onScreen && latest && address !== latest) continue;
    const ownerTab = qualified(machine, labels["herdr.coordinator"]);
    const taskSpace = qualified(machine, labels["herdr.task.space"] ?? knownTask?.task.space);
    const tab = byPane.get(chatPane(terminal)) ?? pane?.tab ?? agentTab ?? qualified(machine, labels["herdr.tab"]);
    const taggedSpace = qualified(machine, labels["herdr.space"] ?? labels["herdr.coordinator.space"]);
    const space = [assistant, taskSpace, byTab.get(tab), qualified(machine, agent?.space), taggedSpace, byTab.get(ownerTab)].find((id) => ids.has(id));
    nodes.set(address, { terminal, space, assistant: Boolean(assistant), taskKey, taskLabel: task, knownTask,
      parent: qualified(machine, terminal.parent), agentStatus: agent?.status ?? terminal.status, agent });
  }
  // A child agent without its own space uses the closest parent that has one.
  for (const node of nodes.values()) {
    if (node.space) continue;
    const visited = new Set([node.terminal.address]);
    for (let parent = nodes.get(node.parent); parent && !visited.has(parent.terminal.address); parent = nodes.get(parent.parent)) {
      if (parent.space) { node.space = parent.space; break; }
      visited.add(parent.terminal.address);
    }
  }
  const working = new Map(), helpers = new Map();
  for (const node of nodes.values()) {
    if (!node.knownTask || node.terminal.state !== "live") continue;
    const target = helper(node.terminal) ? helpers : working;
    if (!target.has(node.taskKey)) target.set(node.taskKey, []);
    const { terminal, agentStatus } = node;
    target.get(node.taskKey).push({
      address: terminal.address, status: agentStatus === "error" ? "blocked" : agentStatus ?? null,
      role: roleOf(terminal), turn: terminal.turn, since: terminal.status_ms,
    });
  }
  const taskPlaces = new Map();
  const roots = new Map(), children = new Map(), projects = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const node of nodes.values()) {
    if (!node.space) continue;
    const address = node.terminal.address;
    add(projects, node.space, address);
    const parent = nodes.get(node.parent);
    const assistant = assistantId(node.space, assistants.get(node.space));
    if (node.assistant) add(roots, node.space, address);
    else if (parent && parent !== node && parent.space === node.space && (!node.taskKey || parent.taskKey || parent.assistant))
      add(children, node.parent, address);
    else if (node.taskKey) add(children, assistant, address);
    else add(roots, node.space, address);
  }

  const out = new Map();
  for (const [space, members] of projects) {
    const assistant = assistantId(space, assistants.get(space));
    const rows = [], visited = new Set();
    // This fallback row keeps workers attached while the Assistant's chat waits for a new process.
    const workers = members.filter((id) => nodes.get(id)?.taskKey && id !== assistant);
    const synthetic = !nodes.has(assistant) && workers.length > 0;
    // Reach any cycles of workers below the Orchestrator before starting the other roots.
    const starts = [assistant, ...workers, ...(roots.get(space) ?? []), ...members];
    for (const start of starts) {
      if (!nodes.has(start) && !synthetic) continue;
      const stack = [{ id: start, depth: nodes.get(start)?.taskKey && start !== assistant ? 1 : 0, inherited: null }];
      while (stack.length) {
        const { id, depth, inherited } = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.get(id);
        if (!node && id !== assistant) continue;
        const context = node?.taskLabel ? node : inherited;
        const task = context?.knownTask?.task;
        let taskPlace;
        if (node?.knownTask) {
          const key = node.taskKey;
          if (!taskPlaces.has(key)) {
            taskPlaces.set(key, place(node.knownTask.list, node.knownTask.task, {
              live: working.get(key) ?? [], helpers: helpers.get(key) ?? [], now,
            }));
          }
          taskPlace = taskPlaces.get(key);
        }
        const k = node?.terminal;
        const isAssistant = node?.assistant || !node;
        const role = isAssistant ? "assistant" : roleOf(k) ?? (node.taskKey ? "worker" : null);
        rows.push({
          id, depth, role,
          title: isAssistant ? "Orchestrator" : task?.title || k.name || k.title || k.program?.name || k.template || k.address,
          state: node ? statusOf(node, taskPlace) : "stopped",
          address: k?.address ?? null, live: k?.state === "live",
          harness: k && (isAssistant || role === "worker") ? harnessOf(k, node.agent) : null,
          slot: isAssistant ? assistants.get(space)?.slot ?? null : null,
          task: !isAssistant ? taskTarget(helper(k) ? inherited ?? node : node) : null,
        });
        for (const child of (children.get(id) ?? []).slice().reverse()) stack.push({ id: child, depth: depth + 1, inherited: context });
      }
    }
    out.set(space, rows);
  }
  return out;
}

// A project and its subordinate worktree rows stay together when inactive projects are folded.
export function splitProjects(rows, visible) {
  const groups = [];
  for (const row of rows) {
    if (!row.tree || !groups.length) groups.push([]);
    groups[groups.length - 1].push(row);
  }
  const shown = [], idle = [];
  for (const group of groups) (group.some(visible) ? shown : idle).push(...group);
  return { shown, idle };
}
