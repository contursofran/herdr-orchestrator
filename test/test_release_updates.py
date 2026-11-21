import home_guard  # noqa: F401  (first: tests never use the real home)
import hashlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from test_install import INSTALLER, ROOT, run


def manifest(body=b"package", tag="v0.1.10"):
    return {"tag_name": tag, "assets": [{"name": "herdr-orchestrator.tar.gz", "state": "uploaded", "size": len(body),
                                          "digest": "sha256:" + hashlib.sha256(body).hexdigest()}]}


class ReleaseUpdates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cli = runpy.run_path(INSTALLER)["main"].__globals__

    def test_offer_only_a_newer_stable_release_with_a_verified_package(self):
        with patch.dict(self.cli, release_open=lambda *_: io.BytesIO(json.dumps(manifest()).encode())):
            self.assertEqual(self.cli["latest_release"]("0.1.9")["tag"], "v0.1.10")
            self.assertEqual(self.cli["latest_release"]("0.1.11"), {"state": "current"})
        for field in ("draft", "prerelease"):
            metadata = {**manifest(), field: True}
            with patch.dict(self.cli, release_open=lambda *_: io.BytesIO(json.dumps(metadata).encode())):
                self.assertEqual(self.cli["latest_release"]("0.1.9"), {"state": "no-release"})
        metadata = manifest()
        metadata["assets"][0].pop("digest")
        with patch.dict(self.cli, release_open=lambda *_: io.BytesIO(json.dumps(metadata).encode())):
            self.assertEqual(self.cli["latest_release"]("0.1.9"), {"state": "no-package", "tag": "v0.1.10"})

    def test_unpublished_project_has_no_offer(self):
        def not_found(url, _accept):
            raise HTTPError(url, 404, "Not found", None, None)

        with patch.dict(self.cli, release_open=not_found):
            self.assertEqual(self.cli["latest_release"]("0.1.0"), {"state": "no-release"})

    def test_release_check_uses_authenticated_gh_when_the_public_quota_is_spent(self):
        def limited(url, _accept):
            raise HTTPError(url, 403, "Rate limited", {"X-RateLimit-Remaining": "0"}, None)

        with patch.dict(self.cli, release_open=limited), patch("shutil.which", return_value="/fake/gh"), \
                patch("subprocess.run") as run_gh:
            run_gh.return_value = subprocess.CompletedProcess([], 0, stdout=json.dumps(manifest()).encode())
            self.assertEqual(self.cli["latest_release"]("0.1.9")["tag"], "v0.1.10")
            run_gh.assert_called_once_with(["/fake/gh", "api", "repos/contursofran/herdr-orchestrator/releases/latest"],
                                           capture_output=True, timeout=15)
            run_gh.return_value = subprocess.CompletedProcess([], 1, stdout=b'{"status":"404"}')
            self.assertEqual(self.cli["latest_release"]("0.1.9"), {"state": "no-release"})

    def test_rejects_a_download_that_does_not_match_its_digest(self):
        expected = hashlib.sha256(b"good").hexdigest()
        release = {"tag": "v0.1.1", "size": 4, "digest": expected}
        with tempfile.TemporaryDirectory() as temp, patch.dict(self.cli, release_open=lambda *_: io.BytesIO(b"bad!")):
            with self.assertRaisesRegex(self.cli["Stop"], "failed its SHA-256 verification"):
                self.cli["download_release"](release, Path(temp, "release.tar.gz"))

    def test_package_must_have_regular_files_and_the_version_on_the_label(self):
        with tempfile.TemporaryDirectory() as temp:
            root, package = Path(temp, "source"), Path(temp, "release.tar.gz")
            with tarfile.open(package, "w:gz") as tar:
                entry = tarfile.TarInfo("link")
                entry.type = tarfile.SYMTYPE
                entry.linkname = "other"
                tar.addfile(entry)
            with self.assertRaisesRegex(self.cli["Stop"], "Unexpected entry"):
                self.cli["unpack_release"](package, root, "v0.1.1")
            with tarfile.open(package, "w:gz") as tar:
                for name, content in {"bin/herdr-orchestrator": b'VERSION = "0.1.0"\n', "install.sh": b"",
                                      "lib/addons.json": b"{}", "web/dist/index.html": b"<html>"}.items():
                    entry = tarfile.TarInfo(name)
                    entry.size = len(content)
                    tar.addfile(entry, io.BytesIO(content))
            with self.assertRaisesRegex(self.cli["Stop"], "doesn't contain a complete v0.1.1 release"):
                self.cli["unpack_release"](package, root, "v0.1.1")

    def test_release_install_uses_the_real_updater_in_a_scratch_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root, source = Path(temp, "home"), Path(temp, "source")
            root.mkdir()
            source.mkdir()
            run("install", "--root", str(root), "--yes", "--no-hooks")
            tagged = subprocess.check_output(["git", "archive", "HEAD"], cwd=ROOT)
            subprocess.run(["tar", "-xf", "-", "-C", source], input=tagged, check=True)
            installer = source / "bin" / "herdr-orchestrator"
            installer.write_text(installer.read_text().replace(f'VERSION = "{self.cli["VERSION"]}"', 'VERSION = "9.0.1"'))
            dist = source / "web" / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<title>Packaged web app</title>")
            package = Path(temp, "asset.tar.gz")
            subprocess.run(["tar", "-czf", package, "-C", source, "."], check=True)
            body = package.read_bytes()
            data = json.dumps(manifest(body, tag="v9.0.1")).encode()
            layout = root / ".config" / "herdr-app" / "layouts" / "herdr-orchestrator.json"
            custom = json.loads(layout.read_text())
            custom["name"] = "My layout"
            layout.write_text(json.dumps(custom))

            with patch.dict(self.cli, release_open=lambda url, _: io.BytesIO(data if url.endswith("/latest") else body)):
                self.assertEqual(self.cli["main"](["release", "install", "v9.0.1", "--root", str(root)]), 0)
            record = self.cli["load_record"](root)
            self.assertEqual((record["version"], record["release"]), ("9.0.1", "v9.0.1"))
            self.assertTrue(Path(record["source"], "install.sh").is_file())
            self.assertFalse(Path(record["source"], ".git").exists())
            self.assertEqual(json.loads(layout.read_text())["name"], "My layout")
            self.assertEqual((root / self.cli["SHARE"] / "web/dist/index.html").read_text(), "<title>Packaged web app</title>")
