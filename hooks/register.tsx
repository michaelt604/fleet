import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetAgent, FleetLimit, FleetSession, FleetView } from '../types'
import { waitText, EDIT_TOOLS, NOT_TYPED, isHostId, isPlanLimit, archiveOf, withFleetLimits, ZERO, currentLimits, forecastFull, fullIn, sameWindow, isFullShown as shownFull, plural, isAgentLive, isBusy, pickName, addUsage, arrange, attentionKey, describeTool, firstLine, kindOfTool, nameOf, parseSession, progressOf, summarize, tasksAfter, totalTokens, windowOf } from './describe'
import { colonyDueAt, noteColonyForced } from './colony-scene'
import { band, dashboard } from './draw'
import type { Actions, Board } from './draw'
import type { LimitSample } from './describe'

const PANE = 'fleet'
const me = atom({ plugin: 'fleet', key: 'me' } as const, null)
const sessions = atom({ plugin: 'fleet', key: 'sessions' } as const, [])
const frame = atom({ plugin: 'fleet', key: 'frame' } as const, 0)
// The side panel is the fleet's home; the band above the prompt is opt-in (/fleet band).
const DEFAULT_VIEW: FleetView = { isCompact: false, isStill: false, showEnded: false, showBand: false, showColony: true, showAlerts: true }
const view = atom({ plugin: 'fleet', key: 'view' } as const, DEFAULT_VIEW)

const FRAME_MS = 400
const TICK_MS = 2_000
const SCAN_LIVE_MS = 2_000
const SCAN_BAND_MS = 5_000
const SCAN_IDLE_MS = 15_000
const HEARTBEAT_MS = 20_000
const USAGE_MS = 5_000
const TITLE_MS = 5 * 60_000
const DAY_MS = 86_400_000
const ARCHIVE_MS = 60_000
// A drawing counts as on screen while it has drawn this recently.
const SEEN_MS = 3_000
// The newest /fleet card stays live this long, then holds still to spare redraws.
const LIVE_CARD_MS = 10 * 60_000

// Module state: rebuilt on a reload, when session.start runs again.
let dir = ''
let home = ''
let myId = ''
let isWindows = false
let isMac = false
let appDir = ''
let localAppData = ''
let lastArchive = 0
let isPaneOpen = false
let isWritePending = false
let lastWrite = 0
let lastScan = 0
let lastUsage = 0
let lastTitle = 0
let lastSignature = ''
let lastStatus: string | undefined
// The last heartbeat each file held that parsed: a file caught mid-write keeps its session showing.
const lastGood = new Map<string, FleetSession>()
// The desktop app's own record of each Code session, by path: read again only when its size or time moves.
const records = new Map<string, { mtimeMs: number; size: number; cli: string; isArchived: boolean }>()
// Heartbeat ids of sessions the person archived in the desktop app: left out of the fleet.
let archived = new Set<string>()
// Each session's state at the last scan, to see who has just started needing the person. The first
// scan only fills it, so a fleet that was already waiting doesn't toast at startup.
const lastStates = new Map<string, string>()
let isSeeded = false
// Subagents with a permission dialog open, by agent id, oldest first: what each dialog says. Kept
// apart from the stored record, which goes on tracking the real state; while this holds anything the
// heartbeat shows the session as waiting on the oldest one. The tool names the call that holds the
// dialog, so a parallel call of another tool finishing first does not close it.
const openDialogs = new Map<string, { text: string; tool: string; at: number }>()
const withDialogs = (s: FleetSession): FleetSession => {
  const first = openDialogs.values().next().value
  return first !== undefined && s.state !== 'ended' ? { ...s, state: 'waiting', kind: 'waiting', now: first.text, waitingSince: Math.min(s.waitingSince ?? first.at, first.at) } : s
}
const TOAST_MS = 8_000
const HEARTBEAT_KEEP_MS = 7 * DAY_MS
// The /fleet card in the transcript that is live: the newest one drawn after a run.
let isCardPending = false
let liveCard: string | null = null
let liveCardAt = 0
// When a terminal drawing (which animates by frames) last drew: the frame clock runs only then.
let terminalDrawAt = 0
const seenCards = new Set<string>()

const blank = (id: string, now: number): FleetSession => ({
  v: 1,
  id,
  project: '',
  cwd: '',
  surface: '',
  model: '',
  effort: null,
  state: 'idle',
  task: '',
  now: 'Waiting for a prompt',
  last: '',
  turnStartedAt: null,
  idleSince: now,
  turns: 0,
  toolsThisTurn: 0,
  toolsTotal: 0,
  contextTokens: 0,
  contextWindow: 0,
  contextPercent: null,
  costUsd: null,
  tokens: ZERO,
  limits: [],
  agents: [],
  startedAt: now,
  updatedAt: now,
})

// What the panel was last handed, in outline (element types, keys, labels, short texts), written to
// `.debug-pane.txt` beside the heartbeats while a `.debug` file is there: the one way to see what a
// real surface receives, since its drawing can't be watched from here. Checked at most every 10s.
let debugCheckedAt = 0
let isDebugging = false
async function dumpPane($: EngineInterface, surface: string, columns: number, tree: unknown) {
  if (dir === '') return
  const now = await $.clock.now()
  if (now - debugCheckedAt >= 10_000) {
    debugCheckedAt = now
    isDebugging = await $.fs.exists(`${dir}/.debug`).catch(() => false)
  }
  if (!isDebugging) return
  const lines: string[] = []
  const walk = (node: unknown, depth: number) => {
    if (node === null || node === undefined || node === false) return
    if (typeof node === 'string' || typeof node === 'number') return void lines.push(`${'  '.repeat(depth)}"${String(node).slice(0, 80)}"`)
    if (Array.isArray(node)) return void node.forEach(n => walk(n, depth))
    const el = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
    const p = el.props ?? {}
    const bits = ['key', 'label', 'module', 'width', 'height', 'alt'].filter(k => p[k] !== undefined).map(k => `${k}=${JSON.stringify(p[k]).slice(0, 80)}`)
    if (typeof p.source === 'string') bits.push(`source=${p.source.length}ch`)
    lines.push(`${'  '.repeat(depth)}${String(el.type)} ${bits.join(' ')}`)
    walk(el.children ?? p.children, depth + 1)
  }
  walk(tree, 0)
  await $.fs.write(`${dir}/.debug-pane.txt`, `${new Date(now).toISOString()} surface=${surface} columns=${columns}\n${lines.join('\n')}\n`).catch(() => undefined)
}

