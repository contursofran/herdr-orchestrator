import { beforeEach, expect, mock, test } from "bun:test";
import { fakeHerdr } from "./fake-herdr";
import { built, byId, element, fakeGpuiBase, fakeGpuiKit, handler } from "./fake-gpui";

const shared = new Map<string, unknown>();
const ran: [string, any][] = [];
const opened: any[] = [];
const timers: (() => void)[] = [];
const cx = { notify() {}, stop_propagation() {}, timer: { after: (_ms: number, fn: () => void) => timers.push(fn) } };
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
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
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
  expect(byId("foot-plan-claude").kids.at(-1).kids).toEqual(["70% wk"]);
  expect(byId("foot-plan-codex")).toBeUndefined();

  plans({ claude, codex });
  render();
  expect(height).toBe(105);
  expect(byId("foot-plan-codex").kids.at(-1).kids).toEqual(["18% wk"]);
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

test("usage comes from the most-used current window and ignores missing or expired data", () => {
  const now = 60_000_000;
  expect(planUsage({ limits: {
    codex: { state: "signed-out" },
    claude: read([{ name: "Quarter", used: 99, resets_at: now - 1 },
      { name: "5-hour", used: 93, resets_at: now + 60_000 }, { name: "Weekly", used: 69 }]),
    elevenlabs: read([{ name: "Month", used: 81 }]),
  } }, now)).toEqual([{ cli: "claude", name: "Claude", used: 93, zone: "5h", level: "over", refill: "1m",
    windowName: "5-hour", freshness: null, failure: null }]);
});

test.each([["5-hour", "5h"], ["Weekly", "wk"]])("Codex model limits keep the %s window and refill", (windowName, zone) => {
  const full = "Codex Test Model With a Long Name · " + windowName;
  plans({ codex: read([{ name: full, used: 88, resets_at: Date.now() + 360_000 }]) });
  render();
  expect(byId("foot-plan-codex").kids.at(-1).kids).toEqual([`88% ${zone} · 6m`]);
  width = 190;
  render();
  const plan = byId("foot-plan-codex");
  expect(plan.kids.at(-1).kids).toEqual([`88% ${zone}`]);
  expect(prop(plan, "tooltip")).toBe(`Codex, 88% used · ${full} · Refills in 6m`);
  expect(prop(plan, "accessibility_label")).toBe(prop(plan, "tooltip"));
});

test("failed and old reads are labeled Stale and omit the live refill countdown", () => {
  const now = Date.now();
  const windows = [{ name: "5-hour", used: 97, resets_at: now + 600_000 }];
  const failed = { ...read(windows), at: now, failed: "Timed out" };
  const old = { ...read([{ ...windows[0], resets_at: now - 1 }]), at: now - 16 * 60_000 };
  plans({ claude: old, codex: failed });
  render();
  const claudePlan = byId("foot-plan-claude"), codexPlan = byId("foot-plan-codex");
  expect(claudePlan.kids.at(-1).kids).toEqual(["97% 5h · Stale"]);
  expect(prop(claudePlan, "tooltip")).toContain("Stale, read 16m ago");
  expect(prop(codexPlan, "tooltip")).toContain("Last read failed: Timed out");
  expect(prop(codexPlan, "tooltip")).not.toContain("Refills in");
  width = 190;
  render();
  expect(byId("foot-plan-codex").kids.at(-1).kids).toEqual(["Stale"]);
});
