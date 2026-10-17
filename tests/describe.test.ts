import { expect, test } from 'claude-code/testing'

import type { FleetSession } from '../types'
import { cacheTtlOf, withFleetLimits, plain, taskText, currentLimits, jobOf, taskVote, agentProgress, pickName, progressLabel, sessionProgress, cacheLeft, cacheText, progressOf, progressText, tasksAfter, SPRITES, ZERO, arrange, describeTool, formatDuration, formatTokens, meter, modelName, parseSession, sprite, spriteKind, summarize, forecastFull, sameWindow, isFullShown, fullIn, DORMANT_MS } from '../hooks/describe'

test('a tool call reads as a few words about what it does', async () => {
  expect(describeTool('Edit', { file_path: 'C:\\x\\hooks\\register.tsx' })).toBe('Editing register.tsx')
  expect(describeTool('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Run the tests')
  expect(describeTool('PowerShell', { command: 'claude plugin list' })).toBe('Running claude plugin list')
  expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Searching for TODO')
  expect(describeTool('WebFetch', { url: 'https://builtbyting.ca/pricing' })).toBe('Reading builtbyting.ca')
  expect(describeTool('Agent', { description: 'Review the demo' })).toBe('Delegating: Review the demo')
  expect(describeTool('mcp__skins__design', {})).toBe('Using skins design')
  expect(describeTool('mcp__c74ccbeb-4b9f-464a-8668-9fc74a400d63__stripe_api_read', {})).toBe('Using connector stripe api read')
  expect(describeTool('Mystery', {})).toBe('Using Mystery')
})

test('names, numbers and plain text read short', async () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-5-5-20260901')).toBe('Haiku 5.5')
  expect(modelName('sonnet')).toBe('sonnet')
  expect(modelName('')).toBe('?')
  {
    expect(formatTokens(1_234_567)).toBe('1.2M')
    expect(formatTokens(84_200)).toBe('84k')
    expect(formatDuration(72_000)).toBe('1m12s')
    expect(meter(0.5, 8)).toBe('▰▰▰▰▱▱▱▱')
    expect(parseSession('{"v":1,"id":"a"}')?.id).toBe('a')
    expect(parseSession('{"v":2,"id":"a"}')).toBeNull()
    expect(parseSession('nope')).toBeNull()
  }
  {
    expect([999, 1_500, 999_499, 999_500, 999_999, 1_000_000, 9_949_999, 9_960_000, 10_000_000].map(formatTokens)).toEqual(['999', '2k', '999k', '1.0M', '1.0M', '1.0M', '9.9M', '10M', '10M'])
  }
  {
    expect(plain('Done: [PR #16](https://github.com/x/y/pull/16) is **ready**, see `a.ts`\n  now')).toBe('Done: PR #16 is ready, see a.ts now')
    // A link cut short by the row's own limit still reads as its words.
    expect(plain('Gale: [PR #16](https://github.com/x/y/pu')).toBe('Gale: PR #16')
    // A name with underscores is not emphasis.
    expect(plain('Fix __init__ and **bold** text')).toBe('Fix __init__ and bold text')
    expect(taskText(session({ task: '<task-notification><task-id>x</task-id>' }))).toBe('')
    expect(taskText(session({ task: '<button> is off, fix [it](http://a)' }))).toBe('<button> is off, fix it')
  }
})

test('the worker is as wide in every frame and matches the work', async () => {
  const widths = Object.values(SPRITES).flatMap(frames => frames.map(f => [...f].length))
  expect(new Set(widths).size).toBe(1)
  expect(sprite('running', 1, false)).not.toBe(sprite('running', 0, false))
  expect(sprite('running', 1, true)).toBe(sprite('running', 0, false))
  {
    expect(spriteKind('working', 'Editing a.ts')).toBe('editing')
    expect(spriteKind('working', 'Running npm test')).toBe('running')
    expect(spriteKind('working', 'Searching the web: x')).toBe('browsing')
    expect(spriteKind('working', 'Thinking…')).toBe('thinking')
    expect(spriteKind('waiting', 'Needs your OK')).toBe('waiting')
    expect(spriteKind('idle', '')).toBe('idle')
  }
})

const session = (over: Partial<FleetSession>): FleetSession => ({
  v: 1, id: 'x', project: 'p', cwd: '', surface: 'desktop', model: 'claude-opus-5-5', effort: null, state: 'idle', task: '', now: '', last: '',
  turnStartedAt: null, turns: 0, toolsThisTurn: 0, toolsTotal: 0, contextTokens: 0, contextWindow: 0, contextPercent: null, costUsd: null,
  tokens: ZERO, limits: [], agents: [], startedAt: 0, updatedAt: 1_000_000, ...over,
})

