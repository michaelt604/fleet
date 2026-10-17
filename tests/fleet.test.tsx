import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { FleetSession } from '../types'
import { ZERO } from '../hooks/describe'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const CARD = (surface: Surface, requestId: string) =>
  ({
    plugin: 'fleet',
    surface,
    component: 'CommandOutput',
    requestId,
    viewport: { columns: 160, rows: 40 },
    props: { command: 'fleet', args: '', text: 'Fleet: 2 sessions', isErrored: false },
  }) as const

const BAND = (surface: Surface) =>
  ({
    plugin: 'fleet',
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    viewport: { columns: 160, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 150, scroll: { offset: 0, bodyRows: 8 }, view: {} },
  }) as const

import colonyView from '../hooks/colony-view-19'

// The Client module's number, which draw.tsx's file name and key carry (they change together).
const COLONY_VIEW_NUMBER = '19'

const DIR = 'C:/Users/me/.claude/fleet'

// What the surface answers when the mod asks for its side panel. Most tests draw the transcript
// card, the fallback for a surface with no side panel; a test may change it.
const NO_PANEL = { isPlaced: false, reason: 'the attached surfaces place no panes' } as const
let openAnswer: { isPlaced: true } | { isPlaced: false; reason: string } = NO_PANEL
// How many times the mod asked for its panel.
let opens = 0
// The session's id as the engine reports it; /clear moves it on.
let sessionId = 'me-1'
// What the desktop app puts in the session's environment; a terminal session has none.
let hostEnv: string | undefined
// What surface the session draws on.
let surfaceName = 'desktop'
// Whether the side panel counts as open, and the toasts the mod raised.
let paneShown = false
let toasts: { text: string; timeoutMs?: number }[] = []
// The plan limits the session reports; none means an API key (a five-minute cache).
let usageLimits: { kind: string; percentUsed: number }[] = [{ kind: 'five_hour', percentUsed: 37 }]
// Whether the folder can't be listed.
let listFails = false

// Stands for this machine: a session's identity, its usage, and a fleet folder in memory.
function machine(on: On, files: Map<string, string>, statuses: (string | undefined)[], title = '', stored?: object, runs: string[][] = []) {
  const key = (path: unknown) => String(path).replace(/\\/g, '/')
  on('env.get', ($, e) => ({ value: e.name === 'USERPROFILE' ? 'C:\\Users\\me' : e.name === 'OS' ? 'Windows_NT' : e.name === 'APPDATA' ? 'C:\\Users\\me\\AppData\\Roaming' : e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? hostEnv : undefined }))
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: 'C:/work/BuiltByTing' }))
  on('session.root', () => ({ value: 'C:/work/BuiltByTing' }))
  on('session.surface', () => ({ value: surfaceName as never }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: 420_000, window: 1_000_000, percent: 42 }, rateLimits: usageLimits, cost: { usd: 1.25 } },
  }))
  on('session.start', () => ({ cwd: 'C:/work/BuiltByTing' }))
  on('store.get', () => ({ value: stored }))
  on('store.set', () => ({ value: undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    opens += 1
    return { value: openAnswer }
  })
  on('ui.panes', () => ({ value: paneShown ? [{ id: 'fleet', title: 'Fleet', isShown: true, isPlaced: true, hasKeys: false }] : [] }) as never)
  on('ui.toast', ($, e) => {
    toasts.push({ text: e.text, timeoutMs: e.timeoutMs })
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: key(e.path).endsWith('/projects/C--work-BuiltByTing/me-1.jsonl') }))
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    const script = String(e.argv.at(-1))
    const isTitle = e.argv[0] === 'powershell' && script.includes('customTitle')
    return { value: { exitCode: 0, stdout: isTitle && title ? `${title}\n` : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', ($, e) => {
    files.set(key(e.path), e.text)
    return { value: undefined }
  })
  // The files directly inside the folder asked for.
  on('fs.list', ($, e) => {
    if (listFails && key(e.path ?? '') === DIR) return { deny: 'unreadable' }
    const base = key(e.path ?? '').replace(/\/$/, '')
    const below = [...files.keys()].filter(p => p.startsWith(`${base}/`)).map(p => p.slice(base.length + 1).split('/'))
    const entry = (name: string, kind: string) => ({ name, kind, size: files.get(`${base}/${name}`)?.length ?? 0, mtimeMs: 60_000, isLink: false })
    return {
      value: [...below.filter(parts => parts.length === 1).map(parts => entry(parts[0], 'file')), ...[...new Set(below.filter(parts => parts.length > 1).map(parts => parts[0]))].map(name => entry(name, 'dir'))],
    }
  })
  on('fs.read', ($, e) => {
    const text = files.get(key(e.path))
    return text === undefined ? { deny: 'missing' } : { value: text }
  })
}

const other = (at: number): FleetSession => ({
  v: 1, id: 'other-2', project: 'CPU-Tuning', title: 'Ryzen Master curve optimization', cwd: 'C:/cpu', surface: 'terminal', model: 'claude-sonnet-5-5', effort: 'medium',
  state: 'waiting', task: 'Run the step test', now: 'Needs your OK: Running core cycler', kind: 'waiting', last: '', turnStartedAt: at - 30_000, idleSince: null,
  turns: 4, toolsThisTurn: 2, toolsTotal: 40, contextTokens: 0, contextWindow: 1_000_000, contextPercent: 12, costUsd: 0.4, tokens: ZERO, limits: [], agents: [],
  startedAt: 0, updatedAt: at,
})

type Found = { props: Record<string, unknown>; children?: readonly unknown[] } | undefined

// All the pictures a desktop dashboard is drawn in (the header, and a row each), as one string.
async function allSvg(drawing: { findAll: (q: never) => Promise<unknown> }): Promise<string> {
  return ((await drawing.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]).map(svg => String(svg.props.source)).join('')
}

// What a drawing says, on either surface: the SVG's text where it drew one, else its Text.
async function says(drawing: { find: (q: never) => Promise<unknown>; findAll: (q: never) => Promise<unknown> }, text: string): Promise<boolean> {
  const svgs = (await drawing.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]
  if (svgs.length > 0) return svgs.some(svg => String(svg.props.source).includes(text.replace(/&/g, '&amp;')))
  return (await drawing.find({ type: 'Text', text } as never)) !== undefined
}

