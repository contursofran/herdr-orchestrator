// The window's Spaces sidebar (mods/spaces-chat) draws with no voice row (GitHub #869, SHEP-158): voiceRow() is null on
// a wide sidebar and with the voice add-on off, and herdr-app's child() throws on null, which blanked the whole sidebar.
// No window runs here, so gpui and herdr are stand-ins: an element's child()/children() refuse what herdr-app refuses.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { BRAILLE_FRAMES, BRAILLE_MS } from "../core/braille.js";
import { fakeHerdr } from "./fake-herdr";
import { fakeGpuiBase, fakeGpuiKit } from "./fake-gpui";

const EL = Symbol("element");
const ok = (v: unknown) => typeof v === "string" || typeof v === "number" || (v !== null && typeof v === "object" && (v as any)[EL]);
function el(asset?: string): any {
  const self: any = new Proxy({ [EL]: true, parts: [] as unknown[], elementId: "", indent: 0, click: null as Function | null,
    hoverChanged: null as Function | null, tip: "", label: "", asset, animation: null as [string[], number] | null }, {
    get(target, k) {
      if (k === EL) return true;
      if (k === "child") return (v: unknown) => {
        if (!ok(v)) throw new TypeError(`child(value) expects an element, a string, or an entity from cx.new(Class, props); got ${v}`);
        target.parts.push(v);
        return self;
      };
      if (k === "children") return (vs: unknown[]) => {
        for (const v of vs) if (!ok(v)) throw new TypeError(`children() got ${v}`);
        target.parts.push(...vs);
        return self;
      };
      if (k === "id") return (id: string) => { target.elementId = id; return self; };
      if (k === "pl") return (indent: number) => { target.indent = indent; return self; };
      if (k === "on_click") return (click: Function) => { target.click = click; return self; };
      if (k === "on_hover") return (hover: Function) => { target.hoverChanged = hover; return self; };
      if (k === "tooltip") return (tip: string) => { target.tip = tip; return self; };
      if (k === "accessibility_label") return (label: string) => { target.label = label; return self; };
      if (k === "frames") return (frames: string[], ms: number) => { target.animation = [frames, ms]; return self; };
      if (k === "when") return (c: unknown, f: (e: any) => any) => (c ? f(self) : self);
      if (k === "then") return undefined;
      return (target as any)[k] ?? (() => self);
    },
  });
  return self;
}

const shared = new Map<string, unknown>();
// #1010: a linked machine's Autopilot file, read there (exec with { on }); this computer's through readTextFile.
let machinesNow: { name: string | null; layout?: string }[] = [];
let localPilot: string | null = null;
const farFiles: Record<string, string> = {};
const execImpl = async (_cmd: string, args: string[], opts?: { on?: string }) =>
  opts?.on && String(args?.[1] ?? "").includes(".autopilot.json") && farFiles[opts.on] != null
    ? { code: 0, stdout: farFiles[opts.on], stderr: "" } : { code: 1, stdout: "", stderr: "" };
