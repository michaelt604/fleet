import type { FleetAgent, FleetLimit, FleetLoop, FleetProgress, FleetReceipt, FleetSession, FleetTokens } from '../types'

const cut = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

const base = (path: unknown): string => String(path ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? ''

const host = (url: unknown): string => {
  try {
    return new URL(String(url)).host
  } catch {
    return cut(String(url ?? ''), 30)
  }
}

// What a tool call is doing, in a few words: "Editing register.tsx", "Running npm test".
export function describeTool(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `Reading ${base(input.file_path)}`
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${base(input.file_path)}`
    case 'Write':
      return `Writing ${base(input.file_path)}`
    case 'NotebookEdit':
      return `Editing ${base(input.notebook_path)}`
    case 'Bash':
    case 'PowerShell':
      // A command's own description already reads as a step ("Run the tests").
      return input.description ? cut(String(input.description), 56) : `Running ${cut(String(input.command ?? ''), 50)}`
    case 'Grep':
      return `Searching for ${cut(String(input.pattern ?? ''), 30)}`
    case 'Glob':
      return `Finding ${cut(String(input.pattern ?? ''), 30)}`
    case 'WebFetch':
      return `Reading ${host(input.url)}`
    case 'WebSearch':
      return `Searching the web: ${cut(String(input.query ?? ''), 36)}`
    case 'Agent':
    case 'Task':
      return `Delegating: ${cut(String(input.description ?? ''), 40)}`
    case 'Skill':
      return `Using the ${String(input.skill ?? '')} skill`
    case 'TodoWrite':
      return 'Updating the plan'
    case 'AskUserQuestion':
      return 'Asking you a question'
    case 'ToolSearch':
      return 'Loading tools'
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) {
    const raw = mcp[1] ?? ''
    // The app's own browsers and desktop control read as what they are.
    const known: Record<string, string> = { Claude_Browser: 'the browser', 'claude-in-chrome': 'Chrome', 'computer-use': 'the desktop', playwright: 'Playwright' }
    if (known[raw]) return `Using ${known[raw]}`
    const server = /^[0-9a-f-]{20,}$/.test(raw) ? 'connector' : raw.replace(/^plugin_[^_]+_/, '').replace(/_/g, ' ')
    return `Using ${server} ${(mcp[2] ?? '').replace(/_/g, ' ')}`
  }
  return `Using ${tool}`
}

// "claude-opus-5-5" → "Opus 5.5"; anything unfamiliar stays as it came.
export function modelName(model: string): string {
  const match = /(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-.](\d+))?/i.exec(model)
  if (!match) return model || '?'
  const family = (match[1] ?? '').charAt(0).toUpperCase() + (match[1] ?? '').slice(1).toLowerCase()
  return `${family} ${match[2]}${match[3] ? `.${match[3]}` : ''}`
}

export const windowOf = (model: string): number => (/haiku/i.test(model) ? 200_000 : 1_000_000)

export const totalTokens = (t: FleetTokens): number => t.input + t.output + t.cacheRead + t.cacheWrite

export const addUsage = (
  t: FleetTokens,
  u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number },
): FleetTokens => ({
  input: t.input + (u.input_tokens ?? 0),
  output: t.output + (u.output_tokens ?? 0),
  cacheRead: t.cacheRead + (u.cache_read_input_tokens ?? 0),
  cacheWrite: t.cacheWrite + (u.cache_creation_input_tokens ?? 0),
})

export const ZERO: FleetTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

// Rounded first, then given its unit, so 999,600 reads "1.0M", never "1000k".
export function formatTokens(n: number): string {
  if (n >= 999_500) return n >= 9_950_000 ? `${Math.round(n / 1_000_000)}M` : `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// "1 agent", "2 agents".
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

// What a session's id from the desktop app may hold before it goes into a link or a command.
export const isHostId = (id: string): boolean => /^[\w-]{1,80}$/.test(id)

// The plan's own windows: a gateway's spend limit is real money, not a plan.
export const isPlanLimit = (l: { kind: string }): boolean => l.kind === 'five_hour' || l.kind === 'seven_day'

// Time to a reset, compact: "6d 21h", "1h12m", "12m".
export function resetIn(ms: number): string {
  const m = Math.max(1, Math.floor(ms / 60_000))
  if (m >= 1_440) return `${Math.floor(m / 1_440)}d ${Math.floor((m % 1_440) / 60)}h`
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
  return `${m}m`
}

// One reading of a limit, kept in memory to forecast from.
export type LimitSample = { at: number; pct: number; resetsAt: string | null }

// Whether two readings are of the same window: the same instant, however each session spells it.
export function sameWindow(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  const x = Date.parse(a)
  const y = Date.parse(b)
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a === b
}

// Time to a limit's full, compact; under a minute reads "<1m".
export const fullIn = (ms: number): string => (ms < 60_000 ? '<1m' : resetIn(ms))

// Whether the status line shows the forecast: once under an hour, and kept until it passes 70 minutes.
export const isFullShown = (wasShown: boolean, ms: number | undefined): boolean => ms !== undefined && (ms < 3_600_000 || (wasShown && ms < 70 * 60_000))

// Ms until a limit reaches 100% at the current pace (least-squares slope over the last 30 minutes of
// this window), or null: too little to go on, not rising lately, full already, or not full before the reset.
export function forecastFull(samples: readonly LimitSample[], resetsAt: string | null, now: number): number | null {
  const resets = resetsAt !== null ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(resets)) return null
  const pts = samples.filter(p => sameWindow(p.resetsAt, resetsAt) && p.at <= now && now - p.at <= 30 * 60_000).sort((a, b) => a.at - b.at)
  if (pts.length < 3) return null
  const last = pts[pts.length - 1]
  if (last.at - pts[0].at < 10 * 60_000 || last.pct >= 100) return null
  // Use that stopped has to stop the warning: the latest reading must be above the one 10 minutes before it.
  const before = pts.filter(p => p.at <= last.at - 10 * 60_000).pop()
  if (!before || last.pct <= before.pct) return null
  const n = pts.length
  const mx = pts.reduce((t, p) => t + p.at, 0) / n
  const my = pts.reduce((t, p) => t + p.pct, 0) / n
  const sxx = pts.reduce((t, p) => t + (p.at - mx) ** 2, 0)
  const slope = pts.reduce((t, p) => t + (p.at - mx) * (p.pct - my), 0) / sxx
  if (!(slope > 0)) return null
  const fullAt = last.at + (100 - last.pct) / slope
  if (fullAt >= resets) return null
  return Math.max(0, fullAt - now)
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// A bar of `width` cells for a fraction from 0 to 1.
export function meter(fraction: number, width: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

// The little worker for each kind of work. Every frame of a set has the same width,
// so nothing beside it jitters. ASCII and narrow glyphs only, for every terminal.
export const SPRITES: Readonly<Record<string, readonly string[]>> = {
  thinking: ['(•ω•)    ', '(•ω•) .  ', '(•ω•) .o ', '(•ω•) .oO'],
  reading: ['(•_•)⊃▤  ', '( •_•)⊃▤ ', '(•_• )⊃▤ ', '(•_•)⊃▤  '],
  editing: ['(•ᴗ•)✎   ', '(•ᴗ•) ✎  ', '(•ᴗ•)  ✎ ', '(•ᴗ•) ✎  '],
  running: ['ᕕ(•ᴗ•)ᕗ  ', ' ᕕ(•ᴗ•)ᕗ ', '  ᕕ(•ᴗ•)ᕗ', ' ᕙ(•ᴗ•)ᕗ '],
  searching: ['(•_•)⌕   ', '(•_•) ⌕  ', '(•_•)  ⌕ ', '(•_•) ⌕  '],
  browsing: ['(•ᴗ•)~≈~ ', '(•ᴗ•)≈~≈ ', '(•ᴗ•)~≈~ ', '(•ᴗ•)≈~≈ '],
  delegating: ['(•ᴗ•)/°  ', '(•ᴗ•)/ ° ', '(•ᴗ•)/  °', '(•ᴗ•)/ ° '],
  waiting: ['(°_°) ?  ', '(°_°)  ? ', '(°_°) ?  ', '(°_°)  ! '],
  idle: ['(-_-) z  ', '(-_-) zZ ', '(-_-)  Zz', '(-_-)   z'],
  done: ['(^ᴗ^)✓   ', '(^ᴗ^)✓   ', '(^ᴗ^)✓   ', '(^ᴗ^)✓   '],
  failed: ['(×_×)    ', '(×_×)    ', '(×_×)    ', '(×_×)    '],
  ended: ['(^_^)/~  ', '(^_^)/~  ', '(^_^)/~  ', '(^_^)/~  '],
}

// Which worker a tool calls for.
export function kindOfTool(tool: string): string {
  if (['Read', 'NotebookRead', 'ToolSearch'].includes(tool)) return 'reading'
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite'].includes(tool)) return 'editing'
  if (['Bash', 'PowerShell'].includes(tool)) return 'running'
  if (['Grep', 'Glob'].includes(tool)) return 'searching'
  if (['Agent', 'Task'].includes(tool)) return 'delegating'
  return 'browsing'
}

// Which worker a line of activity calls for: the recorded kind, else read from the words.
export function spriteKind(state: string, now: string, kind?: string): string {
  if (state !== 'working') return state
  if (kind) return kind
  const verb = now.split(' ')[0] ?? ''
  if (/^Reading|^Loading/.test(verb)) return 'reading'
  if (/^Editing|^Writing|^Updating/.test(verb)) return 'editing'
  if (/^Running/.test(verb)) return 'running'
  if (/^Searching|^Finding/.test(verb)) return /web/.test(now) ? 'browsing' : 'searching'
  if (/^Delegating/.test(verb)) return 'delegating'
  if (/^Using/.test(verb)) return 'browsing'
  return 'thinking'
}

export const sprite = (kind: string, frame: number, isStill: boolean): string => {
  const frames = SPRITES[kind] ?? SPRITES.thinking ?? ['']
  return frames[isStill ? 0 : frame % frames.length] ?? ''
}

const STALE_MS = 90_000

// A heartbeat that stopped without saying it ended: the session closed or crashed.
export const isGone = (s: FleetSession, now: number): boolean => s.state !== 'ended' && now - s.updatedAt > STALE_MS

// When the person last prompted; older records without it fall back to the nearest time they kept.
export const promptedAt = (s: FleetSession): number => s.promptAt ?? s.turnStartedAt ?? s.idleSince ?? s.startedAt

// What a run with no screen and nothing to show leaves behind once it has ended or gone quiet (-p, the
// SDK): no surface, no title, no cost and at most a turn. A desktop session restored at app start has
// no surface either, but has a title or a cost, so it stays.
export const isClutter = (s: FleetSession): boolean => s.state === 'ended' && s.surface === '' && !s.title && (s.costUsd ?? 0) === 0 && s.turns <= 1

// How long a waiting session has waited on the person (0 with no start known).
export const waitingFor = (s: FleetSession, now: number): number => (s.state === 'waiting' && s.waitingSince ? Math.max(0, now - s.waitingSince) : 0)

// The wait as "6m", once it is a minute or more; else empty.
export const waitText = (s: FleetSession, now: number): string => (waitingFor(s, now) >= 60_000 ? ago(waitingFor(s, now)) : '')

// Open sessions only (ended and vanished ones show with showEnded), the ones that need the person
// first, longest-waiting first, then the most recently prompted. Working is not ranked above idle:
// rows that reshuffle as sessions start and stop are hard to track.
export function arrange(sessions: readonly FleetSession[], now: number, showEnded: boolean): FleetSession[] {
  return sessions
    .map(s => (isGone(s, now) ? { ...s, state: 'ended' as const, now: 'No heartbeat: closed or stopped' } : s))
    .filter(s => (showEnded || s.state !== 'ended') && !isClutter(s))
    .sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting') || (a.state === 'waiting' && b.state === 'waiting' ? waitingFor(b, now) - waitingFor(a, now) : 0) || promptedAt(b) - promptedAt(a) || b.updatedAt - a.updatedAt)
}

const HOUR_MS = 3_600_000
const FIVE_MIN_MS = 5 * 60_000

// The prompt cache's lifetime. Subscription sessions write it for an hour; API-key sessions,
// and subscriptions past a plan limit (usage overage), get five minutes. Only the plan's own windows
// count: a gateway's spend limit says nothing of the cache. A session with no plan reading of its own
// is judged on the fleet's through withFleetLimits.
export const cacheTtlOf = (s: FleetSession, now = Infinity): number => {
  const plan = s.limits.filter(isPlanLimit)
  return plan.length === 0 || plan.some(l => l.percentUsed >= 100 && !isOver(l, now)) ? FIVE_MIN_MS : HOUR_MS
}

// Whether a plan limit's window has already reset (an old reading kept in an idle session's heartbeat).
const isOver = (l: FleetLimit, now: number): boolean => l.resetsAt !== null && Number.isFinite(Date.parse(l.resetsAt)) && Date.parse(l.resetsAt) <= now

// The plan limits in force, one per kind, from every session's readings: a window that has reset is
// over; of the rest the latest window wins, and within a window the highest reading (usage only
// rises), so the header holds steady whichever session wrote last.
export function currentLimits(sessions: readonly FleetSession[], now: number): FleetLimit[] {
  const best = new Map<string, FleetLimit>()
  const resets = (l: FleetLimit) => (l.resetsAt !== null && Number.isFinite(Date.parse(l.resetsAt)) ? Date.parse(l.resetsAt) : -Infinity)
  for (const s of sessions) {
    for (const l of s.limits) {
      if (isOver(l, now)) continue
      const was = best.get(l.kind)
      if (!was || resets(l) > resets(was) || (resets(l) === resets(was) && l.percentUsed > was.percentUsed)) best.set(l.kind, l)
    }
  }
  const order = (kind: string) => (kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : 2)
  return [...best.values()].sort((a, b) => order(a.kind) - order(b.kind))
}

// How long the main agent's prompt cache has left: null before the first reply, 0 once cold.
export function cacheLeft(s: FleetSession, now: number): { ms: number; ttl: number } | null {
  if (!s.cacheAt) return null
  const ttl = cacheTtlOf(s, now)
  return { ms: Math.max(0, s.cacheAt + ttl - now), ttl }
}

// "52m", "<1m", "cold".
export const cacheText = (left: { ms: number } | null): string =>
  left === null ? '' : left.ms <= 0 ? 'cold' : left.ms < 60_000 ? '<1m' : `${Math.ceil(left.ms / 60_000)}m`

// A reading with the whole fleet's plan limits: an idle session never refreshes its own, and the
// 5-hour window moves with every session's use. A session known to be on a plan (hasPlan) takes the
// fleet's; with no reading anywhere it stays as it is. An API-key session never has a reading of its own,
// and the fleet's must not give it an hour's cache.
export function withFleetLimits(s: FleetSession, all: readonly FleetSession[], now: number): FleetSession {
  if (s.hasPlan !== true) return s
  const limits = currentLimits([s, ...all.filter(x => x.id !== s.id)], now)
  return limits.length > 0 ? { ...s, limits } : s
}

export type FleetSummary = { sessions: number; working: number; waiting: number; agents: number; costUsd: number }

// A subagent marked running but silent this long is lost: its end never arrived (a reload or a crash
// mid-run). One with a tool running is given longer, since a long build is quiet but busy.
export const LOST_AGENT_MS = 20 * 60_000
const LONG_TOOL_MS = 60 * 60_000

// Whether a subagent is still at work, by its own activity: one running in the background works on
// while its session rests between turns.
export function isAgentLive(a: FleetAgent, now: number): boolean {
  if (a.state !== 'working') return false
  if (a.toolAt) return now - a.toolAt < LONG_TOOL_MS
  return now - Math.max(a.lastAt ?? 0, a.startedAt) < LOST_AGENT_MS
}

// A session counts as busy while it works, waits on the person, or has a subagent still at work.
export const isBusy = (s: FleetSession, now: number): boolean => s.state === 'working' || s.state === 'waiting' || s.agents.some(a => isAgentLive(a, now))

// `now` defaults to the newest heartbeat, for callers without a clock.
export function summarize(sessions: readonly FleetSession[], now = Math.max(0, ...sessions.map(s => s.updatedAt))): FleetSummary {
  const live = sessions.filter(s => s.state !== 'ended')
  return {
    sessions: live.length,
    // Working includes a resting session whose subagents are still at it.
    working: live.filter(s => s.state !== 'waiting' && isBusy(s, now)).length,
    waiting: live.filter(s => s.state === 'waiting').length,
    agents: live.reduce((n, s) => n + s.agents.filter(a => isAgentLive(a, now)).length, 0),
    costUsd: live.reduce((n, s) => n + (s.costUsd ?? 0), 0),
  }
}

// A desktop session record's CLI session id and whether the person archived it; null when it isn't
// whole JSON (a file caught mid-write) or has no id.
export function archiveOf(text: string): { cli: string; isArchived: boolean } | null {
  try {
    const value = JSON.parse(text) as { cliSessionId?: unknown; isArchived?: unknown }
    return typeof value.cliSessionId === 'string' ? { cli: value.cliSessionId, isArchived: value.isArchived === true } : null
  } catch {
    return null
  }
}

export function parseSession(text: string): FleetSession | null {
  try {
    const value = JSON.parse(text) as Partial<FleetSession>
    return value.v === 1 && typeof value.id === 'string' ? (value as FleetSession) : null
  } catch {
    return null
  }
}

// A turn's text that the engine wrapped (a background task's notification, a reminder, a command's
// output), not one the person typed. A prompt that merely starts with markup ("<button> is off") is
// the person's.
export const NOT_TYPED = /^\s*<(task-notification|system-reminder|local-command-[\w-]+|command-[\w-]+|bash-[\w-]+|user-prompt-submit-hook|teammate-message|agent-message)\b/i

// Text as a row shows it: a link as its words (a cut one too), no bold marks or backticks, one line.
// An underscore is left alone: __init__ is a name, not emphasis.
export const plain = (text: string): string =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)?/g, '$1')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

// What the session was asked, as a row shows it: nothing for an engine-wrapped turn.
export const taskText = (s: FleetSession): string => (NOT_TYPED.test(s.task) ? '' : plain(s.task))

// "4m", "1h12m": a time with its seconds left off once past a minute.
export const ago = (ms: number): string => (ms < 60_000 ? formatDuration(ms) : formatDuration(Math.floor(ms / 60_000) * 60_000).replace(/00s$/, ''))

export const firstLine = (text: string, max: number): string => cut(text.split('\n').find(line => line.trim() !== '') ?? '', max)

const isScratch = (project: string): boolean => /^scratch-\d{4}-\d{2}-\d{2}-/.test(project)

// What to call a session: its title, else its folder (a desktop scratch folder says nothing),
// else what it was first asked.
export const nameOf = (s: FleetSession): string =>
  s.title || (s.project && !isScratch(s.project) ? s.project : '') || (s.task ? cut(s.task, 48) : '') || 'New session'

export const folderOf = (s: FleetSession): string => (s.project && !isScratch(s.project) && s.project !== nameOf(s) ? s.project : '')

// Done of planned in a task list; null with no list. Deleted tasks do not count.
export function progressOf(tasks: Readonly<Record<string, string>> | undefined): FleetProgress | null {
  const statuses = Object.values(tasks ?? {}).filter(status => status !== 'deleted')
  return statuses.length === 0 ? null : { done: statuses.filter(status => status === 'completed').length, total: statuses.length }
}

export const percentOf = (p: FleetProgress | null | undefined): number | null => (p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null)

// "3/5 · 60%", or nothing without a plan.
export const progressText = (p: FleetProgress | null | undefined): string => {
  const percent = percentOf(p)
  return p && percent !== null ? `${p.done}/${p.total} · ${percent}%` : ''
}

// A task list after one tool call, or the list unchanged when the call was not about tasks.
export function tasksAfter(tasks: Readonly<Record<string, string>> | undefined, tool: string, input: Record<string, unknown>, result: unknown): Record<string, string> | undefined {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    return Object.fromEntries((input.todos as { status?: string }[]).map((todo, i) => [`todo-${i}`, String(todo.status ?? 'pending')]))
  }
  if (tool === 'TaskCreate') {
    const id = (result as { task?: { id?: unknown } } | undefined)?.task?.id
    return id === undefined ? tasks : { ...tasks, [String(id)]: 'pending' }
  }
  if (tool === 'TaskUpdate' && typeof input.taskId === 'string' && typeof input.status === 'string') {
    return { ...tasks, [input.taskId]: input.status }
  }
  return tasks
}