// Every tag's attributes are unique, and every group closes: otherwise the SVG is invalid XML,
// which the desktop shows as a blank image.
function isWellFormed(source: string): boolean {
  const unique = [...source.matchAll(/<([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"]*")*)\s*\/?>/g)].every(tag => {
    const names = [...(tag[2] ?? '').matchAll(/([a-zA-Z:-]+)="/g)].map(m => m[1])
    return new Set(names).size === names.length
  })
  return unique && (source.match(/<g[\s>]/g) ?? []).length === (source.match(/<\/g>/g) ?? []).length
}

for (const surface of SURFACES) {
  test(`${surface}: /fleet shows every session, what each is doing, and its subagents`, async ($, on) => {
    const files = new Map<string, string>()
    const statuses: (string | undefined)[] = []
    const clock = mock.clock(on, { now: 60_000 })
    machine(on, files, statuses, 'Claude code mods exploration')
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: 'ok' }))
    on('agent.spawn', () => ({ agentId: 'sub-1', model: 'claude-sonnet-5-5' }))

    await $.session.start({ surface, isInteractive: true, cwd: 'C:/work/BuiltByTing' })
    await $.turn.start({ text: 'Add spam protection to the enquiry form', turnId: 't1' })
    await $.agent.spawn({ tool_use_id: 'tu-a', prompt: 'p', description: 'Implement the honeypot', subagentType: 'sonnet-worker', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
    await $.tool.call({ tool: 'Edit', tool_use_id: 'tu-1', file_path: 'C:/work/site/form.ts', old_string: 'a', new_string: 'b', agentId: 'sub-1' } as never)
    await clock.advance(600)

    const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
    expect(mine.state).toBe('working')
    expect(mine.title).toBe('Claude code mods exploration')
    expect(mine.task).toBe('Add spam protection to the enquiry form')
    expect(mine.agents[0]?.now).toBe('Editing form.ts')
    expect(mine.contextPercent).toBe(42)

    files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(60_000), waitingSince: 1 }))
    await $.command.run({ command: 'fleet', args: '' } as never)
    // /fleet answers at once; its fresh scan lands a moment later.
    await clock.advance(1)
    const card = await $.ui.mount(CARD(surface, 'row-1'))

    expect(await says(card, 'Ryzen Master curve optimization')).toBe(true)
    expect(await says(card, 'Needs your OK: Running core cycler')).toBe(true)
    expect(await says(card, 'Claude code mods exploration')).toBe(true)
    expect(await says(card, 'Add spam protection')).toBe(true)
    expect(await says(card, 'sonnet-worker')).toBe(true)
    // What needs the person leads the status line; a long name is cut.
    expect(statuses.at(-1)).toBe('⚑ needs you: Ryzen Master cu… 1m · 1 working · 1 agent')

    if (surface === 'desktop') {
      const svg = (await card.find({ type: 'Svg' })) as Found
      for (const picture of (await card.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]) expect(isWellFormed(String(picture.props.source))).toBe(true)
      expect(String(svg?.props.alt)).toContain('need you')
      // The header's words are the counts and the limits; each row has its own.
      expect(String(svg?.props.alt)).not.toContain('Ryzen')
      expect(((await card.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]).some(p => String(p.props.alt).includes('Ryzen Master curve optimization: needs you: Needs your OK: Running core cycler'))).toBe(true)
      expect(String(svg?.props.source)).toContain('prefers-reduced-motion')
      // Still freezes the CSS motion inside the drawing.
      await $.command.run({ command: 'fleet', args: 'still' } as never)
      await clock.advance(1)
      const card2 = await $.ui.mount(CARD(surface, 'row-2'))
      expect(String(((await card2.find({ type: 'Svg' })) as Found)?.props.source)).toContain('*{animation:none!important}.dots circle{opacity:.7}')
    } else {
      // The terminal's text workers move on the frame clock.
      const before = JSON.stringify(((await card.find({ type: 'Text', text: '(°_°)' })) as Found)?.children)
      await clock.advance(400)
      const after = JSON.stringify(((await card.find({ type: 'Text', text: '(°_°)' })) as Found)?.children)
      expect(after).not.toBe(before)
    }
  })

  test(`${surface}: the band shows busy sessions, folds idle ones, and hides on ×`, async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: 60_000 })
    machine(on, files, [])
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
    files.set(`${DIR}/other-2.json`, JSON.stringify(other(60_000)))
    files.set(`${DIR}/idle-3.json`, JSON.stringify({ ...other(60_000), id: 'idle-3', title: 'Curate galleries', state: 'idle', now: 'Waiting for your reply', kind: undefined }))

    await $.session.start({ surface, isInteractive: true, cwd: 'C:/work/BuiltByTing' })
    await clock.advance(1)
    // Off by default (the sidebar is the fleet's home); /fleet band turns it on.
    const band = await $.ui.mount(BAND(surface))
    expect(await band.find({ key: 'fleet-open' })).toBeUndefined()
    await $.command.run({ command: 'fleet', args: 'band' } as never)
    expect(await says(band, 'Ryzen Master curve optimization')).toBe(true)
    expect(await says(band, 'idle')).toBe(true)
    expect(await band.find({ type: 'Text', text: 'stock' })).toBeDefined()
    if (surface === 'desktop') expect(isWellFormed(String(((await band.find({ type: 'Svg' })) as Found)?.props.source))).toBe(true)

    await band.press({ key: 'fleet-hide' })
    expect(await band.find({ key: 'fleet-open' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: 'stock' })).toBeDefined()
  })

  test(`${surface}: only the newest /fleet result stays live`, async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: 60_000 })
    machine(on, files, [])
    on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
    files.set(`${DIR}/other-2.json`, JSON.stringify(other(60_000)))
    await $.session.start({ surface, isInteractive: true, cwd: 'C:/work/BuiltByTing' })
    await clock.advance(1)

    const old = await $.ui.mount(CARD(surface, 'row-old'))
    expect(await says(old, 'Ryzen Master curve optimization')).toBe(false)
    await $.command.run({ command: 'fleet', args: '' } as never)
    const live = await $.ui.mount(CARD(surface, 'row-new'))
    expect(await says(live, 'Ryzen Master curve optimization')).toBe(true)
  })
}

test('a session that ends says so in its heartbeat', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('session.end', () => ({ sessionId: 'me-1' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.session.end({ reason: 'other' } as never)
  await clock.advance(600)
  expect((JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession).state).toBe('ended')
})

test('a band turned on in an earlier session does not follow into a new one', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [], '', { isCompact: true, isStill: false, showEnded: false, showBand: true })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
  files.set(`${DIR}/other-2.json`, JSON.stringify(other(60_000)))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(1)
  const band = await $.ui.mount(BAND('desktop'))
  expect(await band.find({ key: 'fleet-open' })).toBeUndefined()
})