let sidebarPx = 260;
let platform = "macos";
const space = (id: string, active = false) => ({ id, name: id, active, machine: null as string | null, tabs: [] as unknown[], folder: "/tmp/x" });
let liveSpaces = [space("s1", true), space("s2")];
let liveTerminals: object[] = [], livePanes: object[] = [];
let readProjects: ((args: string[], on?: string) => string | undefined) | null = null;
let getTerminal: ((address: string) => object) | null = null;
let readModel: ((args: string[], on?: string) => string | undefined) | null = null;
let taskTerminal: string | null = null;
let taskPanel = true;
const ran: [string, unknown][] = [];
const labels: string[][] = [];
const reply = (stdout: string) => ({ code: 0, stdout, stderr: "" });
const theme = new Proxy({}, { get: () => "#000000" });
const herdr = {
  agents: () => [], panes: () => livePanes, terminals: () => liveTerminals, spaces: () => liveSpaces,
  appHome: () => "/nonexistent-app", home: () => "/nonexistent-home",
  exec: async (cmd: string, args: string[], opts?: { on?: string }) => {
    const text = args[2] === "projects" ? readProjects?.(args, opts?.on) : readModel?.(args, opts?.on);
    return text === undefined ? execImpl(cmd, args, opts) : reply(text);
  }, hc: async (args: string[]) => {
    if (args[0] === "label") { labels.push(args); return reply(""); }
    if (args[0] === "get" && getTerminal) return reply(JSON.stringify(getTerminal(args[1])));
    return { code: 1, stdout: "", stderr: "" };
  },
  run: (command: string, args: unknown) => { ran.push([command, args]); },
  openOverlay: () => {}, closeOverlay: () => {}, notify: () => {}, playSound: () => {},
  shared: (k: string) => shared.get(k), setShared: (k: string, v: unknown) => { shared.set(k, v); },
  machines: () => machinesNow, focused: () => null, knownAgents: () => [], settings: () => ({}),
  readTextFile: async (path: string) => (path.endsWith("/.autopilot.json") ? localPilot : null), writeTextFile: async () => {}, watchFolder: () => {},
  props: () => ({}), theme: () => theme, window: () => ({ platform }), nextCommand: () => null,
  layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: sidebarPx } }, ...(taskPanel ? [
    { id: "panel", hidden: true, children: [{ id: "panel-body", children: [{ id: "tasks", children: [
      { id: "tasks-thread", children: [{ id: "tasks-thread-body", active: "tasks-thread-chat", children: [
        { id: "tasks-thread-chat" }, { id: "tasks-thread-term", content: { terminal: taskTerminal } },
      ] }] },
    ] }] }] },
  ] : [])] }),
};
mock.module("herdr", () => fakeHerdr(herdr));
mock.module("gpui-kit", () => fakeGpuiKit({ View: class {}, div: el, svg: el, image: el }));
mock.module("gpui-base", () => fakeGpuiBase({
  v_flex: el, h_flex: el, Input: el, InputState: class {}, VirtualListScrollHandle: class {}, v_virtual_list: el, Scrollbar: el,
}));
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { default: Spaces, pilotKey } = await import("../mods/spaces-chat/main.js");
const { PanelHost } = await import("../mods/chat/panel.js");
const { default: Pane } = await import("../mods/pane-chat/main.js");
const cx: any = new Proxy({ timer: { every: () => {}, after: () => {} } }, { get: (t, k) => (t as any)[k] ?? (() => {}) });
const sidebar = () => { const s: any = new Spaces(); s.init({}, cx); return s.render(cx); };

describe("Spaces sidebar without a voice row (GitHub #869)", () => {
  beforeEach(() => { shared.clear(); sidebarPx = 260; machinesNow = []; liveSpaces = [space("s1", true), space("s2")]; });

  test("wide sidebar, voice on: no voice row, still draws", () => {
    expect(sidebar()[EL]).toBe(true);
  });

  test("voice add-on off: no voice row, wide or narrow", () => {
    shared.set("addons.off", ["voice"]);
    expect(sidebar()[EL]).toBe(true);
    sidebarPx = 100;
    expect(sidebar()[EL]).toBe(true);
  });

  test("a loading machine has a Braille spinner with a label in the collapsed sidebar", () => {
    machinesNow = [{ name: null, layout: "loading" }];
    const s: any = new Spaces();
    s.init({}, cx);
    const [row] = s.grouped(theme, true, [], null);
    expect(row.elementId).toBe("machine-loading-local");
    expect(row.parts[0].animation).toEqual([BRAILLE_FRAMES, BRAILLE_MS]);
    expect(row.parts[0].label).toBe("Loading");
  });

  test("a newly created space joins the sidebar after its folder lookup grace period", () => {
    const s: any = new Spaces(); s.init({}, cx);
    liveSpaces.push(space("s3"));
    s.visible();
    // The window gives git lookup a moment to avoid a row jumping to its repo. It must eventually appear.
    s.born.s3 = Date.now() - 1600;
    expect(s.visible().map((r: any) => r.w.id)).toContain("s3");
    expect(s.render(cx)[EL]).toBe(true);
  });

  test("the narrow rail keeps its voice button", () => {
    sidebarPx = 100;
    const s: any = new Spaces(); s.init({}, cx);
    expect(s.voiceRow(theme, true)?.[EL]).toBe(true);
    expect(s.render(cx)[EL]).toBe(true);
  });
});