// --- Attention: what has run or gone quiet long enough to look at. ---

export const SLOW_TOOL_MS = 30_000
export const QUIET_AGENT_MS = 2 * 60_000

// How long the current tool call has run, once that is long enough to say so; else 0.
export const slowFor = (toolAt: number | null | undefined, now: number): number => (toolAt && now - toolAt >= SLOW_TOOL_MS ? now - toolAt : 0)

export type Flag = { text: string; level: 'warn' | 'err' }

// A subagent's one flag, the most serious first: cut off at the token limit, a slow tool, gone quiet.
export function agentFlag(a: FleetAgent, now: number): Flag | null {
  if (a.hitMax) return { text: 'hit max tokens', level: 'err' }
  if (a.state !== 'working') return null
  const slow = slowFor(a.toolAt, now)
  if (slow > 0) return { text: `slow ${formatDuration(slow)}`, level: 'warn' }
  if (!a.toolAt && a.lastAt && now - a.lastAt >= QUIET_AGENT_MS) return { text: `quiet ${formatDuration(now - a.lastAt)}`, level: 'warn' }
  return null
}

// Moves only when a flag would appear or its time would change by a step, so a drawing redraws that often.
export const attentionKey = (s: FleetSession, now: number): string =>
  [Math.floor(slowFor(s.toolAt, now) / SLOW_TOOL_MS), ...s.agents.map(a => agentFlag(a, now)?.text.replace(/\d+s$/, '') ?? '')].join(',')