test("progress comes from the task list and from a worker's step reports", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ agentId: 'sub-1', model: 'claude-sonnet-5-5' }))
  let made = 0
  on('tool.call', ($, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: String(++made), subject: 's' } } } : { result: 'ok' }) as never)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.turn.start({ text: 'Do the thing', turnId: 't1' })
  for (let i = 0; i < 4; i += 1) await $.tool.call({ tool: 'TaskCreate', tool_use_id: `c${i}`, subject: 's', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u1', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u2', taskId: '2', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u3', taskId: '3', status: 'deleted' } as never)
  await $.agent.spawn({ tool_use_id: 'tu-a', prompt: 'p', description: 'Build it', subagentType: 'sonnet-worker', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  await $.tool.call({ tool: 'mcp__savvy-progress__step', tool_use_id: 'st', done: 2, total: 8, agentId: 'sub-1' } as never)
  await clock.advance(600)

  const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  expect(mine.tasks).toEqual({ '1': 'completed', '2': 'completed', '3': 'deleted', '4': 'pending' })
  expect(mine.agents[0]?.progress).toEqual({ done: 2, total: 8 })

  await $.command.run({ command: 'fleet', args: '' } as never)
  const card = await $.ui.mount(CARD('desktop', 'row-p'))
  const source = await allSvg(card)
  expect(source).toContain('2/3 · 67%')
  expect(source).toContain('25%')
})

test('/fleet answers even before the session has finished starting up', async ($, on) => {
  const files = new Map<string, string>()
  mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  // No clock advance: usage, heartbeat, scan and title are all still waiting to run.
  const answer = await $.command.run({ command: 'fleet', args: '' } as never)
  expect(String((answer as { text?: string }).text)).toContain('Fleet:')
})

test('/fleet opens the side panel, which shows each worker in its role hat and the main cache timer', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  openAnswer = { isPlaced: true }
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } }
  } as never)
  on('agent.spawn', () => ({ agentId: 'sub-1', model: 'claude-opus-5-5' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.turn.start({ text: 'Plan it', turnId: 't1' })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) void _
  await $.agent.spawn({ tool_use_id: 'tu-a', prompt: 'p', description: 'Think hard', subagentType: 'opus-deep', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  await clock.advance(8 * 60_000)

  const answer = await $.command.run({ command: 'fleet', args: '' } as never)
  openAnswer = NO_PANEL
  expect(String((answer as { text?: string }).text)).toContain('side panel')
  await clock.advance(1)
  // The transcript row keeps its plain text: the dashboard lives in the panel.
  expect(await says(await $.ui.mount(CARD('desktop', 'row-s')), 'opus-deep')).toBe(false)

  const pane = await $.ui.mount({ plugin: 'fleet', surface: 'desktop', component: 'Pane', requestId: 'fleet', viewport: { columns: 160, rows: 40 }, props: { bodyColumns: 64, bodyRows: 40 } } as never)
  const source = await allSvg(pane)
  expect(isWellFormed(source)).toBe(true)
  // The wizard's hat in the opus-deep hue, the crown on the main agent, and an hour's cache less eight minutes.
  expect(source).toContain('--h:278')
  expect(source).toContain('--h:20')
  expect(source).toContain('>52m<')
})

test('a turn leaves a receipt; slow tools, quiet agents, token limits, forks, mode and compactions show', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  opens = 0
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)
  on('tool.call', ($, e) => (e.tool === 'Bash' ? { isError: true, result: 'boom' } : { result: 'ok' }) as never)
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number; agentId?: string }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: e.agentId === 'sub-1' ? 'max_tokens' : 'end_turn', usage: { model: 'claude-haiku-5-5', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  } as never)
  on('agent.spawn', () => ({ agentId: 'sub-1', model: 'claude-sonnet-5-5' }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'Summary of the work so far', toolUses: [] }] }) as never)
  on('classic.UserPromptSubmit', () => ({}) as never)

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  // Usage (42% context) lands a moment after start.
  await clock.advance(1)
  await $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', prompt: 'go', session_id: 'me-1', transcript_path: '', cwd: '', permission_mode: 'plan' } as never)
  await $.turn.start({ text: 'Fix the form', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  await $.tool.call({ tool: 'Write', tool_use_id: 'e2', file_path: 'b.ts', content: 'x' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' } as never)
  await $.agent.spawn({ tool_use_id: 'tu-a', prompt: 'p', description: 'Build it', subagentType: 'sonnet-worker', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  for await (const _ of $.turn.step({ turnId: 's1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: 'sub-1' } as never)) void _
  for await (const _ of $.turn.step({ turnId: 'f1', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'fork-9' } as never)) void _
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Summary of the work so far', toolUses: [] }] } as never)
  await clock.advance(1)
  // The first subagent opened the panel by itself.
  expect(opens).toBe(1)
  await clock.advance(4 * 60_000)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Done.' } as never)
  await clock.advance(600)

  const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  expect(mine.mode).toBe('plan')
  expect(mine.compactions).toEqual([42])
  expect(mine.loops?.map(l => l.id)).toEqual(['fork-9'])
  expect(mine.agents[0]?.hitMax).toBe(true)
  expect(mine.receipt).toMatchObject({ edits: 2, errors: 1, agents: 1 })

  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-r'))
  const source = await allSvg(card)
  expect(isWellFormed(source)).toBe(true)
  expect(source).toContain('Last turn: 4m')
  expect(source).toContain('2 edits')
  expect(source).toContain('1 error')
  expect(source).toContain('hit max tokens')
  expect(source).toContain('1 background loop')
  expect(source).toContain('plan mode')
  // The colony under the list is a region the page draws and keeps: the subagent walks out of the
  // hall under its own name.
  const colony = (await card.find({ type: 'Client' })) as Found
  const scene = colony?.props.props as { workers: { name: string; fx: number; fy: number }[] }
  expect(scene.workers.find(w => w.name === mine.agents[0]?.name)).toMatchObject({ fx: 160, fy: 60 })
  const drawn = String(((await card.find({ type: 'Svg', in: 'colony-19' } as never)) as Found)?.props.source)
  expect(drawn).toContain('>Colony<')
  expect(isWellFormed(drawn)).toBe(true)
  // Another redraw of the panel with nothing new for the colony hands it the same scene.
  await clock.advance(5_000)
  expect(JSON.stringify(((await card.find({ type: 'Client' })) as Found)?.props.props)).toBe(JSON.stringify(scene))
})

test("a background task's notification is not taken for the person's prompt", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.turn.start({ text: 'Fix the enquiry form', turnId: 't1' })
  await clock.advance(1_000)
  await $.turn.start({ text: '<task-notification><task-id>abc</task-id></task-notification>', turnId: 't2' })
  await clock.advance(600)
  const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  expect(mine.task).toBe('Fix the enquiry form')
  expect(mine.promptAt).toBe(60_000)
})

const PANE = (bodyColumns: number) =>
  ({ plugin: 'fleet', surface: 'desktop', component: 'Pane', requestId: 'fleet', viewport: { columns: 200, rows: 60 }, props: { bodyColumns, bodyRows: 60 } }) as never

test('a fleet too big to draw whole still draws, within the app\'s limit on a drawing', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  openAnswer = { isPlaced: true }
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
  const agent = (n: number) => ({ id: `a${n}`, name: `Agent number ${n}`, type: 'sonnet-worker', description: 'Implement a long described piece of the work '.repeat(3), model: 'claude-sonnet-5-5', state: 'working', now: 'Running a very long command description that goes on and on', kind: 'running', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 5_000, contextWindow: 1_000_000, steps: 3, tools: 4, lastAt: 60_000 })
  for (let i = 0; i < 10; i += 1) {
    files.set(`${DIR}/big-${i}.json`, JSON.stringify({ ...other(60_000), id: `big-${i}`, title: `A very long session title number ${i} `.repeat(4), state: 'working', agents: Array.from({ length: 6 }, (_, n) => agent(n)) }))
  }
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(1)
  const pane = await $.ui.mount(PANE(156))
  openAnswer = NO_PANEL
  // Each row is a picture of its own, and each stays under the app's limit.
  const pictures = ((await pane.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]).map(svg => String(svg.props.source))
  expect(pictures.length).toBeGreaterThan(10)
  expect(pictures.every(p => p.length <= 131_072)).toBe(true)
  expect(pictures.some(p => p.length > 1_000)).toBe(true)
  expect(isWellFormed(pictures.join(''))).toBe(true)
  const colony = String(((await pane.find({ type: 'Svg', in: 'colony-19' } as never)) as Found)?.props.source)
  expect(colony).toContain('>Colony<')
  expect(JSON.stringify(colony).length <= 96_000).toBe(true)
  expect(isWellFormed(colony)).toBe(true)
})

test('a control character, DEL or C1 in a session leaves the drawing well formed', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(60_000), now: 'Running \u001b[31mred\u0007 output', title: 'A\u007FB\u0085C' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-ctl'))
  const source = await allSvg(card)
  expect(source.includes('\u001b')).toBe(false)
  expect(isWellFormed(source)).toBe(true)
  expect(((await card.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]).some(p => String(p.props.alt).includes('ABC'))).toBe(true)
})

test('/clear carries on under the new session id; the cleared one stays ended', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  sessionId = 'me-1'
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.end', () => ({ sessionId: 'me-1' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.turn.start({ text: 'First conversation', turnId: 't1' })
  await clock.advance(600)
  sessionId = 'me-2'
  await $.session.end({ reason: 'clear' } as never)
  await $.turn.start({ text: 'Second conversation', turnId: 't2' })
  await clock.advance(600)
  sessionId = 'me-1'
  const old = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  const fresh = JSON.parse(files.get(`${DIR}/me-2.json`) ?? '{}') as FleetSession
  expect(old.state).toBe('ended')
  expect(fresh.state).toBe('working')
  expect(fresh.task).toBe('Second conversation')
  expect(fresh.turns).toBe(1)
})

test("a notification's turn leaves the last turn's receipt alone", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)
  on('tool.call', () => ({ result: 'ok' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(1)
  await $.turn.start({ text: 'Fix the form', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: 'a.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(60_000)
  await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Done.' } as never)
  await clock.advance(600_000)
  await $.turn.start({ text: '<task-notification><task-id>x</task-id></task-notification>', turnId: 't2' })
  await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'Noted.' } as never)
  await clock.advance(600)
  const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  expect(mine.receipt?.edits).toBe(1)
  expect((mine.receipt?.ms ?? 0) < 120_000).toBe(true)
})

test('"Needs your OK" shows when the dialog does, never for a check auto mode settles or a plugin query', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('classic.PermissionRequest', () => ({}) as never)
  on('classic.UserPromptSubmit', () => ({}) as never)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.classic.UserPromptSubmit({ hook_event_name: 'UserPromptSubmit', prompt: 'go', session_id: 'me-1', transcript_path: '', cwd: '', permission_mode: 'auto' } as never)
  await $.turn.start({ text: 'Build it', turnId: 't1' })
  await clock.advance(600)
  // A plugin's query, and a real call in auto mode: the classifier settles both without the person.
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'b1' } as never)
  await clock.advance(600)
  expect((JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession).state).toBe('working')
  // The dialog itself shows: now it waits on the person.
  await $.classic.PermissionRequest({ hook_event_name: 'PermissionRequest', session_id: 'me-1', transcript_path: '', cwd: '', permission_mode: 'auto', tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } } as never)
  await clock.advance(600)
  const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  expect(mine.state).toBe('waiting')
  expect(mine.now).toContain('Needs your OK')
})

