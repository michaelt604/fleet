import type { FleetAgent, FleetSession } from '../types'
import type { Crew, Progress, Task } from './describe'
import { LOST_AGENT_MS, agentProgress, crewsOf, isAgentLive, jobOf, pickName, sessionProgress, spriteKind, taskVote } from './describe'
import type { ColonyScene, Look, Route, SceneWorker, Spot } from './colony'
import { BUILDING_OF, CROWD, FIRE_AT, MAP_TALL, SPOTS, VENUES, VILLAGE_W, countOf, nudge, playOf, pointOn, routeOf, seatAt, standsClear, strollAt, venueOf } from './colony'
import { visibleAgents } from './svg'

// Who stands where in the colony, decided in the hooks module, where it can remember: each worker's
// task held steady, its spot kept, its walk timed. The scene it hands the drawing is plain data that
// stays the same from one redraw to the next until something about a worker changes, so the page
// (colony-view-25.tsx) draws again only then, and a walk under way is never restarted.

// A worker as this module sees it: `job` what it was asked to do, `vote` what its current step says,
// `look` what its state says right now, and since when, where the heartbeat says (`changedAt`).
type Worker = { key: string; name: string; role: string; look: Look; job: Task; vote: Task | null; progress: number | null; changedAt?: number }


// Progress for the bar over a worker's head: an exact one in eighths (a bar 18 pixels wide shows no
// finer), a guess in quarters, since a guess creeps up with every tool call and each step would
// redraw the colony for nothing.
const barOf = (p: Progress | null): number | null =>
  p === null || !Number.isFinite(p.fraction) ? null : Math.round(Math.max(0, Math.min(1, p.fraction)) * (p.isEstimate ? 4 : 8)) / (p.isEstimate ? 4 : 8)

// A session's workers: its main agent, crowned and named as its captain, then its subagents.
function workersOf(s: FleetSession, now: number, crew: Crew): Worker[] {
  const isQuiet = s.state === 'idle' || s.state === 'ended'
  const kind = spriteKind(s.state, s.now, s.kind)
  const lookOf = (state: string, kind: string): Look =>
    state === 'done' ? 'sleep' : state === 'failed' ? 'failed' : kind === 'waiting' || state === 'waiting' ? 'wait' : 'work'
  const main: Worker = {
    key: `${s.id}/main`,
    name: crew.name,
    role: 'lead',
    look: isQuiet ? 'chill' : lookOf(s.state, kind),
    job: jobOf(s.task),
    vote: taskVote(jobOf(s.task), kind, s.now, true),
    progress: isQuiet ? null : barOf(sessionProgress(s)),
    changedAt: isQuiet ? (s.idleSince ?? undefined) : (s.turnStartedAt ?? undefined),
  }
  const agents = visibleAgents(s, now).map((a: FleetAgent): Worker => {
    const heard = Math.max(a.lastAt ?? 0, a.toolAt ?? 0, a.startedAt)
    // One running in the background keeps working while its session rests; one marked running in an
    // ended session, or lost (long silent: its end never arrived), has stopped.
    const hasStopped = a.state === 'working' && (s.state === 'ended' || !isAgentLive(a, now))
    const agentKind = spriteKind(a.state, a.now, a.kind)
    return {
      key: `${s.id}/${a.id}`,
      name: a.name || pickName(a.id, []),
      role: a.type,
      look: hasStopped ? 'chill' : lookOf(a.state, agentKind),
      job: jobOf(a.description, a.type),
      vote: taskVote(jobOf(a.description, a.type), agentKind, a.now, false),
      progress: hasStopped ? null : barOf(agentProgress(a)),
      changedAt: hasStopped ? heard + LOST_AGENT_MS : undefined,
    }
  })
  return [main, ...agents]
}

// What each worker is shown doing, held steady: a change must hold a while before the worker moves,
// so a quick command, a pause between tool calls or a short turn doesn't send it off and back. Off
// to play only after STEADY.toChill of rest; back to work after STEADY.toWork; to another task after
// STEADY.toTask. Waiting on the person, finishing and failing show at once.
const STEADY = { toChill: 15_000, toWork: 3_000, toTask: 10_000 }
type Shown = { look: Look; task: Task }
const held = new Map<string, { shown: Shown; next?: Shown; since?: number }>()

