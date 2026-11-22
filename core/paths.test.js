import { expect, test } from "bun:test";
import { recentCandidates, recentFrom } from "./newspace.js";
import { isWorktreePath } from "./paths.js";

test("preserved upstream worktrees stay out of recent folders", () => {
  const upstream = "shepherdr";
  const legacy = `/demo/.local/share/${upstream}/worktrees/shop/task-2`;
  const repo = `/demo/projects/${upstream}/shop`;
  expect(isWorktreePath(legacy)).toBe(true);
  expect(recentCandidates([{ cwd: legacy, at: 2 }, { cwd: repo, at: 1 }])).toEqual([repo]);
  expect(recentFrom(`${legacy}\n${repo}\n`)).toEqual([repo]);
});
