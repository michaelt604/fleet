import { expect, test } from 'claude-code/testing'

import type { FleetAgent, FleetSession } from '../types'
import { ZERO } from '../hooks/describe'
import type { SceneWorker } from '../hooks/colony'
import { BUILDINGS, headOf, CLOCK_SPAN, accessoryOf, COLONY_MOTION, DRAWING_LIMIT, LOOP_MS, MAP_TALL, PLAYS, SPOTS, VENUES, colonySvg, hashKey, hasRoomFor, loopDelay, nameSizeOf, pastimeAt, placeNames, playOf, pointOn, reachOf, routeOf, seatAt, standsClear, strollAt, strollKeyframes, tallyOf, workerDelay } from '../hooks/colony'
import { colonyDueAt, colonyScene, forgetColony, noteColonyForced } from '../hooks/colony-scene'

const T0 = 10_000_000

// A session at work; each test takes its own id, since the scene remembers workers by id.
const session = (id: string, over: Partial<FleetSession> = {}): FleetSession => ({
  v: 1, id, project: 'site', title: 'Fix the form', cwd: 'C:/site', surface: 'desktop', model: 'claude-opus-5-5', effort: 'medium',
  state: 'working', task: 'Fix the enquiry form', now: 'Editing form.ts', kind: 'editing', last: '', turnStartedAt: T0 - 60_000, idleSince: null,
  turns: 2, toolsThisTurn: 4, toolsTotal: 10, contextTokens: 0, contextWindow: 1_000_000, contextPercent: 10, costUsd: 1, tokens: ZERO, limits: [], agents: [],
  startedAt: 0, updatedAt: T0, ...over,
})

const agent = (id: string, over: Partial<FleetAgent> = {}): FleetAgent => ({
  id, name: 'Pepper', type: 'sonnet-worker', description: 'Implement the honeypot', model: 'claude-sonnet-5-5', state: 'working', now: 'Editing form.ts', kind: 'editing',
  startedAt: T0 - 30_000, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1_000_000, steps: 3, tools: 4, lastAt: T0 - 1_000, ...over,
})

const mainOf = (id: string, workers: readonly SceneWorker[]) => workers.find(w => w.key === `${id}/main`)

test('the scene holds still while nothing about a worker changes, so the page never redraws a walk', async () => {
  const at = colonyScene([session('still-1', { agents: [agent('a1')] })], T0, 600, false)
  // Another step of the same work: new words, a new kind of tool, a later clock.
  const later = colonyScene([session('still-1', { now: 'Reading form.ts', kind: 'reading', agents: [agent('a1', { now: 'Running npm run lint', kind: 'running' })] })], T0 + 5_000, 600, false)
  expect(JSON.stringify(later)).toBe(JSON.stringify(at))
})

test('a turn that ends sends the captain to play only once it has rested a while', async () => {
  colonyScene([session('rest-1')], T0, 600, false)
  const resting = { state: 'idle' as const, now: 'Waiting for your reply', kind: undefined, idleSince: T0 + 1_000, turnStartedAt: null }
  const soon = mainOf('rest-1', colonyScene([session('rest-1', resting)], T0 + 5_000, 600, false).workers)
  expect(soon?.look).toBe('work')
  // The rest dates from when the turn ended, not from when the colony noticed.
  expect(colonyDueAt(T0 + 5_000)).toBe(T0 + 1_000 + 15_000)
  // A short turn in between (a background agent's notice) changes nothing.
  colonyScene([session('rest-1')], T0 + 8_000, 600, false)
  colonyScene([session('rest-1', resting)], T0 + 9_000, 600, false)
  const still = mainOf('rest-1', colonyScene([session('rest-1', resting)], T0 + 20_000, 600, false).workers)
  expect(still?.look).toBe('work')
  const later = mainOf('rest-1', colonyScene([session('rest-1', resting)], T0 + 25_000, 600, false).workers)
  expect(later?.look).toBe('chill')
  expect(later?.since).toBe(T0 + 25_000)
})

test('waiting on the person goes to the hall at once, and back to work after', async () => {
  colonyScene([session('wait-1')], T0, 600, false)
  const waiting = mainOf('wait-1', colonyScene([session('wait-1', { state: 'waiting', kind: 'waiting', now: 'Needs your OK: Running npm test' })], T0 + 1_000, 600, false).workers)
  expect(waiting?.look).toBe('wait')
  expect({ x: waiting?.x, y: waiting?.y }).toEqual(SPOTS.hall)
  const back = mainOf('wait-1', colonyScene([session('wait-1')], T0 + 2_000, 600, false).workers)
  expect(back).toMatchObject({ look: 'work', task: 'develop' })
})

test('a background subagent keeps working while its session rests; a lost one is let go', async () => {
  const resting = { state: 'idle' as const, idleSince: T0 - 10_000, turnStartedAt: null }
  const scene = colonyScene([session('bg-1', { ...resting, agents: [agent('busy', { lastAt: T0 - 300_000 }), agent('gone', { name: 'Quill', lastAt: T0 - 3_600_000, startedAt: T0 - 4_000_000 })] })], T0, 600, false)
  expect(scene.workers.find(w => w.key === 'bg-1/busy')?.look).toBe('work')
  expect(scene.workers.find(w => w.key === 'bg-1/gone')).toBe(undefined)
})

test('a new subagent walks out of the hall to its building', async () => {
  const scene = colonyScene([session('walk-1', { agents: [agent('a1')] })], T0, 600, false)
  const sub = scene.workers.find(w => w.key === 'walk-1/a1')
  // Its captain is editing there too, at the door; it stands beside.
  expect(sub).toMatchObject({ fx: SPOTS.hall?.x, fy: SPOTS.hall?.y, x: (SPOTS.workshop?.x ?? 0) + 16, since: T0 })
  const drawn = colonySvg(scene, T0 + 500)
  expect(drawn.source).toContain('class="walk"')
  expect(drawn.source).toContain('animation-delay:-500ms')
  // Once it has arrived, a fresh drawing stands it there.
  expect(colonySvg(scene, T0 + 60_000).source).not.toContain('class="walk"')
})

