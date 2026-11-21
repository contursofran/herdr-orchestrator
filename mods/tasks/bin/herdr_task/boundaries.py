"""Check the paths a pinned task revision would change."""

import fnmatch
import os
import re
import shlex
import subprocess
from functools import lru_cache

from .base import Fail, git, now
from .github import remote_of


LINE = re.compile(r"^\s*(?:[-*]\s+)?Boundary:[ \t]*(.*)$", re.IGNORECASE | re.MULTILINE)
OID = re.compile(r"(?:[a-f0-9]{40}|[a-f0-9]{64})")
HOLD = "Task boundary blocked the merge"


def globs(task):
    lines = LINE.findall(task.get("prompt") or "")
    if not lines and not task.get("require_boundary"):
        return []
    try:
        patterns = [part for line in lines for part in shlex.split(line)]
    except ValueError:
        raise Fail("Fix the quoting on the Boundary line in the task brief.")
    if not patterns:
        raise Fail("Add a Boundary line with allowed paths to the task brief.")
    if any(any(part in ("", ".", "..") for part in pattern.split("/")) for pattern in patterns):
        raise Fail("Use repository-relative paths or globs on the Boundary line, such as src/**.")
    return [tuple(pattern.split("/")) for pattern in patterns]


def enabled(task):
    return task.get("require_boundary") or LINE.search(task.get("prompt") or "") is not None


def matches(path, pattern):
    parts = path.split("/")

    @lru_cache(None)
    def visit(i, j):
        if j == len(pattern):
            return i == len(parts)
        if pattern[j] == "**":
            return visit(i, j + 1) or (i < len(parts) and visit(i + 1, j))
        return i < len(parts) and fnmatch.fnmatchcase(parts[i], pattern[j]) and visit(i + 1, j + 1)

    return visit(0, 0)


def changed_paths(folder, base, head):
    # With rename detection off, Git reports a rename as deletion and addition, so both names
    # must match. NUL separation and byte reads preserve whitespace and non-UTF-8 filenames.
    result = subprocess.run(["git", "-C", folder, "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
                             "--ignore-submodules=none", "--name-only", "-z", base, head, "--"], capture_output=True)
    if result.returncode or (result.stdout and not result.stdout.endswith(b"\0")):
        raise Fail("Couldn't read the changed paths. Check the task branch and base, then retry.")
    return {os.fsdecode(path) for path in result.stdout.split(b"\0")[:-1]}


def check(s, task, head, base, *, pull_request=False):
    """Return the reason a scoped merge must wait, or None."""
    try:
        patterns = globs(task)
        if not patterns:
            return None
        if not (OID.fullmatch(head or "") and OID.fullmatch(base or "")):
            raise Fail("Couldn't identify the exact task and base commits. Refresh the branch, then retry.")
        if task.get("head") and task["head"] != head:
            raise Fail("The branch moved since the task was submitted. Run ready for the current commit.")
        folder = s.loc["folder"]
        if pull_request:
            missing = [oid for oid in (base, head) if not git(folder, "cat-file", "-e", f"{oid}^{{commit}}")[0]]
            if missing and not git(folder, "fetch", "--no-tags", "--no-write-fetch-head", remote_of(folder), *missing)[0]:
                raise Fail("Couldn't fetch the exact pull request and base commits. Refresh the branch, then retry.")
            ok, common, _ = git(folder, "merge-base", "--all", base, head)
            if not ok or not OID.fullmatch(common):
                raise Fail("Couldn't identify a single merge base. Update the task branch and run ready again.")
            paths = changed_paths(folder, common, head)
            if common != base:
                # The base may have renamed a file that the task edits. Check the paths in the
                # resulting merge as well as the PR diff, before asking GitHub to merge it.
                ok, merged, _ = git(folder, "merge-tree", "--write-tree", base, head)
                if not ok or not OID.fullmatch(merged):
                    raise Fail("Couldn't determine what the pull request would change on its base. Update the task branch and retry.")
                paths |= changed_paths(folder, base, merged)
        else:
            paths = changed_paths(folder, base, head)
        outside = sorted(path for path in paths if not any(matches(path, pattern) for pattern in patterns))
        if outside:
            shown = ", ".join(repr(path) for path in outside[:8])
            if len(outside) > 8:
                shown += f" and {len(outside) - 8} more"
            raise Fail(f"Outside its Boundary: {shown}. Fix the commit or ask the Orchestrator about scope.")
    except (Fail, OSError, RecursionError) as e:
        return f"{HOLD}: {e}"
    return None


def check_pr(s, task, pr, refresh):
    if not enabled(task):
        return None
    if pr.get("baseRefName") != (task.get("base") or "main"):
        return f"{HOLD}: The pull request targets a different branch than the task's base."
    head, base = pr.get("headRefOid"), pr.get("baseRefOid")
    if problem := check(s, task, head, base, pull_request=True):
        return problem
    current = refresh(task) or {}
    fields = ("headRefOid", "baseRefOid", "baseRefName")
    if any(current.get(field) != pr.get(field) for field in fields) or current.get("state") != "OPEN":
        return f"{HOLD}: The pull request or its base changed during the check. Retry with the current commits."
    return None


def hold(s, task, problem):
    if problem and task.get("attention") != problem:
        task.update(attention=problem, attention_at=now())
        s.dirty = True
    return problem
