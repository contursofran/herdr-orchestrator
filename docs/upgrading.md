# Upgrading

## Move an existing upstream layout install

Close the Herdr window, pause agents that can write tasks or artifacts, and stop the `herdr-automations` terminal in
Herdr Core. Do the move on each machine from its own checkout. The backup and restore cover data roots under that
machine's home directory.

```bash
./install.sh --migrate-legacy --dry-run
./install.sh --migrate-legacy
herdr-orchestrator doctor
```

The move records a private backup before replacing the old service, mods and helper links. It copies tasks, settings,
artifacts, the vault and browser profiles into the new data directories. Existing git worktrees keep their absolute paths.
Customized layouts and keys move to the new layout name, and the installer keeps unrelated Claude Code and Codex hooks.
The installer removes the old service's tailnet route when it points to that service. Update bookmarks to the link shown
by `herdr-orchestrator web status`.

Keep the backup path printed by the installer. To go back, close Herdr and pause writers again, then run this from the
herdr-orchestrator checkout:

```bash
bin/herdr-orchestrator rollback-install --backup "/path/to/the/printed/backup"
```

Rollback restores the original installation and restarts its service if it was running. Changes made after the move
are saved in an `after-*` directory inside that backup. Its `manifest.json` maps the numbered copies to their original
paths. If the move was interrupted, run rollback with the printed backup path before retrying.

## Updating herdr-orchestrator

```bash
git pull --ff-only
herdr-orchestrator update
herdr-orchestrator doctor
```

A web-only install (`./install.sh --web`) updates the same way: `herdr-orchestrator update` reads what was installed and
updates web only. `herdr-orchestrator doctor` says how this install updates. The web app is rebuilt when it's out of date.

Only files herdr-orchestrator put there and you haven't changed are replaced; yours stay, with the new copy beside them as
`.new`. A mod file you changed that herdr-orchestrator changed too is the exception: your copy could stop the new mod from
loading, so herdr-orchestrator's goes in and yours goes to the backup folder (the update says where). Each mod is swapped in one step, so Herdr reloads it once. Agents keep running in herdr-core. Until
`herdr-orchestrator doctor` passes, the sync to other machines waits (`a sync hold (`sync-hold` in `~/.local/state/herdr-orchestrator`)`).

The update renames the settings and sidebar chrome mods. It backs up a customized installed layout before updating its
mod references and keeps the saved layout sizes and props. When the web app opens on the same origin, it carries over
local preferences and pending sends to its new browser storage keys.

## Where herdr-orchestrator moves data from `~/.herdr`

`herdr-orchestrator` uses its own data folders ([Install](install.md), Where your data lives). Its installer migrates
data from the legacy paths under `~/.herdr` once per machine. Use `herdr-orchestrator doctor` or `herdr-orchestrator where`
to see the paths in use. For an installed upstream layout, follow the move instructions above.

- **What moves:** tasks, artifacts, settings, the secrets vault and its mark, task browsers (their sign-ins with them),
  the web service's files, the tools stamp, cli-check and machine-hold. On the same disk each is one rename, so nothing
  is copied. On another disk (`XDG_*` or `HERDR_ORCH_HOME` there), a file (settings, the vault) is copied, checked and
  swapped, the old copy kept as `<old>.pre-layout2`; a folder (tasks, artifacts, browsers) stays where it is and the
  new path links to it. A folder you linked elsewhere yourself (artifacts on a bigger disk) stays there.
- **What doesn't:** task worktrees. Git keeps their absolute paths, and agents, editors and logs know them by it, so a
  running task keeps its worktree in `~/.herdr/worktrees` until it's done; new tasks get theirs in the new folder.
  `~/.herdr` itself and Herdr's own worktree dialog's checkouts there stay too.
- **Old paths keep working:** each moved one is a link to its new place (`~/.herdr/tasks` →
  `~/.local/share/herdr-orchestrator/tasks`). Paths in briefs and artifacts can still use those links. If a helper
  replaces a link with a file, the next herdr-task run moves the file into place and restores the link.
- **Several machines:** each one moves its own data when it updates; until then the others read and write it in its
  old place, and an updated machine's commands find each machine's data wherever it is. The sync hold
  (`herdr-orchestrator doctor`) still keeps new helpers from spreading before this machine's install is whole.
- **Safe to stop:** the move takes a lock, and `LAYOUT` (in `~/.local/share/herdr-orchestrator`) is written last. A crash or a
  power cut halfway leaves every old path working, and the next run finishes it. Running it again changes nothing.
  It doesn't move by itself on a network disk (NFS, SMB): `herdr-orchestrator migrate --force` does, when no other machine
  uses that home.
- **Rolling back:** `herdr-orchestrator migrate --rollback` restores the legacy paths in `~/.herdr`. A later
  `herdr-orchestrator migrate` moves the data into the separate folders again.
- **When the links go:** once every machine uses the current layout (`herdr-task machines` lists them),
  `herdr-orchestrator migrate --cleanup-legacy --yes` removes the links and any `.pre-layout2` copies.

## From the older web app or terminal plugin

The upstream 2.x releases have separate task lists. Keep their original checkouts for access to that data and follow
[Install](install.md) to set up herdr-orchestrator.

## Moving a machine that already runs these mods by hand

A machine whose `~/.config/herdr-app` already holds these mods (they were built there before 3.0) is moved over
like this, with nothing lost:

1. Dry run: `./install.sh --root <scratch>` into a scratch folder that holds a fresh Herdr home, then compare it
   with your Herdr folder file by file ([Develop](develop.md), parity check). Every difference must be intended.
2. Make sure the helper and template hashes match the repo's, so the sync pushes nothing by surprise.
3. Back up `~/.config/herdr-app` (whole), `~/.config/herdr-core`, `~/.herdr`, the `herdr*` items in `~/.local/bin`,
   `~/.claude/settings.json`, `~/.codex/config.toml` and `~/.codex/hooks.json`.
4. Close the window (agents keep running in herdr-core), move `~/.config/herdr-app` aside as
   `~/.config/herdr-app.pre-3.0`, start Herdr once so it writes a fresh home, close it.
5. `./install.sh --guard`, then bring back your state from `.pre-3.0`: `data/`, `shared.json`, `view.json`,
   `seen.json`, `window.json`, `settings.json`, `keys.json`, `secrets/`. Set `"layout": "herdr-orchestrator"` in `shared.json`
   (the layout was `main-tasks` before 3.0) and rename `layout:main-tasks` to `layout:herdr-orchestrator` in `keys.json`.
6. Open the window, `herdr-orchestrator doctor`, and check: no errors in `herdr-app status`, the same tasks, chats and artifacts.

Going back: close the window, move `~/.config/herdr-app` aside and `~/.config/herdr-app.pre-3.0` back, and restore
the links, templates and CLI settings from the backup.