test('the line over the map says what everyone is doing, in words, once', async () => {
  const w = (look: SceneWorker['look'], task: SceneWorker['task']): SceneWorker => ({ key: `${look}${task}${Math.random()}`, name: 'N', role: 'lead', look, task, progress: null, x: 0, y: 0, fx: 0, fy: 0, since: 0, ms: 0 })
  const workers = [w('work', 'develop'), w('work', 'develop'), w('work', 'research'), w('wait', 'plan'), w('chill', 'develop'), w('sleep', 'test')]
  expect(tallyOf(workers)).toBe('1 needs you · 2 developing · 1 researching · 1 chilling · 1 done')
  expect(tallyOf(workers, 150)).toBe('1 needs you · 3 at work · 1 chilling · 1 done')
})

test('a crowd of every role still draws within the page\'s limit, the busiest first', async () => {
  const roles = ['lead', 'sonnet-worker', 'opus-worker', 'opus-deep', 'haiku-quick', 'haiku-worker', 'Explore', 'Plan', 'general-purpose', 'statusline-setup', 'claude-code-guide']
  const looks = ['work', 'chill', 'wait', 'sleep', 'failed'] as const
  const workers = Array.from({ length: 60 }, (_, i): SceneWorker => ({
    key: `crowd/${i}`, name: `Worker number ${i}`, role: roles[i % roles.length] ?? 'lead', look: looks[i % looks.length] ?? 'work', task: 'develop',
    progress: 0.5, x: 20 + ((i * 37) % 280), y: 30 + ((i * 23) % 150), fx: 160, fy: 60, since: T0, ms: 4_000,
  }))
  const drawn = colonySvg({ width: 1600, isStill: false, workers }, T0 + 1_000)
  expect(JSON.stringify(drawn.source).length <= DRAWING_LIMIT).toBe(true)
  // Everyone waiting on the person is still there; the line counts all sixty.
  expect((drawn.source.match(/class="bang\b/g) ?? []).length).toBe(12)
  expect(drawn.alt).toContain('12 need you')
  expect(drawn.source).toContain('12 need you')
})

test('the signs show pictures, not words', async () => {
  const drawn = colonySvg({ width: 600, isStill: false, workers: [] }, T0)
  for (const word of ['Develop', 'Research', 'Review', '>Test<', '>Plan<', 'Debug']) expect(drawn.source).not.toContain(word)
})

test('a panel opened after a long while shows how things stand now, at once', async () => {
  forgetColony()
  colonyScene([session('gap-1')], T0, 600, false)
  // The panel was closed for an hour; the session has rested since half an hour in.
  const later = T0 + 3_600_000
  const main = mainOf('gap-1', colonyScene([session('gap-1', { state: 'idle', idleSince: T0 + 1_800_000, turnStartedAt: null })], later, 600, false).workers)
  expect(main?.look).toBe('chill')
  expect(colonyDueAt(later)).toBe(null)
})

test('a held change is redrawn when due, however long since the last drawing, unless that drew no colony', async () => {
  forgetColony()
  colonyScene([session('due-1')], T0, 600, false)
  colonyScene([session('due-1', { state: 'idle', idleSince: T0 + 1_000, turnStartedAt: null })], T0 + 2_000, 600, false)
  // Nothing redraws for a while: the change is still due, and the tick asks for it.
  expect(colonyDueAt(T0 + 17_000)).toBe(T0 + 16_000)
  // It asked, and the redraw drew no colony: asking again would only loop.
  noteColonyForced(T0 + 17_000)
  expect(colonyDueAt(T0 + 19_000)).toBe(null)
})

test("a stroll's keyframes hold where strollAt says it stands", async () => {
  for (const name of ['a', 'b'] as const) {
    const css = strollKeyframes(name)
    expect(css).toContain('90%,100%')
    const key = Array.from({ length: 80 }, (_, i) => `s${i}/main`).find(k => strollAt(k, 1).x === 0 && strollAt(k, 22_000 * 0.37).x !== 0 && ((hashKey(k) >> 2) % 2 === 0) === (name === 'a')) ?? ''
    // Every held corner in the CSS is where strollAt has the stroller then, and home at the end.
    for (const [f, stop] of [[0.07, 0], [0.37, 1], [0.67, 2], [0.95, 3]] as const) {
      const at = strollAt(key, 22_000 * f)
      expect(css).toContain(`{transform:translate(${at.x}px,${at.y}px)}`)
      if (stop === 3) expect(at).toEqual({ x: 0, y: 0 })
    }
  }
})

test('a crowd at the tents stays on the map, and two widths agree on where everyone stands', async () => {
  forgetColony()
  const done = Array.from({ length: 24 }, (_, i) => ({ id: `d${i}`, name: `Done ${i}`, state: 'done' as const, endedAt: T0 - 1_000 }))
  const list = [session('crowd-1', { agents: done.map(d => ({ id: d.id, name: d.name, type: 'haiku-quick', description: 'Find a thing', model: 'claude-haiku-5-5', state: d.state, now: 'Done', startedAt: T0 - 9_000, endedAt: d.endedAt, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1 })) })]
  const narrow = colonyScene(list, T0, 360, false)
  for (const w of narrow.workers) expect(w.y > 0 && w.y <= MAP_TALL - 6).toBe(true)
  const wide = colonyScene(list, T0 + 100, 1600, false)
  expect(wide.workers.map(w => [w.x, w.y, w.since])).toEqual(narrow.workers.map(w => [w.x, w.y, w.since]))
})

test('walks follow the roads through the plaza, setting off and arriving gently', async () => {
  const route = routeOf(SPOTS.library ?? { x: 0, y: 0 }, SPOTS.forge ?? { x: 0, y: 0 })
  // The forge stands between its door and the road: the walk takes the lane beside it.
  expect(route.legs.map(l => l.to)).toEqual([{ x: 64, y: 104 }, { x: 260, y: 104 }, { x: 260, y: 130 }, SPOTS.forge])
  // No step of any walk between two doors crosses a building.
  const doors = Object.values(SPOTS)
  for (const a of doors) for (const b of doors) {
    const r = routeOf(a, b)
    for (let i = 1; i < 40; i += 1) {
      const p = pointOn(r, (r.ms * i) / 40)
      const on = BUILDINGS.find(k => p.x > k.x + 2 && p.x < k.x + Math.max(...k.art.grid.map(g => g.length)) * 2 - 2 && p.y > k.y + 2 && p.y < k.y + k.art.grid.length * 2 - 2)
      expect(on?.key ?? 'clear').toBe('clear')
    }
  }
  // Barely moving at first; well along the road by the middle; there at the end.
  expect(pointOn(route, route.ms * 0.02).y - (SPOTS.library?.y ?? 0) < 1).toBe(true)
  expect(pointOn(route, route.ms * 0.5).y).toBe(104)
  expect(pointOn(route, route.ms)).toEqual(SPOTS.forge)
  // A step to a neighbouring spot goes straight.
  expect(routeOf({ x: 252, y: 70 }, { x: 268, y: 70 }).legs).toHaveLength(1)
})

test('a stroller called away sets off from where its stroll had taken it', async () => {
  forgetColony()
  // Find a session id whose captain strolls.
  const id = Array.from({ length: 50 }, (_, i) => `stroll-${i}`).find(i => strollAt(`${i}/main`, 6_000).x !== 0) ?? ''
  const resting = { state: 'idle' as const, idleSince: T0 - 60_000, turnStartedAt: null }
  const seated = mainOf(id, colonyScene([session(id, resting)], T0, 600, false).workers)
  const arrived = (seated?.since ?? 0) + (seated?.ms ?? 0)
  const off = strollAt(`${id}/main`, 6_000)
  const away = mainOf(id, colonyScene([session(id, { turnStartedAt: arrived + 6_000 - 10_000 })], arrived + 6_000, 600, false).workers)
  expect(away?.look).toBe('work')
  expect({ x: away?.fx, y: away?.fy }).toEqual({ x: Math.round(((seated?.x ?? 0) + off.x) * 10) / 10, y: Math.round(((seated?.y ?? 0) + off.y) * 10) / 10 })
})

test('idle and sleeping workers go unnamed; the line over the map counts everyone', async () => {
  forgetColony()
  const list = Array.from({ length: 50 }, (_, i) => session(`many-${i}`, i === 0 ? {} : { state: 'idle', idleSince: T0 - 600_000, turnStartedAt: null }))
  const scene = colonyScene(list, T0, 600, false)
  expect(scene.workers.length).toBe(40)
  const drawn = colonySvg(scene, T0)
  expect(drawn.alt).toContain('49 chilling')
  expect((drawn.source.match(/class="nm"/g) ?? []).length).toBe(1)
})

test('a crowd at an edge door fans inward, every worker on a spot of its own', async () => {
  forgetColony()
  const agents = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, type: 'sonnet-worker', description: 'Run the tests', model: 'claude-sonnet-5-5', state: 'working' as const, now: 'Running npm test', kind: 'running', startedAt: T0 - 9_000, endedAt: null, tokens: ZERO, contextTokens: 0, contextWindow: 1, steps: 1, tools: 1, lastAt: T0 - 1_000 }))
  const scene = colonyScene([session('edge-1', { task: 'Run the test suite', now: 'Running npm test', kind: 'running', agents })], T0, 600, false)
  const atForge = scene.workers.filter(w => w.task === 'test')
  expect(atForge.length >= 6).toBe(true)
  expect(new Set(atForge.map(w => `${w.x},${w.y}`)).size).toBe(atForge.length)
  // A second line forms below the door, away from the forge; none stands on the mine next door.
  for (const w of atForge) expect(w.y >= (SPOTS.forge?.y ?? 0)).toBe(true)
  const mine = BUILDINGS.find(b => b.key === 'mine')
  for (const w of atForge) expect(w.x < (mine?.x ?? 0) + 46 && w.y > (mine?.y ?? 0) - 2 && w.y < (mine?.y ?? 0) + 20).toBe(false)
})

