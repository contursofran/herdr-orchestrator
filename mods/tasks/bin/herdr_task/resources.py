"""Exclusive, machine-local resources requested by tasks."""

import fcntl
import os
import re
from contextlib import contextmanager
from copy import deepcopy

from .base import Fail, STORE
from .store import read_list, store_files


ACTIVE = ("running", "ready")


class Busy(Fail):
    pass


def configure(task, args):
    locks = getattr(args, "lock", None)
    if locks is None:
        return
    if task.get("started") or task["state"] in ACTIVE:
        raise Fail("Resource locks can only change before a task starts.")
    if locks == [""]:
        task.pop("locks", None)
        return
    if any(not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}", name) for name in locks):
        raise Fail("Use a resource name like test-device or release for each --lock.")
    task["locks"] = sorted(set(locks))


def waiting(s, task):
    wanted = set(task.get("locks") or ())
    if not wanted:
        return None
    lists = [s.data] + [read_list(path) for path in store_files() if path != s.path]
    for data in filter(None, lists):
        for other in data["tasks"]:
            if other is task or other["state"] not in ACTIVE:
                continue
            shared = wanted.intersection(other.get("locks") or ())
            if shared:
                ref = f"{data.get('prefix') or data['name']}-{other['id']}"
                return f"Resource {', '.join(sorted(shared))} is held by {ref}"
    return None


def reserve(s, task):
    """Reserve before activating a task. List locks and atomic writes are handled by Store."""
    if not task.get("locks"):
        return
    with open(os.path.join(STORE, ".resources.lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if reason := waiting(s, task):
            raise Busy(reason)
        if task["state"] not in ACTIVE:
            task["state"] = "running"
            s.dirty = True
            s.save()


@contextmanager
def activate(s, task):
    prior = deepcopy(task) if task.get("locks") and task["state"] not in ACTIVE else None
    reserve(s, task)
    try:
        yield
    except Exception:
        if prior is not None:
            task.clear()
            task.update(prior)
            s.dirty = True
            s.save()
        raise