const isSame = (a: Shown, b: Shown): boolean => a.look === b.look && a.task === b.task
const steadyFor = (from: Shown, to: Shown): number => (to.look === 'chill' ? STEADY.toChill : from.look === 'chill' ? STEADY.toWork : STEADY.toTask)

// When the colony was last worked out. Nothing is decided while it isn't drawn (a closed panel), so
// a change that has waited out its hold by then shows at once.
let lastBuilt = 0

function shownOf(wk: Worker, now: number): Shown {
  const h = held.get(wk.key)
  if (!h) {
    const shown = { look: wk.look, task: wk.vote ?? wk.job }
    held.set(wk.key, { shown })
    return shown
  }
  // A step with nothing to say keeps whatever task is pending, or the one shown.
  const wanted: Shown = { look: wk.look, task: wk.look === 'wait' ? h.shown.task : (wk.vote ?? h.next?.task ?? h.shown.task) }
  if (isSame(wanted, h.shown)) {
    h.next = undefined
    return h.shown
  }
  const isAtOnce = wanted.look === 'wait' || h.shown.look === 'wait' || wanted.look === 'sleep' || wanted.look === 'failed' || h.shown.look === 'sleep' || h.shown.look === 'failed'
  if (isAtOnce) {
    h.shown = wanted
    h.next = undefined
    return h.shown
  }
  if (!h.next || !isSame(h.next, wanted)) {
    h.next = wanted
    // A change of state dates from when it happened, where the heartbeat says; a task's from now.
    const isLookChange = wanted.look !== h.shown.look
    h.since = isLookChange && wk.changedAt !== undefined ? Math.min(now, Math.max(wk.changedAt, lastBuilt)) : now
    if (now - lastBuilt > STEADY.toChill) h.since = Math.min(h.since, now - steadyFor(h.shown, wanted))
  }
  if (now - (h.since ?? now) >= steadyFor(h.shown, wanted)) {
    h.shown = wanted
    h.next = undefined
  }
  return h.shown
}

// How many times the colony has been worked out, and that count when a redraw was last asked for so
// a held change could show. If no drawing followed (the colony isn't drawn: an empty list, or the
// list fell back to text), asking again won't help. Counts, not times: a drawing already under way
// when the redraw was asked for is stamped earlier, yet does follow.
let builds = 0
let buildsWhenForced = -1
export const noteColonyForced = (_now: number): void => {
  buildsWhenForced = builds
}

// When the soonest held change is due to show, or null when none waits, or when the last redraw
// asked for one drew no colony: a redraw then lets it.
export function colonyDueAt(_now: number): number | null {
  if (builds === buildsWhenForced) return null
  let due: number | null = null
  for (const h of held.values()) {
    if (!h.next || h.since === undefined) continue
    const at = h.since + steadyFor(h.shown, h.next)
    due = due === null ? at : Math.min(due, at)
  }
  return due
}

// Where a worker goes: the building for its task; the hall to wait on the person; at play, its
// pastime's venue (the pond, the garden, the cat) or the plaza; the tents once done.
const placeOf = (shown: Shown, key: string): string =>
  shown.look === 'sleep' || shown.look === 'failed' ? 'tents' : shown.look === 'chill' ? (venueOf(playOf(key))?.key ?? 'chill') : shown.look === 'wait' ? 'hall' : BUILDING_OF[shown.task]
const venueByKey = new Map(VENUES.map(v => [v.key, v]))
const isIdlePlace = (place: string): boolean => place === 'chill' || venueByKey.has(place)

// Each worker keeps its spot at a place for as long as it stays there; a newcomer takes the first
// free one. Numbering by order instead would shuffle everyone whenever one worker came or went.
// A venue has only so many spots: a newcomer finding it full sits at the fire instead, and stays
// there while it is at play, even once a spot frees up, so no one idle gets up and goes.
type Slot = { place: string; slot: number }
const spots = new Map<string, Slot>()

