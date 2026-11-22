"""herdr-artifact preview (SHEP-149): an agent sees its own machine's artifact as the person does, with no reach to the
machine that serves the web app. The web app's viewer (one file) and the artifact's files are served on 127.0.0.1
only, started on demand and reused. Runs the real command in a throwaway home, the tool copied beside a stand-in
viewer page; the server it starts is ended after each test."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, "mods", "artifacts", "bin", "herdr-artifact")
PAGE = "<!doctype html><title>viewer stand-in</title>"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32


def get(url, host=None):
    req = urllib.request.Request(url, headers={"Host": host} if host else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


class Preview(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="herdr-orchestrator-preview-")
        self.home = os.path.join(self.dir, "home")
        self.folder = os.path.join(self.dir, "proj")
        # the tool as a sync leaves it on another machine: bin/herdr-artifact, the viewer beside its folder
        self.tool = os.path.join(self.dir, "artifacts", "bin", "herdr-artifact")
        for d in (self.home, self.folder, os.path.dirname(self.tool)):
            os.makedirs(d)
        shutil.copy(TOOL, self.tool)
        self.viewer = os.path.join(self.dir, "artifacts", "viewer.html")
        with open(self.viewer, "w") as f:
            f.write(PAGE)
        self.env = {"HOME": self.home, "PATH": "/usr/bin:/bin", "HERDR_APP_HOME": os.path.join(self.dir, "app")}
        rec = os.path.join(self.dir, "report")
        os.makedirs(rec)
        with open(os.path.join(rec, "recipe.json"), "w") as f:
            json.dump({"recipe": 1, "blocks": [{"type": "text", "md": "How to group tasks."}, {"type": "image", "src": "shot.png"}]}, f)
        with open(os.path.join(rec, "shot.png"), "wb") as f:
            f.write(PNG)
        out = self.run_tool("publish", rec, "--title", "How to group tasks", "--folder", self.folder, "--json")
        self.assertEqual(out.returncode, 0, out.stderr + out.stdout)
        self.aid = json.loads(out.stdout.strip().splitlines()[-1])["id"]

    def tearDown(self):
        for state in (os.path.join(self.home, ".herdr", "artifacts", ".preview"),):
            try:
                with open(state) as f:
                    os.kill(json.load(f)["pid"], signal.SIGTERM)
            except (OSError, ValueError, KeyError):
                pass
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_tool(self, *args):
        return subprocess.run([sys.executable, self.tool, *args], env=self.env, cwd=self.folder,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=60)

    def preview(self, *args):
        out = self.run_tool("preview", self.aid, "--json", *args)
        self.assertEqual(out.returncode, 0, out.stderr + out.stdout)
        return json.loads(out.stdout)["link"]

    def test_html_artifact_is_served_in_a_static_sandbox(self):
        source = os.path.join(self.dir, "dashboard.html")
        html = b"<!doctype html><style>h1 {color: teal}</style><h1>Dashboard</h1>"
        with open(source, "wb") as f:
            f.write(html)
        out = self.run_tool("publish", source, "--folder", self.folder, "--json")
        self.assertEqual(out.returncode, 0, out.stderr + out.stdout)
        self.aid = json.loads(out.stdout)["id"]
        base = self.preview().split("/?")[0]
        code, _, body = get(f"{base}/api/artifacts/{self.aid}/recipe?v=1")
        self.assertEqual((code, json.loads(body)["blocks"]), (200, [{"type": "html", "src": "visual.html"}]))
        code, headers, body = get(f"{base}/api/artifacts/{self.aid}/file/visual.html?v=1")
        self.assertEqual((code, headers["content-type"], body), (200, "text/html; charset=utf-8", html))
        csp = headers["content-security-policy"]
        self.assertTrue(csp.startswith("sandbox; default-src 'none';"))
        self.assertIn("img-src data:", csp)
        self.assertIn("form-action 'none'", csp)
        self.assertEqual(headers["x-content-type-options"], "nosniff")

    def test_serves_the_viewer_and_the_artifact_on_loopback_only(self):
        # A loopback preview must also start when reverse DNS is unavailable.
        with open(os.path.join(self.dir, "sitecustomize.py"), "w") as f:
            f.write("import socket\n"
                    "def unexpected_lookup(host):\n"
                    "    raise AssertionError(f'unexpected hostname lookup: {host}')\n"
                    "socket.getfqdn = unexpected_lookup\n")
        self.env["PYTHONPATH"] = self.dir
        link = self.preview()
        self.assertRegex(link, r"^http://127\.0\.0\.1:\d+/\?artifact=" + self.aid + "$")
        base = link.split("/?")[0]
        code, headers, body = get(link)
        self.assertEqual((code, body.decode()), (200, PAGE))
        self.assertIn("connect-src 'self'", headers["content-security-policy"])
        code, _, body = get(f"{base}/api/artifacts/{self.aid}")
        meta = json.loads(body)
        self.assertEqual((code, meta["title"], meta["version"], meta["kind"]), (200, "How to group tasks", 1, "recipe"))
        code, _, body = get(f"{base}/api/artifacts/{self.aid}/recipe?v=1")
        self.assertEqual(json.loads(body)["blocks"][0]["md"], "How to group tasks.")
        code, headers, body = get(f"{base}/api/artifacts/{self.aid}/file/shot.png?v=1")
        self.assertEqual((code, headers["content-type"], body), (200, "image/png", PNG))
        self.assertTrue(headers["content-security-policy"].startswith("sandbox"))
        # nothing outside the version's own folder, nothing of another artifact, no other name for this server
        self.assertEqual(get(f"{base}/api/artifacts/{self.aid}/file/..%2f..%2f..%2fproj.json?v=1")[0], 404)
        self.assertEqual(get(f"{base}/api/artifacts/{self.aid}/file/shot.png?v=7")[0], 404)
        self.assertEqual(get(f"{base}/api/artifacts/nope-1234")[0], 404)
        self.assertEqual(get(link, host="attacker.example")[0], 403)
        # bound to loopback: the port is the server's on 127.0.0.1 and nowhere else
        with open(os.path.join(self.home, ".herdr", "artifacts", ".preview")) as f:
            st = json.load(f)
        port = st["port"]
        if sys.platform == "darwin":
            out = subprocess.check_output(
                ["/usr/sbin/lsof", "-nP", "-a", "-p", str(st["pid"]), "-iTCP", "-sTCP:LISTEN", "-Fn"], text=True)
            listeners = [line[1:] for line in out.splitlines() if line.startswith("n")]
            self.assertEqual(listeners, [f"127.0.0.1:{port}"])
        else:
            listeners = []
            for path in ("/proc/net/tcp", "/proc/net/tcp6"):
                if os.path.exists(path):
                    with open(path) as f:
                        next(f)
                        for line in f:
                            _, local, _, state, *_ = line.split()
                            if state == "0A" and local.endswith(f":{port:04X}"):
                                listeners.append(local)
            self.assertEqual(listeners, [f"0100007F:{port:04X}"])

    def test_started_once_and_reused(self):
        a, b = self.preview(), self.preview("--version", "1")
        self.assertEqual(a.split("/?")[0], b.split("/?")[0])
        self.assertTrue(b.endswith("&v=1"))

    def test_an_unknown_artifact_or_version_fails(self):
        self.assertNotEqual(self.run_tool("preview", "nope-1234").returncode, 0)
        out = self.run_tool("preview", self.aid, "--version", "9")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("isn't kept", out.stderr)

    def test_a_server_that_cant_start_says_why(self):
        """#975: the server's own error and its log, not only "didn't start"; it is tried twice."""
        os.makedirs(os.path.join(self.home, ".herdr", "artifacts", ".preview"))  # where it writes its port: a folder
        out = self.run_tool("preview", self.aid)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("The preview server didn't start: it ended at once (exit 1)", out.stderr)
        self.assertIn("IsADirectoryError", out.stderr)
        self.assertIn(".preview.log", out.stderr)

    def test_no_viewer_here_says_so(self):
        os.unlink(self.viewer)
        out = self.run_tool("preview", self.aid)
        if out.returncode == 0:
            self.skipTest("a built or installed viewer is found elsewhere")
        self.assertIn("viewer isn't on this machine", out.stderr)


class Sync(unittest.TestCase):
    def test_a_sync_takes_the_viewer_beside_herdr_artifact(self):
        sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
        from herdr_task import machines
        from unittest import mock
        root = tempfile.mkdtemp(prefix="herdr-orchestrator-viewer-sync-")
        try:
            tool = os.path.join(root, "artifacts", "bin", "herdr-artifact")
            os.makedirs(os.path.dirname(tool))
            shutil.copy(TOOL, tool)
            with open(os.path.join(root, "artifacts", "viewer.html"), "w") as f:
                f.write(PAGE)
            real = machines._real
            with mock.patch.object(machines, "_real", lambda rel: tool if rel.endswith("herdr-artifact") else real(rel)):
                files = {f["path"]: f for f in machines.manifest()["files"]}
            self.assertEqual(files[".local/share/herdr/artifacts/viewer.html"]["data"], PAGE.encode())
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