test('sessions list by their latest prompt; ended, silent and empty ones are hidden', async () => {
  const now = 1_000_000
  const all = [
    session({ id: 'idle', state: 'idle', promptAt: now - 30_000 }),
    session({ id: 'work', state: 'working', promptAt: now - 90_000 }),
    session({ id: 'wait', state: 'waiting', promptAt: now - 60_000, waitingSince: now - 120_000 }),
    session({ id: 'waitlong', state: 'waiting', promptAt: now - 80_000, waitingSince: now - 300_000 }),
    // An older record with no prompt time falls back to when its turn started.
    session({ id: 'legacy', state: 'working', turnStartedAt: now - 10_000 }),
    session({ id: 'quiet', state: 'working', promptAt: now - 5_000, updatedAt: now - 120_000 }),
    session({ id: 'old', state: 'ended', promptAt: now - 1_000 }),
  ]
  // Those waiting on the person lead, the longest wait first; working is not ranked above idle.
  expect(arrange(all, now, false).map(s => s.id)).toEqual(['waitlong', 'wait', 'legacy', 'idle', 'work'])
  const shown = arrange(all, now, true)
  expect(shown.map(s => s.id)).toEqual(['waitlong', 'wait', 'old', 'quiet', 'legacy', 'idle', 'work'])
  expect(shown.find(s => s.id === 'quiet')?.state).toBe('ended')
  {
    const gone = { state: 'ended' as const, surface: '', turns: 1, costUsd: 0 }
    const list = [session({ id: 'junk', ...gone }), session({ id: 'titled', ...gone, title: 'Capture One' }), session({ id: 'paid', ...gone, costUsd: 3 }), session({ id: 'live', state: 'working', surface: '' })]
    expect(arrange(list, 1_000_000, true).map(s => s.id).sort()).toEqual(['live', 'paid', 'titled'])
    // Gone quiet counts as ended.
    expect(arrange([session({ id: 'stale', surface: '', turns: 0, updatedAt: 0 })], 1_000_000, true)).toEqual([])
  }
})

test('the plan limits in force, the cache lifetime they give, and the fleet fill-in', async () => {
  const now = 10_000_000
  const plan = [{ kind: 'five_hour', percentUsed: 40, resetsAt: null }]
  expect(cacheLeft(session({}), now)).toBeNull()
  expect(cacheText(cacheLeft(session({ cacheAt: now - 8 * 60_000, limits: plan }), now))).toBe('52m')
  expect(cacheText(cacheLeft(session({ cacheAt: now - 30_000, limits: [] }), now))).toBe('5m')
  expect(cacheText(cacheLeft(session({ cacheAt: now - 30_000, limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: null }] }), now))).toBe('5m')
  expect(cacheText(cacheLeft(session({ cacheAt: now - 3_570_000, limits: plan }), now))).toBe('<1m')
  expect(cacheText(cacheLeft(session({ cacheAt: now - 2 * 3_600_000, limits: plan }), now))).toBe('cold')
  {
    const plan = { kind: 'five_hour', percentUsed: 10, resetsAt: null }
    const spend = { kind: 'spend_limit', percentUsed: 10, resetsAt: null }
    expect(cacheTtlOf(cachedSession({ limits: [spend] }), 0)).toBe(5 * 60_000)
    expect(cacheTtlOf(cachedSession({ limits: [plan, spend] }), 0)).toBe(60 * 60_000)
    expect(cacheTtlOf(cachedSession({ limits: [plan, { ...spend, percentUsed: 100 }] }), 0)).toBe(60 * 60_000)
    expect(cacheTtlOf(cachedSession({ limits: [{ ...plan, percentUsed: 100 }] }), 0)).toBe(5 * 60_000)
  }
  {
    const plan = { kind: 'five_hour', percentUsed: 10, resetsAt: null }
    const empty = cachedSession({ id: 'e-1', limits: [], hasPlan: true })
    const other = cachedSession({ id: 'o-2', limits: [plan] })
    expect(withFleetLimits(empty, [empty, other], 0).limits).toEqual([plan])
    expect(cacheTtlOf(withFleetLimits(empty, [empty, other], 0), 0)).toBe(60 * 60_000)
    expect(withFleetLimits(empty, [empty, cachedSession({ id: 'p-3', limits: [] })], 0).limits).toEqual([])
    expect(cacheTtlOf(withFleetLimits(empty, [empty], 0), 0)).toBe(5 * 60_000)
    // An API-key session (never a plan reading) stays on a 5-minute cache beside a plan session.
    const apiKey = cachedSession({ id: 'k-4', limits: [] })
    expect(withFleetLimits(apiKey, [apiKey, other], 0).limits).toEqual([])
    expect(cacheTtlOf(withFleetLimits(apiKey, [apiKey, other], 0), 0)).toBe(5 * 60_000)
  }
  {
    const now = 10 * 3_600_000
    const at = (ms: number) => new Date(ms).toISOString()
    const s = (id: string, limits: { kind: string; percentUsed: number; resetsAt: string | null }[]) => ({ id, limits }) as unknown as FleetSession
    const limits = currentLimits([s('old', [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(now - 3_600_000) }]), s('a', [{ kind: 'five_hour', percentUsed: 4, resetsAt: at(now + 4 * 3_600_000) }, { kind: 'seven_day', percentUsed: 37, resetsAt: at(now + 86_400_000) }]), s('b', [{ kind: 'seven_day', percentUsed: 49, resetsAt: at(now + 86_400_000) }])], now)
    expect(limits.map(l => `${l.kind}:${l.percentUsed}`)).toEqual(['five_hour:4', 'seven_day:49'])
  }
})