test('a session started again under the same id keeps what it was about, resting', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 600_000 })
  machine(on, files, [])
  files.set(`${DIR}/me-1.json`, JSON.stringify({ ...other(500_000), id: 'me-1', state: 'working', task: 'Fix the form', last: 'Done: the form sends', promptAt: 400_000, agents: [{ id: 'x' }] }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(600)
  const mine = JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession
  expect(mine.task).toBe('Fix the form')
  expect(mine.last).toBe('Done: the form sends')
  expect(mine.promptAt).toBe(400_000)
  expect(mine.state).toBe('idle')
  expect(mine.agents).toEqual([])
})

test('an in-process /resume keeps what the resumed conversation was about; a closed panel stays closed after /clear', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 600_000 })
  machine(on, files, [])
  sessionId = 'me-1'
  on('session.end', () => ({ sessionId: 'me-1' }))
  on('ui.close', () => ({}) as never)
  files.set(`${DIR}/old-9.json`, JSON.stringify({ ...other(300_000), id: 'old-9', state: 'ended', task: 'Fix the form', last: 'Done: the form sends', turns: 7, promptAt: 200_000 }))
  files.set(`${DIR}/me-1.json`, JSON.stringify({ ...other(500_000), id: 'me-1', state: 'idle', panelClosed: true }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(600)
  sessionId = 'old-9'
  await $.session.end({ reason: 'resume' } as never)
  await clock.advance(600)
  const resumed = JSON.parse(files.get(`${DIR}/old-9.json`) ?? '{}') as FleetSession
  expect(resumed.task).toBe('Fix the form')
  expect(resumed.last).toBe('Done: the form sends')
  expect(resumed.turns).toBe(7)
  expect(resumed.panelClosed).toBe(true)
  sessionId = 'me-1'
})

test('a prompt that starts with markup is the person\'s; a task notification is not', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await $.turn.start({ text: '<button> in the header is misaligned, fix it', turnId: 't1' })
  await clock.advance(600)
  expect((JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession).task).toContain('<button> in the header')
  await $.turn.start({ text: '<task-notification><task-id>x</task-id></task-notification>', turnId: 't2' })
  await clock.advance(600)
  expect((JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession).task).toContain('<button> in the header')
})

const START = { surface: 'desktop', isInteractive: true, cwd: 'C:/work/BuiltByTing' } as const
const mineOf = (files: Map<string, string>): FleetSession => JSON.parse(files.get(`${DIR}/me-1.json`) ?? '{}') as FleetSession

test('a question or a plan for approval holds the call: the session needs you until it is answered', async ($, on) => {
  const files = new Map<string, string>()
  const statuses: (string | undefined)[] = []
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, statuses)
  // What the heartbeat said while each call was held.
  const held: FleetSession[] = []
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.call', () => {
    held.push(mineOf(files))
    return { result: 'ok' }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'Plan the form', turnId: 't1' })
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [] } as never)
  await $.tool.call({ tool: 'ExitPlanMode', tool_use_id: 'p1', plan: 'x' } as never)
  expect(held.map(h => [h.state, h.now])).toEqual([
    ['waiting', 'Asking you a question'],
    ['waiting', 'Plan ready for your OK'],
  ])
  expect(held[0]?.waitingSince).toBeGreaterThan(0)
  // Answered: the session is back at work.
  await clock.advance(600)
  expect(mineOf(files).state).toBe('working')
  expect(mineOf(files).waitingSince).toBeNull()
  // Another session's status line says it needs the person.
  files.set(`${DIR}/peer-5.json`, JSON.stringify({ ...held[0], id: 'peer-5' }))
  await clock.advance(20_000)
  expect(String(statuses.at(-1))).toContain('needs you: BuiltByTing')
})

