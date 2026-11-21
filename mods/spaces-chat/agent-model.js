import { exec, hc } from "herdr";
import { current, DEFAULTS, levelName, modelName, parseDefaults } from "./core/agents.js";
import { Conversation, FIND, LOG, records } from "./core/chat-log.js";
import { machineOf } from "./core/spaces.js";

const kinds = { "claude-code": "claude", claude: "claude", codex: "codex" };

async function recentModel(kind, pid, machine) {
  if (!pid) return null;
  const found = await exec("sh", ["-c", FIND, "chat", kind, String(pid)], { on: machine });
  const path = found.stdout.trim().split("\n").pop();
  if (found.code !== 0 || !path || path === "pending") return null;
  const result = await exec("sh", ["-c", LOG, "log", "recent", path], { on: machine });
  if (result.code !== 0) return null;
  const conv = new Conversation(kind);
  conv.feed(records(result.stdout).records);
  return conv.meta;
}

export async function projectModel(address) {
  const result = await hc(["get", address, "--json"]);
  if (result.code !== 0) return null;
  const terminal = JSON.parse(result.stdout);
  const kind = kinds[terminal?.status?.app] ?? kinds[terminal?.foreground?.name] ?? kinds[terminal?.labels?.["herdr.agent"]];
  if (!kind) return "";
  const machine = machineOf(address) ?? undefined;
  const [config, meta] = await Promise.all([
    exec("sh", ["-c", DEFAULTS, "defaults", kind], { on: machine }).catch(() => null),
    recentModel(kind, terminal.foreground?.pid, machine).catch(() => null),
  ]);
  // A resumed session's log can still describe the previous process.
  const reported = terminal.created_ms && meta?.at && meta.at < terminal.created_ms ? null : meta;
  const settings = parseDefaults(kind, config?.stdout);
  const model = current(kind, terminal.foreground?.argv ?? terminal.argv, reported, settings);
  const name = model.label ?? modelName(model.model);
  const effort = levelName(model.effort ?? settings.models?.find((m) => m.id === model.model)?.defaultEffort);
  return name ? [name, effort && `${effort} effort`].filter(Boolean).join(" · ") : "";
}
