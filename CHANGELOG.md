# Changelog

## 0.1.3

- Publish images, videos, and self-contained HTML files directly as artifacts. Each artifact has version history and can be attached as proof on a task’s Accept card.
- Quiet-worker escalations appear in the Inbox and Automations. Herdr skips nudges during known waits.
- Task file boundaries are checked at merge, including both sides of renamed files.
- Legacy migration preserves linked storage, private vault recovery backups, shared Herdr Core documents, and repository IDs. Preserved worktrees appear in cleanup. Rollback stops the new service and scheduler before taking task locks.

## 0.1.2

- Open **Changelog** from the sidebar’s **Settings** menu to see your installed version and what changed in each release. Release notes are available offline.

## 0.1.1

First published release of herdr-orchestrator.

- The Projects sidebar shows the Orchestrator and its workers with Claude or Codex icons. `Ctrl+1` through `Ctrl+9` focus the main agents.
- The sidebar footer shows weekly quota remaining when available. Hover over a provider to see its other windows and reset times.
- Sidebar Settings checks for updates and can install a verified GitHub release in one click.
- Independent review verdicts apply to the reviewed commit. Herdr cleans up reviewer sessions and checks task file boundaries before merge.
- Herdr nudges a quiet worker once and escalates if the worker stays quiet.
- The Python suite runs on Linux and macOS in GitHub Actions.

## 0.1.0

Started from Shepherdr 3.1.44 and began the rename to `herdr-orchestrator`:

- Renamed the CLI (`bin/herdr-orchestrator`) and window layout (`layouts/herdr-orchestrator.json`, `keys.json` `layout:herdr-orchestrator`).
- Updated visible product strings across the CLI, installer, service, web app, window mods, helpers, and agent templates to `herdr-orchestrator`.
- Updated `README.md`, `RECIPE.md`, `AGENTS.md`, `NOTICE`, and `docs/`, and restarted the version at `0.1.0`.
- Removed the old Shepherdr launch and installer button assets.