// Writes go one after another, each reading the record just before it writes, so an older write can
// never land after a newer one and put back a state that has passed.
let writing: Promise<void> = Promise.resolve()

function flush($: EngineInterface): Promise<void> {
  isWritePending = false
  writing = writing.then(async () => {
    const at = await $.clock.now()
    const mine = await read($, me)
    if (mine === null || dir === '') return
    lastWrite = at
    try {
      await $.fs.write(`${dir}/${mine.id}.json`, JSON.stringify({ ...withDialogs(mine), updatedAt: at }))
    } catch {
      // A failed heartbeat shows as a stale one elsewhere; the next write tries again.
    }
  })
  return writing
}

// Changes this session's own record; writes it out within half a second.
async function patch($: EngineInterface, fn: (s: FleetSession) => FleetSession) {
  const now = await $.clock.now()
  // Stamp when the state turns to waiting, and clear it when it leaves.
  await update($, me, current => {
    if (current === null) return current
    const next = fn(current)
    if (next.state === 'waiting') return current.state === 'waiting' && current.waitingSince ? { ...next, waitingSince: current.waitingSince } : { ...next, waitingSince: now }
    return next.waitingSince ? { ...next, waitingSince: null } : next
  })
  if (!isWritePending) {
    isWritePending = true
    $.clock.after(500, () => void flush($))
  }
}

const patchAgent = ($: EngineInterface, agentId: string, fn: (a: FleetAgent) => FleetAgent) =>
  patch($, s => ({ ...s, agents: s.agents.map(a => (a.id === agentId ? fn(a) : a)) }))

async function refreshUsage($: EngineInterface) {
  lastUsage = await $.clock.now()
  try {
    const [usage, model, surface] = await Promise.all([$.session.usage(), $.session.model(), $.session.surface()])
    await patch($, s => ({
      ...s,
      model: model || s.model,
      surface: surface ?? s.surface,
      contextTokens: usage.context.tokens ?? s.contextTokens,
      contextWindow: usage.context.window,
      contextPercent: usage.context.percent ?? null,
      costUsd: usage.cost?.usd ?? s.costUsd,
      limits: usage.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt ?? null })),
      // Once a reading has held a plan limit, this is a subscription for good (an API key never has one).
      hasPlan: s.hasPlan || usage.rateLimits.some(isPlanLimit) || undefined,
    }))
  } catch {
    // Usage is a nicety; the heartbeat goes on without it.
  }
}

// Claude Code keeps a session's title in its transcript as `custom-title` rows; the last one stands.
// The transcript can run past what one $.fs.read takes, so a shell tool picks the row out.
const mangle = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, '-')

async function refreshTitle($: EngineInterface) {
  lastTitle = await $.clock.now()
  const mine = await read($, me)
  if (mine === null || home === '') return
  for (const folder of [mine.cwd, await $.session.root()]) {
    const path = `${home}/.claude/projects/${mangle(folder)}/${mine.id}.jsonl`
    if (!(await $.fs.exists(path).catch(() => false))) continue
    const argv = isWindows
      ? [
          'powershell',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // No double quote or backslash in the command: Windows PowerShell's own command-line
          // parsing drops or eats them when the command comes as an argument ([char]34 is ", [char]92 is \).
          // The pattern takes escaped characters (\") inside the title; the output is UTF-8 for any script.
          `[Console]::OutputEncoding = [Text.Encoding]::UTF8; $q = [char]34; $b = [char]92; ` +
            `$p = $q + 'customTitle' + $q + ':' + $q + '((?:[^' + $q + $b + $b + ']|' + $b + $b + '.)*)'; ` +
            `$m = Select-String -LiteralPath '${path.replace(/'/g, "''")}' -Pattern $p | Select-Object -Last 1; if ($m) { $m.Matches[0].Groups[1].Value }`,
        ]
      : ['sh', '-c', `grep -o '"customTitle":"\\([^"\\]\\|\\\\.\\)*"' "$1" | tail -n 1 | sed 's/^"customTitle":"//; s/"$//'`, 'sh', path]
    try {
      const result = await $.process.run(argv, { timeoutMs: 15_000 })
      const raw = result.stdout.trim()
      if (result.exitCode === 0 && raw !== '') {
        const title = JSON.parse(`"${raw}"`) as string
        if (title !== mine.title) await patch($, s => ({ ...s, title }))
      }
    } catch {
      // No title yet, or no shell tool: the folder name stands in.
    }
    return
  }
}

// What a drawing shows of the fleet, so a redraw only happens when that changes (each redraw of a
// desktop card restarts its CSS motion). Times move once a minute; token counts by the thousand;
// fields that change on every model step (cache and step times) only through what they show.
const thousands = (n: number): number => Math.round(n / 1_000)
const minutes = (at: number | null | undefined): number | null => (at ? Math.floor(at / 60_000) : null)
const signatureOf = (found: readonly FleetSession[], now: number): string =>
  `${Math.floor(now / 60_000)}|${JSON.stringify(
    found.map(s => ({
      ...s,
      updatedAt: Math.floor((now - s.updatedAt) / 60_000),
      cacheAt: minutes(s.cacheAt),
      toolAt: undefined,
      tokens: thousands(totalTokens(s.tokens)),
      contextTokens: thousands(s.contextTokens),
      costUsd: s.costUsd === null ? null : Math.round(s.costUsd * 100),
      limits: s.limits.map(l => Math.round(l.percentUsed)),
      agents: s.agents.map(a => ({ ...a, lastAt: undefined, toolAt: undefined, steps: undefined, tokens: thousands(totalTokens(a.tokens)), contextTokens: thousands(a.contextTokens) })),
      loops: (s.loops ?? []).map(l => ({ id: l.id, model: l.model, tokens: thousands(l.tokens), lastAt: minutes(l.lastAt) })),
      attention: attentionKey(s, now),
    })),
  )}`

