"""One recovery message per unexplained quiet worker episode."""

import os
import re

from .agents import agent_log, agent_running, last_reply, own_status_text, question_in, status_word, task_status, turn_input, WAITS_ON
from .base import git, hc_json, now, run


NUDGE_AFTER_MS = 2 * 60_000
ESCALATE_AFTER_MS = 5 * 60_000
NUDGE_HEADER = "Herdr noticed this task went quiet."
NUDGE = (f"{NUDGE_HEADER} Check your task and continue the work if you can. "
         "If you're finished, submit it with herdr-task ready. If you need a decision, ask for it in your chat.")
WAITS_FOR_REPLY = re.compile(r"\b(?:wait(?:ing|s)? (?:for|on)|await(?:ing|s)?|needs?) (?:you\b|your\b|the person\b|human\b|"
                             r"(?:an? )?(?:answer|reply|decision|approval|confirmation)\b)", re.I)
WAITING = re.compile(r"\b(?:a?wait(?:ing|s)?|watching|polling)\b", re.I)


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
    review = task.get("review_request") or {}
    if (status_word(k) not in ("idle", "done") or task.get("attention") or task.get("retry")
            or task.get("review_out") or task.get("merge_requested") or task.get("merge_queued")
            or pr.get("wait") or pr.get("needs_approval")
            or review.get("status") in ("queued", "reviewing", "approved", "escalated")
            or (review.get("status") == "changes-requested" and not review.get("builder_notified"))):
        return False
    # Reuse the task's wait classification for background work, questions, and permissions.
    if task_status(task, live, recovery=False)[:2] != ("needs", "reply"):
        return False
    reply = last_reply(task, k["address"], size=262144)
    if question_in(reply):
        return False
    reply = re.sub(r"```.*?(```|$)", "", reply, flags=re.S)
    for text in (own_status_text(task, k["address"]), reply):
        line = " ".join((text or "").split())
        if WAITS_FOR_REPLY.search(line) or (WAITING.search(line) and WAITS_ON.search(line)):
            return False
    return True


def progress(s, task, previous):
    p = task.get("progress") or {}
    folder = task.get("worktree") or (s.loc["folder"] if task.get("mode") == "here" and s.loc["kind"] == "repo" else None)
    head = previous[-1] if previous else None
    if folder:
        ok, current, _ = git(folder, "rev-parse", "--verify", "HEAD")
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
    if row.get("failed") or not row.get("attempted_at") or k["turn"] != row.get("attempt_turn", -2) + 1:
        return False
    began, text = turn_input(task, k["address"])
    if began is None and not text and row.get("log_offset") is not None:
        began, text = turn_input(task, k["address"], after=row["log_offset"])
    # If the core saw a turn but there's still no input record, don't repeat a send we already attempted.
    return (began is None and not text) or (began is not None and began < row["attempted_at"]) or NUDGE_HEADER in text


def pause(s, row):
    if row.pop("since", None) is not None:
        s.dirty = True


def escalate(s, row):
    reason = ("Herdr couldn't deliver its automatic nudge and the worker is still quiet."
              if row.get("failed") else "Worker is still quiet after one automatic nudge.")
    row["reason"] = f"{reason} Check {row['address']} to decide how to recover."
    s.dirty = True


def advance(s, task, live, held=()):
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
        pause(s, row)
        return
    from .news import has_held, typing
    address = k["address"]
    if address in held or has_held(address) or typing(address, k):
        pause(s, row)
        return

    previous = row.get("progress")
    made, at = progress(s, task, previous), now()
    # Older records may have no Git baseline yet. Record it without counting the first read as a commit.
    if previous and previous[-1] is None and made[-1] is not None:
        previous[-1] = made[-1]
        s.dirty = True
    if not continues_episode(task, row, k, made):
        row = {"address": k["address"], "pid": k["foreground"]["pid"], "progress": made}
        task["quiet_recovery"] = row
    if not row.get("since") or row.get("turn") != k["turn"]:
        row.setdefault("since", at)
        row["turn"] = k["turn"]
        s.dirty = True

    attempted = row.get("attempted_at") or 0
    delay = ESCALATE_AFTER_MS if attempted else NUDGE_AFTER_MS
    if row.get("reason") or (not row.get("failed") and at - max(row["since"], attempted) < delay):
        return

    # Re-read the terminal just before acting. A turn change, stopped worker, a changed label
    # or the person's draft invalidates the earlier observation.
    current = hc_json("get", address)
    current_live = [current if other is k else other for other in live] if current else []
    fresh = worker(s, task, current_live)
    if (not fresh or fresh["address"] != k["address"] or fresh["foreground"]["pid"] != row["pid"]
            or fresh["turn"] != row["turn"] or not unexplained(task, fresh, current_live)):
        return
    if has_held(address) or typing(address, fresh):
        pause(s, row)
        return
    if attempted:
        escalate(s, row)
        return

    if log := agent_log(task, address):
        try:
            row["log_offset"] = os.path.getsize(log)
        except FileNotFoundError:
            row["log_offset"] = 0
        except OSError:
            pass
    row.update(attempted_at=now(), attempt_turn=k["turn"])
    s.dirty = True
    # Save before sending. A crash after this point leaves an uncertain delivery, which is
    # safer to escalate than to send a second nudge.
    s.save()
    try:
        delivered = run(["hc", "send", address, NUDGE]).returncode == 0
    except OSError:
        delivered = False
    if not delivered:
        row["failed"] = True
        escalate(s, row)