test('seats round the plaza stay on the map and off the buildings, each one taken once', async () => {
  const seen = new Set<string>()
  for (let i = 0; i < 40; i += 1) {
    const s = seatAt(i)
    expect(seen.has(`${s.x},${s.y}`)).toBe(false)
    seen.add(`${s.x},${s.y}`)
  }
  for (let i = 0; i < 60; i += 1) {
    const s = seatAt(i)
    expect(s.y <= MAP_TALL - 8 && s.y >= 30).toBe(true)
    const on = BUILDINGS.find(k => s.x > k.x && s.x < k.x + Math.max(...k.art.grid.map(g => g.length)) * 2 && s.y > k.y && s.y < k.y + k.art.grid.length * 2 + 10)
    expect(on?.key ?? 'clear').toBe('clear')
  }
})

test('a long name is cut short over the map', async () => {
  forgetColony()
  const scene = colonyScene([session('long-1', { agents: [agent('a1', { name: 'An extraordinarily long agent name indeed' })] })], T0, 600, false)
  expect(scene.workers.find(w => w.key === 'long-1/a1')?.name).toBe('An extraordin…')
})

test('a crowd at a door keeps clear of the signs and the tents', async () => {
  forgetColony()
  const devs = Array.from({ length: 6 }, (_, i) => agent(`w${i}`, { name: `Dev${i}` }))
  const done = Array.from({ length: 12 }, (_, i) => agent(`z${i}`, { name: `Z${i}`, state: 'done', endedAt: T0 - 1_000 }))
  const scene = colonyScene([session('crowd-2', { agents: [...devs, ...done] })], T0, 600, false)
  const signs = BUILDINGS.map(b => ({ x: b.x + b.sign.x, y: b.y + b.sign.y, w: 18, h: 18 }))
  for (const w of scene.workers) {
    for (const s of signs) expect(w.x + 6 > s.x && w.x - 6 < s.x + s.w && w.y > s.y && w.y - 24 < s.y + s.h).toBe(false)
  }
  // The sleepers' extra lines form below the tents, not on them.
  for (const w of scene.workers.filter(w => w.look === 'sleep')) expect(w.y >= (SPOTS.tents?.y ?? 0)).toBe(true)
})