test('the summary counts live sessions, working agents and cost; a resting session with working subagents counts as working, a long-silent one is lost', async () => {
  const sum = summarize([
    session({ state: 'working', costUsd: 1.5, agents: [{ id: 'a', type: 't', description: '', model: '', state: 'working', now: '', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 0, tools: 0 }] }),
    session({ state: 'waiting', costUsd: 0.5 }),
    session({ state: 'ended', costUsd: 2 }),
  ])
  expect(sum).toEqual({ sessions: 2, working: 1, waiting: 1, agents: 1, costUsd: 2 })
  {
    const agent = { id: 'a', type: 't', description: '', model: '', state: 'working' as const, now: '', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 0, tools: 0, lastAt: 1_000_000 }
    const idle = session({ id: 'i', state: 'idle', agents: [agent] })
    const sum = summarize([idle, session({ id: 'q', state: 'idle' }), session({ id: 'w', state: 'waiting', agents: [{ ...agent, id: 'b' }] }), session({ id: 'e', state: 'ended', costUsd: 9 })], 1_000_000)
    expect(sum).toMatchObject({ sessions: 3, working: 1, waiting: 1, agents: 2, costUsd: 0 })
  }
  {
    const now = 100_000_000
    const base = { v: 1, project: 'p', cwd: '', surface: 'desktop', model: 'claude-opus-5-5', effort: null, task: '', now: 'Waiting', last: '', turnStartedAt: null, idleSince: now - 60_000, turns: 1, toolsThisTurn: 0, toolsTotal: 0, contextTokens: 0, contextWindow: 1, contextPercent: 0, costUsd: 0, tokens: ZERO, limits: [], startedAt: 0, updatedAt: now }
    const agent = (id: string, lastAt: number) => ({ id, type: 'sonnet-worker', description: 'd', model: 'm', state: 'working' as const, now: 'x', startedAt: lastAt, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1, lastAt })
    const s = { ...base, id: 'a', state: 'idle' as const, agents: [agent('live', now - 30_000), agent('lost', now - 3 * 3_600_000)] } as FleetSession
    expect(summarize([s], now).agents).toBe(1)
  }
})