function slotsFor(keys: readonly string[], wanted: readonly string[]): Slot[] {
  const used = new Map<string, Set<number>>()
  const usedAt = (place: string): Set<number> => {
    const set = used.get(place) ?? new Set<number>()
    used.set(place, set)
    return set
  }
  const kept = keys.map((key, i): Slot | null => {
    const was = spots.get(key)
    const place = wanted[i] ?? 'chill'
    const isOverflow = was?.place === 'chill' && venueByKey.has(place)
    if (!was || (was.place !== place && !isOverflow) || usedAt(was.place).has(was.slot)) return null
    usedAt(was.place).add(was.slot)
    return was
  })
  return kept.map((was, i) => {
    let slot = was
    if (!slot) {
      const room = venueByKey.get(wanted[i] ?? '')?.spots.length
      let place = wanted[i] ?? 'chill'
      let n = 0
      while (usedAt(place).has(n)) n += 1
      if (room !== undefined && n >= room) {
        place = 'chill'
        n = 0
        while (usedAt(place).has(n)) n += 1
      }
      usedAt(place).add(n)
      slot = { place, slot: n }
    }
    spots.set(keys[i] ?? '', slot)
    return slot
  })
}

// A worker's spot at a place: side by side at a door, round the plaza at play. A crowd at a door
// wraps into more lines, toward the middle of the map, and everything keeps inside the village,
// whatever the panel's width, so two drawings of different widths agree on where everyone is.
// The spots at a door, in the order a crowd takes them: side by side in front of it, then more lines
// below (every building stands above its door, so below is away from it). A door near the village's
// edge (the forge, the tower) fans inward only. Spots that would hide a sign, stand on another
// building or the tents, or leave the village are skipped.
type DoorSpot = Spot
const doorSpots = new Map<string, DoorSpot[]>()

function doorSpotsOf(place: string): DoorSpot[] {
  const known = doorSpots.get(place)
  if (known) return known
  const base = SPOTS[place] ?? FIRE_AT
  const reach = 16 * Math.ceil((CROWD - 1) / 2)
  const side = base.x + reach > VILLAGE_W - 8 ? -1 : base.x - reach < 8 ? 1 : 0
  const offsets = side === 0 ? Array.from({ length: CROWD }, (_, i) => nudge(i)) : [0, 16, 32, 48].map(o => o * side)
  const list: DoorSpot[] = []
  for (let line = 0; line < 8; line += 1) {
    for (const dx of offsets) {
      const s = { x: base.x + dx, y: base.y + line * 22 }
      if (s.y > MAP_TALL - 6) continue
      if ((line === 0 && dx === 0) || standsClear(s, place)) list.push(s)
    }
  }
  // A crowd bigger than the clear spots (nine testers at once) spreads wider rather than stacking.
  for (let line = 0; list.length < 24 && line < 4; line += 1) {
    for (const dx of [64, -64, 80, -80, 96, -96, 112, -112]) {
      const s = { x: base.x + dx, y: base.y + line * 22 }
      const isOnVenue = VENUES.some(v => s.x > v.box.x - 6 && s.x < v.box.x + v.box.w + 6 && s.y > v.box.y && s.y - 24 < v.box.y + v.box.h)
      if (s.x >= 8 && s.x <= VILLAGE_W - 8 && s.y <= MAP_TALL - 6 && !isOnVenue && !list.some(t => t.x === s.x && t.y === s.y)) list.push(s)
    }
  }
  doorSpots.set(place, list)
  return list
}

function spotOf(place: string, n: number): DoorSpot {
  if (place === 'chill') return seatAt(n)
  const venue = venueByKey.get(place)
  if (venue) {
    const s = venue.spots[Math.min(n, venue.spots.length - 1)] ?? venue.at
    return { x: s.x, y: s.y }
  }
  const list = doorSpotsOf(place)
  return list[Math.min(n, list.length - 1)] ?? (SPOTS[place] ?? FIRE_AT)
}

// Where each worker was headed, from where and since when, and whether it strolls once there: the
// same walk until its goal moves.
type Trail = { from: Spot; to: Spot; since: number; route: Route; strolls: boolean }
const trails = new Map<string, Trail>()