test("a subagent's permission dialog marks the session as needing you, until that call is done", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  const held: FleetSession[] = []
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('agent.spawn', () => ({ agentId: 'sub-1', model: 'claude-sonnet-5-5' }))
  on('classic.PermissionRequest', () => ({}) as never)
  on('tool.call', async (_$, e) => {
    if ((e as { agentId?: string }).agentId === 'sub-1') {
      await $.classic.PermissionRequest({ hook_event_name: 'PermissionRequest', session_id: 'me-1', transcript_path: '', cwd: '', permission_mode: 'default', agent_id: 'sub-1', tool_name: 'Bash', tool_input: { command: 'rm -rf dist' } } as never)
      held.push(mineOf(files))
    }
    return { result: 'ok' }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'Build it', turnId: 't1' })
  await $.agent.spawn({ tool_use_id: 'tu-a', name: 'Scout', prompt: 'p', description: 'Clean up', subagentType: 'sonnet-worker', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'rm -rf dist', agentId: 'sub-1' } as never)
  expect(held[0]?.state).toBe('waiting')
  expect(held[0]?.waitingSince).toBeGreaterThan(0)
  expect(held[0]?.now).toBe('Needs your OK (Scout): Running rm -rf dist')
  expect(held[0]?.agents[0]?.now).toBe('Needs your OK (Scout): Running rm -rf dist')
  // The call finished, so the dialog was answered.
  await clock.advance(600)
  const mine = mineOf(files)
  expect(mine.state).toBe('working')
  expect(mine.agents[0]?.now).toBe('Thinking…')
})

test('another session that starts needing you raises a toast while the panel is open; /fleet alerts turns it off', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  toasts = []
  paneShown = true
  openAnswer = { isPlaced: true }
  const late = (state: string, now: string) => JSON.stringify({ ...other(1_000_000), id: 'late-4', title: 'Curate galleries', state, now })
  // One already waits at start: the first scan only notes it.
  files.set(`${DIR}/other-2.json`, JSON.stringify(other(1_000_000)))
  files.set(`${DIR}/late-4.json`, late('working', 'Editing a.ts'))
  await $.session.start(START)
  await clock.advance(5_000)
  expect(toasts).toEqual([])

  files.set(`${DIR}/late-4.json`, late('waiting', 'Needs your OK: Running a very long command that goes on and on past sixty characters'))
  await clock.advance(5_000)
  expect(toasts.length).toBe(1)
  expect(toasts[0]?.text.startsWith('Curate galleries: Needs your OK: Running a very long')).toBe(true)
  expect(toasts[0]?.text.endsWith('…')).toBe(true)
  expect(toasts[0]?.text.length).toBe('Curate galleries: '.length + 60)
  expect(toasts[0]?.timeoutMs).toBe(8_000)
  // Still waiting: no second toast.
  await clock.advance(5_000)
  expect(toasts.length).toBe(1)

  const off = (await $.command.run({ command: 'fleet', args: 'alerts' } as never)) as { text?: string }
  expect(off.text).toBe('Fleet alerts off; /fleet alerts turns them back on.')
  files.set(`${DIR}/late-4.json`, late('working', 'Editing a.ts'))
  await clock.advance(5_000)
  files.set(`${DIR}/late-4.json`, late('waiting', 'Needs your OK: Editing b.ts'))
  await clock.advance(5_000)
  expect(toasts.length).toBe(1)

  const back = (await $.command.run({ command: 'fleet', args: 'alerts' } as never)) as { text?: string }
  expect(back.text).toBe('Fleet alerts on: a toast here when another session needs you, while this panel is open.')
  paneShown = false
  openAnswer = NO_PANEL
})

test("a session archived in the desktop app is left out of the fleet, about once a minute; unarchived, it returns", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  const statuses: (string | undefined)[] = []
  machine(on, files, statuses)
  const record = 'C:/Users/me/AppData/Roaming/Claude/claude-code-sessions/org-1/acct-1/local_x.json'
  const archive = (isArchived: boolean) => files.set(record, JSON.stringify({ cliSessionId: 'other-2', isArchived }))
  files.set(`${DIR}/other-2.json`, JSON.stringify(other(60_000)))
  archive(true)
  await $.session.start(START)
  await clock.advance(5_000)
  expect(statuses.at(-1)).toBeUndefined()

  archive(false)
  await clock.advance(30_000)
  expect(statuses.at(-1)).toBeUndefined()
  await clock.advance(31_000)
  expect(statuses.at(-1)?.startsWith('⚑ needs you:')).toBe(true)
})

test('a waiting desktop session gets an Open button that runs the app link; a terminal one gets none', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  const runs: string[][] = []
  machine(on, files, [], '', undefined, runs)
  hostEnv = 'local_0b1c-77'
  files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(60_000), hostId: 'local_9f2-aa', waitingSince: 1 }))
  files.set(`${DIR}/term-3.json`, JSON.stringify({ ...other(60_000), id: 'term-3', title: 'Terminal one' }))
  await $.session.start(START)
  await clock.advance(600)
  hostEnv = undefined
  // The app's session id rides in this session's own heartbeat.
  expect(mineOf(files).hostId).toBe('local_0b1c-77')
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-go'))
  expect(((await card.find({ key: 'go-other-2' })) as Found)?.props).toMatchObject({ hotkey: '1', label: 'Ryzen Master curve optimization needs you 1m · Open' })
  expect(await card.find({ key: 'go-term-3' })).toBeUndefined()
  // The panel rescans on its own every 2 seconds, so it has no Refresh button.
  expect(await card.find({ key: 'refresh' })).toBeUndefined()
  await card.press({ key: 'go-other-2' })
  await clock.advance(10)
  expect(runs).toContainEqual(['rundll32', 'url.dll,FileProtocolHandler', 'claude://claude.ai/epitaxy/local_9f2-aa'])
})

test('each /fleet option says what it changed and how to undo it; an unknown one opens nothing', async ($, on) => {
  const files = new Map<string, string>()
  mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  openAnswer = { isPlaced: true }
  opens = 0
  await $.session.start(START)
  const say = async (args: string) => String(((await $.command.run({ command: 'fleet', args } as never)) as { text?: string }).text)
  const panel = ' Fleet is open in the side panel.'
  expect(await say('still')).toBe(`Motion stopped; /fleet animate restarts it.${panel}`)
  expect(await say('animate')).toBe(`Motion restarted; /fleet still stops it.${panel}`)
  expect(await say('ended')).toBe(`Showing ended sessions; /fleet ended hides them.${panel}`)
  expect(await say('ended')).toBe(`Ended sessions hidden; /fleet ended shows them.${panel}`)
  expect(await say('colony')).toBe(`Colony hidden; /fleet colony shows it.${panel}`)
  expect(await say('colony')).toBe(`Colony shown; /fleet colony hides it.${panel}`)
  expect(opens).toBe(6)
  expect(await say('bogus')).toBe('Unknown option "bogus". Try: /fleet, /fleet band, /fleet colony, /fleet ended, /fleet still, /fleet animate, /fleet alerts.')
  expect(opens).toBe(6)
  openAnswer = NO_PANEL
})

