# Settings: Everywhere and a space's own

Every setting has a value for **Everywhere**, the default. A setting that makes sense per space can also be set for
one **space**: the space's own wins there, and a setting the space doesn't set is inherited from Everywhere. Reset
drops the space's own, and it inherits again. A few settings are one for every space, or one per machine.

## Where you set them

- **Settings, the level switch.** At the top of each page a space can set its own of (Agents, Tasks, Autopilot,
  Notify, Secrets): *Applies to: Everywhere ⌄*. The picker lists Everywhere, then every space by machine (a Find box
  once there are many). Pages that are one for every space (Machines, Window, Web) say so instead.
- **A space's menu › Space settings…** opens Settings on that space, in the window and on the web.
- **Under each row, in a space:** *Inherited from Everywhere*, or *Set for this space · Reset*. On Everywhere, a row
  that some spaces set their own of says *2 spaces set their own*, which lists them (each opens that space's).
- **The header's Autopilot switch** turns Autopilot on or off in its space; *Write a heartbeat* opens that space's
  Autopilot page.

## The audit

| Page | Setting | Level | Why |
|---|---|---|---|
| Agents | Assistant (CLI, model, effort, fast, permissions) | Everywhere, space | A repo may want a stronger model or another CLI |
| Agents | Workers | Everywhere, space | The same: what a task in this space runs on |
| Agents | Reviewer | Everywhere, space | The same |
| Agents | Backup agent | Everywhere, space | A space whose work shouldn't move to the other CLI |
| Agents | Reactions (every agent reacts with an emoji; on) | Everywhere, space | A space may want a plainer chat |
| Agents | Instructions (assistant.md, worker.md, reviewer.md) | Everywhere only | Repo rules belong in the repo's AGENTS.md or CLAUDE.md, which every agent there reads |
| Tasks | Merge, Review, Must fix, Proof | Everywhere, space | How much care a repo needs differs |
| Tasks | Tasks at once | Everywhere, space | It counts per folder already |
| Tasks | Archive Done after | Everywhere, space | Some repos keep done work in view longer |
| Tasks | Worktrees | Everywhere, space | A folder that isn't a repo, or one that can't take worktrees |
| Tasks | Base branch | Space only | A branch only means something in one repo |
| Tasks | Branch names (a pattern: `{n}`, `{key}`, `{slug}`; empty: `task/{n}-{slug}`; a task's own `--branch` wins) | Everywhere, space | A team may name branches after its tickets |
| Tasks | Run automations | Everywhere, space | Pause one repo's automations |
| Tasks | When a task starts / finishes | Everywhere, space | Setup and cleanup steps are a repo's |
| Autopilot | Heartbeat, Schedule, Events | Everywhere, space | Each space works toward its own goal, at its own pace |
| Autopilot | On or off | Space only | The header's switch: Everywhere never turns a space on |
| Notify | All / Needs me / Off | Everywhere, space | A busy space can be quiet |
| Secrets | A secret | Everywhere, machine, space | A key for one repo, or one machine's own |
| Secrets | Kept on | All machines | One vault every machine's agents and voice calls use; follows Serve from unless picked |
| Machines | When new tasks wait (memory, CPU, disk), low priority, memory cap per worker | All machines, machine | About a machine's hardware, not a space's work |
| Machines | Home Assistant | Machine only | One per machine |
| Window | Tabs, sidebar, counts, filters, subagents, Assistant in new spaces | Everywhere only | How the screen looks; the last is about spaces not made yet |
| Window | Add-ons | Everywhere only | Which mods run: the window's, for every space |
| Web | Serve from, link | Everywhere only | One web app for every machine |

**No Machine level for the rest.** A space already lives on one machine, so a space's own covers "this machine's
repos" without a third layer, and one less layer keeps "where does this value come from" one line long. What a machine
genuinely differs in (its hardware, its home space, a key only it has) is already on Machines and Secrets. Agent and
task values a machine set before (the old machine scope) still apply there until Reset, and say so on Machines.

## Where they're kept, and how they travel

- `~/.config/herdr-orchestrator/settings.json`: `everywhere` and `spaces[<space id>]` (another machine's space as `<machine>/<id>`), each
  with `coordinator`, `worker`, `reviewer`, `backup`, `tasks`, `automations`, `agents` (`{ reactions }`) and
  `autopilot` (`{ every, events, heartbeat }`). The window pushes each machine its share (Everywhere's and its spaces' by their
  ids there), and when the web app is served from another machine its service keeps the file in step with that host
  (`service/sync.ts`). So a space on any machine, and the web on the Mac mini, see the same values. The legacy
  path for herdr-orchestrator is `~/.herdr/herdr-orchestrator.json`; pushes and syncs resolve it on each machine.
- `tasks.worktree_root` (in `everywhere`, a machine's or a space's `tasks`; no row in the window yet): the folder new
  task worktrees go in, e.g. a bigger disk (`~` allowed). Unset: `~/.local/share/herdr-orchestrator/worktrees`. A task keeps
  the worktree it has.
- Secrets live in one vault, `~/.local/share/herdr-orchestrator/secrets/vault.json` on the machine that keeps them (Secrets › Kept on). Which one:
  herdr-core document `herdr-orchestrator.secrets` = `{ id, at, by }` on every machine, handed on by each service as
  `herdr-orchestrator.host` is (`core/secrets.js`). `herdr-secret` on any other machine passes `set`, `rm` and `names` there
  over herdr-core (the value on stdin, scopes renamed into that machine's words); that machine's service answers every
  agent's request even with no window open, and voice calls read the ElevenLabs key from there into memory only.
  `herdr-orchestrator secrets move-to <machine>` moves the vault (a backup on both sides; `move-to here --restore` on the old
  one rolls back when the other is gone). By default the secrets follow Serve from (Kept on says "Same as Serve from:
  <machine>"): with no machine picked, each service names where the secrets are now (the machine whose vault has
  some, else the one serving the web app: `autoKeeper`, a record with `auto: true`) and hands it on, so voice calls
  and agents work with no setup; then the machine serving the web app moves them to itself with `move-to` (backup,
  verified copy, rollback), and does so again when Serve from moves. Picking another machine in Kept on stops the
  following; picking the Serve from machine starts it again. Voice calls with no record yet ask each linked machine
  for the key. No record and nothing to decide yet: the machine without `~/.local/share/herdr-orchestrator/secrets/remote` keeps them.
- Notify is in the shared document (`notify`), kept in step the same way.
- herdr-task reads the effective value: `settings_for()` for agents and tasks (the Settings block every brief ends
  with names who set each line), `autopilot.resolve()` for Autopilot (`herdr-task autopilot show` lists which parts are
  the space's own). Autopilot's schedule and events from before Settings kept them (`~/.local/share/herdr-orchestrator/tasks/.autopilot.json`
  `everywhere`) and its heartbeat file (`~/.config/herdr-core/autopilot/everywhere.md`) are what Everywhere inherits
  until it's set.

## Task file boundaries and resource locks

Add an unindented line such as `Boundary: src/login/** tests/login.test.ts` outside code blocks and lists in a
worktree task's brief. Herdr checks the proposed changes at merge time, including both paths of a rename. Use
whitespace-separated allowed paths or globs, and quote names that contain spaces. `*` matches within one path
segment. `**` matches across directories, and `src/**` covers paths inside `src`. Exclusion patterns such as
`!path` block the merge. `herdr-task add --require-boundary` also blocks merging if the line is missing. The
Orchestrator can use `herdr-task edit --prompt-file` to update the brief when the agreed scope changes.

Use `herdr-task add --lock test-device` for a resource shared on the same machine. Repeat `--lock` to request
more than one. A running or ready task holds its resources until it is done or removed. Tasks with overlapping
boundaries can run in separate worktrees. Use `--after` when one task needs another to finish first.

## Quiet workers

When Herdr observes an idle task worker with no known reason to wait, it gives the worker two minutes to resume
before sending one nudge. It starts the quiet interval again after a draft or queued message has cleared. A worker
that says it is waiting for approval, CI, or review keeps waiting without a nudge. If the worker stays quiet for
five more minutes, or Herdr cannot deliver the nudge, the task appears in Needs you and triggers the `needs-you`
and `failed` events. Herdr also tells the space's Orchestrator which task and terminal need attention. A new request,
a changed work report, or a new commit can start another recovery episode. The attempt survives scheduler restarts.

## Reactions

Agents › Reactions, on by default: every agent reacts to some of your messages with one emoji, as a person would:
Assistants, task workers, automation runs and plain agent tabs, on every machine. It picks the most specific,
delightful or funny one that fits, not a generic 👍 or 👀 by default (🚀 for a launch, 🔥 for a great result, 🐛 for a
bug report, 🧹 for a cleanup ask, 🫡 for a direct order, 🤌 for a nice detail, 🍿 for drama). Tasteful: most messages
get none, never more than one, and never instead of an answer you need. Off, none reacts. The reactions show on your messages in every chat, the
Assistant's, a task's and an agent tab's, in the window and on the web (`core/chat-log.js`).

- **Kept as** `agents.reactions` at each level. SHEP-42 kept it as the Assistant's, `assistant.reactions`: it still
  applies where a level has no `agents.reactions` (herdr-task, the window's chain), and the window and the web app
  move it there when they read the file (`upgradeReactions` in `core/settings.js`), so their next change writes it.
- **How it's told.** The chat's SessionStart hook (`mods/chat/session-note.sh`) asks `herdr-task _session-note` for
  every agent's extra words: an Assistant's settings block (below) ends with them, any other agent gets just them
  (`herdr_task/reactions.py`): the when-and-how paragraph (GUIDE) when on, "never react" when off, by its space (its
  terminal's space or task-space label, else the space whose folder holds its folder, else Everywhere's). It runs at
  every start, resume and compaction, for Claude Code and Codex, and labels the terminal `herdr.reactions=on|off`. The
  role instructions (`assistant.md`, `worker.md`, `reviewer.md`) don't carry it: they are your words to edit, and the
  hook is the one start path that knows the setting now.
- **Changed mid-session.** A `<herdr-setting name="reactions" value scope>` line: an Assistant's comes with its other
  changed settings (below); every other live agent its hook taught gets it alone from herdr-task's news pass
  (`reactions_pass`), once, ending "carry on with what you were doing; if nothing, reply only `<hc no-reply/>`", so a
  worker mid-task keeps working. One started before this isn't told until it starts again.
- **Reviewers** appear as subagents in the worker's chat. For newly started tasks with Review enabled, `herdr-task ready`
  starts a read-only reviewer for the submitted commit. The engine records the verdict from the registered reviewer,
  sends findings to the builder, and applies the task's merge setting after approval. A revised commit takes its own
  review. The Assistant handles scope conflicts and exhausted rounds.
- **A reaction only.** A reply of a `<hc react … />` line and `<hc no-reply/>` shows just the reaction on your
  message.

## What the Assistant is told

A space's Assistant knows the settings that shape how it makes and runs tasks, resolved for its space (Everywhere's,
then the space's own), without guessing (`herdr_task/assistant_settings.py`):

- **At every start, resume, compaction and handoff** the chat's SessionStart hook (`mods/chat/session-note.sh`) asks
  `herdr-task _session-note` for a "Your settings" block, like the Settings block a worker's brief ends with: Review
  (rounds, must fix, reviewer), Merge, Proof, Task agent, Base branch, Worktrees, Tasks at once, Task notes (start and
  finish notes set or not), Autopilot (on or off, schedule, direction) and Reactions, one line each. A line that differs
  from Herdr's default says who set it (*set for this space*, *your setting everywhere*). The terminal is labelled
  `herdr.settings` with a short hash of each line.
- **Changed while it runs** (in the window or on the web, Everywhere or the space): herdr-task's news pass (on a
  settings change, and every minute for Autopilot's switch) sends each live Assistant whose lines differ one message,
  a line per changed setting: `<herdr-setting name="review" value="on" scope="everywhere|space">Review is now on, …
  Tasks you add from now on get it; running ones keep their brief.</herdr-setting>`, the last ending "reply only
  `<hc no-reply/>`". A save that changes nothing for its space says nothing. One started before this (no label) gets the
  whole block once it has had a turn. Busy with the person: next pass.
- **The chat hides them**, as every Herdr tag (`core/chat-log.js`), and the `<hc no-reply/>` after: a settings change
  already shows where it was made, so a news row would only repeat it.
- **Other agents get only Reactions** (above): a worker's brief's Settings block is fixed when it starts.