export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

// "4m12s · 12 edits · 2 agents · 1 error · $0.80"; counts of zero are left out.
export function receiptText(r: FleetReceipt | null | undefined): string {
  if (!r) return ''
  const n = (count: number, word: string) => (count > 0 ? `${count} ${word}${count === 1 ? '' : 's'}` : '')
  return [formatDuration(r.ms), n(r.edits, 'edit'), n(r.agents, 'agent'), n(r.errors, 'error'), r.costUsd !== null && r.costUsd >= 0.01 ? `$${r.costUsd.toFixed(2)}` : ''].filter(Boolean).join(' · ')
}

// The permission mode as a few words; the default says nothing.
export function modeName(mode: string | undefined): string {
  const names: Record<string, string> = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: 'bypass permissions', dontAsk: "don't ask" }
  return mode ? (names[mode] ?? '') : ''
}

const LOOP_KEEP_MS = 5 * 60_000

// Loops no agent list names that ran lately: a workflow's agents, and forks.
export const recentLoops = (s: FleetSession, now: number): FleetLoop[] => (s.loops ?? []).filter(l => now - l.lastAt < LOOP_KEEP_MS)

// --- Names: every worker gets one, steady for its id and unique among its session's agents. ---

const NAMES = [
  'Ada', 'Pip', 'Juno', 'Milo', 'Nova', 'Otto', 'Rue', 'Sage', 'Tess', 'Wren', 'Bix', 'Cleo', 'Dot', 'Fig', 'Gus', 'Hazel',
  'Iggy', 'Kit', 'Lumi', 'Moss', 'Nell', 'Olive', 'Pax', 'Quill', 'Rex', 'Sol', 'Tuck', 'Uma', 'Vik', 'Zed', 'Bean', 'Coco',
  'Echo', 'Fern', 'Gizmo', 'Hopper', 'Indy', 'Jinx', 'Kiwi', 'Lark', 'Mabel', 'Nico', 'Orla', 'Pepper', 'Remy', 'Scout',
]

