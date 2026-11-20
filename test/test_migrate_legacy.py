"""Compatibility with mod IDs recorded by the previous installer."""
import home_guard  # noqa: F401  (first: every test on a throwaway home)
import copy
import fcntl
import json
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import Mock, patch
from test_install import tree, run

ROOT = Path(__file__).resolve().parents[1]
LEGACY = runpy.run_path(str(ROOT / "bin/migrate_legacy.py"))
MOD_RENAMES = LEGACY["MOD_RENAMES"]
_legacy_doc = LEGACY["LEGACY_PRODUCT"].lower() + ".secrets"
OLD_INSTALL = f"LEGACY_SECRETS_DOC = {_legacy_doc!r}\n" + (ROOT / "test/fixtures/install-3.1.26.py").read_text()
IMPORTED_RELEASE = "242156c06cc1325c30b4661b5aa2be50cbfde6fa"


class LegacyService(unittest.TestCase):
    def test_launchd_uses_the_old_label_and_restarts_from_the_restored_plist(self):
        run_service = Mock(side_effect=[True, True, False, True])
        context = LEGACY["stop_service"].__globals__
        with patch.dict(context, {"service_command": run_service}), patch.object(sys, "platform", "darwin"):
            LEGACY["stop_service"]("shepherdr", {"active": True})
            LEGACY["restore_service"](Path("/install"), {"active": True})
        target = f"gui/{LEGACY['os'].getuid()}"
        self.assertEqual(run_service.call_args_list[0].args, ("launchctl", "bootout", target + "/dev.shepherdr.service"))
        self.assertEqual(run_service.call_args_list[-1].args, (
            "launchctl", "bootstrap", target, "/install/Library/LaunchAgents/dev.shepherdr.service.plist",
        ))

    def test_tailscale_removes_only_the_owned_route(self):
        web = {"Web": {
            "box:443": {"Handlers": {"/shepherdr": {"Proxy": "http://127.0.0.1:7788"},
                                     "/other": {"Proxy": "http://127.0.0.1:7788"}}},
            "box:8443": {"Handlers": {"/shepherdr": {"Proxy": "http://127.0.0.1:9090"}}},
        }}
        fake = Mock(return_value=CompletedProcess([], 0, json.dumps(web), ""))
        with patch.object(shutil, "which", return_value="/fake/tailscale"), patch.object(subprocess, "run", fake):
            LEGACY["remove_share"]("shepherdr", 7788)
        self.assertEqual(fake.call_count, 2)
        self.assertEqual(fake.call_args.args, (("/fake/tailscale", "serve", "--https=443", "--set-path", "/shepherdr", "off"),))