test("the band's Fleet button opens the panel directly, and falls back to the command where nothing is placed", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  // Whatever answers the command the button falls back on.
  let commandRuns = 0
  on('command.run', () => {
    commandRuns += 1
    return { text: 'ok' }
  })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
  files.set(`${DIR}/other-2.json`, JSON.stringify(other(60_000)))
  await $.session.start(START)
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: 'band' } as never)
  const band = await $.ui.mount(BAND('desktop'))
  openAnswer = { isPlaced: true }
  opens = 0
  await band.press({ key: 'fleet-open' })
  await clock.advance(1)
  expect(opens).toBe(1)
  // Nothing placed: the command runs, which asks again and draws the card.
  openAnswer = NO_PANEL
  await band.press({ key: 'fleet-open' })
  await clock.advance(1)
  expect(opens).toBe(2)
  expect(commandRuns).toBe(1)
})

// Starts a session with two subagents, Scout (sub-1) and Hugo (sub-2), and a hook that holds a subagent's
// call open behind a permission dialog while `during` runs.
async function withDialogs($: Engine, on: On, during: (agentId: string, files: Map<string, string>, clock: ReturnType<typeof mock.clock>) => Promise<void>, turn: 'open' | 'complete') {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: (e as { answer?: string }).answer ?? '' }) as never)
  on('agent.spawn', (_$, e) => ({ agentId: (e as { name?: string }).name === 'Scout' ? 'sub-1' : 'sub-2', model: 'claude-sonnet-5-5' }))
  on('classic.PermissionRequest', () => ({}) as never)
  on('tool.call', async (_$, e) => {
    const agentId = (e as { agentId?: string }).agentId
    // Only a Bash call opens the dialog; a parallel Read alongside it passes.
    if (agentId !== undefined && (e as { tool?: string }).tool === 'Bash') {
      const name = agentId === 'sub-1' ? 'Scout' : 'Hugo'
      await $.classic.PermissionRequest({ hook_event_name: 'PermissionRequest', session_id: 'me-1', transcript_path: '', cwd: '', permission_mode: 'default', agent_id: agentId, tool_name: 'Bash', tool_input: { command: `run ${name}` } } as never)
      await during(agentId, files, clock)
    }
    return { result: 'ok' }
  })
  await $.session.start(START)
  await $.turn.start({ text: 'Build it', turnId: 't1' })
  for (const name of ['Scout', 'Hugo']) {
    await $.agent.spawn({ tool_use_id: `tu-${name}`, name, prompt: 'p', description: 'Work', subagentType: 'sonnet-worker', provider: { kind: 'model' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  }
  if (turn === 'complete') await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Started them.' } as never)
  await clock.advance(600)
  return { files, clock }
}

test('an idle session whose background subagent had a dialog is idle again once that call ends', async ($, on) => {
  let seen: FleetSession | undefined
  const { files, clock } = await withDialogs($, on, async (_id, files) => void (seen = mineOf(files)), 'complete')
  expect(mineOf(files).state).toBe('idle')
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'run Scout', agentId: 'sub-1' } as never)
  expect(seen?.state).toBe('waiting')
  expect(seen?.now).toBe('Needs your OK (Scout): Running run Scout')
  await clock.advance(600)
  const mine = mineOf(files)
  expect(mine.state).toBe('idle')
  expect(mine.turnStartedAt).toBe(null)
})

test("two open subagent dialogs: the session waits on the oldest until both calls end", async ($, on) => {
  const seen: Record<string, FleetSession> = {}
  const { files, clock } = await withDialogs(
    $,
    on,
    async (agentId, files, clock) => {
      if (agentId === 'sub-1') {
        // Scout's dialog is open; Hugo's call opens its own and finishes first.
        await $.tool.call({ tool: 'Bash', tool_use_id: 'h1', command: 'run Hugo', agentId: 'sub-2' } as never)
        await clock.advance(600)
        seen.afterHugo = mineOf(files)
      } else {
        seen.bothOpen = mineOf(files)
      }
    },
    'open',
  )
  await $.tool.call({ tool: 'Bash', tool_use_id: 's1', command: 'run Scout', agentId: 'sub-1' } as never)
  expect(seen.bothOpen?.now).toBe('Needs your OK (Scout): Running run Scout')
  expect(seen.afterHugo?.state).toBe('waiting')
  expect(seen.afterHugo?.now).toBe('Needs your OK (Scout): Running run Scout')
  // Each subagent's own row says what it waits on while its dialog is open.
  expect(seen.bothOpen?.agents.find(a => a.id === 'sub-2')?.kind).toBe('waiting')
  await clock.advance(600)
  const mine = mineOf(files)
  expect(mine.state).toBe('working')
  expect(mine.agents.every(a => a.kind !== 'waiting')).toBe(true)
})

test("a subagent's parallel call of another tool finishing does not close its open dialog", async ($, on) => {
  let seen: FleetSession | undefined
  const { files, clock } = await withDialogs(
    $,
    on,
    async (_id, files, clock) => {
      // Scout's Bash call waits on the dialog; its Read alongside finishes.
      await $.tool.call({ tool: 'Read', tool_use_id: 'r2', file_path: 'a.ts', agentId: 'sub-1' } as never)
      await clock.advance(600)
      seen = mineOf(files)
    },
    'open',
  )
  await $.tool.call({ tool: 'Bash', tool_use_id: 's2', command: 'run Scout', agentId: 'sub-1' } as never)
  expect(seen?.state).toBe('waiting')
  expect(seen?.now).toBe('Needs your OK (Scout): Running run Scout')
  await clock.advance(600)
  expect(mineOf(files).state).toBe('working')
})

test("the main loop's own calls and the end of the turn do not hide an open subagent dialog", async ($, on) => {
  let seen: FleetSession | undefined
  const { files, clock } = await withDialogs(
    $,
    on,
    async (_id, files, clock) => {
      await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: 'a.ts' } as never)
      await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'Done.' } as never)
      await clock.advance(600)
      seen = mineOf(files)
    },
    'open',
  )
  await $.tool.call({ tool: 'Bash', tool_use_id: 's1', command: 'run Scout', agentId: 'sub-1' } as never)
  expect(seen?.state).toBe('waiting')
  expect(seen?.now).toBe('Needs your OK (Scout): Running run Scout')
  await clock.advance(600)
  expect(mineOf(files).state).toBe('idle')
})

test('a question or plan keeps its own words when a check asks about it; other asks still wait', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('tool.check', () => ({ decision: 'ask' }) as never)
  await $.session.start(START)
  await $.turn.start({ text: 'Go', turnId: 't1' })
  await $.tool.check({ tool: 'AskUserQuestion', input: {}, tool_use_id: 'q1' } as never)
  await clock.advance(600)
  expect(mineOf(files).state).toBe('working')
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'b1' } as never)
  await clock.advance(600)
  expect(mineOf(files).now).toBe('Needs your OK: Running ls')
})