const hashOf = (text: string): number => [...text].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7)

export function pickName(id: string, taken: readonly string[]): string {
  const start = hashOf(id) % NAMES.length
  for (let i = 0; i < NAMES.length; i += 1) {
    const name = NAMES[(start + i) % NAMES.length] ?? 'Ada'
    if (!taken.includes(name)) return name
  }
  return `${NAMES[start] ?? 'Ada'} ${taken.length}`
}

// --- Progress: exact where the work reports it, else a rough guess from how much it has done. ---

// `counts` are the steps done of planned, where a worker reports them.
export type Progress = { fraction: number; isEstimate: boolean; counts?: { done: number; total: number } }

// About how many tool calls each kind of worker makes on a typical task; the guess nears its cap past it.
const PACE: Readonly<Record<string, number>> = { 'haiku-quick': 6, Explore: 10, Plan: 14, 'haiku-worker': 14, 'sonnet-worker': 20, 'opus-worker': 22, 'opus-deep': 26 }
const MAIN_PACE = 24
// A guess never claims to be done: only finishing does.
const GUESS_CAP = 0.92

const guess = (work: number, pace: number): number => Math.min(GUESS_CAP, 1 - Math.exp(-work / pace))

export function agentProgress(a: FleetAgent): Progress | null {
  if (a.state === 'done') return { fraction: 1, isEstimate: false }
  if (a.state === 'failed') return null
  if (a.progress && a.progress.total > 0) return { fraction: a.progress.done / a.progress.total, isEstimate: false, counts: a.progress }
  return { fraction: guess(a.tools + a.steps * 0.5, PACE[a.type] ?? 18), isEstimate: true }
}

