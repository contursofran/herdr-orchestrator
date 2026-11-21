# herdr-orchestrator

A layout and a set of tools for the [Herdr app](https://herdr.dev) that coordinate coding agents. Each project has an orchestrating agent. You tell it what needs doing, and it turns that into tasks. Each task runs as its own agent in its own git worktree, and asks you on a card when it needs a decision.

herdr-orchestrator starts from [Shepherdr](https://github.com/eliasstravik/shepherdr) 3.1.44 and becomes its own tool. It does not follow Shepherdr's updates.

> **Status: early work (0.1.1).** The CLI (`herdr-orchestrator`), layout (`layouts/herdr-orchestrator.json`) and visible names are now `herdr-orchestrator`. The data folders, service and mods now use the new names too.

## What it keeps from the original

- **Settings:** one settings window for tasks, merge, review, agents and machines.
- **Task view:** a task opens beside the chat with its chat, terminal, pull request, browser and artifacts.
- **Chat:** cards for questions and permissions, code with Copy, images, artifacts, dictation.
- **Tasks:** a queue, tasks for later or after other tasks, worktrees on `work/<n>-<slug>` branches, review by a separate agent before a task is ready, merge pinned to the checked head commit.
- **Machines:** every machine you added to herdr-core, from one window.

## What it adds

- **The herdr-contr sidebar:** under each project, its orchestrating agent, and under that agent the agents that work on its tasks, each with its state.
- **Agent rows you can use:** open, stop, open in a new tab, and Ctrl+1 to Ctrl+9 for the main agents.
- **Plan usage** for Claude and Codex in the sidebar foot.
- **An orchestration style:** to be decided. See [#10](https://github.com/contursofran/herdr-orchestrator/issues/10).

## Plan

The work is in the epic [#11](https://github.com/contursofran/herdr-orchestrator/issues/11):

1. Rename the product, service and mods to herdr-orchestrator (#1, #2, #3), and point updates and feedback to this repo (#4).
2. Move from an installed upstream layout (#5).
3. Port the herdr-contr sidebar (#6, #7, #8, #9).
4. Decide and build the orchestration style (#10).

## Install (for now)

If the upstream layout is installed, follow the [move instructions](docs/upgrading.md#move-an-existing-upstream-layout-install) to back it up and switch over.

```bash
git clone https://github.com/contursofran/herdr-orchestrator
cd herdr-orchestrator
./install.sh --dry-run   # see what it does
./install.sh
herdr-orchestrator doctor
```

In Herdr, `Ctrl+Shift+L` picks the layout. You need macOS or Linux, the Herdr app 0.1.12 or newer with herdr-core 0.1.17 or newer, Python 3.8+, Git, and Claude Code or Codex. [docs/install.md](docs/install.md) has the details.

## Safety

The review, merge and rules of a task are lines in its brief, and its agent follows them. They are not a sandbox: every agent has a shell and can do what you can. Keep Merge on "ask me first" when you want to approve each merge.

## Credits and license

Based on [Shepherdr](https://github.com/eliasstravik/shepherdr) by Elias Stravik, MIT licensed: see [LICENSE](LICENSE) and [NOTICE](NOTICE). Parts come from mods of the Herdr app, under the Apache License 2.0: see [LICENSE-herdr](LICENSE-herdr).
