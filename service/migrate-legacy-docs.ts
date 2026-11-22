import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { CoreClient, CoreError } from "./hc/client.ts";

type Doc = { value: unknown; version: number };
type Entry = { name: string; before: Doc; value: unknown };
type Journal = { core: string; writes: Entry[] };
type DocumentCore = Pick<CoreClient, "call">;

const empty = (value: unknown) => value === null || isDeepStrictEqual(value, {});
const conflict = (error: unknown) => error instanceof CoreError && error.kind === "conflict";
const get = (core: DocumentCore, name: string) => core.call<Doc>("doc.get", { name });
const set = (core: DocumentCore, name: string, value: unknown, version: number) =>
  core.call<{ version: number }>("doc.set", { name, value, version });

function save(path: string, journal: Journal) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(journal) + "\n", { mode: 0o600, flag: "wx", flush: true });
  renameSync(temp, path);
}

/** Copy only local documents. Each machine migrates its own data in its own naming. */
export async function moveDocuments(core: DocumentCore, path: string, old: string, next: string) {
  const { core: { id } } = await core.call<{ core: { id: string } }>("server.status");
  if (!id) throw new Error("Herdr Core did not identify itself");
  const journal: Journal = { core: id, writes: [] };
  for (const suffix of ["", ".host", ".secrets"]) {
    const { value } = await get(core, old + suffix);
    if (empty(value)) continue;
    const name = next + suffix;
    const before = await get(core, name);
    if (!empty(before.value)) continue;
    // Record the intent before sending it. Even if the reply is lost, rollback can check
    // whether the write landed using the value and the next version.
    journal.writes.push({ name, before, value });
    save(path, journal);
    try {
      await set(core, name, value, before.version);
    } catch (error) {
      if (!conflict(error)) throw error;
      journal.writes.pop();
      save(path, journal);
    }
  }
}

export async function restoreDocuments(core: DocumentCore, path: string) {
  const journal: Journal = JSON.parse(readFileSync(path, "utf8"));
  if (journal.writes.length === 0) return;
  const { core: { id } } = await core.call<{ core: { id: string } }>("server.status");
  if (id !== journal.core) throw new Error("the backup belongs to a different Herdr Core");
  for (const { name, before, value } of journal.writes) {
    const current = await get(core, name);
    if (current.version !== before.version + 1 || !isDeepStrictEqual(current.value, value)) continue;
    try {
      await set(core, name, before.value, current.version);
    } catch (error) {
      if (!conflict(error)) throw error;
    }
  }
}

if (import.meta.main) {
  const [action, path, old, next, binary] = process.argv.slice(2);
  let core: CoreClient | undefined;
  try {
    core = await CoreClient.endpoint({ binary });
    if (action === "move") await moveDocuments(core, path, old, next);
    else if (action === "restore") await restoreDocuments(core, path);
    else throw new Error("expected move or restore");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    core?.close();
  }
}
