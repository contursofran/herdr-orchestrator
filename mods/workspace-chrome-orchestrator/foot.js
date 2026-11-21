import { div, image, svg } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { exec, layout, run, shared, updates } from "herdr";
import { ago, failedWords, leftOf, liveWindow, planLevelOf, readOld, SIDEBAR_PLAN_USAGE, span } from "./core/machines.js";
import { openSettings, RADIUS, TEXT, toast } from "./ui.js";

const ICON = "mods/workspace-chrome-orchestrator/";
const BLOCK = "sidebar-footer";
const ROW = 16, GAP = 10, TOP = 12, BOTTOM = 6;
const CONTROLS = 30, CONTROLS_TOP = 4, CONTROLS_BOTTOM = 10;
const ADD_MACHINE = 28, CONTROL_GAP = 4;
const PLANS = [["claude", "Claude"], ["codex", "Codex"]];
const RELEASE_INTERVAL = 60 * 60 * 1_000;
const RELEASE_COMMAND = 'PATH="$HOME/.local/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH; '
  + 'exec "$HOME/.local/bin/herdr-orchestrator" release "$@"';
const RELEASE_STATUS = { "no-release": "No stable Orchestrator release has been published yet.",
  "no-package": "The latest release has no verified install package.", current: "Orchestrator is up to date." };

function periodOf(name) {
  const period = name.split(" · ").at(-1);
  if (/^week(?:ly)?\b/i.test(period)) return "Week";
  if (/^(?:daily|day|1[- ]day|24[- ]hour)s?\b/i.test(period)) return "Day";
  return period.replace(/^(\d+)[- ](minute|hour|day)s?\b.*$/i, (_, n, unit) => n + unit[0].toLowerCase());
}

export function planUsage(stats, now = Date.now()) {
  return PLANS.flatMap(([cli, name]) => {
    const read = stats?.limits?.[cli];
    if (read?.state !== "ok") return [];
    const stale = readOld(read, now);
    const windows = (read.windows ?? []).filter((w) => Number.isFinite(w.used)).map((w) => {
      const name = w.name || "Limit";
      const expired = !liveWindow(w, now);
      const left = Math.min(100, leftOf(w));
      return { name, period: periodOf(name), left, expired,
        refill: !stale && !expired && w.resets_at ? span(w.resets_at - now) : null,
        resetWords: expired ? "Reset passed" : !stale && w.resets ? `Resets ${w.resets}` : null };
    });
    // The subscription's shared weekly quota takes priority over per-model quotas.
    const weekly = windows.filter((w) => w.period === "Week");
    const summary = weekly.find((w) => /^week(?:ly)?(?: \(all models\))?$/i.test(w.name))
      ?? weekly.find((w) => !w.expired) ?? weekly[0] ?? windows.find((w) => !w.expired) ?? windows[0];
    if (!summary) return [];
    const freshness = stale ? ["Stale", Number.isFinite(read.at) ? "read " + ago(read.at, now) : null].filter(Boolean).join(", ") : null;
    return [{ cli, name, summary, windows, freshness, failure: read.failed ? failedWords(read) : null }];
  });
}

export const footerHeight = (count, narrow = false) => 1 + CONTROLS_TOP + CONTROLS + CONTROLS_BOTTOM
  + (narrow ? ADD_MACHINE + CONTROL_GAP : 0)
  + (count ? TOP + ROW * count + GAP * (count - 1) + BOTTOM : 0);

export function nodeOf(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = nodeOf(child, id);
    if (found) return found;
  }
  return null;
}

export class Footer {
  startReleaseChecks(cx) {
    if (this.releaseChecksStarted) return;
    this.releaseChecksStarted = true;
    cx.timer.after(0, (cx) => this.releaseAction(cx));
    cx.timer.every(RELEASE_INTERVAL, (cx) => this.releaseAction(cx));
  }