function trailOf(key: string, to: Spot, now: number, start: Spot, strolls: boolean): Trail {
  const was = trails.get(key)
  if (was && was.to.x === to.x && was.to.y === to.y) return was
  // A new goal: set off from wherever the drawing has it now, mid-walk, arrived, or partway round a
  // stroll; a newcomer from `start`.
  let from = start
  if (was) {
    const at = pointOn(was.route, now - was.since)
    const off = was.strolls ? strollAt(key, now - was.since - was.route.ms, was.to) : { x: 0, y: 0 }
    from = { x: Math.round((at.x + off.x) * 10) / 10, y: Math.round((at.y + off.y) * 10) / 10 }
  }
  const trail = { from, to, since: now, route: routeOf(from, to), strolls }
  trails.set(key, trail)
  return trail
}

// A name over the map is kept short: a long one would cover its neighbours.
const NAME_MAX = 14
const shortName = (name: string): string => {
  const chars = [...name.trim()]
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('').trimEnd()}…` : chars.join('')
}

// At most this many workers are drawn, the busiest first: past it the drawing would outgrow the
// app's limit (131,072 characters).
export const MOST_WORKERS = 40
const RANK: Readonly<Record<Look, number>> = { wait: 0, work: 1, chill: 2, failed: 3, sleep: 4 }

// The colony's scene for a drawing `width` pixels wide.
export function colonyScene(list: readonly FleetSession[], now: number, width: number, isStill: boolean): ColonyScene {
  const crews = crewsOf(list)
  const all = list.flatMap(s => workersOf(s, now, crews.get(s.id) ?? { name: 'Aria' }))
  const shown = new Map(all.map(wk => [wk.key, shownOf(wk, now)]))
  lastBuilt = now
  builds += 1
  const look = (wk: Worker): Look => shown.get(wk.key)?.look ?? wk.look
  const workers = all
    .map((wk, i) => ({ wk, i }))
    .sort((a, b) => RANK[look(a.wk)] - RANK[look(b.wk)] || a.i - b.i)
    .slice(0, MOST_WORKERS)
    .sort((a, b) => a.i - b.i)
    .map(({ wk }) => wk)

  const slots = slotsFor(
    workers.map(wk => wk.key),
    workers.map(wk => placeOf(shown.get(wk.key) ?? { look: wk.look, task: wk.job }, wk.key)),
  )
  const hall = { x: SPOTS.hall?.x ?? 0, y: SPOTS.hall?.y ?? 0 }
  const scene = workers.map((wk, i): SceneWorker => {
    const s = shown.get(wk.key) ?? { look: wk.look, task: wk.job }
    const { place, slot } = slots[i] ?? { place: 'chill', slot: 0 }
    const at = spotOf(place, slot)
    // A new subagent walks out of the hall; a main agent starts where it is.
    const trail = trailOf(wk.key, at, now, wk.key.endsWith('/main') ? at : hall, isIdlePlace(place))
    return {
      key: wk.key,
      name: shortName(wk.name),
      role: wk.role,
      look: s.look,
      task: s.task,
      progress: s.look === 'work' ? wk.progress : null,
      x: at.x,
      y: at.y,
      fx: trail.from.x,
      fy: trail.from.y,
      since: trail.since,
      ms: trail.route.ms,
    }
  })

  // Forget the tasks, spots and walks of workers no longer drawn.
  const ids = new Set(workers.map(wk => wk.key))
  for (const key of [...trails.keys()]) if (!ids.has(key)) trails.delete(key)
  for (const key of [...held.keys()]) if (!shown.has(key)) held.delete(key)
  for (const key of [...spots.keys()]) if (!ids.has(key)) spots.delete(key)
  // The line over the map counts everyone, drawn or not.
  const count = countOf(all.map(wk => ({ ...wk, look: look(wk), task: shown.get(wk.key)?.task ?? wk.job, x: 0, y: 0, fx: 0, fy: 0, since: 0, ms: 0 })))
  return { width, isStill, workers: scene, count }
}

// Forgets everything the scene remembers, as a reload does.
export function forgetColony(): void {
  held.clear()
  spots.clear()
  trails.clear()
  lastBuilt = 0
  builds = 0
  buildsWhenForced = -1
}