test('progress comes from a task list or a report, else a guess that never claims done', async () => {
  const tasks = tasksAfter(undefined, 'TodoWrite', { todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] }, undefined)
  expect(progressOf(tasks)).toEqual({ done: 1, total: 3 })
  expect(progressText(progressOf(tasks))).toBe('1/3 · 33%')
  expect(progressOf({ a: 'deleted' })).toBeNull()
  expect(progressText(null)).toBe('')
  expect(tasksAfter({ a: 'pending' }, 'Read', {}, undefined)).toEqual({ a: 'pending' })
  {
    const agent = { id: 'a', type: 'sonnet-worker', description: '', model: '', state: 'working' as const, now: '', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 0, tools: 0 }
    expect(progressLabel(agentProgress({ ...agent, progress: { done: 3, total: 4 } }))).toBe('75%')
    const early = agentProgress({ ...agent, tools: 2 })
    const late = agentProgress({ ...agent, tools: 200 })
    expect(early?.isEstimate).toBe(true)
    expect((early?.fraction ?? 1) < (late?.fraction ?? 0)).toBe(true)
    expect(late?.fraction).toBe(0.92)
    expect(progressLabel(late)).toBe('~92%')
    expect(agentProgress({ ...agent, state: 'done' })?.fraction).toBe(1)
    expect(sessionProgress(session({ state: 'idle' }))).toBeNull()
    expect(progressLabel(sessionProgress(session({ state: 'working', tasks: { a: 'completed', b: 'pending' } })))).toBe('50%')
  }
  {
    const agent = { id: 'a', type: 'sonnet-worker', description: '', model: '', state: 'working' as const, now: '', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 0, tools: 0 }
    expect(progressLabel(agentProgress({ ...agent, progress: { done: 0, total: 5 } }))).toBe('0/5')
    expect(progressLabel(agentProgress({ ...agent, progress: { done: 2, total: 5 } }))).toBe('40%')
    // With no total there is nothing exact to show: it falls back to the guess.
    expect(agentProgress({ ...agent, progress: { done: 0, total: 0 } })?.isEstimate).toBe(true)
  }
})

test('a worker keeps its name, and no two in a session share one', async () => {
  expect(pickName('agent-1', [])).toBe(pickName('agent-1', []))
  const first = pickName('agent-1', [])
  expect(pickName('agent-1', [first])).not.toBe(first)
})

test('a worker takes on a task from what it was asked, and a step votes for one', async () => {
  expect(jobOf('Review the VOLTECHS demo')).toBe('review')
  expect(jobOf('Implement the terminal layout')).toBe('develop')
  expect(jobOf('Find transcript title rows')).toBe('research')
  expect(jobOf('Why does the form fail on submit?')).toBe('debug')
  expect(jobOf('Design the schema for bookings')).toBe('plan')
  expect(jobOf('Fix the header', 'Explore')).toBe('research')
  expect(jobOf('anything', 'Plan')).toBe('plan')
  {
    expect(taskVote('review', 'editing', 'Editing a.ts', false)).toBe('review')
    expect(taskVote('review', 'thinking', 'Thinking…', false)).toBeNull()
    expect(taskVote('review', 'running', 'Run the tests', false)).toBe('test')
    expect(taskVote('develop', 'waiting', 'Needs your OK', true)).toBe('plan')
    expect(taskVote('research', 'editing', 'Editing a.ts', true)).toBe('develop')
    expect(taskVote('develop', 'browsing', 'Reading docs', true)).toBe('research')
    // An ordinary command, or a pause between tool calls, moves no one.
    expect(taskVote('develop', 'running', 'Running git status', true)).toBeNull()
    expect(taskVote('debug', 'thinking', 'Thinking…', true)).toBeNull()
  }
})

const cachedSession = (over: Partial<FleetSession> = {}): FleetSession =>
  ({ id: 'c-1', title: 'Cached', state: 'idle', limits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: null }], cacheAt: 1_000_000, model: 'claude-opus-5-5', contextTokens: 0, ...over }) as FleetSession

// Readings once a minute, from `from` rising by `rate` a minute, `minutes` long, ending at `now`.
const climb = (now: number, from: number, rate: number, minutes: number, resetsAt: string | null) =>
  Array.from({ length: minutes + 1 }, (_, i) => ({ at: now - (minutes - i) * 60_000, pct: from + rate * i, resetsAt }))