// --- Pastimes. ---

const resting = { state: 'idle' as const, now: 'Waiting', kind: undefined, idleSince: T0 - 600_000, turnStartedAt: null }
// The first `n` session ids from `prefix` whose captain takes `play`.
const idsFor = (prefix: string, play: string, n: number): string[] => Array.from({ length: 4_000 }, (_, i) => `${prefix}${i}`).filter(id => playOf(`${id}/main`) === play).slice(0, n)
// What marks each pastime in a drawing.
const MARK: Readonly<Record<string, RegExp>> = {
  sip: /class="sip l"/, stroll: /class="stroll-[ab]"/, juggle: /class="juggle l"/, dance: /class="dance l"/, fish: /class="fish l"/, water: /class="drip l"/,
  pet: /class="pet l"/, lute: /class="strum l"/, read: /class="read-a l"/, kite: /class="kite-b l"/, birds: /class="bird-a l"/,
}
const idler = (key: string, at: { x: number; y: number }, over: Partial<SceneWorker> = {}): SceneWorker => ({ key, name: 'N', role: 'lead', look: 'chill', task: 'develop', progress: null, x: at.x, y: at.y, fx: at.x, fy: at.y, since: T0 - 100_000, ms: 1_000, ...over })
const meets = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const bodyAt = (s: { x: number; y: number }) => ({ x: s.x - 6, y: s.y - 24, w: 12, h: 24 })
const wallOf = (b: (typeof BUILDINGS)[number]) => ({ x: b.x, y: b.y, w: Math.max(...b.art.grid.map(r => r.length)) * 2, h: b.art.grid.length * 2 })
const signOf = (b: (typeof BUILDINGS)[number]) => ({ x: b.x + b.sign.x, y: b.y + b.sign.y - 6, w: 18, h: 18 + (b.wall === null ? 16 : 6) })
const TENT_BOXES = [{ x: 58, y: 132, w: 22, h: 14 }, { x: 82, y: 138, w: 22, h: 14 }]
// Where a worker at play stands for its pastime: a venue's spot, or a seat with room for it.
const spotFor = (play: string, i = 0) => VENUES.find(v => v.play === play)?.spots[i % 2] ?? (play === 'kite' || play === 'birds' ? (Array.from({ length: 60 }, (_, n) => seatAt(n)).filter(s => hasRoomFor(play, s))[i] ?? seatAt(0)) : seatAt(i))
const NEW_LOOPS = [['fish', 'fish', 6_400], ['ripple', 'fish', 6_400], ['drip', 'drip', 1_200], ['pet', 'pet', 1_600], ['heart', 'heart', 5_600], ['strum', 'strum', 1_600], ['note', 'note', 3_600], ['read-a', 'read', 7_000], ['kite-a', 'kite', 9_000], ['bird-a', 'birds', 3_600]] as const

test('every pastime is reachable, at its venue or round the fire, and drawn as itself', async () => {
  for (const play of PLAYS) {
    forgetColony()
    const id = idsFor(`reach-${play}-`, play, 1)[0] ?? ''
    expect(id).not.toBe('')
    const w = mainOf(id, colonyScene([session(id, resting)], T0, 600, false).workers)
    const venue = VENUES.find(v => v.play === play)
    // A venue's pastime takes its worker to the venue; any other, to a seat by the fire.
    if (venue) expect(venue.spots.some(s => s.x === w?.x && s.y === w?.y)).toBe(true)
    else expect({ x: w?.x, y: w?.y }).toEqual({ x: seatAt(0).x, y: seatAt(0).y })
    // Drawn where it has room, it shows as itself and as nothing else, and carries only its own motion.
    const drawn = colonySvg({ width: 600, isStill: false, workers: [idler(`${id}/main`, spotFor(play))] }, T0).source
    expect(MARK[play]?.test(drawn)).toBe(true)
    for (const other of PLAYS) if (other !== play) expect(MARK[other]?.test(drawn)).toBe(false)
  }
  const none = colonySvg({ width: 600, isStill: false, workers: [] }, T0).source
  for (const kf of ['@keyframes kite-a', '@keyframes fish', '@keyframes dance', '@keyframes stroll-a', '@keyframes ar']) expect(none).not.toContain(kf)
})

test('venues stand clear of the signs, the buildings, the tents and each other, and no one else stands on them', async () => {
  for (const v of VENUES) {
    expect(v.spots.length >= 1).toBe(true)
    for (const s of v.spots) {
      expect(standsClear(s, v.key)).toBe(true)
      // Its body stands within the venue's own ground.
      expect(s.x - 6 >= v.box.x && s.x + 6 <= v.box.x + v.box.w && s.y - 24 >= v.box.y && s.y <= v.box.y + v.box.h).toBe(true)
    }
    for (const b of BUILDINGS) {
      expect(meets(v.box, wallOf(b))).toBe(false)
      expect(meets(v.box, signOf(b))).toBe(false)
    }
    for (const t of TENT_BOXES) expect(meets(v.box, t)).toBe(false)
    for (const o of VENUES) if (o !== v) expect(meets(v.box, o.box)).toBe(false)
    expect(v.box.y + v.box.h <= MAP_TALL).toBe(true)
    // No fire seat stands on a venue.
    for (let i = 0; i < 60; i += 1) expect(meets(bodyAt(seatAt(i)), v.box)).toBe(false)
  }
  // Nor does a crowd at a door: fourteen asleep by the tents, next to the cat and the garden.
  forgetColony()
  const done = Array.from({ length: 14 }, (_, i) => agent(`z${i}`, { name: `Z${i}`, state: 'done', endedAt: T0 - 1_000 }))
  const scene = colonyScene([session('venue-crowd', { agents: done })], T0, 600, false)
  for (const w of scene.workers.filter(w => w.look === 'sleep')) for (const v of VENUES) expect(meets(bodyAt(w), v.box)).toBe(false)
})

