import { div } from "gpui-kit";
import { BRAILLE_FRAMES, BRAILLE_MS } from "./core/braille.js";

export function brailleLoader(size = 12, color) {
  return div().size(size).flex_none().flex().items_center().justify_center().text_size(size)
    .when(Boolean(color), el => el.text_color(color))
    .frames(BRAILLE_FRAMES, BRAILLE_MS);
}

export function loadingText(words, size = 12) {
  return div().flex().items_center().gap(6).child(brailleLoader(size)).child(words);
}
