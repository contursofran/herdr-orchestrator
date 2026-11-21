import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { built, byId, element, fakeGpuiBase, fakeGpuiKit, handler } from "./fake-gpui";

const shared = new Map<string, unknown>();
const ran: [string, any][] = [];
const opened: any[] = [];
const timers: (() => void)[] = [];
const repeated: [number, () => void][] = [];
const spawned: Promise<void>[] = [];
const releaseCalls: string[][] = [];
const notifications: any[] = [];
const cx = {
  notify() {}, stop_propagation() {}, spawn: (fn: (cx: any) => Promise<void>) => spawned.push(fn(cx)),
  timer: { after: (_ms: number, fn: (cx: any) => void) => timers.push(() => fn(cx)),
    every: (ms: number, fn: (cx: any) => void) => repeated.push([ms, () => fn(cx)]) },
};
let releaseState: { state: string; tag?: string };
let installError: string;
const read = (windows: { name: string; used: number; resets_at?: number }[]) => ({ state: "ok", windows });
const claude = read([{ name: "5-hour", used: 36 }, { name: "Weekly (all models)", used: 70 }]);
const codex = read([{ name: "Weekly", used: 18 }]);
let height: number, width: number, chrome: any;
let updateReady: boolean;
const t = new Proxy({}, { get: (_target, k) => String(k) });
const prop = (el: any, name: string) => el.calls.find(([key]: [string]) => key === name)?.[1][0];

mock.module("herdr", () => fakeHerdr({
  shared: (key: string) => shared.get(key), setShared: (key: string, value: unknown) => shared.set(key, value),
  layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: width },
    children: [{ id: "sidebar-footer", size: { px: height } }] }] }),
  run: (command: string, args: any) => { ran.push([command, args]); if (command === "layout.resize") height = args.px; },
  openOverlay: (options: unknown) => opened.push(options), props: () => ({ footer: true }),
  exec: async (_command: string, args: string[]) => {
    const action = args.slice(3);
    releaseCalls.push(action);
    return { code: action[0] === "install" && installError ? 1 : 0,
      stdout: JSON.stringify(releaseState), stderr: installError };
  },
  notify: (notice: unknown) => notifications.push(notice),
  updates: () => ({ app: { ready: updateReady } }), theme: () => t,
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());

const { default: WorkspaceChrome } = await import("../mods/workspace-chrome-orchestrator/main.js");
const { planUsage } = await import("../mods/workspace-chrome-orchestrator/foot.js");
const { layoutSection } = await import("../mods/orchestrator-settings/layout.js");
const { KEYS } = await import("../mods/tabs-tasks/bridge.js");
const { setWindow, windowSection } = await import("./window.ts");
const render = () => { built.length = 0; chrome.render(cx); for (const fn of timers.splice(0)) fn(); };
const plans = (limits: object) => shared.set("machines.stats", { "": { limits }, remote: { limits: { codex } } });

beforeEach(() => {
  shared.clear();
  ran.length = opened.length = timers.length = 0;
  repeated.length = spawned.length = releaseCalls.length = notifications.length = 0;
  releaseState = { state: "no-release" };
  installError = "";
  height = 97;
  width = 275;
  updateReady = true;
  chrome = new WorkspaceChrome();
});

test("the installed footer fits zero, one and two local plans and keeps the controls in view", () => {
  plans({});
  render();
  expect(height).toBe(45);
  expect(byId("foot-plan-claude")).toBeUndefined();
  expect(byId("foot-plan-codex")).toBeUndefined();
  expect(byId("foot-settings")).toBeDefined();
  expect(byId("foot-add-machine")).toBeDefined();

  plans({ claude });
  render();
  expect(height).toBe(79);
  expect(byId("foot-plan-claude").kids[3].kids).toEqual(["30%"]);
  expect(byId("foot-plan-codex")).toBeUndefined();

  plans({ claude, codex });
  render();
  expect(height).toBe(105);
  expect(byId("foot-plan-codex").kids[3].kids).toEqual(["82%"]);
  render();
  expect(ran).toEqual([45, 79, 105].map((px) => ["layout.resize", { id: "sidebar-footer", px }]));
});

test("Window settings hides and restores both plans without losing their data", () => {
  plans({ claude, codex });
  render();
  const view = { title: () => element(), row: (_theme: any, _name: string, _about: string, input: any) => element().child(input) };
  layoutSection(view, t);
  handler(byId("layout-plan-usage"), "on_click")?.({}, cx);
  render();
  expect(height).toBe(45);
  expect(byId("foot-plan-claude")).toBeUndefined();

  layoutSection(view, t);
  handler(byId("layout-plan-usage"), "on_click")?.({}, cx);
  render();
  expect(height).toBe(105);
});