test('a kite or the birds only where they have room: never over a building, sign, tent or door crowd', async () => {
  const hall = SPOTS.hall ?? { x: 0, y: 0 }
  let kites = 0
  let birds = 0
  for (let i = 0; i < 60; i += 1) {
    const seat = seatAt(i)
    for (const play of ['kite', 'birds'] as const) {
      const id = idsFor(`room-${play}-`, play, 1)[0] ?? ''
      const at = pastimeAt(`${id}/main`, seat)
      // Decided by seat: the same answer every time.
      expect(pastimeAt(`${id}/main`, seat)).toEqual(at)
      expect(at.play === play).toBe(hasRoomFor(play, seat))
      if (at.play !== play) {
        expect(['sip', 'juggle', 'dance', 'lute', 'read'].includes(at.play)).toBe(true)
        continue
      }
      if (play === 'kite') kites += 1
      else birds += 1
      const box = reachOf(play, seat)
      for (const b of BUILDINGS) expect(meets(box, wallOf(b)) || meets(box, signOf(b))).toBe(false)
      for (const t of TENT_BOXES) expect(meets(box, t)).toBe(false)
      for (const v of VENUES) expect(meets(box, v.box)).toBe(false)
      if (play === 'kite') for (const dx of [0, 16, -16, 32, -32]) expect(meets(box, bodyAt({ x: hall.x + dx, y: hall.y }))).toBe(false)
      // Nor over whoever sits at any other seat.
      for (let j = 0; j < 60; j += 1) if (j !== i && seatAt(j) !== seatAt(i)) expect(meets(box, bodyAt(seatAt(j)))).toBe(false)
    }
  }
  // The seats just below the hall never fly one; a kite is rare, the birds less so, but both happen.
  for (const i of [6, 7]) expect(hasRoomFor('kite', seatAt(i))).toBe(false)
  expect(kites >= 1 && birds >= 10).toBe(true)
})

test('a full venue sends a newcomer to the fire, and one coming or going moves no one else', async () => {
  forgetColony()
  const pond = VENUES.find(v => v.key === 'pond')
  const atPondSpot = (s: string | undefined) => pond?.spots.some(p => `${p.x},${p.y}` === s) === true
  const fishers = idsFor('fisher-', 'fish', 5)
  const others = [...idsFor('fisher-', 'lute', 1), ...idsFor('fisher-', 'read', 1)]
  const where = (ids: string[], now: number) => new Map(colonyScene(ids.map(id => session(id, resting)), now, 600, false).workers.map(w => [w.key.replace('/main', ''), `${w.x},${w.y}`]))
  const all = [...fishers.slice(0, 3), ...others]
  const first = where(all, T0)
  // Two fish at the pond; the third, finding it full, sits by the fire and does something else there.
  const atPond = all.filter(id => atPondSpot(first.get(id)))
  expect(atPond.length).toBe(2)
  const spare = fishers.slice(0, 3).find(id => !atPond.includes(id)) ?? ''
  const [sx, sy] = (first.get(spare) ?? '0,0').split(',').map(Number)
  expect(pastimeAt(`${spare}/main`, { x: sx ?? 0, y: sy ?? 0 }).play).not.toBe('fish')
  // One at the pond leaves: the one by the fire stays put, and so does everyone else.
  const left = all.filter(id => id !== atPond[0])
  const after = where(left, T0 + 1_000)
  for (const id of left) expect(after.get(id)).toBe(first.get(id))
  // A fourth fisher arrives: the free spot at the pond is its, and no one else moves.
  const more = [...left, fishers[3] ?? '']
  const then = where(more, T0 + 2_000)
  for (const id of left) expect(then.get(id)).toBe(first.get(id))
  expect(then.get(fishers[3] ?? '')).toBe(first.get(atPond[0] ?? ''))
  // A fifth finds the pond full again: to the fire, everyone else where they were.
  const last = where([...more, fishers[4] ?? ''], T0 + 3_000)
  for (const id of more) expect(last.get(id)).toBe(then.get(id))
  expect(atPondSpot(last.get(fishers[4] ?? ''))).toBe(false)
})

test('every loop follows the clock: one delay per worker, the same for the same moment, each loop as far in as the clock says', async () => {
  // Every loop's length divides the span the worker's delay is taken over.
  for (const ms of Object.values(LOOP_MS)) expect(CLOCK_SPAN % ms).toBe(0)
  const key = 'tick/main'
  for (const [, loop, ms] of NEW_LOOPS) {
    for (const dt of [0, 100, 999, 5_000, 20_000]) expect(loopDelay(loop, T0 + dt, key)).toBe((loopDelay(loop, T0, key) + dt) % ms)
    expect(loopDelay(loop, T0, key)).toBe(workerDelay(T0, key) % ms)
  }
  // A drawing sets that one delay on the worker, and every loop in it takes it; it depends only on
  // the worker and the clock, not on who else is drawn.
  const workers = PLAYS.map((play, i) => idler(`${idsFor(`clock-${play}-`, play, 1)[0]}/main`, spotFor(play, i)))
  const now = T0 + 12_345
  const all = colonySvg({ width: 600, isStill: false, workers }, now).source
  expect(colonySvg({ width: 600, isStill: false, workers }, now).source).toBe(all)
  expect(all).toMatch(/\.l\{animation-delay:var\(--d\)\}<\/style>|\.l\{animation-delay:var\(--d\)\}\.nm/)
  for (const w of workers) {
    expect(all).toContain(`style="--d:-${workerDelay(now, w.key)}ms"`)
    expect(colonySvg({ width: 600, isStill: false, workers: [w] }, now).source).toContain(`style="--d:-${workerDelay(now, w.key)}ms"`)
  }
  // No loop carries a delay of its own.
  expect(all).not.toMatch(/class="[a-z-]+ l" style=/)
})

