import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Popover } from "gpui-base";
import { layout, run, shared, updates } from "herdr";
import { leftOf, liveWindow, planLevelOf, SIDEBAR_PLAN_USAGE, span } from "./core/machines.js";
import { openSettings, RADIUS, TEXT } from "./ui.js";

const ICON = "mods/workspace-chrome-orchestrator/";
const BLOCK = "sidebar-footer";
const ROW = 16, GAP = 10, TOP = 12, BOTTOM = 6;
const CONTROLS = 30, CONTROLS_TOP = 4, CONTROLS_BOTTOM = 10;
const PLANS = [["claude", "Claude"], ["codex", "Codex"]];

export function planUsage(stats, now = Date.now()) {
  return PLANS.flatMap(([cli, name]) => {
    const read = stats?.limits?.[cli];
    if (read?.state !== "ok") return [];
    let worst = null;
    for (const window of read.windows ?? []) {
      if (!Number.isFinite(window.used) || !liveWindow(window, now)) continue;
      if (!worst || window.used > worst.used) worst = window;
    }
    if (!worst) return [];
    const left = Math.min(100, leftOf(worst));
    const zone = /^5.hour/i.test(worst.name) ? "5h" : /^week/i.test(worst.name) ? "wk" : worst.name || "";
    return [{ cli, name, used: 100 - left, zone, level: planLevelOf(left),
      refill: worst.resets_at ? span(worst.resets_at - now) : null }];
  });
}

export const footerHeight = (count) => 1 + CONTROLS_TOP + CONTROLS + CONTROLS_BOTTOM
  + (count ? TOP + ROW * count + GAP * (count - 1) + BOTTOM : 0);

function nodeOf(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = nodeOf(child, id);
    if (found) return found;
  }
  return null;
}

export class Footer {
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
      .on_mouse_down("right", () => openSettings())
      .child(svg(`${ICON}settings.svg`).size(16).flex_none())
      .when(narrow, (el) => el.relative().justify_center())
      .when(!narrow, (el) => el.child(div().flex_1().min_w(0).truncate().child("Settings")))
      .when(ready, (el) => el.child(div().size(6).flex_none().rounded_full().bg(t.accent)
        .when(narrow, (dot) => dot.absolute().top(5).right(4))));
    const choice = (id, name, action) => h_flex().id(id).h(32).w_full().px(9).items_center().rounded(RADIUS.control)
      .cursor_pointer().text_size(TEXT.body).text_color(t.foreground).hover((s) => s.bg(t.hover)).child(name)
      .on_click((_e, cx) => {
        this.menu = false;
        cx.notify();
        action();
      });
    return Popover.new("foot-settings-menu").anchor("bottom_left").open(Boolean(this.menu))
      .on_open_change((open, cx) => { this.menu = open; cx.notify(); })
      .trigger(button)
      .content(div().pb(6).child(v_flex().w(218).bg(t.raised).border_1().border_color(t.border).rounded(12).p(4)
        .child(choice("foot-settings-herdr", "Herdr settings", () => run("app.settings")))
        .child(choice("foot-settings-orchestrator", "herdr-orchestrator settings", () => openSettings()))));
  }

  plan(t, p, tight) {
    const color = p.level === "over" ? t.blocked : p.level === "busy" ? t.working : t.muted;
    const value = [`${p.used}%`, p.zone].filter(Boolean).join(" ");
    const description = p.refill ? `${value} · ${p.refill}` : value;
    return h_flex().id(`foot-plan-${p.cli}`).h(ROW).flex_none().gap(8).items_center()
      .accessibility_label(`${p.name}, ${p.used}% used${p.zone ? ` in ${p.zone}` : ""}${p.refill ? `, refills in ${p.refill}` : ""}`)
      .child(div().w(44).flex_none().text_size(TEXT.label).text_color(t.muted).child(p.name))
      .child(div().flex_1().min_w(0).h(4).rounded(2).bg(t.hover)
        .child(div().h(4).rounded(2).bg(color).w(`${p.used}%`)))
      .child(div().max_w(tight ? 52 : 125).flex_none().truncate().font_family("Menlo").text_size(TEXT.id)
        .text_color(t.muted).child(tight ? value : description));
  }

  render(t, width, cx) {
    const narrow = width < 160;
    const plans = narrow || shared(SIDEBAR_PLAN_USAGE) === false ? [] : planUsage(shared("machines.stats")?.[""]);
    this.resize(footerHeight(plans.length), cx);
    return v_flex().id("foot").size_full().bg(t.chrome).border_t(1).border_color(t.border)
      .when(plans.length > 0, (el) => el.child(v_flex().flex_none().pt(TOP).px(16).pb(BOTTOM).gap(GAP)
        .children(plans.map((p) => this.plan(t, p, width < 245)))))
      .child(h_flex().flex_none().pt(CONTROLS_TOP).pb(CONTROLS_BOTTOM).px(narrow ? 0 : 10).gap(4).items_center()
        .when(narrow, (el) => el.justify_center().child(div().w(32).child(this.settings(t, narrow))))
        .when(!narrow, (el) => el.child(div().flex_1().min_w(0).child(this.settings(t, narrow)))
          .child(div().id("foot-add-machine").size(28).flex_none().flex().items_center().justify_center().rounded(RADIUS.card)
            .accessibility_label("Add machine").cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => run("mod.open", { name: "machine-add-chat" })).child(svg(`${ICON}plus.svg`).size(16)))));
  }
}