test("the web Window switch reads and writes the footer preference synced by the bridge", async () => {
  expect(KEYS).toContain("sidebar.planUsage");
  plans({ claude });
  const setting = () => windowSection((key) => shared.get(key)).rows.find((row) => row.key === "window.plan-usage");
  const write = async (key: string, value: unknown) => { shared.set(key, value); };
  expect(setting()?.value).toBe("on");
  await setWindow("window.plan-usage", "off", write);
  expect(setting()?.value).toBe("off");
  render();
  expect(byId("foot-plan-claude")).toBeUndefined();
  await setWindow("window.plan-usage", "on", write);
  render();
  expect(byId("foot-plan-claude")).toBeDefined();
});

test("Settings menu opens both destinations and the plus opens Add machine", () => {
  render();
  handler(byId("foot-settings-herdr"), "on_click")?.({}, cx);
  handler(byId("foot-settings-orchestrator"), "on_click")?.({}, cx);
  handler(byId("foot-add-machine"), "on_click")?.({}, cx);
  expect(ran.slice(-2)).toEqual([["app.settings", undefined], ["mod.open", { name: "machine-add-chat" }]]);
  expect(opened).toEqual([expect.objectContaining({ mod: "orchestrator-settings" })]);
});

test("Settings checks for a stable release in the background and installs only after a click", async () => {
  releaseState = { state: "available", tag: "v0.1.1" };
  render();
  await Promise.all(spawned.splice(0));
  render();
  expect(releaseCalls).toEqual([["check", "--json"]]);
  expect(repeated.map(([ms]) => ms)).toEqual([3_600_000]);
  const button = byId("foot-release-install");
  expect(button.kids[0].kids).toEqual(["Install Orchestrator v0.1.1"]);
  handler(button, "on_click")?.({}, cx);
  render();
  expect(byId("foot-release-busy").kids[0].kids).toEqual(["Installing Orchestrator update…"]);
  await Promise.all(spawned.splice(0));
  expect(releaseCalls).toEqual([["check", "--json"], ["install", "v0.1.1"]]);
  expect(notifications.at(-1)?.title).toBe("Orchestrator v0.1.1 installed");
  render();
  expect(byId("foot-release-install")).toBeUndefined();
});

test("a failed release install returns the menu to checking and reports the failure", async () => {
  releaseState = { state: "available", tag: "v0.1.1" };
  installError = "The release package failed its SHA-256 verification.";
  render();
  await Promise.all(spawned.splice(0));
  render();
  handler(byId("foot-release-install"), "on_click")?.({}, cx);
  await Promise.all(spawned.splice(0));
  render();
  expect(byId("foot-release-check")).toBeDefined();
  expect(notifications.at(-1)).toMatchObject({ title: "Orchestrator update failed", body: installError, level: "error" });
});

test("right-clicking Settings closes its open menu and stops propagation", () => {
  const menu = () => built.find((e) => e.kind === "Popover");
  render();
  handler(menu(), "on_open_change")?.(true, cx);
  render();
  expect(prop(menu(), "open")).toBe(true);
  expect(byId("foot-herdr-update")).toBeDefined();
  expect(byId("foot-settings-orchestrator").kids).toHaveLength(1);
  let stopped = false;
  handler(byId("foot-settings"), "on_mouse_down")?.({}, { ...cx, stop_propagation: () => { stopped = true; } });
  updateReady = false;
  render();
  expect(prop(menu(), "open")).toBe(false);
  expect(stopped).toBe(true);
  expect(opened).toEqual([expect.objectContaining({ mod: "orchestrator-settings" })]);
  expect(byId("foot-herdr-update")).toBeUndefined();
});

test("the narrow rail fits Settings and Add machine and returns the plan rows when widened", () => {
  plans({ claude, codex });
  width = 44;
  render();
  expect(height).toBe(77);
  expect(prop(byId("foot-settings"), "tooltip")).toBe("Settings");
  expect(prop(byId("foot-add-machine"), "tooltip")).toBe("Add machine");
  handler(byId("foot-add-machine"), "on_click")?.({}, cx);
  expect(ran.at(-1)).toEqual(["mod.open", { name: "machine-add-chat" }]);
  expect(byId("foot-plan-codex")).toBeUndefined();
  width = 275;
  render();
  expect(height).toBe(105);
});