// Reads every session's heartbeat; files untouched for a day are not read.
// Recent readings of each limit kind, for the 5-hour forecast. Lost on a reload, which is fine.
const SAMPLE_GAP_MS = 30_000
const SAMPLE_KEEP_MS = 45 * 60_000
const limitSamples = new Map<string, LimitSample[]>()
let isFullShown = false

// Notes the fleet's current limits: one reading per kind per 30 s, a new window starting afresh.
function sampleLimits(limits: readonly FleetLimit[], now: number) {
  for (const l of limits) {
    let list = limitSamples.get(l.kind) ?? []
    if (list.length > 0 && !sameWindow(list[list.length - 1].resetsAt, l.resetsAt)) list = []
    const last = list[list.length - 1]
    if (!last || now - last.at >= SAMPLE_GAP_MS) list.push({ at: now, pct: l.percentUsed, resetsAt: l.resetsAt })
    limitSamples.set(l.kind, list.filter(p => now - p.at <= SAMPLE_KEEP_MS))
  }
}

// The limits with the 5-hour one's forecast, when its pace would fill it before the reset.
function withForecast(limits: FleetLimit[], now: number): FleetLimit[] {
  return limits.map(l => {
    if (l.kind !== 'five_hour') return l
    const fullInMs = forecastFull(limitSamples.get(l.kind) ?? [], l.resetsAt, now)
    return fullInMs === null ? l : { ...l, fullInMs }
  })
}

// Reads the desktop app's session records (<org>/<account>/local_*.json) about once a minute.
async function refreshArchived($: EngineInterface) {
  if (appDir === '' || lastScan - lastArchive < ARCHIVE_MS) return
  lastArchive = lastScan
  try {
    const dirs = async (path: string) => (await $.fs.list(path)).filter(e => e.kind === 'dir').map(e => `${path}/${e.name}`)
    // The Windows app is a packaged one: a process it didn't start sees its folder only under the package.
    const orgs = await dirs(appDir).catch(async () => {
      if (!isWindows || localAppData === '') throw new Error('no app folder')
      const pkg = (await $.fs.list(`${localAppData}/Packages`)).find(e => e.kind === 'dir' && e.name.startsWith('Claude_'))
      if (pkg === undefined) throw new Error('no app package')
      appDir = `${localAppData}/Packages/${pkg.name}/LocalCache/Roaming/Claude/claude-code-sessions`
      return dirs(appDir)
    })
    const accounts = (await Promise.all(orgs.map(dirs))).flat()
    const files = (await Promise.all(accounts.map(async path => (await $.fs.list(path)).filter(e => e.kind === 'file' && /^local_.*\.json$/.test(e.name) && lastScan - e.mtimeMs < HEARTBEAT_KEEP_MS).map(e => ({ ...e, path: `${path}/${e.name}` })))))
      .flat()
    const paths = new Set(files.map(f => f.path))
    for (const path of [...records.keys()]) if (!paths.has(path)) records.delete(path)
    await Promise.all(
      files.map(async f => {
        const known = records.get(f.path)
        if (known && known.mtimeMs === f.mtimeMs && known.size === f.size) return
        const parsed = archiveOf(String(await $.fs.read(f.path).catch(() => '')))
        if (parsed !== null) records.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, ...parsed })
      }),
    )
    archived = new Set([...records.values()].filter(r => r.isArchived).map(r => r.cli))
  } catch {
    // No desktop app folder (terminal only, Linux) or it can't be listed: nothing is left out.
  }
}