test("each new loop's CSS runs for its own length, slow and in whole steps", async () => {
  for (const [cls, , ms] of NEW_LOOPS) expect(COLONY_MOTION).toMatch(new RegExp(`\\.${cls}(,\\.[a-z-]+)*\\{animation:([a-z-]+ )?${ms}ms`))
  expect(COLONY_MOTION).toContain(`.pet{animation:pet 1600ms steps(2,end)`)
  expect(COLONY_MOTION).toContain(`.strum{animation:strum 1600ms steps(1,end)`)
})

test('forty idlers over every pastime still draw whole within the page\'s limit, narrow or wide', async () => {
  for (const width of [360, 1600]) {
    const workers = Array.from({ length: 40 }, (_, i): SceneWorker => {
      const play = PLAYS[i % PLAYS.length] ?? 'sip'
      const key = `${idsFor(`worst-${i}-`, play, 1)[0]}/main`
      return idler(key, spotFor(play, i), { role: ['lead', 'sonnet-worker', 'opus-deep', 'haiku-quick', 'Explore'][i % 5] ?? 'lead' })
    })
    const drawn = colonySvg({ width, isStill: false, workers }, T0)
    expect(JSON.stringify(drawn.source).length <= DRAWING_LIMIT).toBe(true)
    // No one was left out to make it fit.
    expect((drawn.source.match(/class="sh"/g) ?? []).length).toBe(40)
  }
})

test('forty walking at once, to work or to play, all draw within the page\'s limit, narrow or wide', async () => {
  const hall = SPOTS.hall ?? { x: 0, y: 0 }
  const tasks = ['develop', 'research', 'review', 'test', 'plan', 'debug'] as const
  const roles = ['lead', 'sonnet-worker', 'opus-worker', 'opus-deep', 'haiku-quick', 'haiku-worker', 'Explore', 'Plan', 'general-purpose']
  const walker = (i: number, look: 'work' | 'chill'): SceneWorker => {
    const task = tasks[i % 6] ?? 'develop'
    const play = PLAYS[i % PLAYS.length] ?? 'sip'
    const door = SPOTS[BUILDINGS.find(b => b.task === task)?.key ?? 'hall'] ?? hall
    const to = look === 'work' ? { x: door.x + ((i % 7) - 3) * 16, y: door.y + (Math.floor(i / 7) % 2) * 22 } : spotFor(play, i)
    const key = look === 'work' ? `walk-${i}/main` : `${idsFor(`walk-${i}-`, play, 1)[0]}/main`
    return { key, name: `Worker ${i}`, role: roles[i % roles.length] ?? 'lead', look, task, progress: look === 'work' ? 0.5 : null, x: to.x, y: to.y, fx: hall.x, fy: hall.y, since: T0, ms: routeOf(hall, to).ms }
  }
  for (const look of ['work', 'chill'] as const) {
    const workers = Array.from({ length: 40 }, (_, i) => walker(i, look))
    for (const width of [360, 1600]) {
      const drawn = colonySvg({ width, isStill: false, workers }, T0 + 500)
      expect(JSON.stringify(drawn.source).length <= DRAWING_LIMIT).toBe(true)
      expect((drawn.source.match(/class="sh"/g) ?? []).length).toBe(40)
    }
  }
})

test('on the way to play a worker walks upright with empty hands, and takes up its pastime on arrival', async () => {
  for (const play of ['read', 'pet', 'birds', 'fish', 'kite', 'sip'] as const) {
    const key = `${idsFor(`arrive-${play}-`, play, 1)[0]}/main`
    const at = spotFor(play)
    const w = idler(key, at, { fx: SPOTS.hall?.x ?? 0, fy: SPOTS.hall?.y ?? 0, since: T0, ms: 6_000 })
    const walking = colonySvg({ width: 600, isStill: false, workers: [w] }, T0 + 1_000).source
    // Its props (and a sitter's seated body) wait in a layer shown from arrival, 5 s on.
    const layer = walking.slice(walking.indexOf('<g class="ar" style="animation-delay:5000ms">'))
    expect(layer.length > 0 && walking.includes('<g class="ar" style="animation-delay:5000ms">')).toBe(true)
    expect(MARK[play]?.test(layer)).toBe(true)
    expect(MARK[play]?.test(walking.slice(0, walking.indexOf('<g class="ar"')))).toBe(false)
    // A sitter walks on its feet, hidden on arrival.
    expect(walking.includes('<g class="lv" style="animation-delay:5000ms">')).toBe(play === 'read' || play === 'pet' || play === 'sip')
    expect(walking).toContain('.lv{opacity:0;')
    // Once there, it simply is at its pastime.
    const there = colonySvg({ width: 600, isStill: false, workers: [w] }, T0 + 7_000).source
    expect(there).not.toContain('class="ar"')
    expect(there).not.toContain('class="lv"')
    expect(MARK[play]?.test(there)).toBe(true)
  }
})

