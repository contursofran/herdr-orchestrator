import { expect, test } from "bun:test";
import { artifactOf, artifactStore } from "./compat.ts";
import { Artifacts } from "./artifacts.ts";
import type { Hub } from "./hub.ts";

test("a space's artifact store is herdr-artifact's: the repo's main folder, named as the window's Artifacts header", () => {
  expect(artifactStore({ folder: "/h/u" }, "/h/u")).toEqual({ folder: "/h/u", key: "|/h/u", name: "~" });
  expect(artifactStore({ folder: "/h/u/wt/x", git: { repo: "/h/u/dev/app/.git" } }, "/h/u")).toEqual({ folder: "/h/u/dev/app", key: "|/h/u/dev/app", name: "app" });
  // another machine's home reads "~" there too; its key names the machine
  expect(artifactStore({ folder: "/root", machine: "vm" }, "/h/u")).toEqual({ folder: "/root", key: "vm|/root", name: "~" });
  expect(artifactStore({ folder: "/root/dev/site", machine: "vm" }, "/h/u").name).toBe("site");
});

test("each version says its kind and its window picture: a converted one was a panel, then a recipe", () => {
  const a = artifactOf({ id: "x-1a2b", title: "Plan", version: 2, at: 2, folder: "/h/u", files: ["recipe.json"],
    versions: [{ v: 1, at: 1, kind: "custom", picture: 5 }, { v: 2, at: 2, kind: "recipe" }] }, []);
  expect(a.kind).toBe("recipe");
  expect(a.versions.map((x) => [x.n, x.kind, x.picture])).toEqual([[2, "recipe", undefined], [1, "gpui", 5]]);
});

test("serves HTML from another machine as a sandboxed visual document", async () => {
  const html = '<style>h1{color:teal}</style><h1>Routes</h1>';
  const artifacts = new Artifacts();
  artifacts.hub = {
    async call(_, params) {
      expect(params?.on).toBe("worker");
      const argv = params?.argv;
      expect(Array.isArray(argv) && argv.slice(-3)).toEqual(["report-1234", "2", "visual.html"]);
      return { code: 0, stdout: Buffer.from(html).toString("base64") };
    },
  } as Hub;
  const result = await artifacts.file("report-1234", 2, "visual.html", "worker");
  expect(await result.text()).toBe(html);
  expect(result.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(result.headers.get("content-security-policy")).toStartWith("sandbox; default-src 'none';");
  expect(result.headers.get("content-security-policy")).toContain("form-action 'none'");
  expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await artifacts.file("..", 2, "visual.html", "worker")).status).toBe(404);
});
