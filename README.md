# fleet

Every open Claude Code session and its subagents, live: what each is doing, how far along it is, context, cost, limits and prompt-cache time, with a pixel-art colony of the workers.

A [Claude Code](https://claude.com/claude-code) mod (a hooks-module plugin). It runs in the terminal and in the desktop app's Code tab.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install fleet --marketplace michaelt604/fleet
```

Answer `y` to add the marketplace, then press Enter to take the user scope. Fleet is active at once, and loads in every session you start after that, desktop sessions included.

From a shell:

```bash
claude plugin install fleet --marketplace michaelt604/fleet
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `michaelt604/fleet`, then **Add plugin**.

**Update:** `claude plugin marketplace update fleet && claude plugin update fleet@fleet`. Open sessions keep the version they loaded until `/reload-plugins` or a restart.

**Uninstall:** `claude plugin uninstall fleet@fleet`. Its heartbeats stay in `~/.claude/fleet/`; delete that folder to remove them.

Fleet sees a session only once that session has fleet loaded, so sessions that were already open before the install show up after their `/reload-plugins` or a restart.

## Usage


- **`/fleet`:** opens the dashboard in the app's side panel. Where the surface has no side panel, it draws the dashboard inline in the conversation instead. The panel also opens by itself at the first subagent of a session, unless you closed it.
- **`/fleet colony`:** hide or show the colony (shown by default; the panel's "Hide colony" button does the same).
- **`/fleet band`:** a strip of busy sessions above the prompt, for this session.
- **`/fleet ended`:** also list ended and closed sessions, and those idle over 12 hours (all hidden by default).
- **`/fleet still`** / **`/fleet animate`:** stop or restart all motion.
- **`/fleet alerts`:** turn the toasts on or off (on by default). When another session starts needing you, and the panel is open, a toast gives its name and what it waits on ("Aria: Needs your OK: run npm test").
- Each option replies with what it changed and how to undo it. An option it doesn't know gets a reply listing the ones it does.
- Status line: `⚑ needs you: A, B · 2 working · 5 agents` whenever another session is about. Zero counts are left out; with nothing else to say, it shows how many sessions are idle. The flag and the names show only when someone needs you, and lead; names are cut at 16 characters. A session resting between turns while its subagents work counts as working. A run with no surface, title or cost (`claude -p`, the SDK) is hidden once it ends; a desktop session restored at app start has a title or cost and stays. Rows show text plainly (links as their words, no markup).

A session that needs you shows how long it has waited once that is a minute (`needs you 6m`, and `⚑ needs you: Aria 6m, Bram` in the status line), and the longest-waiting leads.

Sessions that need you are listed first. The rest go by their latest prompt, newest first, and don't move when a session starts or stops. A background task's notification doesn't count as a prompt.

Sessions idle for more than 12 hours, with no subagent still at work, are left out too: the desktop app keeps every session you haven't archived loaded, so they never end by themselves. A dim line under the list counts them ("3 sessions idle over 12h hidden · /fleet ended shows them"). The session you're in always shows in its own panel.

Sessions you have archived in the desktop app are left out, even with `/fleet ended`. They are read from the app's own session records (`claude-code-sessions` in its data folder), checked about once a minute; unarchive one and it returns.

**Open button (unverified):** under the list, each other desktop session that needs you gets a button (`Aria needs you 6m · Open`, pressed with the number key 1 to 9 for its place) that opens the app's link for it (`claude://claude.ai/epitaxy/<id>`, the id from `CLAUDE_CODE_HOST_SESSION_ID`, kept only by desktop sessions). I haven't confirmed in the real app that the link brings that session forward. Terminal sessions have no id, so no button.

## Each row

- **Line 1:** the session's name, and how it stands (working, needs you, idle) with its progress. In a narrow panel the progress leaves this line (the bar along the foot shows it) and "this session" becomes "here", so the name keeps its room.
- **Line 2:** its main agent, by name, and what it is doing now: "Hugo: Editing svg.ts". A tool call running past 30 seconds shows its time in amber.
- **Line 3:** what you asked, or once it rests, the last turn's receipt: time, edits, agents, errors, cost.
- **Line 4 (narrow panel):** context used, with a tick wherever the conversation was compacted, then model, permission mode and cost.
- **Under the worker:** the prompt-cache time left. It's an hour after the last reply on a plan, and five minutes on an API key or past a plan limit. "cold" means the next prompt re-sends the whole context.
- **The thin line along the foot:** the main agent's progress. It comes from the task list when there is one; otherwise it's a guess from this turn's tool calls, shown with "~".
- **Subagents:** each has its own name (the one it was spawned with, else one picked for it), its role, what it's doing, and a progress bar. Its own step reports make the bar exact; otherwise it's a "~" guess that never shows done until the agent finishes. Flags: "slow 45s" (a tool running long), "quiet 3m" (no activity for 2 minutes), "hit max tokens".
- **Background loops:** model loops no agent list names, such as a workflow's agents or forks, folded into one line.

## Workers and the colony

Each session's main agent is its captain, with a name of its own (Aria, Bram, Cass…), never one a subagent can get. It leads its row in the list ("Hugo: Editing svg.ts") and wears the crown in the colony.

Workers wear a hat for their role, in their role's colour:

| Hat | Role |
|---|---|
| crown | each session's main agent |
| propeller beanie | haiku-quick |
| cap | haiku-worker |
| ranger hat | Explore |
| hard hat | sonnet-worker |
| mortarboard | Plan |
| wizard hat | opus-deep |
| top hat | opus-worker |
| beanie | general-purpose |

Other agent types get a steady hat and colour of their own.

In the colony, a pixel-art village under the header, each building is a general task. A small hanging sign shows it as a picture, with no words. The line over the map says it in words, once, counting everyone and leading with anyone who needs you, in amber: "1 needs you · 2 developing · 1 researching · 3 chilling".

| Building | Sign | Task |
|---|---|---|
| workshop | hammer | Develop: writing and changing code |
| library | book | Research: investigating, reading up, exploring the codebase |
| watchtower | lens | Review: code review, critique, audits |
| forge | flask | Test: running tests, builds, lints, deploys |
| town hall | scroll | Plan: plans and designs, delegating, and waiting on you (with a "!") |
| mine | bug | Debug: digging into bugs and failures |

- **Subagents** take their task from what they were asked and their role ("Review the demo" goes to the watchtower; Explore agents always research, Plan agents always plan). They keep it, except that running tests sends them to the forge.
- **Main agents** start from your prompt, then follow what they're doing: editing takes them to the workshop, web research to the library, commands to the forge. Between tool calls they stay where they are.
- **Changes hold before anyone moves:** a new task must hold for 10 seconds, getting back to work takes 3, and going off to play waits for 15 seconds of rest. A quick command or a short turn doesn't send anyone off and back. Waiting on you goes to the hall at once.
- **Background subagents** keep working while their session rests between turns, and count in the status line and the band. One silent for 20 minutes (an hour with a tool running) is taken as lost: its end never arrived, so it is dropped.
- **"Needs you"** shows when a permission dialog does, a subagent's too ("Needs your OK (Hugo): …"), and when the session asks you a question or offers a plan to approve. While any subagent's dialog is open the session shows as needing you, whatever else it does; it goes back when the dialog's call ends. In auto mode, calls the classifier settles never show it.
- **Idle workers** each have a pastime of their own. Round the fire they sip from a mug, stroll a little loop, juggle, dance, strum a lute, read a book, fly a kite or feed the birds. Some go further: to fish at the pond, water the garden, or pet the village cat. Each of those has room for two; anyone who finds it full stays by the fire and does something else there. Finished subagents sleep by the tents.
- **Motion** is slow and smooth. Walks follow the dirt roads through the plaza at an unhurried pace, setting off and arriving gently, with a small step on the way. A worker called away mid-walk or mid-stroll sets off from exactly where it is. Work is a gentle bob, and a hammer is raised slowly and brought down quickly.

Each worker holds its task's tool (a hammer, a pickaxe, a book, a lens, a scroll or a flask). Captains wear a gold crown, each in a colour of its own. Most workers also wear a little something of their own, always the same one: shades, round specs, a scarf, a bow tie, rosy cheeks, a mustache, a backpack or a pin. Workers at work have a progress bar over their head and their name right under their feet, in small light letters with no box (over a bare head when a sign is in the way). A name is never put further off, where it would read as a neighbour's: in a crowd with no room, it is left out, those who need you named first. A walker's name shows once it arrives. Workers at play or asleep go unnamed; the line over the map counts them, and the list above names everyone.

**Why the colony doesn't jump:** the desktop rebuilds the panel's picture on every redraw, which restarts every animation in it. So on the desktop the colony is a `Client` region (`hooks/colony-view-19.tsx`; its file name and key carry the release, because the page keeps a module it has loaded even across a plugin reload) that the page keeps across those redraws. It gets plain scene data (`hooks/colony-scene.ts`) and draws again only when a worker's state changes, timed by the page's own clock. Other surfaces draw it as an ordinary Svg with the panel.

**The colony comes first.** In the side panel the colony sits right under the header, so it is in view when the panel opens however many sessions there are; the list follows it and scrolls with the panel's own scrollbar.

On a wide panel, the village stays the same size and forest fills either side. A drawing in a page region is held to 100,000 characters, so at most 40 workers are drawn, and an unusually varied crowd leaves out the least busy first; the line over the map still counts everyone. `/fleet still` stops all motion, and so does the system's reduced-motion setting.

Each session writes `~/.claude/fleet/<session id>.json`; the views read those. After `/clear` the session carries on under a new id with a fresh record (a panel you closed stays closed). A session resumed or restarted under the same id picks up its task, last reply and receipt from its heartbeat.

The header's plan-limit rings combine every session's readings: a window that has already reset is ignored, and of the rest the latest window and highest reading win, so the rings don't jump between sessions. Each ring has two small notches, at 60% (where it turns amber) and 85% (red). Under each ring is the time left to its reset ("5h · 1h12m", or "7d · 6d 21h"); with many limits on a narrow panel the times drop out. Once the readings span 10 minutes or more, the 5-hour ring also forecasts: when the pace of the last half hour would fill the limit before it resets, the line under it reads "5h · full ~40m" in red instead of the reset time (the terminal header and the status line say it too, the status line only under an hour). It is worked out from the app's own recent readings, which are lost on a reload, and nothing is shown for a flat or falling pace. With a plan limit (5h or 7d) the cost reads "API value", not "spent": it's what the same use would cost on the API. Heartbeats older than 7 days are removed when a session starts.

## Notes

- **Agent types:** the hats and pacing know the built-in agents (Explore, Plan, general-purpose) and a few custom ones (`haiku-quick`, `haiku-worker`, `sonnet-worker`, `opus-worker`, `opus-deep`). Any other agent type still gets a steady hat and colour of its own.
- **Exact subagent progress:** a subagent's bar is exact when it reports steps through a `step` tool from an MCP server named `savvy-progress` (`mcp__savvy-progress__step`, with `done` and `total`). Without one, bars are "~" guesses.
- **Files it writes:** one heartbeat per session in `~/.claude/fleet/`. It reads the desktop app's own session records only to hide archived sessions.

## Develop

```bash
git clone https://github.com/michaelt604/fleet.git
claude --plugin-dir ./fleet
```

`--plugin-dir` loads the mod from your working copy for that session (uninstall the marketplace copy first, or both run).

- **Validate:** `claude plugin validate .` checks the manifest, the marketplace file and the hooks module the way the engine reads them.
- **Tests:** `claude plugin test .` runs `tests/*.test.ts(x)` against a fake engine.
- **Type-check:** once the engine has loaded the mod it writes `.claude-plugin/types/` (ignored by git); then `tsc -p .`.
- **Layout:** `hooks/register.tsx` is the hooks module (events, heartbeats, commands); `describe.ts` turns tool calls into words; `draw.tsx` and `svg.ts` draw the panel, band and status line; `colony.ts` and `colony-scene.ts` draw the village; `types/index.d.ts` is the `$.state` contract.
- **Releasing:** bump `version` in `.claude-plugin/plugin.json`. When colony drawing changes, also rename `hooks/colony-view-NN.tsx` and its `key` in `draw.tsx` to the new release number (the desktop page keeps a loaded module across reloads), and update the matching import and `colony-NN` finds in `tests/fleet.test.tsx`.

## License

[MIT](LICENSE)
