import { expect, test } from "bun:test";
import { mainAgents } from "./mainagents.js";

const project = (id, machine = null) => ({ id, machine });
const main = (id) => ({ id, live: true, depth: 0 });
const ids = (spaces, projects) => mainAgents(spaces, projects).map(({ row }) => row.id);

test("main agents follow the local projects, then the linked machines by name", () => {
  const projects = new Map([
    ["zulu", [main("zulu-assistant")]],
    ["second", [main("second-assistant")]],
    ["alpha", [main("alpha-assistant")]],
    ["first", [
      main("first-assistant"), { ...main("child"), depth: 1 },
      { ...main("detached-worker"), task: { ref: "SHOP-1" } },
      main("ordinary"), { ...main("stopped"), live: false },
    ]],
  ]);
  expect(ids([project("zulu", "zulu"), project("first"), project("alpha", "alpha"), project("second")], projects))
    .toEqual(["first-assistant", "ordinary", "second-assistant", "alpha-assistant", "zulu-assistant"]);
});

test("only the first nine main agents get keys", () => {
  const agents = Array.from({ length: 12 }, (_, i) => main(i + 1));
  expect(ids([project("local")], new Map([["local", agents]]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
