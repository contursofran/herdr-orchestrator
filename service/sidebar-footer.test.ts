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
const t = new Proxy({}, { get: (_target, k) => String(k) });

mock.module("herdr", () => fakeHerdr({
  shared: (key: string) => shared.get(key), setShared: (key: string, value: unknown) => shared.set(key, value),
  layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: width },
    children: [{ id: "sidebar-footer", size: { px: height } }] }] }),
  run: (command: string, args: any) => { ran.push([command, args]); if (command === "layout.resize") height = args.px; },
  openOverlay: (options: unknown) => opened.push(options), props: () => ({ footer: true }),
  updates: () => ({ app: { ready: true } }), theme: () => t,
}));
mock.module("gpui-kit", () => fakeGpuiKit());
mock.module("gpui-base", () => fakeGpuiBase());

const { default: WorkspaceChrome } = await import("../mods/workspace-chrome-orchestrator/main.js");
const { planUsage } = await import("../mods/workspace-chrome-orchestrator/foot.js");
const { layoutSection } = await import("../mods/orchestrator-settings/layout.js");
const render = () => { built.length = 0; chrome.render(cx); for (const fn of timers.splice(0)) fn(); };
const plans = (limits: object) => shared.set("machines.stats", { "": { limits }, remote: { limits: { codex } } });

beforeEach(() => {
  shared.clear();
  ran.length = opened.length = timers.length = 0;
  height = 97;
  width = 275;
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

test("Settings menu opens both destinations and the plus opens Add machine", () => {
  render();
  handler(byId("foot-settings-herdr"), "on_click")?.({}, cx);
  handler(byId("foot-settings-orchestrator"), "on_click")?.({}, cx);
  handler(byId("foot-add-machine"), "on_click")?.({}, cx);
  expect(ran.slice(-2)).toEqual([["app.settings", undefined], ["mod.open", { name: "machine-add-chat" }]]);
  expect(opened).toEqual([expect.objectContaining({ mod: "orchestrator-settings" })]);
});

test("the narrow rail keeps Settings and returns the plan rows when widened", () => {
  plans({ claude, codex });
  width = 76;
  render();
  expect(height).toBe(45);
  expect(byId("foot-settings")).toBeDefined();
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
  } }, now)).toEqual([{ cli: "claude", name: "Claude", used: 93, zone: "5h", level: "over", refill: "1m" }]);
});
