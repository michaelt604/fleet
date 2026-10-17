import { expect, test } from 'claude-code/testing'

import type { FleetSession } from '../types'
import { ZERO, resetIn, summarize } from '../hooks/describe'
import { fittingCards } from '../hooks/draw'
import { hasAgentRows, bandLayout, bandSvg, dashboardSvg, headerSvg, measure } from '../hooks/svg'

const now = 1_000_000

const session = (over: Partial<FleetSession>): FleetSession => ({
  v: 1, id: 'x', project: 'p', cwd: '', surface: 'desktop', model: 'claude-opus-5-5', effort: null, state: 'working', task: '', now: 'Editing a.ts', last: '',
  turnStartedAt: now - 180_000, turns: 0, toolsThisTurn: 0, toolsTotal: 0, contextTokens: 0, contextWindow: 0, contextPercent: null, costUsd: null,
  tokens: ZERO, limits: [], agents: [], startedAt: 0, updatedAt: now, ...over,
})

// The row title's text in a drawing: the bold 13.5px line at the row's left.
const titleOf = (source: string): string => /font-size="13.5" font-weight="600"[^>]*>([^<]*)</.exec(source)?.[1] ?? ''

test('a narrow panel keeps a long title readable: short state words, "here", a capped state column', async () => {
  const mine = session({ id: 'me', title: 'Rework the enquiry form validation', tasks: { a: 'completed', b: 'pending', c: 'pending' } })
  const input = { list: [mine], sum: summarize([mine], now), limits: [], mineId: 'me', now, isCompact: false }
  const narrow = dashboardSvg(input, 360).source
  // More than one word of a 34-character title survives (it used to get 58 pixels: one word).
  expect(titleOf(narrow).split(' ').length >= 3).toBe(true)
  expect(narrow).toContain('>working 3m<')
  expect(narrow).not.toContain('1/3')
  expect(narrow).toContain('>  here<')
  expect(narrow).not.toContain('this session')
  // A wide drawing keeps the progress and the long words.
  const wide = dashboardSvg(input, 900).source
  expect(wide).toContain('this session')
  expect(wide).toContain('1/3 · 33%')
  // Idle and waiting keep their words.
  const idle = dashboardSvg({ ...input, list: [session({ id: 'z', state: 'idle', idleSince: now - 1_200_000 })] }, 360).source
  expect(idle).toContain('idle 20m')
  expect(dashboardSvg({ ...input, list: [session({ id: 'w', state: 'waiting' })] }, 360).source).toContain('>needs you<')
  // A minute or more of waiting is told.
  expect(dashboardSvg({ ...input, list: [session({ id: 'w', state: 'waiting', waitingSince: now - 360_000 })] }, 360).source).toContain('>needs you 6m<')
})