test("the weekly summary prefers the shared quota and hover includes all reported windows", () => {
  const now = 60_000_000;
  const [plan] = planUsage({ limits: {
    codex: { state: "signed-out" },
    claude: read([{ name: "Weekly (Sonnet)", used: 99, resets_at: now - 1 },
      { name: "5-hour", used: 93, resets_at: now + 60_000 }, { name: "Weekly (all models)", used: 69 }]),
    elevenlabs: read([{ name: "Month", used: 81 }]),
  } }, now);
  expect(plan.cli).toBe("claude");
  expect(plan.summary).toMatchObject({ name: "Weekly (all models)", left: 31, period: "Week" });
  expect(plan.windows).toEqual([
    { name: "Weekly (Sonnet)", period: "Week", left: 1, expired: true, refill: null, resetWords: "Reset passed" },
    { name: "5-hour", period: "5h", left: 7, expired: false, refill: "1m", resetWords: null },
    plan.summary,
  ]);
});

test("the footer aligns the icon, weekly window, meter, percent, and reset with full detail on hover", () => {
  const now = Date.now();
  plans({ claude: read([{ name: "5-hour", used: 93, resets_at: now + 60_000 },
    { name: "Weekly (all models)", used: 66, resets_at: now + 47 * 3600_000 }]), codex });
  render();
  const plan = byId("foot-plan-claude");
  expect(plan.kids[0].kids[0].kind).toBe("image");
  expect(plan.kids[0].kids[1]).toBe("Claude");
  expect(plan.kids[1].kids).toEqual(["Week"]);
  expect(prop(plan.kids[2].kids[0], "w")).toBe("34%");
  expect(plan.kids[3].kids).toEqual(["34%"]);
  expect(plan.kids[4].kids).toEqual(["1d 23h"]);
  expect(prop(plan, "tooltip")).toBe("Claude\n5-hour, 7% left · Resets in 1m\nWeekly (all models), 34% left · Resets in 1d 23h");
  expect(prop(plan, "accessibility_label")).toContain("5-hour, 7% left");
  expect(prop(byId("foot-plan-codex"), "tooltip")).toBe("Codex\nWeekly, 82% left");
});

test.each([[0, 100, "muted"], [76, 24, "working"], [100, 0, "blocked"]])(
  "weekly usage of %s%% fills and colors the meter for %s%% left", (used, left, color) => {
    plans({ codex: read([{ name: "Weekly", used }]) });
    render();
    const plan = byId("foot-plan-codex");
    const fill = plan.kids[2].kids[0];
    expect(prop(fill, "w")).toBe(`${left}%`);
    expect(prop(fill, "bg")).toBe(color);
    expect(plan.kids[3].kids).toEqual([`${left}%`]);
  },
);

test.each([["5-hour", "5h"], ["1-day", "Day"], ["Weekly", "Week"]])("reported %s limits use their real period and refill", (windowName, period) => {
  const full = "Codex Test Model With a Long Name · " + windowName;
  plans({ codex: read([{ name: full, used: 88, resets_at: Date.now() + 360_000 }]) });
  render();
  expect(byId("foot-plan-codex").kids.at(-1).kids).toEqual(["6m"]);
  width = 190;
  render();
  const plan = byId("foot-plan-codex");
  expect(plan.kids[1].kids).toEqual([period]);
  expect(plan.kids.at(-1).kids).toEqual(["12%"]);
  expect(prop(plan, "tooltip")).toBe(`Codex\n${full}, 12% left · Resets in 6m`);
});

test("failed and old reads are labeled Stale and omit the live refill countdown", () => {
  const now = Date.now();
  const windows = [{ name: "5-hour", used: 97, resets_at: now + 600_000 }];
  const failed = { ...read(windows), at: now, failed: "Timed out" };
  const old = { ...read([{ ...windows[0], resets_at: now - 1 }]), at: now - 16 * 60_000 };
  plans({ claude: old, codex: failed });
  render();
  const claudePlan = byId("foot-plan-claude"), codexPlan = byId("foot-plan-codex");
  expect(claudePlan.kids[3].kids).toEqual(["3%"]);
  expect(claudePlan.kids.at(-1).kids).toEqual(["Stale"]);
  expect(prop(claudePlan, "tooltip")).toContain("Stale, read 16m ago");
  expect(prop(claudePlan, "tooltip")).toContain("Reset passed");
  expect(prop(codexPlan, "tooltip")).toContain("Last read failed: Timed out");
  expect(prop(codexPlan, "tooltip")).not.toContain("Resets in");
  width = 190;
  render();
  expect(byId("foot-plan-codex").kids.at(-1).kids).toEqual(["Stale"]);
});
