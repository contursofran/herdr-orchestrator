"""Move an upstream layout install into the current installer's namespace."""

import datetime
import fcntl
import json
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack, contextmanager
from pathlib import Path

LEGACY_PRODUCT = "Shepherdr"
OLD = LEGACY_PRODUCT.lower()
NEW = "herdr-orchestrator"
APP = Path(".config/herdr-app")
BACKUPS = APP / ".herdr-orchestrator-backup"
OLD_SHARE = Path(".local/share") / OLD
OLD_RECORD = APP / "data" / OLD / "installed.json"
NEW_SHARE = Path(".local/share") / NEW
NEW_RECORD = APP / "data" / NEW / "installed.json"
OLD_LAYOUT = APP / "layouts" / (OLD + ".json")
NEW_LAYOUT = APP / "layouts" / (NEW + ".json")
KEYS = APP / "keys.json"
SHARED = APP / "shared.json"
HOOKS = (Path(".claude/settings.json"), Path(".codex/hooks.json"))
MOD_RENAMES = {
    "shepherdr-settings": "orchestrator-settings",
    "workspace-chrome-shepherdr": "workspace-chrome-orchestrator",
}


class MigrationError(Exception):
    pass


def detected(root):
    root = Path(root)
    if (root / BACKUPS / "legacy-in-progress").exists():
        backup = (root / BACKUPS / "legacy-in-progress").read_text().strip()
        raise MigrationError(f"an installation move was interrupted. Run rollback-install --backup {backup!r} first")
    if (root / OLD_RECORD).is_file():
        return True
    if (root / OLD_SHARE / "installed.json").is_file():
        raise MigrationError(f"found a web-only {LEGACY_PRODUCT} install. This move supports the installed Herdr layout")
    return False


def json_dict(path):
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except ValueError as error:
        raise MigrationError(f"{path} is invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise MigrationError(f"{path} must contain a JSON object")
    return value


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, mode="w", delete=False) as tmp:
        json.dump(value, tmp, indent=2, ensure_ascii=False)
        tmp.write("\n")
        tmp.flush()
        os.fsync(tmp.fileno())
    os.replace(tmp.name, path)


def present(path):
    return os.path.lexists(path)