describe("Autopilot rocket for a linked machine's spaces (GitHub #1010)", () => {
  const remote = (id: string) => ({ id: `vmb/${id}`, name: id, active: false, machine: "vmb", tabs: [], folder: "/tmp/y" });
  // cx.spawn runs the read at once and hands back its promise, so the test waits for it.
  let last: Promise<unknown> | null = null;
  const run: any = new Proxy({ timer: { every: () => {}, after: () => {} }, spawn: (f: any) => { last = f(run); } }, { get: (t, k) => (t as any)[k] ?? (() => {}) });
  const read = async (s: any) => { s.readPilots(run); await last; };

  beforeEach(() => {
    shared.clear(); sidebarPx = 260;
    liveSpaces = [space("s1", true), remote("sp1"), remote("sp2")];
    machinesNow = [{ name: null, layout: "ready" }, { name: "vmb", layout: "ready" }];
    localPilot = JSON.stringify({ spaces: { s1: { on: true } } });
    farFiles.vmb = JSON.stringify({ spaces: { sp1: { on: true }, sp2: { on: true, inflight: true } } });
  });

  test("a linked machine's space on Autopilot gets the rocket, as this computer's does", async () => {
    const s: any = new Spaces(); s.init({}, cx); s.pilotTick = 0;
    await read(s);
    expect(s.pilots.get(pilotKey(liveSpaces[0]))).toBe("on");
    expect(s.pilots.get(pilotKey(liveSpaces[1]))).toBe("on");
    expect(s.pilots.get(pilotKey(liveSpaces[2]))).toBe("waking");
    expect(s.pilotMark(liveSpaces[1], theme)?.[EL]).toBe(true);
    expect(s.render(cx)[EL]).toBe(true);
  });

  test("an offline machine isn't asked; what it said last stays until it answers", async () => {
    const s: any = new Spaces(); s.pilots = new Map();
    await read(s);
    machinesNow = [{ name: null, layout: "ready" }, { name: "vmb", layout: "offline" }];
    delete farFiles.vmb;
    await read(s); await read(s); await read(s);
    expect(s.pilots.get("vmb/sp1")).toBe("on");
  });

  test("turned off there: its rocket goes at the next read there", async () => {
    const s: any = new Spaces(); s.pilots = new Map();
    await read(s);
    farFiles.vmb = JSON.stringify({ spaces: { sp1: { on: false } } });
    await read(s); await read(s); await read(s);
    expect(s.pilots.has("vmb/sp1")).toBe(false);
    expect(s.pilotMark(liveSpaces[1], theme)).toBeNull();
  });
});