// A working session: its task list when it keeps one, else a guess from this turn's tool calls.
export function sessionProgress(s: FleetSession): Progress | null {
  const plan = progressOf(s.tasks)
  if (plan) return { fraction: plan.done / plan.total, isEstimate: false }
  if (s.state !== 'working' && s.state !== 'waiting') return null
  return { fraction: guess(s.toolsThisTurn, MAIN_PACE), isEstimate: true }
}

// "60%", or "~40%" for a guess.
// An exact zero reads as steps ("0/5"): "0%" over an empty bar says nothing.
export const progressLabel = (p: Progress | null): string =>
  p ? (!p.isEstimate && p.counts && p.counts.done === 0 ? `0/${p.counts.total}` : `${p.isEstimate ? '~' : ''}${Math.round(p.fraction * 100)}%`) : ''

// --- Captains: each session's main agent gets a name of its own, unique across the fleet. ---

// Captains' names, kept apart from the subagents' so a main agent is never mistaken for a helper.
const CAPTAINS = [
  'Aria', 'Bram', 'Cass', 'Dax', 'Elio', 'Faye', 'Gale', 'Hugo', 'Iris', 'Jett', 'Kai', 'Luna',
  'Mira', 'Nash', 'Opal', 'Pike', 'Quinn', 'Ravi', 'Skye', 'Theo', 'Vera', 'Wynn', 'Yara', 'Zane',
]