async function scan($: EngineInterface, isForced = false) {
  lastScan = await $.clock.now()
  if (dir === '') return
  let found: FleetSession[] = []
  try {
    const entries = await $.fs.list(dir)
    const fresh = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json') && lastScan - entry.mtimeMs < DAY_MS)
    const texts = await Promise.all(fresh.map(entry => $.fs.read(`${dir}/${entry.name}`).catch(() => '')))
    // A file gone from the folder takes its last good reading with it.
    const names = new Set(fresh.map(entry => entry.name))
    for (const name of [...lastGood.keys()]) if (!names.has(name)) lastGood.delete(name)
    found = fresh
      .map((entry, i) => {
        const text = texts[i]
        const parsed = parseSession(typeof text === 'string' ? text : '')
        if (parsed !== null) lastGood.set(entry.name, parsed)
        return parsed ?? lastGood.get(entry.name) ?? null
      })
      .filter((s): s is FleetSession => s !== null)
  } catch {
    // No folder yet (this session's first heartbeat makes it) or it can't be listed: keep what was
    // shown, and don't let the next good scan toast every waiting session again.
    return
  }
  await refreshArchived($)
  // This session stays in its own panel even once archived.
  found = found.filter(s => !archived.has(s.id) || s.id === myId)
  const signature = signatureOf(found, lastScan)
  if (isForced || signature !== lastSignature) {
    lastSignature = signature
    await update($, sessions, () => found)
  }

  const all = arrange(found, lastScan, false)
  const sum = summarize(all, lastScan)
  // Only the other sessions that wait on the person: this one says so itself.
  const waiting = all.filter(s => s.state === 'waiting' && s.id !== myId)
  // Another session that has just started needing the person says so, while this panel is open.
  if (isSeeded && isPaneOpen && (await read($, view)).showAlerts !== false) {
    for (const s of waiting) if (lastStates.get(s.id) !== 'waiting') $.ui.toast(`${nameOf(s)}: ${firstLine(s.now, 60)}`, { timeoutMs: TOAST_MS })
  }
  lastStates.clear()
  for (const s of all) lastStates.set(s.id, s.state)
  isSeeded = true
  // What needs the person leads; names are cut so a long title doesn't push the rest off. The flag shows only then.
  const isAbout = sum.sessions > 1 || waiting.length > 0
  const busy = [waiting.length ? `⚑ needs you: ${waiting.map(s => [firstLine(nameOf(s), 16), waitText(s, lastScan)].filter(Boolean).join(' ')).join(', ')}` : '', isAbout && sum.working > 0 ? `${sum.working} working` : '', isAbout && sum.agents > 0 ? plural(sum.agents, 'agent') : ''].filter(Boolean)
  // With nobody needing you and nothing working, say how many rest.
  const idle = sum.sessions
  const limits = currentLimits(all, lastScan)
  sampleLimits(limits, lastScan)
  const fullMs = withForecast(limits, lastScan).find(l => l.kind === 'five_hour')?.fullInMs
  // Shown once under an hour; hidden only above 70 minutes, so it doesn't flicker at the edge.
  isFullShown = shownFull(isFullShown, fullMs)
  const full = isFullShown && fullMs !== undefined ? [`5h full ~${fullIn(fullMs)}`] : []
  const parts = [...(busy.length || !isAbout || idle === 0 ? busy : [`${idle} idle`]), ...full]
  const status = parts.length ? parts.join(' · ') : undefined
  if (status !== lastStatus) {
    lastStatus = status
    $.ui.status(status)
  }
}

// A path inside a PowerShell single-quoted string: its quote marks (U+2018 to U+201B count as one) doubled.
const quoted = (text: string): string => text.replace(/['\u2018-\u201B]/g, m => m + m)

// Heartbeats of sessions long gone: removed once a session starts, so the folder doesn't grow forever.
async function pruneHeartbeats($: EngineInterface) {
  if (dir === '') return
  const days = HEARTBEAT_KEEP_MS / DAY_MS
  const argv = isWindows
    ? [
        'powershell',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-ChildItem -LiteralPath '${quoted(dir)}' -Filter *.json | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-${days}) } | Remove-Item`,
      ]
    : ['sh', '-c', `find "$1" -maxdepth 1 -name '*.json' -mtime +${days} -delete`, 'sh', dir]
  try {
    await $.process.run(argv, { timeoutMs: 15_000 })
  } catch {
    // Nothing to prune, or no shell tool: the scan skips old files anyway.
  }
}

// After /clear (or a resume), the process goes on under a new session id and no session.start runs:
// follow it, so the new conversation gets its own heartbeat and the old one stays ended.
async function followSession($: EngineInterface) {
  const id = await $.session.id()
  if (id === myId) return
  const at = await $.clock.now()
  myId = id
  // A resumed conversation picks up what its own heartbeat said it was about; a closed panel stays
  // closed, /clear or not.
  const earlier = await lastHeartbeat($, id)
  await update($, me, current =>
    current === null
      ? current
      : { ...blank(id, at), ...earlier, cwd: current.cwd, project: current.project, surface: current.surface, mode: current.mode, hostId: current.hostId, panelClosed: current.panelClosed, panelOpenedOnce: current.panelOpenedOnce, hasPlan: current.hasPlan || earlier.hasPlan },
  )
  lastTitle = 0
  await flush($)
}

const saveView = async ($: EngineInterface, fn: (v: FleetView) => FleetView) => {
  const next = await update($, view, fn)
  if (next !== undefined) await $.store.set('view', next)
  return next
}

// Reads only what the drawing shows: never this session's own record, which changes on every
// tool call, and never the frame, which only the terminal's text workers move by.
async function board($: EngineInterface): Promise<Board> {
  const [all, v] = await Promise.all([read($, sessions), read($, view)])
  const now = await $.clock.now()
  // Each row is judged on the whole fleet's plan limits.
  const list = arrange(all, now, v.showEnded).map(s => withFleetLimits(s, all, now))
  return {
    list,
    sum: summarize(list, now),
    limits: withForecast(currentLimits(all, now), now),
    v,
    mineId: myId || undefined,
    now,
  }
}

// Opens the side panel. Where the surface places none, the /fleet command draws the card instead.
async function openPanel($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: 'Fleet' })
  isPaneOpen = opened.isPlaced
  $.clock.after(1, () => void scan($, true))
  if (!opened.isPlaced) await $.command.run({ command: 'fleet', args: '' }).catch(() => undefined)
}

// Brings up the desktop app's window for a session that waits on the person. The link is the app's
// own deep link; its id comes from another session's file, so it is checked before it reaches a command.
async function go($: EngineInterface, id: string) {
  const hostId = (await read($, sessions)).find(s => s.id === id)?.hostId
  if (hostId === undefined || !isHostId(hostId)) return
  const link = `claude://claude.ai/epitaxy/${hostId}`
  const argv = isWindows ? ['rundll32', 'url.dll,FileProtocolHandler', link] : [isMac ? 'open' : 'xdg-open', link]
  try {
    await $.process.run(argv, { timeoutMs: 15_000 })
  } catch {
    // No way to open the link here: the button does nothing.
  }
}

// The panel rescans every 2 seconds while it is open, so it needs no refresh button.
const actionsFor = ($: EngineInterface): Actions => ({
  open: () => void openPanel($),
  hideBand: () => void saveView($, v => ({ ...v, showBand: false })),
  toggle: key => void saveView($, v => ({ ...v, [key]: !v[key] })),
  go: id => void go($, id),
})

// Tools that hold the main loop's call until the person answers, and what the row says meanwhile.
const ASKS = new Map([
  ['AskUserQuestion', 'Asking you a question'],
  ['ExitPlanMode', 'Plan ready for your OK'],
])

// Permission modes in which an "ask" is settled without the person.
const SETTLES_ASKS = new Set(['auto', 'bypassPermissions', 'dontAsk'])

// The session waits on the person to approve a tool call. It shows until that call's tool.call
// finishes: no event marks the approval itself.
async function markWaiting($: EngineInterface, tool: string, input: unknown) {
  const what = describeTool(tool, (input ?? {}) as Record<string, unknown>)
  await patch($, s => ({ ...s, state: 'waiting', now: `Needs your OK: ${what}`, kind: 'waiting' }))
  await flush($)
}

// A subagent's dialog names the subagent and marks its own row. The session's stored state is left
// alone: the heartbeat shows it waiting while any dialog is open (see withDialogs).
async function markAgentWaiting($: EngineInterface, agent: { id: string; name: string }, tool: string, input: unknown) {
  const text = `Needs your OK (${agent.name}): ${describeTool(tool, (input ?? {}) as Record<string, unknown>)}`
  openDialogs.set(agent.id, { text, tool, at: await $.clock.now() })
  await patchAgent($, agent.id, a => ({ ...a, now: text, kind: 'waiting' }))
  await flush($)
}

async function noteMode($: EngineInterface, mode: unknown) {
  if (typeof mode !== 'string') return
  const mine = await read($, me)
  if (mine !== null && mine.mode !== mode) await patch($, s => ({ ...s, mode }))
}

// What a session's own heartbeat on disk says it was about, for a session starting again under the
// same id: its task, last answer and receipt, never its running state or its subagents.
async function lastHeartbeat($: EngineInterface, id: string): Promise<Partial<FleetSession>> {
  if (dir === '') return {}
  try {
    const was = parseSession(await $.fs.read(`${dir}/${id}.json`))
    if (was === null || was.id !== id) return {}
    const { task, last, title, tasks, receipt, promptAt, idleSince, turns, panelClosed, panelOpenedOnce, mode, compactions, hostId, cacheAt, hasPlan } = was
    const kept = { task, last, title, tasks, receipt, promptAt, idleSince, turns, panelClosed, panelOpenedOnce, mode, compactions, hostId, cacheAt, hasPlan }
    return Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined && value !== null)) as Partial<FleetSession>
  } catch {
    return {}
  }
}