test("the app's session id is kept only on the desktop surface; the Open button needs a safe id; options ignore case", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  hostEnv = 'local_inherited'
  surfaceName = 'terminal'
  openAnswer = { isPlaced: true }
  files.set(`${DIR}/bad-4.json`, JSON.stringify({ ...other(60_000), id: 'bad-4', hostId: 'x y;z' }))
  await $.session.start({ ...START, surface: 'terminal' })
  await clock.advance(600)
  hostEnv = undefined
  surfaceName = 'desktop'
  expect(mineOf(files).hostId).toBe(undefined)
  const said = String(((await $.command.run({ command: 'fleet', args: 'STILL' } as never)) as { text?: string }).text)
  expect(said.startsWith('Motion stopped')).toBe(true)
  openAnswer = NO_PANEL
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-bad'))
  expect(await card.find({ key: 'go-bad-4' })).toBeUndefined()
})

const MIN = 60_000
const LONG = { timeoutMs: 40_000 }

test('a session with no surface (a desktop one restored at app start) still writes its heartbeat and shows, with its title and cost', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [], 'Restored from yesterday')
  surfaceName = null as never
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  await $.session.start(START)
  await $.turn.start({ text: 'Go', turnId: 't1' })
  await clock.advance(30_000)
  surfaceName = 'desktop'
  const mine = mineOf(files)
  expect(mine.surface).toBe('')
  expect(mine.title).toBe('Restored from yesterday')
  expect(mine.costUsd).toBe(1.25)
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-nosurface'))
  expect(await says(card, 'Restored from yesterday')).toBe(true)
})

test('the terminal card says idle in whole minutes, and a resting session with agents says they work', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 2_000_000 })
  machine(on, files, [])
  const agent = { id: 'a1', name: 'Pepper', type: 'opus-worker', description: 'x', model: 'claude-opus-5-5', state: 'working', progress: { done: 0, total: 4 }, now: 'Editing a.ts', startedAt: 1_900_000, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1, lastAt: 2_000_000 }
  files.set(`${DIR}/idle-3.json`, JSON.stringify({ ...other(2_000_000), id: 'idle-3', title: 'Quiet one', state: 'idle', idleSince: 800_000, now: 'Waiting for your reply', task: '<task-notification><id>x</id>', last: 'See [PR #16](https://github.com/x/y/pull/16)' }))
  files.set(`${DIR}/busy-4.json`, JSON.stringify({ ...other(2_000_000), id: 'busy-4', title: 'Agents at it', state: 'idle', idleSince: 1_975_000, agents: [agent] }))
  await $.session.start({ ...START, surface: 'terminal' })
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('terminal', 'row-plain'))
  expect(await says(card, 'idle 20m')).toBe(true)
  expect(await says(card, 'idle 20m00s')).toBe(false)
  expect(await says(card, '1 agent working')).toBe(true)
  expect(await says(card, 'Replied: See PR #16')).toBe(true)
  expect(await says(card, 'task-notification')).toBe(false)
  expect(await says(card, 'Pepper')).toBe(true)
  expect(await says(card, '0/4 ·')).toBe(true)
})

test('the terminal band says a resting session with live agents is working them', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 2_000_000 })
  machine(on, files, [])
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
  const agent = { id: 'a1', name: 'Pepper', type: 'opus-worker', description: 'x', model: 'claude-opus-5-5', state: 'working', now: 'Editing a.ts', startedAt: 1_900_000, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1, lastAt: 2_000_000 }
  files.set(`${DIR}/busy-4.json`, JSON.stringify({ ...other(2_000_000), id: 'busy-4', title: 'Agents at it', state: 'idle', now: 'Waiting for your reply', idleSince: 1_975_000, agents: [agent] }))
  await $.session.start({ ...START, surface: 'terminal' })
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: 'band' } as never)
  const band = await $.ui.mount(BAND('terminal'))
  expect(await says(band, '1 agent working')).toBe(true)
  expect(await says(band, 'Waiting for your reply')).toBe(false)
})

test('a desktop row with subagents is two pictures', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 2_000_000 })
  machine(on, files, [])
  const agent = { id: 'a1', name: 'Pepper', type: 'opus-worker', description: 'x', model: 'claude-opus-5-5', state: 'working', now: 'Editing a.ts', startedAt: 1_900_000, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1, lastAt: 2_000_000 }
  files.set(`${DIR}/crew-3.json`, JSON.stringify({ ...other(2_000_000), id: 'crew-3', title: 'With a crew', state: 'working', limits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: null }], cacheAt: 1_990_000, agents: [agent] }))
  await $.session.start(START)
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-split'))
  const pictures = ((await card.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]).map(svg => String(svg.props.source))
  const own = pictures.filter(p => p.includes('With a crew'))
  const crew = pictures.filter(p => p.includes('Pepper'))
  expect(own.length).toBe(1)
  expect(crew.length).toBe(1)
  expect(own[0]).not.toContain('Pepper')
  expect(crew[0]).not.toContain('With a crew')
  // Header, this session (no agents: one picture) and the crew's two.
  expect(pictures.length).toBe(4)
})

test("the desktop's colony Client module exists, and its file suffix is the key's", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  await $.session.start(START)
  await clock.advance(600)
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-client'))
  const client = (await card.find({ type: 'Client' })) as { key?: string; props: Record<string, unknown> } | undefined
  const module = String(client?.props.module)
  // The page keeps a loaded Client module across reloads: a change to the drawing renames both, together.
  const file = /^(?:\.\/|hooks\/)(colony-view-(\d+)\.tsx)$/.exec(module)
  expect(file).not.toBeNull()
  expect(client?.key).toBe(`colony-${file?.[2]}`)
  // The file is imported by name above: a missing one fails the whole file to load, and a rename has to
  // change that line too, which is where it is caught that the number here moved with it.
  expect(typeof colonyView).toBe('function')
  expect(file?.[2]).toBe(COLONY_VIEW_NUMBER)
})

test("a row's alt counts background loops", async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 2_000_000 })
  machine(on, files, [])
  files.set(`${DIR}/loop-3.json`, JSON.stringify({ ...other(2_000_000), id: 'loop-3', title: 'Loops only', state: 'working', loops: [{ id: 'f1', model: 'claude-haiku-5-5', steps: 2, tokens: 10, startedAt: 1_900_000, lastAt: 1_999_000 }] }))
  await $.session.start(START)
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: '' } as never)
  await clock.advance(1)
  const card = await $.ui.mount(CARD('desktop', 'row-loops'))
  const alts = ((await card.findAll({ type: 'Svg' } as never)) as NonNullable<Found>[]).map(p => String(p.props.alt))
  expect(alts).toContain('Loops only: 1 background loop')
  expect(alts.some(a => a.includes(': 0 agents'))).toBe(false)
})

