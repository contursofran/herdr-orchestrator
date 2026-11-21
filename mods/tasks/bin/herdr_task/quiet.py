"""One recovery message per unexplained quiet worker episode."""

import re

from .agents import agent_running, last_question, last_words, own_line, status_word, task_status, turn_input, WAITS_ON
from .base import git, hc_json, now, run


NUDGE_AFTER_MS = 2 * 60_000
ESCALATE_AFTER_MS = 5 * 60_000
NUDGE_HEADER = "Herdr noticed this task went quiet."
NUDGE = (f"{NUDGE_HEADER} Check your task and continue the work if you can. "
         "If you're finished, submit it with herdr-task ready. If you need a decision, ask for it in your chat.")
WAITS_FOR_REPLY = re.compile(r"\b(?:wait(?:ing|s)? (?:for|on)|need(?:s)?) (?:you\b|your\b|the person\b|human\b|"
                             r"(?:an? )?(?:answer|reply|decision|approval|confirmation)\b)", re.I)
WAITING = re.compile(r"\b(?:waiting|waits|watching|polling)\b", re.I)


def worker(s, task, live):
    """Identify one local task worker, recorded by Herdr and still running in its terminal."""
    owners = [k for k in live if (k.get("labels") or {}).get("herdr.role") in (None, "worker")]
    if len(owners) != 1:
        return None
    k = owners[0]
    address = k.get("address") or ""
    labels = k.get("labels") or {}
    if (not address or "/" in address or k.get("state") != "live" or labels.get("herdr.task") != s.key(task)
            or not (k.get("foreground") or {}).get("pid") or not agent_running(k) or not isinstance(k.get("turn"), int)
            or not any(a.get("address") == address and not a.get("ended") for a in task.get("agents") or [])):
        return None
    return k


def unexplained(task, k, live):
    pr = task.get("pr") or {}
    if (status_word(k) not in ("idle", "done") or task.get("attention") or task.get("retry")
            or task.get("review_out") or task.get("merge_requested") or task.get("merge_queued")
            or pr.get("wait") or pr.get("needs_approval")
            or (task.get("review_request") or {}).get("status") in ("queued", "reviewing", "approved", "escalated")):
        return False
    # Reuse the task's wait classification for background work, questions, and permissions.
    if task_status(task, live, recovery=False)[:2] != ("needs", "reply") or last_question(task, k["address"]):
        return False
    line = own_line(task, k["address"]) or last_words(task, k["address"], default="")
    return not (WAITS_FOR_REPLY.search(line) or (WAITING.search(line) and WAITS_ON.search(line)))


def progress(task, previous):
    p = task.get("progress") or {}
    wt = task.get("worktree")
    head = previous[-1] if previous else None
    if wt:
        ok, current, _ = git(wt, "rev-parse", "--verify", "HEAD")
        if ok:
            head = current
    reported = {} if p.get("by") else p
    return [" ".join((reported.get("text") or "").casefold().split()), reported.get("done"), head]


def continues_episode(task, row, k, made):
    if (row.get("address") != k["address"] or row.get("pid") != k["foreground"]["pid"]
            or row.get("progress") != made):
        return False
    if row.get("turn") == k["turn"]:
        return True
    # A reply to the nudge can increment the turn without advancing the work. A distinct
    # prompt in the transcript, or a later turn, starts a new episode.
    if not row.get("attempted_at") or k["turn"] != row.get("attempt_turn", -2) + 1:
        return False
    began, text = turn_input(task, k["address"])
    return not began or began < row["attempted_at"] or NUDGE_HEADER in text


def advance(s, task, live):
    """Advance a recovery episode while holding the task list's write lock."""
    row = task.get("quiet_recovery") or {}
    if not s.write:
        return
    if task["state"] != "running" or task.get("archived"):
        if task.pop("quiet_recovery", None):
            s.dirty = True
        return
    k = worker(s, task, live)
    if not k or not unexplained(task, k, live):
        if row.pop("since", None):
            s.dirty = True
        return

    made, at = progress(task, row.get("progress")), now()
    if not continues_episode(task, row, k, made):
        row = {"address": k["address"], "pid": k["foreground"]["pid"], "progress": made}
        task["quiet_recovery"] = row
    if not row.get("since") or row.get("turn") != k["turn"]:
        row.setdefault("since", at)
        row["turn"] = k["turn"]
        s.dirty = True

    attempted = row.get("attempted_at") or 0
    delay = ESCALATE_AFTER_MS if attempted else NUDGE_AFTER_MS
    if row.get("reason") or at - max(row["since"], attempted) < delay:
        return

    # Re-read the terminal just before acting. A turn change, stopped worker, a changed label
    # or the person's draft invalidates the earlier observation.
    from .news import typing
    current = hc_json("get", k["address"])
    current_live = [current if other is k else other for other in live] if current else []
    fresh = worker(s, task, current_live)
    if (not fresh or fresh["address"] != k["address"] or fresh["foreground"]["pid"] != row["pid"]
            or fresh["turn"] != row["turn"] or not unexplained(task, fresh, current_live) or typing(k["address"], fresh)):
        return
    if attempted:
        reason = ("Herdr couldn't deliver its automatic nudge and the worker is still quiet."
                  if row.get("failed") else "Worker is still quiet after one automatic nudge.")
        row["reason"] = f"{reason} Check {k['address']} to decide how to recover."
        s.dirty = True
        return

    row.update(attempted_at=now(), attempt_turn=k["turn"])
    s.dirty = True
    # Save before sending. A crash after this point leaves an uncertain delivery, which is
    # safer to escalate than to send a second nudge.
    s.save()
    try:
        delivered = run(["hc", "send", k["address"], NUDGE]).returncode == 0
    except OSError:
        delivered = False
    if not delivered:
        row["failed"] = True
        s.dirty = True
