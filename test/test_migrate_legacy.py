"""Compatibility with mod IDs recorded by the previous installer."""
import home_guard  # noqa: F401  (first: every test on a throwaway home)
import copy
import json
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from test_install import run

ROOT = Path(__file__).resolve().parents[1]
LEGACY = runpy.run_path(str(ROOT / "bin/migrate_legacy.py"))
MOD_RENAMES = LEGACY["MOD_RENAMES"]
_legacy_doc = LEGACY["LEGACY_PRODUCT"].lower() + ".secrets"
OLD_INSTALL = f"LEGACY_SECRETS_DOC = {_legacy_doc!r}\n" + (ROOT / "test/fixtures/install-3.1.26.py").read_text()


class LegacyLayout(unittest.TestCase):
    def test_update_retires_old_mods_and_keeps_a_custom_layout(self):
        with tempfile.TemporaryDirectory(prefix="orch-mod-rename-") as root:
            app = Path(root) / ".config/herdr-app"
            run("install", "--root", root, "--yes")
            record = app / "data/herdr-orchestrator/installed.json"
            installed = json.loads(record.read_text())
            for previous, current in MOD_RENAMES.items():
                (app / "mods" / current).rename(app / "mods" / previous)
                installed["mods"][previous] = installed["mods"].pop(current)
                prefix = f".config/herdr-app/mods/{current}/"
                for file in list(installed["files"]):
                    if file.startswith(prefix):
                        rel = file[len(prefix):]
                        installed["files"][f".config/herdr-app/mods/{previous}/{rel}"] = installed["files"].pop(file)
            record.write_text(json.dumps(installed))

            layout = app / "layouts/herdr-orchestrator.json"
            expected = json.loads(layout.read_text())
            sidebar = expected["children"][0]
            sidebar["size"] = {"px": 312}
            sidebar["children"].append({
                "id": "settings-block", "type": "block", "size": {"px": 64},
                "content": {"mod": "orchestrator-settings", "props": {"section": "tasks"}},
            })
            saved = copy.deepcopy(expected)
            previous_names = {current: previous for previous, current in MOD_RENAMES.items()}
            for block in saved["children"][0]["children"]:
                content = block.get("content", {})
                if content.get("mod") in previous_names:
                    content["mod"] = previous_names[content["mod"]]
            layout.write_text(json.dumps(saved))

            update = run("update", "--root", root, "--yes", "--source", str(ROOT)).stdout
            self.assertEqual(json.loads(layout.read_text()), expected)
            for previous, current in MOD_RENAMES.items():
                self.assertFalse((app / "mods" / previous).exists())
                self.assertTrue((app / "mods" / current / "main.js").is_file())
                self.assertIn(f"renamed mod to {current}", update)
            backup = next(app.glob(".herdr-orchestrator-backup/*/.config/herdr-app/layouts/herdr-orchestrator.json"))
            self.assertEqual(json.loads(backup.read_text()), saved)
            again = run("update", "--root", root, "--yes", "--source", str(ROOT)).stdout
            self.assertNotIn("renamed mod to", again)


class LegacyBrowserStorage(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "needs Node to run the page's boot script")
    def test_boot_restores_queued_sends_and_preferences_once(self):
        prefix = subprocess.check_output([sys.executable, str(ROOT / "bin/migrate_legacy.py")], text=True).strip()
        html = (ROOT / "web/index.html").read_text()
        boot = html.split("<script>", 1)[1].split("</script>", 1)[0]
        boot = boot.replace("__ORCH_LEGACY_STORAGE_PREFIX__", json.dumps(prefix))
        driver = """
const vm = require('node:vm');
const assert = require('node:assert/strict');
const boot = process.argv[1], oldPrefix = process.argv[2], prefix = 'herdr-orchestrator.';
class Storage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = value; }
  removeItem(key) { delete this[key]; }
}
const localStorage = new Storage(), sessionStorage = new Storage();
localStorage.setItem(oldPrefix + 'outbox.2', '[{"cid":"pending"}]');
localStorage.setItem(oldPrefix + 'appearance', 'dark');
localStorage.setItem(prefix + 'appearance', 'light');
sessionStorage.setItem(oldPrefix + 'kept', '{"place":"shop"}');
const ctx = {
  localStorage, sessionStorage, window: {}, location: {hash: ''},
  document: {documentElement: {dataset: {}}, querySelector: () => ({})},
  matchMedia: () => ({matches: false}),
};
vm.runInNewContext(boot, ctx);
assert.equal(localStorage.getItem(prefix + 'outbox.2'), '[{"cid":"pending"}]');
assert.equal(localStorage.getItem(oldPrefix + 'outbox.2'), null);
assert.equal(sessionStorage.getItem(prefix + 'kept'), '{"place":"shop"}');
assert.equal(ctx.document.documentElement.dataset.theme, 'light');
localStorage.removeItem(prefix + 'outbox.2');
localStorage.setItem(oldPrefix + 'outbox.2', '[{"cid":"stale"}]');
vm.runInNewContext(boot, ctx);
assert.equal(localStorage.getItem(prefix + 'outbox.2'), null);
"""
        subprocess.run(["node", "-e", driver, boot, prefix], check=True, capture_output=True, text=True)