class InstalledMove(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (ROOT / ".git").exists():
            raise unittest.SkipTest("an exported tree has no upstream import commit")
        source = tempfile.TemporaryDirectory(prefix="orch-upstream-source-")
        cls.addClassCleanup(source.cleanup)
        cls.source = Path(source.name)
        with subprocess.Popen(["git", "archive", IMPORTED_RELEASE], cwd=ROOT, stdout=subprocess.PIPE) as archive:
            subprocess.run(["tar", "-x", "-C", str(cls.source)], stdin=archive.stdout, check=True)
            if archive.wait():
                raise AssertionError("the upstream import commit is missing from the checkout")

    def setUp(self):
        root = tempfile.TemporaryDirectory(prefix="orch-move-")
        self.addCleanup(root.cleanup)
        self.root = Path(root.name)
        app = self.root / ".config/herdr-app"
        app.mkdir(parents=True)
        (self.root / ".claude").mkdir()
        (self.root / ".codex").mkdir()
        self.save(".claude/settings.json", {"model": "my-default"})
        self.save(".codex/hooks.json", {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "true"}]}]}})
        previous = subprocess.run(
            [sys.executable, str(self.source / "bin/shepherdr"), "install", "--root", str(self.root), "--yes", "--no-build"],
            cwd=self.source, text=True, capture_output=True,
        )
        self.assertEqual(previous.returncode, 0, previous.stdout + previous.stderr)
        old_settings = {"everywhere": {"tasks": {"merge": "ask"}}, "version": 1}
        self.save(".config/shepherdr/settings.json", old_settings)
        self.save(".local/share/shepherdr/tasks/shop.json", {"name": "shop", "tasks": [{"id": 1, "title": "Keep me"}]})
        self.save(".local/share/shepherdr/secrets/vault.json", {"secrets": [{"name": "EXAMPLE", "value": "fake"}]})
        self.save(".local/share/shepherdr/artifacts/shop.json", {"artifacts": [{"id": "plan"}]})
        self.save(".config/herdr-app/shared.json", {"layout": "shepherdr", "custom": {"preserve": True}})
        keys = self.load(".config/herdr-app/keys.json")
        keys["layout:shepherdr"]["f2"] = "my.custom-key"
        keys["global"]["alt-1"] = "my.other-key"
        self.save(".config/herdr-app/keys.json", keys)
        layout = self.load(".config/herdr-app/layouts/shepherdr.json")
        layout["children"][0]["size"]["px"] = 353
        self.save(".config/herdr-app/layouts/shepherdr.json", layout)
        self.save(".config/herdr-app/data/shepherdr-settings/window.json", {"section": "tasks"})
        own = app / "mods/my-custom"
        own.mkdir()
        (own / "main.js").write_text("// my own mod\n")
        self.before = tree(self.root)

    def save(self, path, value):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(value))

    def load(self, path):
        return json.loads((self.root / path).read_text())

    def invoke(self, *args, **kwargs):
        return run(*args, "--root", str(self.root), **kwargs)

    def test_move_and_rollback(self):
        no = self.invoke("install", "--yes", "--adopt", ok=False)
        self.assertNotEqual(no.returncode, 0)
        self.assertIn("--migrate-legacy", no.stderr)
        preview = self.invoke("install", "--migrate-legacy", "--dry-run", "--yes")
        self.assertIn("would back up", preview.stdout)
        self.assertEqual(tree(self.root), self.before)
        result = self.invoke("install", "--migrate-legacy", "--yes")
        line = next(line for line in result.stdout.splitlines() if "installation backup:" in line)
        backup = Path(line.split("installation backup: ", 1)[1])
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        for path in (".config/shepherdr", ".local/share/shepherdr", ".local/state/shepherdr", ".local/bin/shepherdr",
                     ".config/herdr-app/layouts/shepherdr.json", ".config/herdr-app/data/shepherdr",
                     ".config/herdr-app/mods/shepherdr-settings", str(LEGACY["unit"]("shepherdr"))):
            self.assertFalse((self.root / path).exists(), path)
            self.assertFalse((self.root / path).is_symlink(), path)
        for previous, current in (
            (".config/shepherdr/settings.json", ".config/herdr-orchestrator/settings.json"),
            (".local/share/shepherdr/tasks/shop.json", ".local/share/herdr-orchestrator/tasks/shop.json"),
            (".local/share/shepherdr/secrets/vault.json", ".local/share/herdr-orchestrator/secrets/vault.json"),
            (".local/share/shepherdr/artifacts/shop.json", ".local/share/herdr-orchestrator/artifacts/shop.json"),
            (".config/herdr-app/data/shepherdr-settings/window.json", ".config/herdr-app/data/orchestrator-settings/window.json"),
        ):
            self.assertEqual((self.root / current).read_bytes(), self.before[previous])
        self.assertEqual((self.root / ".herdr/tasks").resolve(), self.root.resolve() / ".local/share/herdr-orchestrator/tasks")
        layout = self.load(".config/herdr-app/layouts/herdr-orchestrator.json")
        self.assertEqual(layout["children"][0]["size"]["px"], 353)
        self.assertIn("workspace-chrome-orchestrator", json.dumps(layout))
        keys = self.load(".config/herdr-app/keys.json")
        self.assertNotIn("layout:shepherdr", keys)
        self.assertEqual(keys["layout:herdr-orchestrator"]["f2"], "my.custom-key")
        self.assertEqual(keys["global"]["alt-1"], "my.other-key")
        self.assertEqual(self.load(".config/herdr-app/shared.json"), {"layout": "herdr-orchestrator", "custom": {"preserve": True}})
        self.assertTrue((self.root / ".config/herdr-app/mods/my-custom/main.js").is_file())
        claude = self.load(".claude/settings.json")
        self.assertEqual(claude["model"], "my-default")
        self.assertEqual(len(claude["hooks"]["SessionStart"]), 1)
        self.assertIn("Stop", self.load(".codex/hooks.json")["hooks"])
        self.assertIn("whole", self.invoke("doctor").stdout)

        self.save(".local/share/herdr-orchestrator/tasks/shop.json", {"tasks": [{"id": 2, "title": "After"}]})
        self.invoke("rollback-install", "--backup", str(backup))
        self.assert_restored()
        self.assertTrue(any(b'After' in f.read_bytes() for f in backup.glob("after-*/files/*/tasks/shop.json")))

    def assert_restored(self):
        restored = tree(self.root)
        self.assertEqual(set(restored), set(self.before))
        self.assertEqual([name for name, contents in restored.items() if contents != self.before[name]], [])

    def test_active_scheduler_blocks_cutover(self):
        lock = self.root / ".local/share/shepherdr/tasks/.scheduler.lock"
        with lock.open("wb") as held:
            fcntl.flock(held, fcntl.LOCK_EX)
            blocked = self.invoke("install", "--migrate-legacy", "--yes", ok=False)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("stop herdr-automations", blocked.stderr)
        self.assertFalse((self.root / ".config/herdr-app/data/herdr-orchestrator/installed.json").exists())

    def test_failed_install_restores_old_files_and_data(self):
        with tempfile.TemporaryDirectory(prefix="orch-inject-failure-") as folder:
            source = Path(folder) / "source"
            shutil.copytree(ROOT, source, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", ".last"))
            installer = source / "bin/herdr-orchestrator"
            script = installer.read_text()
            marker = "def save_record(root, rec):\n"
            self.assertIn(marker, script)
            installer.write_text(script.replace(marker, marker + '    raise OSError("test failure before saving install record")\n', 1))
            failed = subprocess.run(
                [sys.executable, str(installer), "install", "--root", str(self.root), "--yes", "--no-build", "--migrate-legacy"],
                cwd=source, capture_output=True, text=True,
            )
        self.assertEqual(failed.returncode, 1, failed.stdout + failed.stderr)
        self.assertIn("test failure before saving install record", failed.stderr)
        self.assert_restored()


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