export type Crew = { name: string }

// Oldest session first, so a session keeps its captain's name as others come and go.
export function crewsOf(list: readonly FleetSession[]): Map<string, Crew> {
  const crews = new Map<string, Crew>()
  const names: string[] = []
  for (const s of [...list].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))) {
    const start = hashOf(s.id)
    const name = Array.from({ length: CAPTAINS.length }, (_, i) => CAPTAINS[(start + i) % CAPTAINS.length] ?? 'Aria').find(n => !names.includes(n)) ?? `Aria ${names.length}`
    names.push(name)
    crews.set(s.id, { name })
  }
  return crews
}

// --- Tasks: the general kind of work a worker has taken on, and so the building it works in. ---

export type Task = 'develop' | 'research' | 'review' | 'test' | 'plan' | 'debug'

export const TASK_NAMES: Readonly<Record<Task, string>> = { develop: 'Develop', research: 'Research', review: 'Review', test: 'Test', plan: 'Plan', debug: 'Debug' }

// Agent types whose work is one task whatever they are asked.
const ROLE_TASK: Readonly<Record<string, Task>> = { Explore: 'research', Plan: 'plan', 'claude-code-guide': 'research' }

// Words that say what a job is, the more particular first; anything else is development.
const TASK_WORDS: readonly (readonly [Task, RegExp])[] = [
  ['review', /\b(review|critique|audit|inspect|assess|evaluat|proofread|sign.?off)\w*/i],
  ['debug', /\b(debug|bug|crash|broken|fail|regression|diagnos|stack ?trace|why (is|does|did|isn.t|doesn.t))\w*/i],
  ['plan', /\b(plan|design|architect|spec|outline|roadmap|strateg|scope|break (it )?down|prioriti)\w*/i],
  ['research', /\b(research|investigat|explor|find|look ?up|search|survey|compare|summari[sz]|learn|what is|how (do|does|to))\w*/i],
  ['test', /\b(test|lint|typecheck|benchmark|smoke)\w*/i],
]