test('the header names each limit with its time left, the forecast in red or amber over it, and calls the cost API value on a plan', async () => {
  const sum = summarize([session({ costUsd: 34 })], now)
  const plan = [
    { kind: 'five_hour', percentUsed: 37, resetsAt: new Date(now + 72 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: null },
  ]
  const withPlan = headerSvg(sum, plan, 800, now).parts.join('')
  expect(withPlan).toContain('>5h · 1h12m<')
  expect(withPlan).toContain('>7d<')
  expect(withPlan).toContain('API value')
  expect(withPlan).not.toContain('spent')
  const withKey = headerSvg(sum, [], 800, now).parts.join('')
  expect(withKey).toContain('spent')
  expect(withKey).not.toContain('API value')
  {
    const now = 1_000_000
    const sum = summarize([session({ costUsd: 34 })], now)
    const resetsAt = new Date(now + 72 * 60_000).toISOString()
    const plain = headerSvg(sum, [{ kind: 'five_hour', percentUsed: 72, resetsAt }], 800, now).parts.join('')
    expect(plain).toContain('>5h · 1h12m<')
    expect(plain).not.toContain('full ~')
    const forecast = headerSvg(sum, [{ kind: 'five_hour', percentUsed: 72, resetsAt, fullInMs: 40 * 60_000 }], 800, now).parts.join('')
    expect(forecast).toContain('class="err-t">5h · full ~40m<')
    expect(forecast).not.toContain('1h12m')
  }
  {
    const now = 1_000_000
    const sum = summarize([session({ costUsd: 34 })], now)
    const resetsAt = new Date(now + 5 * 3_600_000).toISOString()
    const head = (fullInMs: number) => headerSvg(sum, [{ kind: 'five_hour', percentUsed: 40, resetsAt, fullInMs }], 800, now).parts.join('')
    expect(head(40 * 60_000)).toContain('class="err-t">5h · full ~40m<')
    expect(head(90 * 60_000)).toContain('class="wait-t">5h · full ~1h30m<')
    expect(head(20_000)).toContain('5h · full ~&lt;1m<')
  }
})

test('reset times read compactly, the rings never run into the title, and each ring has two notches', async () => {
  expect(resetIn(165.6 * 3_600_000)).toBe('6d 21h')
  expect(resetIn(72 * 60_000)).toBe('1h12m')
  expect(resetIn(12 * 60_000)).toBe('12m')
  const sum = summarize([session({ costUsd: 3 })], now)
  const limits = [
    { kind: 'five_hour', percentUsed: 37, resetsAt: new Date(now + 72 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(now + 165.6 * 3_600_000).toISOString() },
    { kind: 'spend_limit', percentUsed: 50, resetsAt: new Date(now + 20 * 86_400_000).toISOString() },
  ]
  // Wide: every ring keeps its reset time.
  expect(headerSvg(sum, limits, 900, now).parts.join('')).toContain('7d · 6d 21h')
  // Narrow: the first ring's left edge (its circle's centre less 11) stays clear of "Fleet".
  for (const width of [360, 420]) {
    const parts = headerSvg(sum, limits, width, now).parts.join('')
    const lefts = [...parts.matchAll(/<circle cx="([\d.-]+)" cy="29" r="9" fill="none" stroke="var\(--fg\)" stroke-opacity="\.12"/g)].map(m => Number(m[1]) - 11)
    expect(lefts.length).toBe(3)
    expect(Math.min(...lefts) >= 70).toBe(true)
  }
  // A gateway's spend limit alone is real money; a plan window makes the cost an API value.
  expect(headerSvg(sum, limits.slice(2), 800, now).parts.join('')).toContain('spent')
  expect(headerSvg(sum, limits.slice(0, 1), 800, now).parts.join('')).toContain('API value')
  // Each ring has two notches, at 60% and 85%.
  expect(headerSvg(sum, limits.slice(0, 1), 800, now).parts.join('').match(/stroke-opacity="\.35" stroke-width="1" stroke-linecap="round"/g)?.length).toBe(2)
})

const PLAN_LIMIT = [{ kind: 'five_hour', percentUsed: 10, resetsAt: null }]
const idleRow = (over: Partial<FleetSession>): FleetSession => session({ id: 'w', state: 'idle', idleSince: now, limits: PLAN_LIMIT, cacheAt: now - 30 * 60_000, ...over })
const draw = (s: FleetSession, at: number, width: number) => dashboardSvg({ list: [s], sum: summarize([s], at), limits: [], mineId: undefined, now: at, isCompact: false }, width).source

test('each part of the dashboard draws on its own, and a row with subagents splits into its own lines', async () => {
  const list = [idleRow({ id: 'p', title: 'First' }), idleRow({ id: 'q', title: 'Second', task: 'Fix', last: 'Done' })]
  const input = { list, sum: summarize(list, now), limits: [], mineId: undefined, now, isCompact: false }
  for (const width of [360, 420, 1000]) {
    const whole = dashboardSvg(input, width)
    const head = dashboardSvg({ ...input, part: 'header' }, width)
    const rows = [0, 1].map(i => dashboardSvg({ ...input, part: i }, width))
    expect(head.source).toContain('>Fleet<')
    expect(head.source).not.toContain('First')
    expect(rows[0]?.source).toContain('First')
    expect(rows[0]?.source).not.toContain('Second')
    expect(rows[1]?.source).toContain('Second')
    // Header, rows and the closing margin make the whole, to the pixel.
    expect(head.height + (rows[0]?.height ?? 0) + (rows[1]?.height ?? 0) + 10).toBe(whole.height)
    // Rows start at their own top, and none carries a divider.
    expect(rows[0]?.source).toMatch(/<g class="role" transform="translate\(20 12\)/)
  }
  {
    const s = session({ id: 's', title: 'Split me', state: 'working', agents: [agentOf(), agentOf({ id: 'a2', name: 'Gizmo' })], updatedAt: now })
    for (const width of [360, 1000]) {
      const input = { list: [s], sum: summarize([s], now), limits: [], mineId: undefined, now, isCompact: false }
      const whole = dashboardSvg({ ...input, part: 0 }, width)
      const main = dashboardSvg({ ...input, part: { main: 0 } }, width)
      const agents = dashboardSvg({ ...input, part: { agents: 0 } }, width)
      expect(hasAgentRows(s, now)).toBe(true)
      expect(main.source).toContain('Split me')
      expect(main.source).not.toContain('Pepper')
      expect(agents.source).toContain('Pepper')
      expect(agents.source).toContain('Gizmo')
      expect(agents.source).not.toContain('Split me')
      // The agents' rail starts at the top of its own picture, so it continues the row's own lines.
      expect(agents.source).toContain('M66 2V')
      expect(main.height).toBeLessThan(whole.height)
      expect(main.height + agents.height - whole.height).toBe(6)
    }
    // A row without agents is one picture, as before.
    expect(hasAgentRows(session({ id: 'n', state: 'idle' }), now)).toBe(false)
  }
})

const agentOf = (over: Record<string, unknown> = {}) => ({ id: 'a1', name: 'Pepper', type: 'opus-worker', description: 'Do it', model: 'claude-opus-5-5', state: 'working' as const, now: 'Editing a.ts', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1, lastAt: now, ...over })

test('a row reads by its width: resting sessions with working subagents, no empty prompt line, and no role words when narrow', async () => {
  const s = session({ id: 'r', state: 'idle', idleSince: now - 25_000, last: 'Done', agents: [agentOf(), agentOf({ id: 'a2', name: 'Gizmo' })] })
  expect(draw(s, now, 900)).toContain('>2 agents working<')
  expect(draw(s, now, 360)).toContain('>2 agents<')
  expect(bandSvg([s, session({ id: 'z', state: 'working' })], undefined, 500, now).source).toContain('2 agents working')
  {
    const fresh = session({ id: 'f', state: 'idle', now: 'Waiting for a prompt', idleSince: now })
    const asked = session({ id: 'g', state: 'idle', task: 'Fix the form', last: 'Done', idleSince: now })
    for (const width of [360, 900]) {
      const bare = dashboardSvg({ list: [fresh], sum: summarize([fresh], now), limits: [], mineId: undefined, now, isCompact: false }, width)
      const full = dashboardSvg({ list: [asked], sum: summarize([asked], now), limits: [], mineId: undefined, now, isCompact: false }, width)
      expect(bare.source).toContain('>No prompt yet<')
      expect(bare.source).not.toContain('Waiting for a prompt')
      expect(bare.height).toBeLessThan(full.height)
    }
  }
  {
    const s = session({ id: 'p', state: 'working', agents: [agentOf({ progress: { done: 0, total: 4 } })] })
    const narrow = draw(s, now, 360)
    expect(narrow).not.toContain('>opus-worker<')
    expect(narrow).toContain('>0/4<')
    expect(draw(s, now, 900)).toContain('opus-worker · Do it')
  }
})

test('the band keeps a session that needs you in a chip, and a folded pill counts the rest', async () => {
  const list = [
    session({ id: 'a', title: 'Needs the person', state: 'waiting', now: 'Needs your OK: Running npm test' }),
    session({ id: 'b', title: 'Busy one', state: 'working' }),
    session({ id: 'c', title: 'Busy two', state: 'working' }),
    ...[1, 2, 3, 4, 5].map(i => session({ id: `i${i}`, state: 'idle' })),
  ]
  for (const width of [270, 330]) {
    const source = bandSvg(list, undefined, width, now).source
    expect(source).toContain('Needs the person')
    expect(source).toContain('Needs your OK')
    expect(source).not.toContain('>1 needs you')
  }
  // More waiting than there is room for: the folded ones are counted first, in the wait colour.
  const many = [1, 2, 3, 4].map(i => session({ id: `w${i}`, title: `Waiting ${i}`, state: 'waiting' }))
  const layout = bandLayout(4, 0, 270, 4)
  expect(layout.chips).toBe(1)
  expect(layout.pillWait).toBe('3 need you')
  expect(bandSvg(many, undefined, 270, now).source).toContain('<tspan class="wait-t">3 need you</tspan>')
  {
    const layout = bandLayout(3, 5, 270, 1)
    expect(layout.isTight).toBe(true)
    expect(layout.chips).toBe(1)
    expect(layout.pillText).toBe('+7 more')
  }
})

test('the header counts drop the cost, then the agents, rather than run off the card', async () => {
  const sessions = Array.from({ length: 8 }, (_, i) => session({ id: `s${i}`, state: 'working', costUsd: 30, agents: [agentOf({ id: `x${i}` })] }))
  const sum = { ...summarize(sessions, now), costUsd: 241.42, agents: 5, waiting: 2 }
  for (const width of [360, 420, 900]) {
    const parts = headerSvg(sum, [{ kind: 'five_hour', percentUsed: 37, resetsAt: null }], width, now).parts.join('')
    const line = /<text x="20" y="(?:45|67)" font-size="12" class="muted">(.*?)<\/text>/.exec(parts)?.[1] ?? ''
    const flat = line.replace(/<[^>]+>/g, '')
    expect(measure(flat, 12) <= width - 40).toBe(true)
    expect(flat).toContain('8 sessions')
    if (width === 360) expect(flat).not.toContain('API value')
    if (width === 900) expect(flat).toContain('API value')
  }
})

// A board of `count` sessions, each with `agents` subagents (and long words, to make big pictures).
const boardOf = (count: number, agents: number, over: Partial<FleetSession> = {}) => {
  const list = Array.from({ length: count }, (_, i) => session({ id: `big-${i}`, title: `Session ${i} `.repeat(3), state: 'working', agents: Array.from({ length: agents }, (_, n) => agentOf({ id: `a${i}-${n}`, name: `Agent ${n}`, description: 'Implement a long described piece of the work '.repeat(3), now: 'Running a very long command that goes on and on', lastAt: now })), ...over }))
  return { list, sum: summarize(list, now), limits: [], v: { isCompact: false, isStill: false, showEnded: false, showBand: false }, mineId: undefined, now }
}

test('one size mode serves every row: the poorest any row needs; and the rows together are held to a total', async () => {
  // A session with a great many subagents needs a smaller mode than the plain ones beside it.
  const small = boardOf(2, 1)
  const huge = boardOf(1, 120)
  const mixed = { ...small, list: [...small.list, ...huge.list.map(s => ({ ...s, id: 'huge' }))] }
  const alone = fittingCards(small, 360)
  const together = fittingCards(mixed, 360)
  expect(alone?.mode).toBe(0)
  expect((together?.mode ?? 0) > 0).toBe(true)
  // In that mode the plain rows are drawn compact too: shorter than they were alone.
  expect((together?.rows[0]?.main.height ?? 0) < (alone?.rows[0]?.main.height ?? 0)).toBe(true)
  // A crowd past the total draws its first sessions and counts the rest.
  const crowd = fittingCards(boardOf(80, 8), 1000)
  expect(crowd).not.toBeNull()
  expect((crowd?.hidden ?? 0) > 0).toBe(true)
  expect((crowd?.rows.length ?? 0) + (crowd?.hidden ?? 0)).toBe(80)
  const total = (crowd?.rows ?? []).reduce((n, r) => n + r.main.source.length + (r.agents?.source.length ?? 0), 0)
  expect(total <= 400_000).toBe(true)
})