test('forecastFull: the time to 100% at the current pace, and nothing without a real pace to go on', async () => {
  const now = 10_000_000
  const resets = new Date(now + 2 * 3_600_000).toISOString()
  // 26% rising 2% a minute to 50% over 12 minutes: 25 more minutes to go.
  const rising = climb(now, 26, 2, 12, resets)
  expect(Math.round(forecastFull(rising, resets, now)! / 60_000)).toBe(25)
  // Flat, or falling, has no pace to fear.
  expect(forecastFull(climb(now, 50, 0, 12, resets), resets, now)).toBeNull()
  expect(forecastFull(climb(now, 50, -1, 12, resets), resets, now)).toBeNull()
  {
    const now = 10_000_000
    const resets = new Date(now + 2 * 3_600_000).toISOString()
    // Too few readings.
    expect(forecastFull([climb(now, 26, 6, 12, resets)[0], climb(now, 26, 6, 12, resets)[12]], resets, now)).toBeNull()
    // Under 10 minutes between the first and the last.
    expect(forecastFull(climb(now, 40, 2, 9, resets), resets, now)).toBeNull()
    // Already full.
    expect(forecastFull(climb(now, 90, 1, 12, resets), resets, now)).toBeNull()
    // No known reset.
    expect(forecastFull(climb(now, 26, 2, 12, null), null, now)).toBeNull()
  }
  {
    const now = 10_000_000
    const soon = new Date(now + 10 * 60_000).toISOString()
    const late = new Date(now + 2 * 3_600_000).toISOString()
    // 25 minutes to full, but the window resets in 10.
    expect(forecastFull(climb(now, 26, 2, 12, soon), soon, now)).toBeNull()
    // Readings from an earlier window are ignored.
    const old = climb(now - 30_000, 10, 2, 12, new Date(now - 3_600_000).toISOString())
    expect(forecastFull([...old, ...climb(now, 40, 2, 2, late)], late, now)).toBeNull()
    // Readings older than 30 minutes are ignored.
    expect(forecastFull(climb(now - 31 * 60_000, 26, 2, 12, late), late, now)).toBeNull()
  }
  {
    const now = 10_000_000
    const resets = new Date(now + 3 * 3_600_000).toISOString()
    // 20 minutes of 2%/min, then 15 minutes flat.
    const samples = [...climb(now - 15 * 60_000, 10, 2, 20, resets), ...climb(now, 50, 0, 15, resets).slice(1)]
    expect(forecastFull(samples, resets, now)).toBeNull()
    // The same climb, still going, warns.
    expect(forecastFull(climb(now, 10, 2, 20, resets), resets, now)).not.toBeNull()
  }
  {
    const now = 10_000_000
    const a = new Date(now + 2 * 3_600_000).toISOString()
    const b = a.replace('.000Z', 'Z')
    expect(sameWindow(a, b)).toBe(true)
    expect(sameWindow(a, null)).toBe(false)
    const mixed = climb(now, 26, 2, 12, a).map((p, i) => (i % 2 ? { ...p, resetsAt: b } : p))
    expect(forecastFull(mixed, a, now)).not.toBeNull()
  }
})

test('the status line shows the forecast under an hour, keeps it until 70 minutes, and reads "<1m" under a minute', async () => {
  const m = 60_000
  expect(isFullShown(false, 59 * m)).toBe(true)
  expect(isFullShown(false, 65 * m)).toBe(false)
  expect(isFullShown(true, 65 * m)).toBe(true)
  expect(isFullShown(true, 71 * m)).toBe(false)
  expect(isFullShown(true, undefined)).toBe(false)
  {
    expect(fullIn(20_000)).toBe('<1m')
    expect(fullIn(40 * 60_000)).toBe('40m')
  }
})


test('a session idle over 12 hours is put away with the ended ones, unless it is the one looking or still has work', async () => {
  const now = 100 * 3_600_000
  const agent = { id: 'a', type: 'Explore', description: '', model: '', state: 'working' as const, now: '', startedAt: now - 1_000, endedAt: null, lastAt: now - 1_000, tokens: ZERO, contextTokens: 0, contextWindow: 0, steps: 0, tools: 0 }
  const all = [
    session({ id: 'fresh', state: 'idle', idleSince: now - DORMANT_MS + 60_000, updatedAt: now }),
    session({ id: 'old', state: 'idle', idleSince: now - DORMANT_MS - 60_000, updatedAt: now }),
    session({ id: 'me', state: 'idle', idleSince: now - 2 * DORMANT_MS, updatedAt: now }),
    // No idleSince: judged by its last prompt.
    session({ id: 'legacy', state: 'idle', promptAt: now - 2 * DORMANT_MS, updatedAt: now }),
    // Resting, but a background subagent still works.
    session({ id: 'busy', state: 'idle', idleSince: now - 2 * DORMANT_MS, updatedAt: now, agents: [agent] }),
  ]
  expect(DORMANT_MS).toBe(12 * 3_600_000)
  expect(arrange(all, now, false, 'me').map(s => s.id).sort()).toEqual(['busy', 'fresh', 'me'])
  expect(arrange(all, now, false).map(s => s.id).sort()).toEqual(['busy', 'fresh'])
  expect(arrange(all, now, true).map(s => s.id).sort()).toEqual(['busy', 'fresh', 'legacy', 'me', 'old'])
})