// A worker's job from what it was asked (its description, or the person's prompt) and its role.
export function jobOf(ask: string, role?: string): Task {
  const fixed = role ? ROLE_TASK[role] : undefined
  if (fixed) return fixed
  return TASK_WORDS.find(([, words]) => words.test(ask))?.[0] ?? 'develop'
}

// Commands that test or build something.
const TESTISH = /\b(test|tests|build|lint|typecheck|tsc|compile|deploy|check|verify|bench)\w*/i

// What a worker's current step says about its task, or null when it says nothing (a pause between
// tool calls, reading, an ordinary command). A subagent's steps mostly say its job; a main agent
// does everything, so editing and web research speak for themselves. The colony moves a worker only
// on a vote that holds, so one step never sends it off and back.
export function taskVote(job: Task, kind: string, now: string, isMain: boolean): Task | null {
  if (kind === 'waiting' || kind === 'delegating') return 'plan'
  if (kind === 'running' && TESTISH.test(now)) return 'test'
  if (!isMain) return kind === 'thinking' ? null : job
  if (kind === 'editing') return job === 'debug' ? 'debug' : 'develop'
  if (kind === 'browsing') return 'research'
  return null
}

// How a session stands, in words. Narrow, the state column is small and the plan is left to the row's bar.
export const stateLine = (s: FleetSession, now: number, isNarrow = false): string => {
  // Resting between turns while its subagents work on: that is work, and the line says so.
  const live = s.agents.filter(a => isAgentLive(a, now)).length
  if (s.state === 'idle' && live > 0) return isNarrow ? plural(live, 'agent') : `${plural(live, 'agent')} working`
  const plan = isNarrow ? '' : progressText(progressOf(s.tasks)) || progressLabel(sessionProgress(s))
  if (s.state === 'working') return `${s.turnStartedAt !== null ? `working ${ago(now - s.turnStartedAt)}` : 'working'}${plan ? ` · ${plan}` : ''}`
  if (s.state === 'waiting') return ['needs you', waitText(s, now)].filter(Boolean).join(' ')
  if (s.state === 'ended') return 'ended'
  return s.idleSince ? `idle ${ago(now - s.idleSince)}` : 'idle'
}

// A limit's name: "5h" or "5-hour" (long), "7d" or "7-day", else its kind with spaces.
export const limitName = (kind: string, isLong = false): string =>
  kind === 'five_hour' ? (isLong ? '5-hour' : '5h') : kind === 'seven_day' ? (isLong ? '7-day' : '7d') : kind.replace(/_/g, ' ')

// How loud a limit reads: red under an hour to full or at 85%, amber on a forecast or 60%.
export const limitTone = (l: FleetLimit): 'error' | 'warning' | 'inactive' =>
  (l.fullInMs !== undefined && l.fullInMs < 3_600_000) || l.percentUsed >= 85 ? 'error' : l.fullInMs !== undefined || l.percentUsed >= 60 ? 'warning' : 'inactive'
