import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreClient, CoreError } from "./hc/client.ts";
import { moveDocuments, restoreDocuments } from "./migrate-legacy-docs.ts";

function fakeCore(values: Record<string, unknown>) {
  const docs = new Map(Object.entries(values).map(([name, value]) => [name, { value, version: 1 }]));
  const read = (name: string) => docs.get(name) ?? { value: null, version: 0 };
  const state = { id: "original-core", afterWrite: (_name: string) => {} };
  const call: CoreClient["call"] = async <T>(method: string, params: Record<string, unknown> = {}) => {
    const name = String(params.name);
    if (method === "server.status") return { core: { id: state.id } } as T;
    if (method === "doc.get") return structuredClone(read(name)) as T;
    if (method !== "doc.set" || params.on) throw new Error(`unexpected request: ${method}`);
    const { version } = read(name);
    if (version !== params.version) throw new CoreError("conflict", "version mismatch");
    docs.set(name, { value: params.value, version: version + 1 });
    state.afterWrite(name);
    return { version: version + 1 } as T;
  };
  return { core: { call }, docs, read, state };
}

test("migrates all three documents and can restore empty and absent originals", async () => {
  const top = mkdtempSync(join(tmpdir(), "orch-docs-"));
  const path = join(top, "journal.json");
  const data = { pinned: ["shop"], notify: { completed: true } };
  const host = { id: "web-host", at: 2 };
  const secrets = { id: "secrets-host", at: 3 };
  const { core, read } = fakeCore({
    "upstream": data, "upstream.host": host, "upstream.secrets": secrets, "current": {},
  });
  try {
    await moveDocuments(core, path, "upstream", "current");
    expect(read("current")).toEqual({ version: 2, value: data });
    expect(read("current.host").value).toEqual(host);
    expect(read("current.secrets").value).toEqual(secrets);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await restoreDocuments(core, path);
    await restoreDocuments(core, path);
    expect(read("current")).toEqual({ version: 3, value: {} });
    expect(read("current.host")).toEqual({ version: 2, value: null });
    expect(read("current.secrets")).toEqual({ version: 2, value: null });
    expect(read("upstream").value).toEqual(data);
    expect(read("upstream.host").value).toEqual(host);
    expect(read("upstream.secrets").value).toEqual(secrets);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});

test("leaves existing and later edits alone, and recovers a write whose reply was lost", async () => {
  const top = mkdtempSync(join(tmpdir(), "orch-docs-"));
  const path = join(top, "journal.json");
  const { core, read, state } = fakeCore({
    "upstream": { pinned: ["old"] }, "current": { pinned: ["keep"] },
    "upstream.host": { id: "web-host" }, "upstream.secrets": { id: "secrets-host" },
  });
  state.afterWrite = (name) => {
    if (name !== "current.secrets") return;
    expect(JSON.parse(readFileSync(path, "utf8")).writes.map((entry: { name: string }) => entry.name))
      .toEqual(["current.host", "current.secrets"]);
    throw new CoreError("uncertain", "lost reply");
  };
  try {
    await expect(moveDocuments(core, path, "upstream", "current")).rejects.toThrow("lost reply");
    state.afterWrite = () => {};
    await core.call("doc.set", { name: "current.host", value: { id: "new-host" }, version: 1 });
    state.id = "different-core";
    await expect(restoreDocuments(core, path)).rejects.toThrow("different Herdr Core");
    state.id = "original-core";
    await restoreDocuments(core, path);
    expect(read("current").value).toEqual({ pinned: ["keep"] });
    expect(read("current.host").value).toEqual({ id: "new-host" });
    expect(read("current.secrets").value).toBeNull();
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
});