test('the cache time is stamped when a model request goes out, not when its reply ends', LONG, async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => (release = resolve))
  on('turn.step', async function* (_$: unknown, e: { turnId: string; index: number }) {
    // A slow reply: it ends only when the test lets it.
    await gate
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } }
  } as never)
  await $.session.start(START)
  await clock.advance(1)
  await $.turn.start({ text: 'Go', turnId: 't1' })
  const stepping = (async () => {
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)) void _
  })()
  await clock.advance(5 * MIN)
  release()
  await stepping
  await clock.advance(600)
  const at = mineOf(files).cacheAt ?? 0
  expect(at).toBeGreaterThanOrEqual(60_000)
  expect(at).toBeLessThan(60_000 + MIN)
})

test('a failed listing of the fleet folder keeps what was shown, and the next good scan toasts no one again', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  toasts = []
  paneShown = true
  openAnswer = { isPlaced: true }
  files.set(`${DIR}/other-2.json`, JSON.stringify(other(1_000_000)))
  try {
    await $.session.start(START)
    await clock.advance(5_000)
    expect(toasts).toEqual([])
    listFails = true
    await clock.advance(10_000)
    listFails = false
    await clock.advance(10_000)
    // Still waiting all along: nothing new.
    expect(toasts).toEqual([])
  } finally {
    listFails = false
    paneShown = false
    openAnswer = NO_PANEL
  }
})

test('an "ask" outside a turn does not make the session wait or work', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  on('tool.check', () => ({ decision: 'ask' }) as never)
  on('tool.call', () => ({ result: 'ok' }))
  on('classic.PermissionRequest', () => ({}) as never)
  await $.session.start(START)
  await clock.advance(600)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'b1' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' } as never)
  await clock.advance(600)
  expect(mineOf(files).state).toBe('idle')
  // A dialog outside a turn ends with its call, too.
  await $.classic.PermissionRequest({ hook_event_name: 'PermissionRequest', session_id: 'me-1', transcript_path: '', cwd: '', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'ls' } } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' } as never)
  await clock.advance(600)
  expect(mineOf(files).state).toBe('idle')
})

// --- Status line: the flag ---

const AGENT = { id: 'a', type: 't', description: '', model: '', state: 'working', now: '', startedAt: 0, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 0, tools: 0 }
const SOON = 7_200_000

// The status line after a start with one other session in the folder.
async function statusWith($: Engine, on: On, peer: object, more: object[] = []): Promise<string | undefined> {
  const files = new Map<string, string>()
  const statuses: (string | undefined)[] = []
  const clock = mock.clock(on, { now: SOON })
  machine(on, files, statuses)
  files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(SOON), ...peer }))
  for (const extra of more) files.set(`${DIR}/${(extra as { id: string }).id}.json`, JSON.stringify({ ...other(SOON), ...extra }))
  await $.session.start(START)
  await clock.advance(20_000)
  return statuses.at(-1)
}

test('status line: the flag leads while someone needs you', async ($, on) => {
  const text = await statusWith($, on, {}, [{ id: 'other-3', state: 'idle', title: 'Bram' }])
  expect(text?.startsWith('⚑ needs you: Ryzen Master cu…')).toBe(true)
})

test('status line: nobody needing you leaves no flag and counts the idle', async ($, on) => {
  const text = await statusWith($, on, { state: 'idle' }, [{ id: 'other-3', state: 'idle', title: 'Bram' }])
  expect(text).toBe('3 idle')
})

test('the terminal band says "1 needs you", "2 need you", "1 agent" and "3 agents"', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [], '', { isCompact: true, isStill: false, showEnded: false, showBand: true })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['stock'] }))
  files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(60_000), agents: [AGENT] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:/work/BuiltByTing' })
  await clock.advance(1)
  await $.command.run({ command: 'fleet', args: 'band' } as never)
  const band = await $.ui.mount(BAND('terminal'))
  expect(await band.find({ type: 'Text', text: '1 needs you' } as never)).toBeDefined()
  expect(await band.find({ type: 'Text', text: '1 agent' } as never)).toBeDefined()
  files.set(`${DIR}/other-3.json`, JSON.stringify({ ...other(60_000), id: 'other-3', title: 'Second', agents: [AGENT, { ...AGENT, id: 'b' }] }))
  await clock.advance(20_000)
  expect(await band.find({ type: 'Text', text: '2 need you' } as never)).toBeDefined()
  expect(await band.find({ type: 'Text', text: '3 agents' } as never)).toBeDefined()
})

test('the /fleet reply leaves out zero counts', async ($, on) => {
  const files = new Map<string, string>()
  const clock = mock.clock(on, { now: 60_000 })
  machine(on, files, [])
  files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(60_000), state: 'idle' }))
  await $.session.start(START)
  await clock.advance(1)
  const idle = String(((await $.command.run({ command: 'fleet', args: '' } as never)) as { text?: string }).text)
  expect(idle).toMatch(/Fleet: 2 sessions\./)
  files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(60_000), agents: [AGENT] }))
  await clock.advance(20_000)
  const busy = String(((await $.command.run({ command: 'fleet', args: '' } as never)) as { text?: string }).text)
  expect(busy).toMatch(/1 needs you, 1 agent running\./)
  expect(busy).not.toMatch(/\b0 /)
})

// Another session's heartbeat shows the 5-hour limit, read every 30 s: `pct` gives the reading at each
// step (in half minutes). The reset is 2 hours off. Returns the status lines and a way to see the terminal card.
async function climbing($: Engine, on: On, pcts: number[], surface = 'desktop') {
  const files = new Map<string, string>()
  const statuses: (string | undefined)[] = []
  const clock = mock.clock(on, { now: SOON })
  const resetsAt = new Date(SOON + 2 * 3_600_000).toISOString()
  machine(on, files, statuses)
  await $.session.start({ ...START, surface } as never)
  for (const [i, pct] of pcts.entries()) {
    files.set(`${DIR}/other-2.json`, JSON.stringify({ ...other(SOON + i * 30_000), state: 'working', limits: [{ kind: 'five_hour', percentUsed: pct, resetsAt }] }))
    await clock.advance(30_000)
  }
  return { status: String(statuses.at(-1)), clock, card: async () => {
    await $.command.run({ command: 'fleet', args: '' } as never)
    await clock.advance(1)
    return $.ui.mount(CARD('terminal', 'row-forecast'))
  } }
}
// 27 readings (13 minutes) from 30%, rising 2 points a minute.
const RISING = Array.from({ length: 27 }, (_, i) => 30 + i)
// Then 20 minutes more with no use.
const STOPPED = [...RISING, ...Array.from({ length: 40 }, () => 56)]

test('status line: warns when the 5-hour limit climbs fast enough to fill before its reset', async ($, on) => {
  expect((await climbing($, on, RISING)).status).toBe('1 working · 5h full ~22m')
})

test('status line: the warning goes once the use has stopped', async ($, on) => {
  expect((await climbing($, on, STOPPED)).status).toBe('1 working')
})

test('terminal: the header names the forecast beside the 5-hour reading', async ($, on) => {
  const { card } = await climbing($, on, RISING, 'terminal')
  expect(await says(await card(), 'full ~22m')).toBe(true)
})