// The terminal's text workers move by frames; the desktop's SVG ones move by CSS on their own.
async function frameFor($: EngineInterface, surface: string): Promise<number> {
  if (surface !== 'terminal') return 0
  terminalDrawAt = await $.clock.now()
  return read($, frame)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    home = ((await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '').replace(/\\/g, '/')
    dir = home ? `${home}/.claude/fleet` : ''
    isWindows = (await $.env.get('OS')) === 'Windows_NT'
    // The mod runtime names no platform: a home under /Users is a Mac's.
    isMac = !isWindows && home.startsWith('/Users/')
    const appData = isWindows ? ((await $.env.get('APPDATA')) || '').replace(/\\/g, '/') : isMac ? `${home}/Library/Application Support` : ''
    appDir = appData ? `${appData}/Claude/claude-code-sessions` : ''
    localAppData = isWindows ? ((await $.env.get('LOCALAPPDATA')) || '').replace(/\\/g, '/') : ''
    lastArchive = 0
    records.clear()
    archived = new Set()
    const [id, cwd, root, surface, at] = await Promise.all([$.session.id(), $.session.cwd(), $.session.root(), $.session.surface(), $.clock.now()])
    // The desktop app sets this in each session it starts. Children inherit it, so a terminal claude -p
    // run from a desktop session's shell would claim the parent's id: only a desktop surface keeps it.
    const hostId = surface === 'desktop' ? (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) || undefined : undefined
    myId = id
    const stored = (await $.store.get('view')) as Partial<FleetView> | undefined
    // The band's setting lasts for the session it was set in; each new session starts from the default.
    await update($, view, () => ({ ...DEFAULT_VIEW, ...stored, showBand: DEFAULT_VIEW.showBand }))

    // A reload keeps the record the session already had. A session started again under the same id
    // (the app restarted, a resume) picks up what its last heartbeat said it was about, resting.
    const earlier = await lastHeartbeat($, id)
    await update($, me, current =>
      current !== null && current.id === id
        ? current
        : { ...blank(id, at), ...earlier, cwd, project: root.split(/[\\/]/).filter(Boolean).at(-1) ?? root, surface: surface ?? '', hostId },
    )
    // /fleet first, so it answers as soon as the session is up; the slower work follows on its own.
    await $.command.register({ name: 'fleet', description: 'Show every running session and its agents, live', argumentHint: '[band|colony|ended|still|animate|alerts]' })
    $.clock.after(1, () => {
      void (async () => {
        await refreshUsage($)
        await flush($)
        await scan($, true)
        await refreshTitle($)
        await pruneHeartbeats($)
      })()
    })

    $.clock.every(FRAME_MS, () => {
      void (async () => {
        const now = await $.clock.now()
        if (now - terminalDrawAt > SEEN_MS) return
        const v = await read($, view)
        const all = arrange(await read($, sessions), now, false)
        if (!v.isStill && all.some(s => isBusy(s, now))) await update($, frame, n => (n + 1) % 1_000_000)
      })()
    })
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const now = await $.clock.now()
        isPaneOpen = (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
        const isCardLive = liveCard !== null && now - liveCardAt < LIVE_CARD_MS
        const v = await read($, view)
        const mine = await read($, me)
        if (mine?.state === 'working' && now - lastUsage >= USAGE_MS) await refreshUsage($)
        if (now - lastWrite >= HEARTBEAT_MS) await flush($)
        if (now - lastTitle >= TITLE_MS) void refreshTitle($)
        const every = isPaneOpen || isCardLive ? SCAN_LIVE_MS : v.showBand ? SCAN_BAND_MS : SCAN_IDLE_MS
        if (now - lastScan >= every) await scan($)
        // A colony worker whose change has held long enough moves on the next drawing: draw now.
        const due = colonyDueAt(now)
        if ((isPaneOpen || isCardLive) && v.showColony !== false && due !== null && due <= now) {
          noteColonyForced(now)
          await scan($, true)
        }
      })()
    })
    return started
  })

  on('session.end', async ($, e, next) => {
    openDialogs.clear()
    await patch($, s => ({ ...s, state: 'ended', now: e.reason === 'clear' ? 'Cleared' : 'Session ended', agents: s.agents.filter(a => a.state !== 'working') }))
    await flush($)
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await followSession($)
    return ended
  })

  // /fleet opens the dashboard in the app's side panel. Where the surface places no panel, it draws
  // the dashboard as a live card in the transcript instead. The fresh scan follows on a timer,
  // outside this dispatch, so a slow disk or a session still starting up never leaves it unanswered.
  on('command.run', { command: 'fleet' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'band') {
      const v = await update($, view, x => ({ ...x, showBand: !x.showBand }))
      if (v !== undefined) void $.store.set('view', v)
      return { text: v?.showBand ? 'Fleet band shown above the prompt.' : 'Fleet band hidden; /fleet band brings it back.' }
    }
    if (arg === 'alerts') {
      const v = await saveView($, x => ({ ...x, showAlerts: x.showAlerts === false }))
      return { text: v?.showAlerts === false ? 'Fleet alerts off; /fleet alerts turns them back on.' : 'Fleet alerts on: a toast here when another session needs you, while this panel is open.' }
    }
    if (arg !== '' && !['still', 'animate', 'ended', 'colony'].includes(arg)) {
      return { text: `Unknown option "${arg}". Try: /fleet, /fleet band, /fleet colony, /fleet ended, /fleet still, /fleet animate, /fleet alerts.` }
    }
    // What changed, and how to undo it, leads the reply; the panel opens as for a bare /fleet.
    let changed = ''
    if (arg === 'still' || arg === 'animate') {
      void saveView($, v => ({ ...v, isStill: arg === 'still' }))
      changed = arg === 'still' ? 'Motion stopped; /fleet animate restarts it. ' : 'Motion restarted; /fleet still stops it. '
    }
    if (arg === 'ended') {
      const v = await saveView($, x => ({ ...x, showEnded: !x.showEnded }))
      changed = v?.showEnded ? 'Showing ended sessions; /fleet ended hides them. ' : 'Ended sessions hidden; /fleet ended shows them. '
    }
    if (arg === 'colony') {
      const v = await saveView($, x => ({ ...x, showColony: x.showColony === false }))
      changed = v?.showColony === false ? 'Colony hidden; /fleet colony shows it. ' : 'Colony shown; /fleet colony hides it. '
    }
    $.clock.after(1, () => void scan($, true))
    const opened = await $.ui.open({ id: PANE, title: 'Fleet' })
    isPaneOpen = opened.isPlaced
    if (opened.isPlaced) return { text: `${changed}Fleet is open in the side panel.` }
    isCardPending = true
    liveCardAt = await $.clock.now()
    const sum = summarize(arrange(await read($, sessions), liveCardAt, false), liveCardAt)
    return { text: `${changed}Fleet: ${[plural(sum.sessions, 'session'), sum.working > 0 ? `${sum.working} working` : '', sum.waiting > 0 ? `${plural(sum.waiting, 'needs', 'need')} you` : '', sum.agents > 0 ? `${plural(sum.agents, 'agent')} running` : ''].filter(Boolean).join(', ')}.` }
  }).catch(() => ({ text: 'Fleet: still starting up in this session. Run /fleet again in a moment.' }))

  on('ui.render', { component: 'CommandOutput', props: { command: 'fleet' } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const id = e.requestId
    // Only a row never drawn before can be the run's own: an old row redrawn stays old.
    if (!seenCards.has(id)) {
      if (seenCards.size > 500) seenCards.clear()
      seenCards.add(id)
      if (isCardPending) {
        isCardPending = false
        liveCard = id
      }
    }
    // Runs that opened the side panel, and old cards, keep their plain text.
    const now = await $.clock.now()
    if (id !== liveCard || now - liveCardAt >= LIVE_CARD_MS) return next(e)
    return dashboard($.ui.resolve(e), e.surface, await board($), actionsFor($), Math.max(60, (e.viewport?.columns ?? 120) - 4), await frameFor($, e.surface))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const tree = dashboard($.ui.resolve(e), e.surface, await board($), actionsFor($), e.props.bodyColumns, await frameFor($, e.surface))
    await dumpPane($, e.surface, e.props.bodyColumns, tree)
    return tree
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const theirs = await next(e)
    const v = await read($, view)
    if (!v.showBand || e.props.hasSurvey) return theirs
    const ui = $.ui.resolve(e)
    const mine = band(ui, e.surface, await board($), actionsFor($), e.props.bodyColumns, await frameFor($, e.surface))
    if (mine === null) return theirs
    const { Box } = ui
    return (
      <Box flexDirection="column">
        {mine}
        {theirs}
      </Box>
    )
  })

  on('turn.start', async ($, e, next) => {
    await followSession($)
    const at = await $.clock.now()
    // A background task's notification starts a turn too, but the person did not ask anything.
    const isPrompt = e.text.trim() !== '' && !NOT_TYPED.test(e.text)
    await patch($, s => ({
      ...s,
      state: 'working',
      task: isPrompt ? firstLine(e.text, 140) : s.task,
      now: 'Thinking…',
      kind: 'thinking',
      turnStartedAt: at,
      promptAt: isPrompt ? at : (s.promptAt ?? at),
      idleSince: null,
      // A list that was all done belonged to the last piece of work.
      tasks: (() => {
        const p = progressOf(s.tasks)
        return p && p.done === p.total ? undefined : s.tasks
      })(),
      turns: s.turns + 1,
      toolsThisTurn: 0,
      toolAt: null,
      // A notification's turn is not the person's: it leaves the last receipt alone.
      tally: isPrompt ? { edits: 0, errors: 0, agents: 0, costStart: s.costUsd } : null,
    }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const at = await $.clock.now()
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      // A finished subagent has no dialog open, whatever became of the call that had one.
      openDialogs.delete(agentId)
      await patchAgent($, agentId, a => ({
        ...a,
        state: e.reason === 'answer' ? 'done' : 'failed',
        now: e.reason === 'answer' ? firstLine(e.answer, 80) || 'Done' : `Stopped: ${e.reason}`,
        kind: undefined,
        endedAt: at,
        tokens: a.steps === 0 && e.usage ? addUsage(ZERO, e.usage) : a.tokens,
      }))
      return result
    }
    await patch($, s => ({
      ...s,
      state: 'idle',
      now: e.reason === 'answer' ? 'Waiting for your reply' : e.reason === 'aborted' ? 'Interrupted' : `Stopped: ${e.reason}`,
      kind: undefined,
      last: firstLine(e.answer, 140) || s.last,
      turnStartedAt: null,
      toolAt: null,
      idleSince: at,
      // Subagents the turn left running stay; finished ones older than the turn fade.
      // Lost subagents (marked running, long silent) are let go here: their end is never coming.
      agents: s.agents.filter(a => (a.state === 'working' ? isAgentLive(a, at) : (a.endedAt ?? at) >= (s.turnStartedAt ?? 0))),
    }))
    await refreshUsage($)
    // The turn's receipt, with its cost once the usage above has caught up.
    await patch($, s =>
      s.tally && s.turnStartedAt === null
        ? {
            ...s,
            receipt: {
              ms: at - (s.promptAt ?? at),
              edits: s.tally.edits,
              errors: s.tally.errors,
              agents: s.tally.agents,
              costUsd: s.costUsd !== null && s.tally.costStart !== null ? s.costUsd - s.tally.costStart : null,
              endedAt: at,
            },
            tally: null,
          }
        : s,
    )
    await flush($)
    if (at - lastTitle >= 60_000) void refreshTitle($)
    return result
  })

  // Every model request, the main loop's and each subagent's: tokens and live context.
  on('turn.step', async function* ($, e, next) {
    // The cache's lifetime restarts when the request goes out, not when the reply ends.
    const startedAt = await $.clock.now()
    const result = yield* next(e)
    const usage = result.usage
    if (!usage) return result
    const agentId = e.agentId
    const mine = await read($, me)
    // A loop no listed agent owns: a workflow's agent, or a fork (compaction, memory, a plugin's).
    if (agentId !== undefined && mine !== null && !mine.agents.some(a => a.id === agentId)) {
      const at = await $.clock.now()
      const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
      await patch($, s => {
        const loops = s.loops ?? []
        const was = loops.find(l => l.id === agentId)
        const loop = was
          ? { ...was, steps: was.steps + 1, tokens: was.tokens + tokens, lastAt: at, model: usage.model || was.model }
          : { id: agentId, model: usage.model || e.model || '', steps: 1, tokens, startedAt: at, lastAt: at }
        return { ...s, loops: [...loops.filter(l => l.id !== agentId), loop].slice(-12) }
      })
      return result
    }
    if (agentId === undefined) {
      // Each reply writes or reads the prompt cache, which restarts its lifetime.
      await patch($, s => ({ ...s, model: usage.model || e.model || s.model, effort: typeof e.effort === 'string' ? e.effort : s.effort, tokens: addUsage(s.tokens, usage), cacheAt: startedAt }))
      return result
    }
    const model = usage.model || e.model
    const stepAt = await $.clock.now()
    await patchAgent($, agentId, a => ({
      ...a,
      model: model || a.model,
      lastAt: stepAt,
      hitMax: a.hitMax || result.stopReason === 'max_tokens',
      tokens: addUsage(a.tokens, usage),
      contextTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0),
      contextWindow: windowOf(model || a.model),
      steps: a.steps + 1,
    }))
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const at = await $.clock.now()
    const id = started.agentId ?? e.tool_use_id
    const mine = await read($, me)
    const taken = (mine?.agents ?? []).map(x => x.name ?? '')
    const agent: FleetAgent = {
      id,
      name: e.name || pickName(id, taken),
      type: e.subagentType,
      description: firstLine(e.description, 80),
      model: started.model ?? e.model ?? '',
      state: 'working',
      now: 'Starting…',
      kind: 'thinking',
      startedAt: at,
      endedAt: null,
      tokens: ZERO,
      contextTokens: 0,
      contextWindow: windowOf(started.model ?? e.model ?? ''),
      steps: 0,
      tools: 0,
      lastAt: at,
    }
    await patch($, s => ({
      ...s,
      agents: [...s.agents.filter(a => a.id !== agent.id), agent].slice(-30),
      tally: s.tally ? { ...s.tally, agents: s.tally.agents + 1 } : s.tally,
    }))
    // The panel opens by itself once, at the session's first subagent, unless the person closed it.
    if (mine !== null && !mine.panelOpenedOnce && !mine.panelClosed && !isPaneOpen) {
      await patch($, s => ({ ...s, panelOpenedOnce: true }))
      $.clock.after(1, () => void $.ui.open({ id: PANE, title: 'Fleet' }).then(opened => (isPaneOpen = opened.isPlaced)))
    }
    return started
  })

  // A call that needs the person's approval: the session waits on them. The dialog's own event says
  // so for certain. A check that answers "ask" says so too, unless the permission mode settles asks
  // without the person (auto mode's classifier, bypass, don't-ask), or it is a plugin's query that
  // runs nothing (no tool_use_id).
  on('classic.PermissionRequest', async ($, e, next) => {
    const input = e as { agent_id?: unknown; tool_name?: unknown; tool_input?: unknown }
    if (input.agent_id === undefined) await markWaiting($, String(input.tool_name ?? ''), input.tool_input)
    else {
      const id = String(input.agent_id)
      const agent = (await read($, me))?.agents.find(a => a.id === id)
      await markAgentWaiting($, { id, name: agent?.name || agent?.type || 'subagent' }, String(input.tool_name ?? ''), input.tool_input)
    }
    return next(e)
  })
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    // A question or a plan keeps its own words (tool.call sets them).
    if (verdict.decision === 'ask' && e.agentId === undefined && e.tool_use_id !== undefined && !ASKS.has(e.tool)) {
      const mine = await read($, me)
      // Outside a turn (a plugin's own call while idle) the session waits on no one.
      if (mine?.turnStartedAt != null && !SETTLES_ASKS.has(mine.mode ?? '')) await markWaiting($, e.tool, e.input)
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const what = describeTool(tool, e as unknown as Record<string, unknown>)
    const kind = kindOfTool(tool)
    const agentId = (e as { agentId?: string }).agentId
    const startedAt = await $.clock.now()
    if (agentId !== undefined) {
      await patchAgent($, agentId, a => ({ ...a, now: what, kind, tools: a.tools + 1, toolAt: startedAt, lastAt: startedAt }))
    } else {
      // Outside a turn (a plugin's own tool call while idle) the session doesn't turn busy.
      await patch($, s =>
        s.turnStartedAt === null ? { ...s, toolsTotal: s.toolsTotal + 1 } : { ...s, state: 'working', now: what, kind, toolAt: startedAt, toolsThisTurn: s.toolsThisTurn + 1, toolsTotal: s.toolsTotal + 1 },
      )
      // A question or a plan for approval holds the call until the person answers: they are needed.
      const asks = ASKS.get(tool)
      if (asks !== undefined) {
        await patch($, s => ({ ...s, state: 'waiting', now: asks, kind: 'waiting' }))
        await flush($)
      }
    }
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      // The call that had this subagent's dialog open is over, however it ended: the dialog was answered.
      if (agentId !== undefined && openDialogs.get(agentId)?.tool === tool && openDialogs.delete(agentId)) {
        await patchAgent($, agentId, a => ({ ...a, now: a.now.startsWith('Needs your OK') ? 'Thinking…' : a.now, kind: a.kind === 'waiting' ? 'thinking' : a.kind }))
      }
    }
    const endedAt = await $.clock.now()
    const input = e as unknown as Record<string, unknown>
    const output = 'result' in result ? result.result : undefined
    const isError = result.isError === true || result.deny !== undefined
    if (agentId === undefined) {
      await patch($, s => {
        const tasks = tasksAfter(s.tasks, tool, input, output)
        const tally = s.tally ? { ...s.tally, edits: s.tally.edits + (EDIT_TOOLS.has(tool) && !isError ? 1 : 0), errors: s.tally.errors + (isError ? 1 : 0) } : s.tally
        if (s.turnStartedAt === null) {
          // No turn: a wait left from a call outside one ends with the call, and nothing turns busy.
          return s.state === 'waiting' ? { ...s, state: 'idle', now: 'Waiting for your reply', kind: undefined, toolAt: null, tasks, tally } : { ...s, toolAt: null, tasks, tally }
        }
        return s.state === 'working' || s.state === 'waiting'
          ? { ...s, state: 'working', now: 'Thinking…', kind: 'thinking', toolAt: null, tasks, tally }
          : { ...s, toolAt: null, tasks, tally }
      })
    } else {
      // A worker's own step report (savvy-progress's step tool) is its progress.
      const count = (n: unknown): number => (Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0)
      const step = tool === 'mcp__savvy-progress__step' ? { done: count(input.done), total: count(input.total) } : null
      await patchAgent($, agentId, a => ({
        ...a,
        kind: a.state === 'working' ? 'thinking' : a.kind,
        toolAt: null,
        lastAt: endedAt,
        progress:
          step && step.total > 0
            ? { done: Math.min(step.done, step.total), total: step.total }
            : step && a.progress
              ? { ...a.progress, done: Math.min(step.done, a.progress.total) }
              : a.progress,
      }))
    }
    return result
  })

  // A compaction of the main conversation: mark how full the context was when it ran.
  on('session.compact', async ($, e, next) => {
    const before = await read($, me)
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && 'messages' in result && result.messages !== undefined && before !== null) {
      const percent = before.contextPercent ?? (before.contextWindow ? (before.contextTokens / before.contextWindow) * 100 : null)
      if (percent !== null) await patch($, s => ({ ...s, compactions: [...(s.compactions ?? []), Math.round(percent)].slice(-6) }))
    }
    // A compaction starts a new prefix that nothing has cached yet: no cache time until the next reply.
    if (e.agentId === undefined && e.trigger !== 'precompute' && 'messages' in result && result.messages !== undefined) {
      await patch($, s => ({ ...s, cacheAt: null }))
    }
    return result
  })

  // The permission mode rides on the classic hook inputs: each prompt and tool call carries it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, (e as { permission_mode?: unknown }).permission_mode)
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    if ((e as { agent_id?: unknown }).agent_id === undefined) await noteMode($, (e as { permission_mode?: unknown }).permission_mode)
    return next(e)
  })

  // A panel the person closed stays closed: it no longer opens by itself this session, reloads included.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await patch($, s => ({ ...s, panelClosed: true }))
    isPaneOpen = false
    return next(e)
  })
}