describe("Desktop Projects tree", () => {
  const byId = (tree: any, id: string): any => tree?.elementId === id ? tree
    : tree?.parts?.map((child: any) => byId(child, id)).find(Boolean);
  const words = (tree: any): string[] => typeof tree === "string" ? [tree]
    : tree?.parts?.flatMap(words) ?? [];
  const ids = (tree: any): string[] => tree?.parts ? [tree.elementId, ...tree.parts.flatMap(ids)] : [];
  const assistant = (id = "t1") => ({
    address: id, state: "live", status: "idle", labels: { "herdr.role": "coordinator", "herdr.chat": "chat" },
  });
  const worker = (id: string, parent: string | null, status = "working") => ({
    address: id, parent, state: "live", status,
    labels: { "herdr.task": "shop#1", "herdr.task.space": "s1" },
  });
  let s: any;

  beforeEach(() => {
    shared.clear();
    sidebarPx = 320;
    platform = "macos";
    machinesNow = [{ name: null, layout: "ready" }];
    liveSpaces = [{ ...space("s1", true), tabs: [{ id: "assistant-tab" }] }, space("s2"), space("s3"), space("pinned")];
    livePanes = [{ pane: "chat", tab: "assistant-tab", mod: "chat" }];
    liveTerminals = [];
    readProjects = null;
    readModel = null;
    getTerminal = null;
    taskTerminal = null;
    taskPanel = true;
    ran.length = 0;
    labels.length = 0;
    shared.set("spaces-chat", {
      pinned: ["pinned"],
      sections: [{ id: "ideas", name: "Ideas", machine: null, spaces: ["s3"], folded: false }],
    });
    s = new Spaces();
    s.init({}, cx);
  });

  test("folds inactive projects into one row and expands them within their sections", () => {
    const collapsed = s.render(cx);
    expect(words(collapsed)).toContain("Projects");
    expect(words(collapsed)).toContain("2 more projects");
    expect(byId(collapsed, "space-s1")).toBeDefined();
    expect(byId(collapsed, "space-pinned")).toBeDefined();
    expect(byId(collapsed, "space-s2")).toBeUndefined();
    expect(byId(collapsed, "space-s3")).toBeUndefined();
    byId(collapsed, "more-projects-local").click({}, cx);
    const expanded = s.render(cx);
    expect(byId(expanded, "space-s2")).toBeDefined();
    expect(byId(expanded, "space-s3")).toBeDefined();
    expect(ids(expanded).indexOf("section-ideas")).toBeLessThan(ids(expanded).indexOf("space-s3"));
  });

  test("renders a parked Orchestrator even if it has no workers", () => {
    liveTerminals = [assistant()];
    const row = byId(s.render(cx), "project-agent-t1");
    expect(words(row)).toEqual(["Orchestrator", "⌃1", "Idle"]);
    expect(row.parts).toHaveLength(3);
    expect(s.projectRows.get("s1")).toHaveLength(1);
  });

  test("renders accessible harness icons as the first child of Orchestrator and worker rows", () => {
    const lead = assistant();
    const labeled = worker("t2", "t1");
    const claude = worker("t3", null, "blocked");
    liveTerminals = [{ ...lead, labels: { ...lead.labels, "herdr.agent": "codex" } },
      { ...labeled, labels: { ...labeled.labels, "herdr.agent": "codex" } },
      { ...claude, labels: { ...claude.labels, "herdr.agent": "claude" } }];
    const tree = s.render(cx);
    for (const [terminal, name, file] of [["t1", "Codex", "codex"], ["t2", "Codex", "codex"], ["t3", "Claude Code", "claude"]]) {
      const row = byId(tree, `project-agent-${terminal}`);
      const icon = byId(row, `project-harness-${terminal}`);
      expect(row.parts[0]).toBe(icon);
      expect(icon.label).toBe(name);
      expect(icon.parts[0].asset).toBe(`icons/${file}.svg`);
    }
  });

  test("reads only the worker's task list and renders detached and nested workers by task title", async () => {
    liveTerminals = [assistant(), worker("t2", null), worker("t3", "t2", "blocked")];
    readProjects = (args) => {
      expect(args.slice(3)).toEqual(["shop.json"]);
      return 'shop.json\n{"folder":"/tmp/x","tasks":[{"id":1,"state":"running","title":"Wire up checkout"}]}\n@@herdr-task-list@@\n';
    };
    let wait: Promise<unknown> | undefined;
    const reader = { spawn: (f: (inner: typeof cx) => Promise<unknown>) => { wait = f(cx); } };
    s.readProjectTasks(reader);
    await wait;
    const tree = s.render(cx);
    const head = byId(tree, "project-agent-t1"), direct = byId(tree, "project-agent-t2"), nested = byId(tree, "project-agent-t3");
    expect(words(direct)).toEqual(["Wire up checkout", "Working"]);
    expect(words(nested)).toEqual(["Wire up checkout", "Needs you"]);
    expect(head.indent).toBeLessThan(direct.indent);
    expect(direct.indent).toBeLessThan(nested.indent);
  });

  test("keeps a worker beneath the replacement Assistant after restart", () => {
    liveTerminals = [assistant(), worker("t2", "t1")];
    expect(byId(s.render(cx), "project-agent-t1")).toBeDefined();
    liveTerminals = [{ ...assistant(), state: "finished" }, assistant("t7"), worker("t2", "t1")];
    const tree = s.render(cx);
    expect(byId(tree, "project-agent-t1")).toBeUndefined();
    const replacement = byId(tree, "project-agent-t7"), child = byId(tree, "project-agent-t2");
    expect(replacement.indent).toBeLessThan(child.indent);
  });

  test("clicking a parked Assistant selects its project and focuses the chat", () => {
    liveTerminals = [assistant()];
    liveSpaces[0].active = false;
    liveSpaces[1].active = true;
    byId(s.render(cx), "project-agent-t1").click({}, cx);
    expect(ran.slice(-3)).toEqual([
      ["space.select", { id: "s1" }], ["tab.select", { id: "assistant-tab" }], ["pane.focus", { pane: "chat" }],
    ]);
  });

  test("clicking or using a number for a parked standalone agent focuses its chat", () => {
    liveSpaces[0].tabs.push({ id: "notes-tab" });
    livePanes.push({ pane: "notes", tab: "notes-tab", mod: "chat" });
    liveTerminals = [assistant(), { address: "t5", state: "live", program: { agent: true }, labels: { "herdr.chat": "notes" } }];
    byId(s.render(cx), "project-agent-t5").click({}, cx);
    const commands: [string, unknown][] = [["tab.select", { id: "notes-tab" }], ["pane.focus", { pane: "notes" }]];
    expect(ran).toEqual(commands);
    ran.length = 0;
    s.focusMainAgent(2);
    expect(ran).toEqual(commands);
  });

  test("opening a Terminal-mode Orchestrator targets its pane even as the header mounts", () => {
    liveSpaces[0].active = false;
    liveSpaces[1].active = true;
    const target = { pane: "work", tab: "assistant-tab", terminal: "t1", program: { key: "codex" } };
    const previous = { pane: "other", tab: "other-tab", terminal: "t9", program: { key: "codex" }, focused: true };
    livePanes = [target, previous];
    liveTerminals = [{ ...assistant(), labels: { "herdr.role": "coordinator", "herdr.coordinator.space": "s1" } }];
    byId(s.render(cx), "project-agent-t1").click({}, cx);
    expect(ran).toEqual([["space.select", { id: "s1" }], ["tab.select", { id: "assistant-tab" }], ["pane.focus", { pane: "work" }]]);
    expect(shared.get("pane-chat.openreq")).toMatchObject({ pane: "work", terminal: "t1" });
    const timers: Function[] = [];
    const context = { timer: { after: (_ms: number, fn: Function) => timers.push(fn) } };
    const head = new Pane();
    head.born = Date.now();
    head.me = () => target;
    const toChat = mock(() => {});
    head.toChat = toChat;
    head.openRequestedChat(previous, context);
    expect(timers).toHaveLength(0);
    // Re-renders can schedule the same request, but its header consumes it only once.
    head.openRequestedChat(target, context);
    head.openRequestedChat(target, context);
    for (const fn of timers) fn(context);
    expect(toChat).toHaveBeenCalledTimes(1);
    expect(toChat).toHaveBeenCalledWith(target, context);
    expect(shared.get("pane-chat.openreq")).toBeNull();
  });

  test("clicking the stopped Assistant opens its registered chat while a worker remains", () => {
    livePanes.unshift({ pane: "elsewhere", tab: "assistant-tab", terminal: null });
    liveTerminals = [worker("t2", null)];
    shared.set("coordinator.slots", { waiting: { pane: "chat", tab: "assistant-tab", space: "s1" } });
    byId(s.render(cx), "project-agent-assistant:chat").click({}, cx);
    expect(ran.slice(-2)).toEqual([["tab.select", { id: "assistant-tab" }], ["pane.focus", { pane: "chat" }]]);
  });

  test("clicking a worker opens its task's chat and reveals the closed Tasks panel", () => {
    liveTerminals = [assistant(), worker("t2", null)];
    byId(s.render(cx), "project-agent-t2").click({}, cx);
    expect(shared.get("tasks.thread")).toMatchObject({
      terminal: "t2", task: "1", key: { slug: "shop", id: 1 }, openTerminal: false,
    });
    expect(ran.slice(-4)).toEqual([
      ["layout.select", { stack: "panel-body", child: "tasks" }],
      ["layout.select", { stack: "tasks", child: "tasks-thread" }],
      ["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-chat" }],
      ["layout.show", { id: "panel" }],
    ]);
  });

  for (const role of ["reviewer", "helper"]) {
    test(`clicking a ${role} without its own task opens the parent task on that child's terminal`, async () => {
      liveTerminals = [assistant(), worker("t2", null),
        { address: "t3", state: "live", status: "working", parent: "t2", labels: { "herdr.role": role } }];
      taskTerminal = "t3";
      byId(s.render(cx), "project-agent-t3").click({}, cx);
      expect(shared.get("tasks.thread")).toMatchObject({
        terminal: "t3", key: { slug: "shop", id: 1 }, openTerminal: true,
      });
      expect(ran).toContainEqual(["layout.show", { id: "panel" }]);
      const timers: Function[] = [];
      const jobs: Promise<unknown>[] = [];
      const headCx = { notify() {}, timer: { after: (_delay: number, fn: Function) => timers.push(fn), every() {} },
        spawn: (fn: Function) => jobs.push(fn(headCx)) };
      // The header can be mounting for the first time as the sidebar opens the Tasks panel.
      const head = new PanelHost(class {}, true);
      head.render(headCx);
      for (const fn of timers) fn(headCx);
      await Promise.all(jobs);
      expect(ran.slice(-2)).toEqual([
        ["layout.select", { stack: "tasks-thread-body", child: "tasks-thread-term" }],
        ["pane.focus", { terminal: "t3" }],
      ]);
    });
  }

  test("clicking an agent without a task uses agent.focus", () => {
    liveTerminals = [{ address: "t5", state: "live", program: { agent: true }, labels: { "herdr.tab": "assistant-tab" } }];
    byId(s.render(cx), "project-agent-t5").click({}, cx);
    expect(ran.at(-1)).toEqual(["agent.focus", { terminal: "t5" }]);
  });

  test("shortcut numbers follow Projects order and also work with the sidebar collapsed", () => {
    liveSpaces[3].tabs = [{ id: "pinned-tab" }];
    liveSpaces[2].tabs = [{ id: "ideas-tab" }];
    liveTerminals = [assistant(), worker("t2", null), ...["pinned", "ideas"].map((name) => ({
      address: name, state: "live", program: { agent: true }, labels: { "herdr.tab": `${name}-tab` },
    }))];
    const tree = s.render(cx);
    expect(words(byId(tree, "project-key-pinned"))).toEqual(["⌃1"]);
    expect(words(byId(tree, "project-key-t1"))).toEqual(["⌃2"]);
    expect(words(byId(tree, "project-key-ideas"))).toEqual(["⌃3"]);
    expect(byId(tree, "project-key-t2")).toBeUndefined();
    s.focusMainAgent(2);
    expect(ran.at(-1)).toEqual(["pane.focus", { pane: "chat" }]);
    sidebarPx = 100;
    s.render(cx);
    s.focusMainAgent(1);
    expect(ran.at(-1)).toEqual(["agent.focus", { terminal: "pinned" }]);
    ran.length = 0;
    s.focusMainAgent(9);
    expect(ran).toEqual([]);
  });

  test("pinned remote projects and saved machine order determine shortcuts, with folded rows excluded", () => {
    const remote = (machine: string, name: string) => ({
      ...space(`${machine}/${name}`), machine, tabs: [{ id: `${machine}/${name}-tab` }],
    });
    liveSpaces = [liveSpaces[0], remote("alpha", "pinned"), remote("alpha", "section"), remote("alpha", "top"), remote("zulu", "project")];
    s.shown = new Set(liveSpaces.map((w) => w.id));
    s.machines = ["alpha", "zulu"].map((name) => ({ name, state: "connected" }));
    liveTerminals = [assistant(), ...liveSpaces.slice(1).map((w) => ({
      address: w.id, state: "live", program: { agent: true }, labels: { "herdr.tab": `${w.id.split("/")[1]}-tab` },
    }))];
    const prefs = {
      pinned: ["alpha/pinned"], machineOrder: ["zulu", "", "alpha"],
      sections: [{ id: "alpha-section", name: "Ideas", machine: "alpha", spaces: ["alpha/section"], folded: false }],
    };
    const badges = () => ids(s.render(cx)).filter((id) => id.startsWith("project-key-")).map((id) => id.slice("project-key-".length));
    shared.set("spaces-chat", prefs);
    expect(badges()).toEqual(["alpha/pinned", "zulu/project", "t1", "alpha/top", "alpha/section"]);
    s.focusMainAgent(1);
    expect(ran.at(-1)).toEqual(["agent.focus", { terminal: "alpha/pinned" }]);

    shared.set("spaces-chat", { ...prefs, pinnedFolded: true, sections: [{ ...prefs.sections[0], folded: true }] });
    expect(badges()).toEqual(["zulu/project", "t1", "alpha/top"]);
    s.folded.add("alpha");
    expect(badges()).toEqual(["zulu/project", "t1"]);
    ran.length = 0;
    s.focusMainAgent(3);
    expect(ran).toEqual([]);
  });

  test("shows the section drop line when all of its projects are hidden under More", () => {
    s.pressed = "s1";
    s.over = "section:ideas";
    s.line = (_t: any, edge: string) => el().id(`drop-${edge}`);
    const tree = s.render(cx);
    expect(byId(tree, "space-s3")).toBeUndefined();
    expect(byId(byId(tree, "section-ideas"), "drop-bottom")).toBeDefined();
  });

  test("a helper in a layout without a Tasks panel opens a terminal peek", () => {
    taskPanel = false;
    liveTerminals = [assistant(), worker("t2", null),
      { ...worker("t3", "t2"), labels: { "herdr.role": "helper" } }];
    byId(s.render(cx), "project-agent-t3").click({}, cx);
    expect(ran.at(-1)).toEqual(["terminal.peek", { terminal: "t3" }]);
    byId(s.render(cx), "project-agent-t2").click({}, cx);
    expect(ran.at(-1)).toEqual(["terminal.peek", { terminal: "t2" }]);
    expect(shared.has("tasks.thread")).toBe(false);
  });

  test("hover shows model and effort and gives both agent controls their own click targets", async () => {
    liveTerminals = [assistant()];
    platform = "linux";
    let reads = 0;
    getTerminal = (addr) => {
      expect(addr).toBe("t1");
      reads++;
      return { foreground: { name: "codex", pid: 123, argv: ["codex", "--model", "old"] } };
    };
    readModel = (args) => {
      if (args[2] === "chat") return "/tmp/rollout-model.jsonl\n";
      if (args[2] === "defaults") return 'model_reasoning_effort\tlow\n';
      if (args[2] === "log") {
        expect(args.slice(3)).toEqual(["recent", "/tmp/rollout-model.jsonl"]);
        return 'T 1 0 1\n0\tJ\t{"type":"turn_context","payload":{"model":"gpt-6.2-sol","effort":"high"}}\n';
      }
    };
    let model: Promise<unknown> | undefined;
    let stopped = 0;
    const mouse = { notify() {}, stop_propagation() { stopped++; }, spawn: (fn: Function) => { model = fn(mouse); } };
    let tree = s.render(cx);
    expect(words(byId(tree, "project-key-t1"))).toEqual(["Ctrl+1"]);
    expect(byId(tree, "project-stop-t1")).toBeUndefined();
    byId(tree, "project-agent-t1").hoverChanged(true, mouse);
    await model;
    tree = s.render(cx);
    expect(byId(tree, "project-key-t1")).toBeUndefined();
    expect(byId(tree, "project-agent-t1").tip).toBe("gpt-6.2-sol · High effort");
    expect(byId(tree, "project-stop-t1").tip).toBe("Stop");
    byId(tree, "project-stop-t1").click({}, mouse);
    expect(ran.at(-1)).toEqual(["terminal.kill", { terminal: "t1" }]);
    s.projectModels.get("t1").at -= 15000;
    getTerminal = null;
    byId(s.render(cx), "project-agent-t1").hoverChanged(true, mouse);
    await model;
    tree = s.render(cx);
    expect(byId(tree, "project-agent-t1").tip).toBe("gpt-6.2-sol · High effort");
    expect(byId(tree, "project-tab-t1").tip).toBe("Open in a new tab");
    let opened: Promise<unknown> | undefined;
    const open = { ...mouse, spawn: (fn: Function) => { opened = fn(open); }, sleep: async () => {
      expect(labels).toEqual([]);
      livePanes.push({ pane: "new-terminal", tab: "new-tab", terminal: "t1" });
    } };
    byId(tree, "project-tab-t1").click({}, open);
    await opened;
    expect(ran.at(-1)).toEqual(["terminal.keep", { terminal: "t1", place: "tab" }]);
    expect(labels).toEqual([["label", "t1", "herdr.chat="]]);
    expect(stopped).toBe(2);
    expect(reads).toBe(1);
    expect(byId(s.render(cx), "project-tab-t1")).toBeUndefined();
  });

  test("opening a terminal in a new tab leaves a newer chat label alone", async () => {
    liveTerminals = [assistant()];
    let opened: Promise<unknown> | undefined;
    const context = { spawn: (fn: Function) => { opened = fn(context); }, sleep: async () => {
      livePanes.push({ pane: "new-terminal", tab: "new-tab", terminal: "t1" });
      liveTerminals = [{ ...assistant(), labels: { "herdr.chat": "new-chat" } }];
    } };
    s.openProjectTerminal("t1", context);
    await opened;
    expect(labels).toEqual([]);
  });
});