def remove(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    elif present(path):
        path.unlink()


def copy(path, destination):
    """Copy a tree without following child links or saving transient Unix sockets."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        destination.symlink_to(os.readlink(path))
    elif path.is_dir():
        def special(folder, names):
            return [name for name in names if not (
                (Path(folder) / name).is_symlink() or (Path(folder) / name).is_dir() or (Path(folder) / name).is_file()
            )]
        shutil.copytree(path, destination, symlinks=True, ignore=special)
    elif stat.S_ISREG(path.stat().st_mode):
        shutil.copy2(path, destination)
    else:
        raise MigrationError(f"cannot back up the special file {path}")


def unit(product):
    if sys.platform == "darwin":
        return Path("Library/LaunchAgents") / f"dev.{product}.service.plist"
    return Path(".config/systemd/user") / f"{product}.service"


def service_command(*args, check=False):
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as error:
        if isinstance(error, FileNotFoundError) and not check:
            return False
        raise MigrationError(f"{args[0]}: {error}") from error
    if check and result.returncode:
        raise MigrationError(result.stderr.strip() or f"{' '.join(args)} failed")
    return result.returncode == 0


def service_state(product):
    if sys.platform == "darwin":
        target = f"gui/{os.getuid()}/dev.{product}.service"
        return {"active": service_command("launchctl", "print", target)}
    name = product + ".service"
    return {"active": service_command("systemctl", "--user", "is-active", name),
            "enabled": service_command("systemctl", "--user", "is-enabled", name)}


def stop_service(product, state):
    if sys.platform == "darwin":
        if state["active"]:
            target = f"gui/{os.getuid()}/dev.{product}.service"
            service_command("launchctl", "bootout", target, check=True)
            until = time.monotonic() + 10
            while service_command("launchctl", "print", target):
                if time.monotonic() >= until:
                    raise MigrationError(f"{product}'s service did not stop")
                time.sleep(0.2)
    elif state["active"] or state["enabled"]:
        service_command("systemctl", "--user", "disable", "--now", product + ".service", check=True)


def restore_service(root, state):
    if sys.platform == "darwin":
        if state["active"]:
            service_command("launchctl", "bootstrap", f"gui/{os.getuid()}", str(root / unit(OLD)), check=True)
    elif state["active"] or state["enabled"]:
        service_command("systemctl", "--user", "daemon-reload", check=True)
        if state["enabled"]:
            service_command("systemctl", "--user", "enable", OLD + ".service", check=True)
        if state["active"]:
            service_command("systemctl", "--user", "start", OLD + ".service", check=True)


def remove_share(product, port):
    """Remove only the product's mount pointing at its own loopback port."""
    tailscale = shutil.which("tailscale")
    if not tailscale:
        return
    try:
        result = subprocess.run([tailscale, "serve", "status", "--json"], capture_output=True, text=True, timeout=10)
        web = (json.loads(result.stdout or "{}").get("Web") or {}) if result.returncode == 0 else {}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return
    mount = "/" + product
    for address, listeners in web.items():
        handler = (listeners.get("Handlers") or {}).get(mount) or {}
        _, _, https_port = address.rpartition(":")
        if https_port.isdecimal() and handler.get("Proxy") == f"http://127.0.0.1:{port}":
            service_command(tailscale, "serve", f"--https={https_port}", "--set-path", mount, "off", check=True)


def old_roots(root, home):
    env = dict(os.environ) if home else {}
    config = root / unit(OLD)
    if home and config.is_file():
        if sys.platform == "darwin":
            with config.open("rb") as stream:
                env.update(plistlib.load(stream).get("EnvironmentVariables", {}))
        else:
            for line in config.read_text().splitlines():
                if line.startswith("Environment="):
                    key, _, value = line[len("Environment="):].partition("=")
                    env[key] = value
    defaults = {
        "config": ".config", "data": ".local/share", "state": ".local/state",
        "cache": "Library/Caches" if sys.platform == "darwin" else ".cache",
    }
    one = Path(env.get("SHEPHERDR_HOME") or ".")
    if one.is_absolute():
        return {kind: one / kind for kind in defaults}
    paths = {}
    for kind, default in defaults.items():
        base = Path(env.get(f"XDG_{kind.upper()}_HOME") or ".")
        paths[kind] = (base if base.is_absolute() else root / default) / OLD
    return paths


def within(path, root):
    return path == root or root in path.parents


def snapshot_paths(root, paths):
    """Keep only outer paths and refuse traversal through symlinked directories."""
    relatives = sorted({p.relative_to(root) for p in paths}, key=lambda p: (len(p.parts), str(p)))
    out = []
    for rel in relatives:
        if not rel.parts or not within((root / rel).parent.resolve(), root):
            raise MigrationError(f"{root / rel} must be inside the install root")
        if not any(within(rel, saved) for saved in out):
            out.append(rel)
    return out


def snapshot(root, folder, paths):
    folder.mkdir(mode=0o700)
    entries = []
    for i, rel in enumerate(paths):
        exists = present(root / rel)
        if exists:
            copy(root / rel, folder / str(i))
        entries.append([str(rel), exists])
    return entries


def restore(root, backup, entries):
    for i, (name, exists) in enumerate(entries):
        rel = Path(name)
        target = root / rel
        if rel.is_absolute() or ".." in rel.parts or not rel.parts or not within(target.parent.resolve(), root):
            raise MigrationError(f"invalid backup path: {name}")
        remove(target)
        if exists:
            copy(backup / str(i), target)


@contextmanager
def migration_lock(root):
    folder = root / BACKUPS
    if not within(folder.resolve(), root):
        raise MigrationError("the installation backup folder must be inside the install root")
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (folder / "legacy.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise MigrationError("another installation move is running") from error
        yield


@contextmanager
def task_locks(tasks, wait=0):
    deadline = time.monotonic() + wait
    with ExitStack() as locks:
        if tasks and tasks.is_dir():
            for path in (*tasks.glob(".*.json.lock"), tasks / ".scheduler.lock", tasks / ".tick.lock"):
                if not path.is_file():
                    continue
                stream = locks.enter_context(path.open("rb"))
                while True:
                    try:
                        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError as error:
                        if time.monotonic() >= deadline:
                            raise MigrationError("pause task agents and stop herdr-automations before moving the install") from error
                        time.sleep(0.1)
        yield


def stop_scheduler(root):
    if not shutil.which("hc"):
        return
    from herdr_task import base
    from herdr_task.scheduler import SCHEDULER
    try:
        terminal = base.hc_json("get", SCHEDULER) or {}
        address = terminal.get("address", "")
        argv = (terminal.get("foreground") or {}).get("argv") or terminal.get("argv") or []
        entries = {(root / p / "mods/tasks/bin/herdr-task").resolve() for p in (APP, NEW_SHARE)}
        if (terminal.get("state") == "live" and not terminal.get("machine")
                and address and address.isalnum()
                and len(argv) >= 2 and argv[-1] == "scheduler" and Path(argv[-2]).resolve() in entries):
            # Lock acquisition below verifies exit, including when a kill races with natural exit.
            base.run(["hc", "kill", address])
    except base.Fail as error:
        raise MigrationError(str(error)) from error


def stop_destination(root, home, port_of):
    if home and ((root / unit(NEW)).exists() or (root / NEW_RECORD).exists()):
        port = port_of(root)
        stop_service(NEW, service_state(NEW))
        stop_scheduler(root)
        remove_share(NEW, port)


def restore_install(root, backup, home, state):
    restore(root, backup / "before", state["entries"])
    if home:
        if state["service"]["active"] and service_state(OLD)["active"]:
            return
        restore_service(root, state["service"])


def rollback(root, backup, home, port_of):
    root, backup = Path(root), Path(backup).resolve()
    if backup.parent != (root / BACKUPS).resolve():
        raise MigrationError("use the backup directory printed by the move")
    with migration_lock(root):
        state = json_dict(backup / "manifest.json")
        marker = root / BACKUPS / "legacy-in-progress"
        pending = marker.read_text().strip() if marker.exists() else None
        if pending and pending != str(backup):
            raise MigrationError("another installation move needs recovery first")
        if state.get("root") != str(root):
            raise MigrationError(f"{backup} has no move for this root")
        if state.get("state") == "rolled-back" and pending:
            marker.unlink()
            return str(backup)
        if state.get("state") not in ("moving", "complete", "restoring"):
            raise MigrationError(f"{backup} has no active move for this root")
        relative = Path(state["tasks"])
        tasks = root / relative
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or not within(tasks.parent.resolve(), root):
            raise MigrationError("the backup's task store is outside the install root")
        stop_destination(root, home, port_of)
        with task_locks(tasks, wait=10):
            if state["state"] != "restoring":
                if (root / NEW_RECORD).exists():
                    after = Path(tempfile.mkdtemp(prefix="after-", dir=backup))
                    entries = snapshot(root, after / "files", [Path(name) for name, _ in state["entries"]])
                    write_json(after / "manifest.json", {"root": str(root), "entries": entries})
                marker.write_text(str(backup))
                state["state"] = "restoring"
                write_json(backup / "manifest.json", state)
            restore_install(root, backup, home, state)
            state["state"] = "rolled-back"
            write_json(backup / "manifest.json", state)
            marker.unlink()
    return str(backup)


class Move:
    def __init__(self, root, home, where, kinds, read_hash, move_layout, port_of):
        self.root, self.home, self.where = Path(root), home, where
        self.port_of = port_of
        self.marker = self.root / BACKUPS / "legacy-in-progress"
        self.backup = None
        self.state = None
        self.record = json_dict(self.root / OLD_RECORD)
        if not all(isinstance(self.record.get(k), dict) and self.record[k] for k in ("files", "mods")):
            raise MigrationError(f"{LEGACY_PRODUCT}'s layout install record is incomplete")
        if (self.root / NEW_RECORD).exists() or (self.root / NEW_SHARE / "installed.json").exists():
            raise MigrationError("a destination installation already exists")
        if (self.root / unit(OLD)).is_symlink():
            raise MigrationError(f"{self.root / unit(OLD)} is managed externally; remove the old service through its manager first")
        roots = old_roots(self.root, home)
        self.new_roots = {Path(p) for p in where.roots.values()} | {self.root / NEW_SHARE}
        for path in {*roots.values(), *self.new_roots}:
            if not within(path.resolve(), self.root) or path.resolve() == self.root:
                raise MigrationError(f"put the product data under the install root before moving it: {path}")
        for path in self.new_roots:
            if present(path):
                raise MigrationError(f"destination already exists: {path}")

        self.old_roots = {*roots.values(), self.root / OLD_SHARE}
        self.old_entries = set()
        self.sources = {}
        self.old_port = self.record.get("port") or 7788
        for kind, (legacy, base, relative, _, _) in kinds.items():
            new_alias = self.root / legacy
            old_alias = self.root / {
                "settings": f".herdr/{OLD}.json", "service": f".herdr/{OLD}",
            }.get(kind, legacy)
            if old_alias != new_alias and present(new_alias):
                raise MigrationError(f"destination already exists: {new_alias}")
            modern = roots[base] / relative
            if old_alias.exists() and modern.exists() and old_alias.resolve() != modern.resolve():
                raise MigrationError(f"two copies of {kind} exist: reconcile {old_alias} and {modern} before moving")
            self.old_entries.update((old_alias, new_alias))
            source = next((p for p in (modern, old_alias) if p.exists()), None)
            if source is None:
                continue
            if kind == "service":
                for name in ("usage.jsonl", "usage.1.jsonl", "usage.deleted", "https-port"):
                    if (source / name).is_file():
                        self.sources[Path(where.new(kind)) / name] = source / name
            else:
                self.sources[Path(where.new(kind))] = source

        self.vault_backups = {}
        secrets = roots["data"] / "secrets"
        self.new_secrets = Path(where.new("vault")).parent
        if secrets.is_dir():
            for source in secrets.iterdir():
                if source.name.startswith(("vault.json.moved-", "vault.json.before-move-")) and source.is_file():
                    self.vault_backups[self.new_secrets / source.name] = source

        self.old_entries.update(self.root / ".herdr" / name for name in (".layout-rollback", "sync-hold"))
        self.old_mod_data = {}
        for old, new in MOD_RENAMES.items():
            source = self.root / APP / "data" / old
            target = self.root / APP / "data" / new
            if present(source):
                if present(target):
                    raise MigrationError(f"destination already exists: {target}")
                self.old_mod_data[target] = source

        files = {}
        for name, sha in self.record["files"].items():
            rel = Path(name)
            if rel.is_absolute() or ".." in rel.parts:
                raise MigrationError(f"unsafe path in the old install record: {name}")
            if within(rel, APP) or within(rel, Path(".config/herdr-core/templates")):
                files[name] = sha
        self.previous = {"files": files, "mods": self.record["mods"]}
        for name in self.previous["mods"]:
            if not name or name in (".", "..") or Path(name).name != name:
                raise MigrationError(f"invalid mod ID in the old install record: {name}")
        self.keys = json_dict(self.root / KEYS)
        old_keys, new_keys = f"layout:{OLD}", f"layout:{NEW}"
        destination_keys = self.keys.get(new_keys, {})
        if old_keys in self.keys:
            if not isinstance(self.keys[old_keys], dict) or not isinstance(destination_keys, dict):
                raise MigrationError("the layout's key bindings must be JSON objects")
            self.keys[new_keys] = {**self.keys.pop(old_keys), **destination_keys}
        key_owners = {}
        for name, owner in self.record.get("keys", {}).items():
            if name.startswith(old_keys + " "):
                key = name.split(" ", 1)[1]
                if key in destination_keys:
                    continue
                name = f"{new_keys} {key}"
            key_owners[name] = owner
        self.previous["keys"] = key_owners
        self.shared = json_dict(self.root / SHARED)
        for path in HOOKS:
            json_dict(self.root / path)
        self.layout = None
        source = self.root / OLD_LAYOUT
        if source.is_file():
            old_data = source.read_bytes()
            # Untouched installs take the new shipped layout. Customized ones keep their layout and switch mod IDs.
            if read_hash(str(OLD_LAYOUT), old_data) != files.get(str(OLD_LAYOUT)):
                if present(self.root / NEW_LAYOUT):
                    raise MigrationError(f"custom layout destination already exists: {self.root / NEW_LAYOUT}")
                json_dict(source)
                moved, _ = move_layout(old_data, NEW)
                self.layout = moved.encode() if moved is not None else old_data
                self.previous["files"][str(NEW_LAYOUT)] = files.get(str(OLD_LAYOUT), "")

    @contextmanager
    def transaction(self):
        tasks = Path(self.where.new("tasks"))
        with migration_lock(self.root):
            try:
                with task_locks(self.sources.get(tasks)):
                    if not detected(self.root):
                        raise MigrationError("the old install is no longer there")
                    yield
            except (Exception, KeyboardInterrupt):
                if self.state:
                    stop_destination(self.root, self.home, self.port_of)
                    with task_locks(tasks, wait=10):
                        self.state["state"] = "restoring"
                        write_json(self.backup / "manifest.json", self.state)
                        restore_install(self.root, self.backup, self.home, self.state)
                        self.state["state"] = "rolled-back"
                        write_json(self.backup / "manifest.json", self.state)
                        self.marker.unlink()
                raise

    def begin(self, mods, items):
        root = self.root
        old_entries = set(self.old_entries)
        # Keep absolute git worktree paths usable. Everything else leaves the old product's roots.
        for directory in self.old_roots:
            if directory.is_dir() and not directory.is_symlink():
                for child in directory.iterdir():
                    if child.name == "worktrees" and child.is_dir() and any(child.iterdir()):
                        continue
                    old_entries.add(child)
        data = {**self.sources, **self.vault_backups}
        linked_targets = {source.resolve() for source in data.values() if source.is_symlink()}
        # A cross-disk move may already link back to data in the old layout.
        old_entries = {path for path in old_entries
                       if path.is_symlink() or not any(within(target, path) for target in linked_targets)}
        obsolete = {
            root / OLD_RECORD.parent, root / OLD_LAYOUT, root / unit(OLD),
            root / ".local/bin" / OLD, root / APP / f".{OLD}-backup",
            *self.old_mod_data.values(),
        }
        paths = {root / rel for _, rel, _ in items} | {root / rel for rel in self.previous["files"]}
        paths.update(root / (rel + ".new") for _, rel, _ in items)
        paths.update(root / APP / "mods" / mod for mod in {*mods, *self.previous["mods"]})
        paths.update(root / Path(".local/bin") / name for name in (
            "herdr-task", "herdr-artifact", "herdr-secret", "herdr-browser", NEW, "herdr-app",
        ))
        paths.update({root / KEYS, root / SHARED, root / NEW_LAYOUT, root / NEW_RECORD.parent,
                      root / unit(NEW), root / APP / ".herdr-orchestrator-stage"})
        paths.update(root / path for path in HOOKS)
        paths.update(self.new_roots | old_entries | obsolete | set(self.old_mod_data))
        relatives = snapshot_paths(root, paths)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.backup = Path(tempfile.mkdtemp(prefix=f"legacy-{stamp}-", dir=root / BACKUPS))
        state = {
            "root": str(root), "state": "moving",
            "tasks": str(Path(self.where.new("tasks")).relative_to(root)),
            "service": service_state(OLD) if self.home else {},
            "entries": snapshot(root, self.backup / "before", relatives),
        }
        write_json(self.backup / "manifest.json", state)
        self.marker.write_text(str(self.backup))
        self.state = state
        print(f"  installation backup: {self.backup}", flush=True)
        if self.home:
            stop_service(OLD, state["service"])
            remove_share(OLD, self.old_port)
        if self.vault_backups:
            self.new_secrets.mkdir(parents=True, mode=0o700, exist_ok=True)
        for target, source in data.items():
            if source.is_symlink():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(source.resolve())
            else:
                copy(source, target)
                if target in self.vault_backups:
                    target.chmod(0o600)
        for target, source in self.old_mod_data.items():
            copy(source, target)
        for path in old_entries | obsolete:
            remove(path)
        for directory in self.old_roots:
            if directory.is_dir() and not directory.is_symlink() and not any(directory.iterdir()):
                directory.rmdir()
        if self.keys or (root / KEYS).exists():
            write_json(root / KEYS, self.keys)
        if self.shared.get("layout") == OLD:
            self.shared["layout"] = NEW
            write_json(root / SHARED, self.shared)
        if self.layout is not None:
            (root / NEW_LAYOUT).write_bytes(self.layout)

    def done(self):
        self.state["state"] = "complete"
        write_json(self.backup / "manifest.json", self.state)
        self.marker.unlink()
        self.state = None


if __name__ == "__main__":
    print(LEGACY_PRODUCT.lower() + ".")