  releaseAction(cx, { tag, manual = false } = {}) {
    if (this.releaseBusy) return;
    this.releaseBusy = tag ? "Installing Orchestrator update…" : "Checking for Orchestrator updates…";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const args = tag ? ["install", tag] : ["check", "--json"];
        const result = await exec("sh", ["-c", RELEASE_COMMAND, "herdr-orchestrator", ...args], { timeout: tag ? 300_000 : 20_000 });
        if (result.code !== 0) throw new Error(result.stderr.trim().split("\n").slice(-2).join("\n") || "The update command failed.");
        if (tag) {
          this.releaseTag = null;
          toast({ title: `Orchestrator ${tag} installed` });
        } else {
          const data = JSON.parse(result.stdout);
          this.releaseTag = data.state === "available" && /^v\d+\.\d+\.\d+$/.test(data.tag) ? data.tag : null;
          if (manual) toast({ title: this.releaseTag ? `Orchestrator ${this.releaseTag} is available`
            : RELEASE_STATUS[data.state] ?? "No Orchestrator update is available." });
        }
      } catch (error) {
        if (tag) this.releaseTag = null;
        if (tag || manual) toast({ title: tag ? "Orchestrator update failed" : "Couldn't check for updates",
          body: String(error?.message ?? error), level: "error" });
      } finally {
        this.releaseBusy = null;
        cx.notify();
      }
    });
  }

  resize(height, cx) {
    this.height = height;
    const node = nodeOf(layout(), BLOCK);
    if (!node || node.size?.px === height || this.resizing) return;
    this.resizing = true;
    cx.timer.after(0, () => {
      this.resizing = false;
      const current = nodeOf(layout(), BLOCK);
      if (current && current.size?.px !== this.height) run("layout.resize", { id: BLOCK, px: this.height });
    });
  }

  settings(t, narrow) {
    const ready = Boolean(updates()?.app?.ready);
    const button = h_flex().id("foot-settings").h(CONTROLS).w_full().px(narrow ? 0 : 8).gap(8).items_center().rounded(RADIUS.card)
      .accessibility_label("Settings").text_size(TEXT.body).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .when(Boolean(this.menu), (el) => el.bg(t.hover))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menu = false;
        cx.notify();
        openSettings();
      })
      .child(svg(`${ICON}settings.svg`).size(16).flex_none())
      .when(narrow, (el) => el.relative().justify_center().tooltip("Settings"))
      .when(!narrow, (el) => el.child(div().flex_1().min_w(0).truncate().child("Settings")))
      .when(ready || this.releaseTag, (el) => el.child(div().size(6).flex_none().rounded_full().bg(t.accent)
        .when(narrow, (dot) => dot.absolute().top(5).right(4))));
    const choice = (id, name, action, { update = false, keepOpen = false } = {}) => h_flex().id(id).h(32).w_full().px(9).gap(8).items_center().rounded(RADIUS.control)
      .text_size(TEXT.body).text_color(action ? t.foreground : t.muted)
      .child(div().flex_1().child(name))
      .when(update, (el) => el.accessibility_label("Herdr settings, update available")
        .child(div().id("foot-herdr-update").size(6).flex_none().rounded_full().bg(t.accent)))
      .when(Boolean(action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
        if (!keepOpen) {
          this.menu = false;
          cx.notify();
        }
        action(cx);
      }));
    const tag = this.releaseTag;
    const releaseChoice = this.releaseBusy ? choice("foot-release-busy", this.releaseBusy)
      : tag ? choice("foot-release-install", `Install Orchestrator ${tag}`, (cx) => this.releaseAction(cx, { tag }), { keepOpen: true })
        : choice("foot-release-check", "Check for Orchestrator updates", (cx) => this.releaseAction(cx, { manual: true }), { keepOpen: true });
    return Popover.new("foot-settings-menu").anchor("bottom_left").open(Boolean(this.menu))
      .on_open_change((open, cx) => { this.menu = open; cx.notify(); })
      .trigger(button)
      .content(div().pb(6).child(v_flex().w(218).bg(t.popover).shadow_md().border_1().border_color(t.border).rounded(12).p(4)
        .child(choice("foot-settings-herdr", "Herdr settings", () => run("app.settings"), { update: ready }))
        .child(choice("foot-settings-orchestrator", "herdr-orchestrator settings", () => openSettings()))
        .child(releaseChoice)));
  }

  plan(t, p, tight) {
    const { period, left, refill, expired } = p.summary;
    const stale = p.freshness || expired;
    const level = planLevelOf(left);
    const color = stale ? t.dim : level === "over" ? t.blocked : level === "busy" ? t.working : t.muted;
    const details = p.windows.map((w) => [`${w.name}, ${w.left}% left`, w.refill ? `Resets in ${w.refill}` : w.resetWords]
      .filter(Boolean).join(" · "));
    const lines = [p.name, ...details, p.freshness, p.failure].filter(Boolean);
    const detail = lines.join("\n");
    const number = (width, value, color) => h_flex().w(width).justify_end().flex_none().text_size(TEXT.id)
      .font_family("Menlo").text_color(color).child(value);
    return h_flex().id(`foot-plan-${p.cli}`).h(ROW).flex_none().gap(tight ? 5 : 8).items_center()
      .accessibility_label(lines.join(". ")).tooltip(detail)
      .child(h_flex().w(tight ? 58 : 64).flex_none().gap(6).items_center().text_size(TEXT.label).text_color(t.foreground)
        .child(image(`icons/${p.cli}.svg`).size(14).flex_none()).child(p.name))
      .child(div().w(tight ? 28 : 34).flex_none().truncate().text_size(TEXT.id).text_color(t.muted).child(period))
      .child(div().flex_1().min_w(0).h(4).rounded(2).bg(t.hover)
        .child(div().h(4).rounded(2).bg(color).w(`${left}%`)))
      .child(number(tight ? 34 : 30, stale && tight ? "Stale" : `${left}%`, stale && tight ? t.working : t.muted))
      .when(!tight, (el) => el.child(number(60, stale ? "Stale" : refill ?? "", stale ? t.working : t.muted)));
  }

  render(t, width, cx) {
    this.startReleaseChecks(cx);
    const narrow = width < 160;
    const tight = width < 245;
    const plans = narrow || shared(SIDEBAR_PLAN_USAGE) === false ? [] : planUsage(shared("machines.stats")?.[""]);
    this.resize(footerHeight(plans.length, narrow), cx);
    const controls = narrow ? v_flex() : h_flex();
    return v_flex().id("foot").size_full().bg(t.chrome).border_t(1).border_color(t.border)
      .when(plans.length > 0, (el) => el.child(v_flex().flex_none().pt(TOP).px(tight ? 8 : 14).pb(BOTTOM).gap(GAP)
        .children(plans.map((p) => this.plan(t, p, tight)))))
      .child(controls.flex_none().pt(CONTROLS_TOP).pb(CONTROLS_BOTTOM).px(narrow ? 0 : 10).gap(CONTROL_GAP).items_center()
        .child(div().when(narrow, (el) => el.w(32)).when(!narrow, (el) => el.flex_1().min_w(0)).child(this.settings(t, narrow)))
        .child(div().id("foot-add-machine").size(ADD_MACHINE).flex_none().flex().items_center().justify_center().rounded(RADIUS.card)
          .accessibility_label("Add machine").tooltip("Add machine").cursor_pointer().text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("mod.open", { name: "machine-add-chat" })).child(svg(ICON + "plus.svg").size(16))));
  }
}
