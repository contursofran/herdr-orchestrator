import { div } from "gpui-kit";
import { h_flex, Scrollbar, TextView, v_flex } from "gpui-base";
import { appHome, readTextFile } from "herdr";
import { loadingText } from "./loader.js";
import { button, TEXT } from "./ui.js";

export async function readChangelog() {
  const root = appHome();
  const [notes, record] = await Promise.all([
    readTextFile(`${root}/mods/orchestrator-settings/CHANGELOG.md`).catch(() => null),
    readTextFile(`${root}/data/herdr-orchestrator/installed.json`).catch(() => null),
  ]);
  let version = null;
  try {
    const value = JSON.parse(record)?.version;
    if (typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value)) version = value;
  } catch { /* The notes are useful even when the install record can't be read. */ }
  return { version, notes: notes?.replace(/^# Changelog\s*/i, "").trim() || null };
}

export function changelogView(t, focus, changelog, close) {
  const body = changelog?.notes ? TextView.markdown("changelog-markdown", changelog.notes).selectable(true)
    : div().text_size(TEXT.body).text_color(t.muted).child(changelog
      ? "Release notes are unavailable in this installation."
      : loadingText("Reading the changelog…"));
  const header = h_flex().w_full().flex_none().justify_between().items_center().gap(12).px(24).py(14)
    .border_b(1).border_color(t.border)
    .child(v_flex().gap(3)
      .child(div().text_size(TEXT.title).font_semibold().text_color(t.foreground).child("Changelog"))
      .when(Boolean(changelog?.version), (el) => el.child(div().id("changelog-version").text_size(TEXT.label).text_color(t.muted)
        .child(`Installed version v${changelog.version}`))))
    .child(button("changelog-close", "Close", { onClick: close }));
  const card = v_flex().id("changelog").track_focus(focus).size_full().min_h(0).rounded(12).border_1().border_color(t.border)
    .bg(t.popover).shadow_lg().overflow_hidden()
    .on_click((_e, cx) => cx.stop_propagation())
    .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); close(); } })
    .child(header)
    .child(div().relative().w_full().flex_1().min_h(0)
      .child(div().id("changelog-scroll").size_full().overflow_y_scroll()
        .child(div().px(24).py(18).text_color(t.foreground).child(body)))
      .child(Scrollbar.vertical("changelog-scroll").absolute().inset_0()));
  return div().id("changelog-root").size_full().on_click(close).child(card);
}