test("a gardener's pacing is where the scene says it is, and no other new pastime moves anyone", async () => {
  const garden = VENUES.find(v => v.key === 'garden')
  const key = `${idsFor('gardener-', 'water', 1)[0]}/main`
  for (const spot of garden?.spots ?? []) {
    const name = spot.flip ? 'pace-l' : 'pace'
    const css = strollKeyframes(name)
    // Each held stop in the CSS is where strollAt has the gardener then.
    for (const f of [0.1, 0.25, 0.6, 0.75]) {
      const at = strollAt(key, 18_000 * f, spot)
      expect(css).toContain(`{transform:translate(${at.x}px,${at.y}px)}`)
    }
    expect(strollAt(key, 18_000 * 0.6, spot).x).toBe(spot.flip ? -6 : 6)
    // The drawing paces it from when it arrived.
    const w = idler(key, spot, { since: T0, ms: 2_000 })
    expect(colonySvg({ width: 600, isStill: false, workers: [w] }, T0 + 5_000).source).toContain(`class="stroll-${name}" style="animation-delay:-3000ms"`)
  }
  // Off its spot (the garden was full), a gardener stands still.
  expect(strollAt(key, 18_000 * 0.6, seatAt(0))).toEqual({ x: 0, y: 0 })
  for (const play of ['fish', 'pet', 'lute', 'read', 'kite', 'birds']) {
    const other = `${idsFor(`still-${play}-`, play, 1)[0]}/main`
    for (const t of [1_000, 7_000, 15_000]) expect(strollAt(other, t, spotFor(play))).toEqual({ x: 0, y: 0 })
    expect(colonySvg({ width: 600, isStill: false, workers: [idler(other, spotFor(play))] }, T0).source).not.toMatch(/class="stroll-/)
  }
})

test('a gardener called away sets off from where its pacing had taken it', async () => {
  forgetColony()
  const garden = VENUES.find(v => v.key === 'garden')
  const id = idsFor('pacer-', 'water', 1)[0] ?? ''
  const seated = mainOf(id, colonyScene([session(id, resting)], T0, 600, false).workers)
  const spot = garden?.spots.find(s => s.x === seated?.x && s.y === seated?.y)
  expect(spot !== undefined).toBe(true)
  const arrived = (seated?.since ?? 0) + (seated?.ms ?? 0)
  const t = arrived + 18_000 * 0.6
  const off = strollAt(`${id}/main`, t - arrived, spot)
  expect(Math.abs(off.x)).toBe(6)
  const away = mainOf(id, colonyScene([session(id, { turnStartedAt: t - 10_000 })], t, 600, false).workers)
  expect(away?.look).toBe('work')
  expect({ x: away?.fx, y: away?.fy }).toEqual({ x: (seated?.x ?? 0) + off.x, y: seated?.y })
})

test('the cat\'s hearts rise over the cat, whichever side its petter sits', async () => {
  const cat = VENUES.find(v => v.key === 'cat')
  const key = `${idsFor('hearts-', 'pet', 1)[0]}/main`
  for (const spot of cat?.spots ?? []) {
    const drawn = colonySvg({ width: 600, isStill: false, workers: [idler(key, spot)] }, T0).source
    const x = Number(drawn.match(/<g class="heart l"><use href="#d\d+" x="(-?[\d.]+)"/)?.[1])
    // The heart is three art pixels wide: its middle is over the cat's.
    expect(spot.x + x + 3).toBe(cat?.at.x ?? 0)
  }
})

test('Still and reduced motion stop every loop, show everyone arrived, and hide part-time frames', async () => {
  expect(COLONY_MOTION).toContain('@media (prefers-reduced-motion:reduce){*{animation:none!important}.smoke rect{opacity:.5}}')
  expect(colonySvg({ width: 600, isStill: true, workers: [] }, T0).source).toContain('*{animation:none!important}.smoke rect{opacity:.5}</style>')
  // With nothing moving, the walking body hides and the arrived pose shows.
  expect(COLONY_MOTION).toContain('.lv{opacity:0;')
  expect(COLONY_MOTION).not.toMatch(/\.ar\{[^}]*opacity/)
  for (const cls of ['ripple', 'read-b', 'kite-a', 'tail-b']) expect(COLONY_MOTION).toMatch(new RegExp(`\\.${cls}(,\\.[a-z-]+)*\\{opacity:0\\}`))
})

test('a name sits just under its worker, or over a bare head, and nowhere further off', async () => {
  const list = Array.from({ length: 14 }, (_, i) => session(`names-${i}`, { agents: [agent(`n${i}a`, { name: `Name${i}` })] }))
  colonyScene(list, T0, 900, false)
  const at = T0 + 120_000
  const source = colonySvg(colonyScene(list, at, 900, false), at).source
  const tags = [...source.matchAll(/<g transform="translate\(([\d.-]+) ([\d.-]+)\)"><text x="([\d.-]+)" y="([\d.-]+)" class="nm">([^<]*)<\/text>/g)]
  // Twenty-eight workers crowd one door: only those with room by them are named.
  expect(tags.length).toBeGreaterThan(4)
  const size = nameSizeOf(900)
  // Below: the baseline a few units under the feet. Over the head: above the body, never higher.
  for (const tag of tags) {
    const y = Number(tag[4])
    expect(y <= 3 + size).toBe(true)
    expect(y >= -40).toBe(true)
    // Slid along at most so far that it still reaches over its own body.
    expect(Math.abs(Number(tag[3])) <= 30).toBe(true)
  }
})

// --- Names. ---

test('every name sits by its own worker, clear of the signs, the "!"s and every other name, the same each time', async () => {
  const waiting = (id: string, name: string) => agent(id, { name, kind: 'waiting', now: 'Needs your OK: npm test' })
  const testing = (id: string, name: string) => agent(id, { name, description: 'Run the tests', now: 'Running npm test', kind: 'running' })
  const list = [
    session('names-1', { state: 'waiting', kind: 'waiting', now: 'Needs your OK', agents: [waiting('w1', 'Jett'), waiting('w2', 'Marigold'), agent('r1', { name: 'Marlow', type: 'Explore', description: 'Research the API' }), agent('r2', { name: 'Basil', type: 'Explore', description: 'Find the config' }), agent('v1', { name: 'Gizmo', type: 'opus-worker', description: 'Review the diff' }), agent('v2', { name: 'Quill', type: 'opus-worker', description: 'Review the demo' })] }),
    session('names-2', { task: 'Run the test suite', now: 'Running npm test', kind: 'running', agents: [testing('t1', 'Pepper'), testing('t2', 'Tansy'), testing('t3', 'Rowan'), testing('t4', 'Bartholomew'), testing('t5', 'Yara')] }),
    session('names-3', { agents: [agent('d1', { name: 'Fennel' }), agent('d2', { name: 'Juniper' }), agent('p1', { name: 'Hazel', type: 'Plan', description: 'Plan the rollout' })] }),
    session('names-4', { state: 'waiting', kind: 'waiting', now: 'Needs your OK' }),
  ]
  const signs = BUILDINGS.map(b => signOf(b))
  for (const width of [420, 1000]) {
    forgetColony()
    const scene = colonyScene(list, T0, width, false)
    const named = scene.workers.filter(w => w.look === 'work' || w.look === 'wait')
    expect(named.length >= 15).toBe(true)
    // In a crowd some names are left out rather than put where they would read as a neighbour's;
    // those who need the person are named first.
    const names = placeNames(scene.workers, width)
    const size = nameSizeOf(width)
    // The same scene always places them the same way, and the drawing puts them there.
    expect([...placeNames(scene.workers, width)]).toEqual([...names])
    const drawn = colonySvg(scene, T0).source
    expect(names.size >= 8).toBe(true)
    expect(named.filter(w => w.look === 'wait').some(w => names.has(w.key))).toBe(true)
    for (const w of named) {
      const at = names.get(w.key)
      if (!at) continue
      expect(drawn).toContain(`<text x="${at.x}" y="${at.y}" class="nm">${w.name}</text>`)
      // Close to its own worker: within one name's height of its body, or of the bar or "!" over it.
      const head = w.y - 26
      const own = { x: w.x - 6, y: head - (w.look === 'wait' ? 20 : 9), w: 12, h: w.y - head + (w.look === 'wait' ? 20 : 9) }
      const gapX = Math.max(0, own.x - (at.box.x + at.box.w), at.box.x - (own.x + own.w))
      const gapY = Math.max(0, own.y - (at.box.y + at.box.h), at.box.y - (own.y + own.h))
      expect(Math.max(gapX, gapY) <= size).toBe(true)
      // Under the feet, or over a bare head: never up over a bar or a "!", where it floats off.
      const mark = headOf(w).mark
      if (mark) expect(at.y > 0).toBe(true)
      // Never over another worker, whose name it would seem to be.
      for (const o of scene.workers) if (o !== w) expect(meets(at.box, { x: o.x - 6, y: o.y - 26, w: 12, h: 26 })).toBe(false)
      for (const s of signs) expect(meets(at.box, s)).toBe(false)
      // Never over another's "!".
      for (const o of named) if (o !== w && o.look === 'wait') expect(meets(at.box, { x: o.x - 7, y: o.y - 20 - 19, w: 14, h: 16 })).toBe(false)
      for (const o of named) {
        const other = names.get(o.key)
        if (o !== w && other) expect(meets(at.box, other.box)).toBe(false)
      }
    }
  }
})

// --- Accessories. ---

test('each worker wears its own little something, the same every time, drawn once and shared', async () => {
  const keys = Array.from({ length: 600 }, (_, i) => `wear-${i}/main`)
  const worn = keys.map(k => accessoryOf(k))
  expect(keys.map(k => accessoryOf(k))).toEqual(worn)
  const kinds = new Set(worn.map(k => k.replace(/\d+$/, '')))
  for (const kind of ['', 'shades', 'specs', 'scarf', 'bowtie', 'cheeks', 'mustache', 'backpack', 'pin']) expect(kinds.has(kind)).toBe(true)
  // A good share wear something; some wear nothing.
  const bare = worn.filter(k => k === '').length / worn.length
  expect(bare > 0.08 && bare < 0.3).toBe(true)
  // Many wearing the same thing share one drawing of it, standing, sitting, asleep or at work.
  const key = keys.find(k => accessoryOf(k) === 'scarf1') ?? ''
  const workers = (['work', 'chill', 'sleep', 'wait'] as const).map((look, i): SceneWorker => ({ key, name: 'N', role: ['lead', 'sonnet-worker', 'Explore', 'opus-deep'][i] ?? 'lead', look, task: 'develop', progress: null, x: 40 + i * 40, y: 120, fx: 0, fy: 0, since: 0, ms: 1 }))
  const drawn = colonySvg({ width: 600, isStill: false, workers }, T0).source
  const id = drawn.match(/<g id="(d\d+)"><g fill="none" stroke-width="2"><path stroke="#e8c46a"/)?.[1] ?? ''
  expect(id).not.toBe('')
  // The sleeper's is a grey drawing of its own, like its body.
  expect((drawn.match(new RegExp(`href="#${id}"`, 'g')) ?? []).length).toBe(3)
  expect(drawn).toContain('#9a958d')
})

test('a worker with a bar is never named up over its bar, where the name would float off', async () => {
  const w: SceneWorker = { key: 'lone/main', name: 'Pepper', role: 'sonnet-worker', look: 'work', task: 'test', progress: 0.5, x: 264, y: 130, fx: 264, fy: 130, since: T0 - 100_000, ms: 1_000 }
  const place = placeNames([w], 600).get(w.key)
  // Under its feet if there is room; otherwise left out.
  expect(place === undefined || place.y > 0).toBe(true)
})

test('rosy cheeks are left off pink and red skins, and accessories go grey on a sleeper', async () => {
  const key = Array.from({ length: 2000 }, (_, i) => `cheek-${i}/main`).find(k => accessoryOf(k) === 'cheeks') ?? ''
  expect(key).not.toBe('')
  const at = (look: SceneWorker['look'], role: string): string => colonySvg({ width: 600, isStill: false, workers: [{ key, name: 'N', role, look, task: 'develop', progress: null, x: 100, y: 100, fx: 100, fy: 100, since: T0 - 100_000, ms: 1_000 }] }, T0).source
  expect(at('work', 'sonnet-worker')).toContain('#e8697f')
  expect(at('failed', 'sonnet-worker')).not.toContain('#e8697f')
  expect(at('work', 'general-purpose')).not.toContain('#e8697f')
  expect(at('sleep', 'sonnet-worker')).not.toContain('#e8697f')
})
