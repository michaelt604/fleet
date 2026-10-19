import type { Task } from './describe'
import { THEME, PAD, clean, escape, measure, roleOf } from './svg'

// The colony: one village for the whole fleet, seen from above in pixel art, under the list.
// Each building is a general task, marked by a hanging sign with a picture, never a word: a hammer
// at the workshop (develop), a book at the library (research), a lens at the watchtower (review),
// a flask at the forge (test and build), a scroll at the town hall (plan, and waiting on the person),
// a bug at the mine (debug). The words are said once, in the line over the map. A worker works at
// the building for its task, holding that task's tool; one with nothing to do plays round the fire;
// a finished subagent sleeps by the tents. It is for fun: each worker shows only its name.
//
// This module only draws: a scene in, an SVG out. It runs in the hooks module and, on the desktop,
// in the page itself (colony-view-26.tsx), so a redraw of the panel never restarts a walk.
// colony-scene.ts decides who stands where.

export const P = 2 // one art pixel, in map units
const OUT = '#2b201b' // every sprite's outline
const HEAD = 26
export const MAP_TALL = 198 // map units
export const VILLAGE_W = 320 // the village's own width; wider maps get forest either side

type Colors = Readonly<Record<string, string>>
export type Spot = { x: number; y: number }
type Box = { x: number; y: number; w: number; h: number }
type Art = { grid: readonly string[]; colors: Colors }

// A grid of art pixels at (x, y), outlined: each letter a colour, '.' clear. Every clear cell
// beside a filled one takes the outline colour. Runs of one colour become one path, kept short (the
// app refuses a drawing past 131,072 characters): each run a line one art pixel thick along its row,
// each after the first placed from the end of the last.
function sprite(grid: readonly string[], colors: Colors, x: number, y: number, isOutlined = true): string {
  const H = grid.length
  const W = Math.max(...grid.map(row => row.length))
  const filled = (r: number, c: number): boolean => r >= 0 && r < H && c >= 0 && colors[grid[r]?.[c] ?? '.'] !== undefined
  const isEdge = (r: number, c: number): boolean => !filled(r, c) && (filled(r - 1, c) || filled(r + 1, c) || filled(r, c - 1) || filled(r, c + 1))
  const runs = new Map<string, { d: string; x: number; y: number }>()
  const n = (v: number) => +v.toFixed(2)
  const run = (r: number, c: number, end: number, color: string) => {
    const at = { x: x + c * P, y: y + r * P + P / 2 }
    const was = runs.get(color)
    const move = was ? `m${n(at.x - was.x)} ${n(at.y - was.y)}` : `M${n(at.x)} ${n(at.y)}`
    runs.set(color, { d: `${was?.d ?? ''}${move}h${(end - c) * P}`, x: at.x + (end - c) * P, y: at.y })
  }
  if (isOutlined) {
    for (let r = -1; r <= H; r += 1) {
      let c = -1
      while (c <= W) {
        if (!isEdge(r, c)) {
          c += 1
          continue
        }
        let end = c
        while (end <= W && isEdge(r, end)) end += 1
        run(r, c, end, OUT)
        c = end
      }
    }
  }
  grid.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      const color = colors[row[c] ?? '.']
      if (!color) {
        c += 1
        continue
      }
      let end = c
      while (end < row.length && row[end] === row[c]) end += 1
      run(r, c, end, color)
      c = end
    }
  })
  return `<g fill="none" stroke-width="${P}">${[...runs].map(([color, path]) => `<path stroke="${color}" d="${path.d}"/>`).join('')}</g>`
}

// Scenery drawn many times (trees, bushes, tents) is defined once and placed with <use>.
const useArt = (id: string, x: number, y: number): string => `<use href="#${id}" x="${x}" y="${y}"/>`

// --- Buildings, drawn from a few numbers: a stepped gable roof over a wall with a door and windows. ---

type House = { w: number; roof: number; wall: number; door: number; doorW?: number; doorH?: number; windows: number[]; chimney?: number }

function houseGrid(h: House): string[] {
  const extra = h.chimney !== undefined ? 3 : 0
  const rows = Array.from({ length: extra + h.roof + h.wall }, () => Array.from({ length: h.w }, () => '.'))
  const set = (r: number, c: number, ch: string) => {
    const row = rows[r]
    if (row && c >= 0 && c < h.w) row[c] = ch
  }
  for (let i = 0; i < h.roof; i += 1) {
    const inset = h.roof - 1 - i
    for (let c = inset; c < h.w - inset; c += 1) set(extra + i, c, i === 0 ? 'L' : i === h.roof - 1 ? 'D' : c === inset ? 'L' : 'R')
  }
  if (h.chimney !== undefined) {
    for (let r = 0; r < extra + 2; r += 1) {
      set(r, h.chimney, r === 0 ? 'c' : 'C')
      set(r, h.chimney + 1, r === 0 ? 'c' : 'C')
    }
  }
  const top = extra + h.roof
  for (let r = 0; r < h.wall; r += 1) for (let c = 1; c < h.w - 1; c += 1) set(top + r, c, r === h.wall - 1 ? 'w' : 'W')
  const dw = h.doorW ?? 4
  const dh = h.doorH ?? 5
  const d0 = h.door - Math.floor(dw / 2)
  for (let r = 0; r < dh; r += 1) for (let c = 0; c < dw; c += 1) set(top + h.wall - dh + r, d0 + c, r === 0 ? 'f' : 'd')
  for (const wx of h.windows) {
    for (let r = 0; r < 4; r += 1) for (let c = 0; c < 4; c += 1) set(top + 2 + r, wx + c, r === 0 || r === 3 || c === 0 || c === 3 ? 'f' : 'g')
  }
  return rows.map(row => row.join(''))
}

const CREAM = { W: '#e6d8b8', w: '#bba982', d: '#5a3a26', f: '#3f2a1c', g: '#f3d26b' }
const HALL: Art = { grid: houseGrid({ w: 30, roof: 8, wall: 12, door: 15, doorW: 6, doorH: 6, windows: [4, 22] }), colors: { ...CREAM, L: '#d06a4e', R: '#b5523b', D: '#7f3527' } }
const LIBRARY: Art = { grid: houseGrid({ w: 22, roof: 7, wall: 10, door: 11, windows: [3, 15] }), colors: { ...CREAM, L: '#7a9bd0', R: '#4f6fa8', D: '#33497a' } }
const WORKSHOP: Art = { grid: houseGrid({ w: 22, roof: 6, wall: 10, door: 8, windows: [14] }), colors: { W: '#c48c5c', w: '#9a6a42', d: '#4a2f1f', f: '#3f2a1c', g: '#f3d26b', L: '#b07a50', R: '#8b5a3c', D: '#5e3a25' } }
const FORGE: Art = { grid: houseGrid({ w: 20, roof: 6, wall: 10, door: 13, windows: [3], chimney: 4 }), colors: { W: '#b7b0a2', w: '#8e877b', d: '#2b201b', f: '#3f2a1c', g: '#f08a3c', L: '#8a94a3', R: '#5d6675', D: '#3d4450', C: '#7a726c', c: '#4a4440' } }
const TOWER: Art = {
  grid: [
    '....LR....', '...LRRR...', '...LRRR...', '..LRRRRR..', '..LRRRRR..', '.LRRRRRRR.', 'DDDDDDDDDD',
    '.WWWWWWWW.', '.WWWffWWW.', '.WWWggWWW.', '.WWWggWWW.', '.WWWWWWWW.', '.WWWWWWWW.', '.WWWffWWW.',
    '.WWWggWWW.', '.WWWggWWW.', '.WWWWWWWW.', '.WWWffWWW.', '.WWWddWWW.', '.WWWddWWW.', '.wwwddwww.',
  ],
  colors: { L: '#6fbfaa', R: '#3f8f7c', D: '#2b6656', W: '#c4bdb0', w: '#8e877b', f: '#3f2a1c', g: '#f3d26b', d: '#5a3a26' },
}
const MINE: Art = {
  grid: [
    '......HHHHH...........', '....HHKKKKKKHH........', '...HKKKKKKKKKKKH......', '..HKKKKKkkKKKKKKKH....',
    '.HKKKKTTTTTTKKKKKKkH..', '.KKKKKTddddTKKKKKkkk..', 'KKKKKKTddddTKKKKkkkkk.', 'KKKKKKTddddTKKKkkkkkkk', 'kkkkkkTddddTkkkkkkkkkk',
  ],
  colors: { H: '#b3aea5', K: '#8f8a82', k: '#6f6a63', T: '#8b5a3c', d: '#1f1814' },
}
const FLAG: Art = { grid: ['pFFFF', 'pFFFF', 'pFF..', 'p....', 'p....', 'p....'], colors: { p: '#5a3a26', F: '#e08a68' } }
const ANVIL: Art = { grid: ['.AAAAAA', 'AAAAAA.', '..AA...', '.AAAA..'], colors: { A: '#5b6270' } }
const BARREL: Art = { grid: ['.NNN.', 'NnnnN', 'NNNNN', 'NnnnN', '.NNN.'], colors: { N: '#8b5a3c', n: '#6b4029' } }
const CART: Art = { grid: ['MmmmmM', 'MMMMMM', '.o..o.'], colors: { M: '#6f7680', m: '#c9a26b', o: '#2b201b' } }
const BOOK: Art = { grid: ['kkKkk', 'kkKkk', 'kkKkk'], colors: { k: '#f4ebd0', K: '#4f6fa8' } }
const TENT: Art = { grid: ['....E....', '...EEe...', '..EEEee..', '.EEdddee.', 'EEEdddeee'], colors: { E: '#ece1c6', e: '#c6b48e', d: '#5a3a26' } }
const FIRE = { a: ['...o....', '..oyo...', '..oyyo..', '.SoyyoS.', 'SNNNNNNS', '.SSSSSS.'], b: ['....o...', '...oyo..', '..oyyo..', '.SoyyoS.', 'SNNNNNNS', '.SSSSSS.'], colors: { S: '#8e877b', N: '#7a4f33', o: '#f08a3c', y: '#f7d154' } }
const BENCH_H: Art = { grid: ['NNNNNNN', 'nnnnnnn'], colors: { N: '#9a6a42', n: '#6b4029' } }
const BENCH_V: Art = { grid: ['Nn', 'Nn', 'Nn', 'Nn', 'Nn'], colors: { N: '#9a6a42', n: '#6b4029' } }
const TREE: Art = {
  grid: ['...HHHH....', '..HHGGGGG..', '.HHGGGGGGg.', '.HGGGGGGGg.', 'HGGGGGGGGgg', 'GGGGGGGGggg', '.GGGGGGggg.', '..ggggggg..', '....TTt....', '....TTt....'],
  colors: { H: '#7bb35e', G: '#4f8a43', g: '#386a33', T: '#7a4f33', t: '#5a3a26' },
}
const PINE: Art = {
  grid: ['.....H.....', '....HGg....', '...HGGGg...', '....GGg....', '...HGGGg...', '..HGGGGGg..', '...GGGGg...', '..HGGGGGg..', '.HGGGGGGGg.', 'HGGGGGGGGgg', '....TTt....', '....TTt....'],
  colors: { H: '#5f9a55', G: '#3d7542', g: '#2b5732', T: '#7a4f33', t: '#5a3a26' },
}
const BUSH: Art = { grid: ['.HGG.', 'HGGGg', 'GGGgg', '.ggg.'], colors: { H: '#7bb35e', G: '#4f8a43', g: '#386a33' } }

const GRASS = '#5b8f4c'
const DIRT = '#c8a46e'
const DIRT_RIM = '#a8844f'

// --- Signs: a picture of each task on a small board, hung from the wall or stood on a post. ---

const WOOD = '#7a4f33'
const STEEL = '#6f7680'
const SIGN_ICONS: Readonly<Record<Task, Art>> = {
  develop: { grid: ['.sssss.', '.SSSSS.', '...N...', '...N...', '...N...', '...N...', '...N...'], colors: { s: '#9aa2ad', S: STEEL, N: WOOD } },
  research: { grid: ['.......', 'SKKKKKp', 'SKyyyKp', 'SKKKKKp', 'SKKKKKp', 'SKKKKKp', '.......'], colors: { S: '#33497a', K: '#4f6fa8', y: '#e8c46a', p: '#fbf6e6' } },
  review: { grid: ['.SSS...', 'SgggS..', 'SgggS..', 'SgggS..', '.SSSN..', '....NN.', '.....NN'], colors: { S: '#4a4440', g: '#9fd3ea', N: WOOD } },
  test: { grid: ['..CCC..', '...g...', '...g...', '..gLg..', '.gLLLg.', 'gLLLLLg', '.ggggg.'], colors: { C: '#8b5a3c', g: '#cfe9f2', L: '#5fb57a' } },
  plan: { grid: ['NNNNNNN', '.ppppp.', '.plllp.', '.ppppp.', '.pllpp.', '.ppppp.', 'NNNNNNN'], colors: { N: '#9a6a42', p: '#fbf6e6', l: '#8b6a4a' } },
  debug: { grid: ['.k...k.', '..kRk..', '.RRRRR.', 'kRkRkRk', '.RRRRR.', 'kRRkRRk', '..R.R..'], colors: { R: '#d7665d', k: OUT } },
}
const BOARD: Art = { grid: Array.from({ length: 9 }, () => 'bbbbbbbbb'), colors: { b: '#e9d6a8' } }
const BOARD_SIZE = 9 * P

// A task's sign with its board's top-left at (x, y): hung by two chains from an iron arm that
// runs from the wall at `wallX`, or, with no wall to hang from, stood on a post.
function signSvg(task: Task, x: number, y: number, wallX: number | null): string {
  const icon = SIGN_ICONS[task]
  const mount =
    wallX === null
      ? `<rect x="${x + BOARD_SIZE / 2 - 1.5}" y="${y + BOARD_SIZE}" width="3" height="10" fill="${OUT}"/><rect x="${x + BOARD_SIZE / 2 - 0.5}" y="${y + BOARD_SIZE}" width="1" height="9" fill="${WOOD}"/>`
      : `<rect x="${Math.min(wallX, x) - 1}" y="${y - 5}" width="${Math.abs(x + BOARD_SIZE / 2 - wallX) + BOARD_SIZE / 2 + 2}" height="2" fill="#3d3530"/><rect x="${x + 3}" y="${y - 3}" width="1" height="3" fill="#3d3530"/><rect x="${x + BOARD_SIZE - 4}" y="${y - 3}" width="1" height="3" fill="#3d3530"/>`
  return mount + sprite(BOARD.grid, BOARD.colors, x, y) + sprite(icon.grid, icon.colors, x + P, y + P, false)
}

// --- The village plan, in map units with the village's left edge at 0. ---

// Each building, the task it houses, and its sign: the board's top-left from the building's corner,
// and the wall its arm leaves from (null: a post). Signs hang clear of the doors workers crowd.
export const BUILDINGS: readonly { key: string; task: Task; x: number; y: number; art: Art; sign: Spot; wall: number | null }[] = [
  { key: 'hall', task: 'plan', x: 130, y: 12, art: HALL, sign: { x: -22, y: 22 }, wall: 2 },
  { key: 'library', task: 'research', x: 42, y: 30, art: LIBRARY, sign: { x: -22, y: 20 }, wall: 2 },
  { key: 'workshop', task: 'develop', x: 236, y: 32, art: WORKSHOP, sign: { x: 48, y: 18 }, wall: 42 },
  { key: 'tower', task: 'review', x: 6, y: 76, art: TOWER, sign: { x: 24, y: 4 }, wall: 18 },
  { key: 'forge', task: 'test', x: 268, y: 88, art: FORGE, sign: { x: -32, y: 24 }, wall: 2 },
  { key: 'mine', task: 'debug', x: 206, y: 128, art: MINE, sign: { x: 50, y: 10 }, wall: null },
]
export const BUILDING_OF = Object.fromEntries(BUILDINGS.map(b => [b.task, b.key])) as Readonly<Record<Task, string>>

// Where a worker stands for each kind of work (in front of the door), and the plaza's fire.
export const SPOTS: Readonly<Record<string, Spot>> = {
  hall: { x: 160, y: 60 }, library: { x: 64, y: 72 }, workshop: { x: 252, y: 70 }, tower: { x: 16, y: 126 },
  forge: { x: 296, y: 130 }, mine: { x: 226, y: 152 }, tents: { x: 82, y: 160 },
}
export const FIRE_AT: Spot = { x: 160, y: 104 }
// Spots round the plaza for those with nothing to do, front ones first, spread wide enough that
// their names don't meet; past these, a second ring further out.
const SEATS: readonly Spot[] = [
  { x: 128, y: 114 }, { x: 192, y: 114 }, { x: 146, y: 132 }, { x: 176, y: 132 }, { x: 116, y: 98 }, { x: 204, y: 98 }, { x: 140, y: 86 }, { x: 182, y: 86 },
]

// Workers sharing a spot stand side by side: 0, +16, -16, +32...; past CROWD a new line starts.
export const CROWD = 7
export const nudge = (i: number): number => (i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * 16)

// The ground a building (with its sign) stands on, in village units: no one is seated there.
const FOOTPRINTS: readonly Box[] = BUILDINGS.flatMap(b => [
  { x: b.x - 4, y: b.y - 4, w: Math.max(...b.art.grid.map(r => r.length)) * P + 8, h: b.art.grid.length * P + 12 },
  { x: b.x + b.sign.x - 2, y: b.y + b.sign.y - 6, w: 9 * P + 4, h: 9 * P + 18 },
])
// Whether a worker standing at a door's spot (its body about 12 wide and 24 tall above its feet)
// keeps clear of every sign, of every building but its own, and of the tents, and stays inside the
// village: a crowd at a door must not hide the signs that say what each building is for.
const TENTS: readonly Box[] = [{ x: 58, y: 132, w: 22, h: 14 }, { x: 82, y: 138, w: 22, h: 14 }]

// Little places to while away the time, along the foot of the village, each with a spot or two:
// a pond to fish in, a garden patch to water, and the village cat, to pet. `box` is the ground it
// takes, its idlers included: no one else is seated or crowds there. A spot that faces left flips.
export type VenueSpot = Spot & { flip?: boolean }
export type Venue = { key: string; play: 'fish' | 'water' | 'pet'; at: Spot; spots: readonly VenueSpot[]; box: Box }
export const VENUES: readonly Venue[] = [
  { key: 'pond', play: 'fish', at: { x: 218, y: 182 }, spots: [{ x: 186, y: 186 }, { x: 250, y: 186, flip: true }], box: { x: 178, y: 160, w: 78, h: 34 } },
  { key: 'garden', play: 'water', at: { x: 117, y: 181 }, spots: [{ x: 94, y: 186 }, { x: 140, y: 186, flip: true }], box: { x: 86, y: 162, w: 62, h: 32 } },
  { key: 'cat', play: 'pet', at: { x: 60, y: 186 }, spots: [{ x: 44, y: 188 }, { x: 76, y: 188, flip: true }], box: { x: 36, y: 164, w: 48, h: 30 } },
]
export const venueOf = (play: string): Venue | undefined => VENUES.find(v => v.play === play)

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
export function standsClear(s: Spot, own: string): boolean {
  if (s.x < 8 || s.x > VILLAGE_W - 8 || s.y > MAP_TALL - 6) return false
  const body = { x: s.x - 6, y: s.y - 24, w: 12, h: 24 }
  const signs = BUILDINGS.map(b => ({ x: b.x + b.sign.x, y: b.y + b.sign.y - 6, w: BOARD_SIZE, h: BOARD_SIZE + (b.wall === null ? 16 : 6) }))
  const walls = BUILDINGS.filter(b => b.key !== own).map(b => ({ x: b.x, y: b.y, w: Math.max(...b.art.grid.map(r => r.length)) * P, h: b.art.grid.length * P }))
  const venues = VENUES.filter(v => v.key !== own).map(v => v.box)
  return ![...signs, ...walls, ...venues, ...(own === 'tents' ? [] : TENTS)].some(box => overlaps(body, box))
}

const isClear = (s: Spot): boolean =>
  s.x >= 10 && s.x <= VILLAGE_W - 10 && s.y >= 30 && s.y <= MAP_TALL - 8 && ![...FOOTPRINTS, ...VENUES.map(v => v.box)].some(f => s.x > f.x - 6 && s.x < f.x + f.w + 6 && s.y > f.y && s.y < f.y + f.h + 22)

// Seats for those at play: the eight round the fire first, then spots on a grid spreading out from
// the plaza, nearest first, leaving out any on a building, a sign or off the map. The nth worker at
// play takes the nth; each seat is handed out once.
const SEAT_LIST: Spot[] = (() => {
  const grid: Spot[] = []
  for (let gx = -12; gx <= 12; gx += 1) for (let gy = -6; gy <= 6; gy += 1) grid.push({ x: FIRE_AT.x + gx * 18, y: FIRE_AT.y + gy * 15 })
  const near = grid.filter(s => Math.hypot(s.x - FIRE_AT.x, s.y - FIRE_AT.y) > 34).sort((a, b) => Math.hypot((a.x - FIRE_AT.x) / 1.6, a.y - FIRE_AT.y) - Math.hypot((b.x - FIRE_AT.x) / 1.6, b.y - FIRE_AT.y))
  const list: Spot[] = []
  for (const seat of [...SEATS, ...near]) if (isClear(seat) && !list.some(t => Math.abs(t.x - seat.x) < 14 && Math.abs(t.y - seat.y) < 12)) list.push(seat)
  return list
})()
export function seatAt(i: number): Spot {
  return SEAT_LIST[Math.min(i, SEAT_LIST.length - 1)] ?? FIRE_AT
}

// A filled ellipse in art-pixel rows, for the plaza.
function blob(cx: number, cy: number, rx: number, ry: number, color: string): string {
  let d = ''
  for (let r = -ry; r <= ry; r += 1) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (r / (ry + 0.5)) ** 2)))
    if (half > 0) d += `M${cx - half * P} ${cy + r * P}h${half * 2 * P}v${P}h${-half * 2 * P}z`
  }
  return `<path fill="${color}" d="${d}"/>`
}

// The x a spot's way to the road runs along: straight up or down from the spot, unless a building
// stands between it and the road (the forge, the mine, the tower all face away from it); then a lane
// beside that building. Village units.
export function laneOf(s: Spot): number {
  const top = Math.min(s.y, FIRE_AT.y)
  const bottom = Math.max(s.y, FIRE_AT.y)
  for (const b of BUILDINGS) {
    const x0 = b.x
    const x1 = b.x + Math.max(...b.art.grid.map(r => r.length)) * P
    const y0 = b.y
    const y1 = b.y + b.art.grid.length * P
    if (s.x > x0 - 6 && s.x < x1 + 6 && y1 > top && y0 < bottom) return x0 - 8 >= 10 ? x0 - 8 : x1 + 8
  }
  return s.x
}

// A dirt path from the road to a door, along the same lane walkers take: its rim, and its fill to
// lay over the rim. `dx` is the village's left edge in the map.
function path(fire: Spot, to: Spot, dx: number): { rim: string; fill: string } {
  const lane = laneOf(to) + dx
  const x = to.x + dx
  const strip = (x1: number, y1: number, x2: number, y2: number, half: number) =>
    `<rect x="${Math.min(x1, x2) - half}" y="${Math.min(y1, y2) - half}" width="${Math.abs(x2 - x1) + half * 2}" height="${Math.abs(y2 - y1) + half * 2}"/>`
  const end = to.y - 6
  const legs = (half: number) => strip(fire.x, fire.y, lane, fire.y, half) + strip(lane, fire.y, lane, end, half) + (lane !== x ? strip(lane, end, x, end, half) : '')
  return { rim: legs(5), fill: legs(3) }
}

// A steady pseudo-random number for a seed: the same scenery every draw.
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

// The art grows with the panel, so a wide one shows a bigger village, with forest either side.
export const scaleFor = (w: number): number => Math.min(1.6, Math.max(1, w / 350))
// The map's width in village units for a drawing `width` pixels wide, and where the village starts in it.
export function mapOf(width: number): { k: number; w: number; vx: number } {
  const k = scaleFor(width - 2 * PAD)
  const w = Math.round((width - 2 * PAD) / k)
  return { k, w, vx: Math.max(0, Math.round((w - VILLAGE_W) / 2)) }
}

// --- Workers. ---

// How a worker looks: at work, waiting on the person, at play, asleep (done), or failed.
export type Look = 'work' | 'wait' | 'chill' | 'sleep' | 'failed'

// One worker as the scene hands it over: plain data, the same from one redraw to the next until
// something about the worker changes. Spots are in village units; `since` is when its walk began.
export type SceneWorker = {
  key: string
  name: string
  role: string
  look: Look
  task: Task
  progress: number | null
  x: number
  y: number
  fx: number
  fy: number
  since: number
  ms: number
}

// How many are doing what, for the line over the map: everyone, drawn or not.
export type Count = { tasks: Partial<Record<Task, number>>; wait: number; chill: number; done: number }

// Everything the colony draws: the drawing's width in pixels, the person's Still setting, the workers
// drawn, and the count of everyone (left out, it is counted from the workers).
export type ColonyScene = { width: number; isStill: boolean; workers: SceneWorker[]; count?: Count }

// Hats as art pixels, the bottom row sitting on the head; 'h' is the hat colour, 'a' its accent.
const HATS: Readonly<Record<string, readonly string[]>> = {
  crown: ['a.a.a', 'hhhhh'],
  wizard: ['...h.', '..hh.', '.hah.', 'hhhhh'],
  tophat: ['.hhh.', '.aaa.', 'hhhhh'],
  hardhat: ['.hhh.', 'hhahh', 'hhhhh'],
  cap: ['.hhh.', 'hhhhhh'],
  propeller: ['aa.aa', '..a..', '.hhh.'],
  ranger: ['.h.h.', '.hhh.', 'hhhhh'],
  mortarboard: ['hhhhhh', '.hhh.a'],
  beanie: ['..a..', '.hhh.', 'hhhhh'],
  bucket: ['.hhh.', 'hhhhh'],
  headband: ['....h', 'hhhhh'],
}
// Five wide: a round head with two eyes, a shaded side, and feet; sitting, the feet tuck away.
const BODY = ['.bbb.', 'bebeb', 'bbbbb', 'Bbbbb', '.bbb.', '.f.f.']
const BODY_SITTING = ['.bbb.', 'bebeb', 'bbbbb', 'Bbbbb', '.bbb.']

// A little something each worker wears, the same every time for the same worker: shades, round
// specs, a scarf, a bow tie, rosy cheeks, a mustache, a backpack or a pin; or nothing. Each is a few
// art pixels laid on the body's own rows (row 0 its head's top, the same standing or sitting) and
// columns, kept to the body so it never meets a hat, a tool or a prop; a backpack hangs behind, on
// the side away from the tools. `x` shifts it by whole art pixels.
type Accessory = { grid: readonly string[]; colors: Colors; x?: number; isBehind?: boolean }
const SCARVES = ['#d7665d', '#e8c46a', '#5fa8a0', '#9b7fc4']
const ACCESSORIES: Readonly<Record<string, Accessory>> = {
  shades: { grid: ['', 'sssss'], colors: { s: '#1e1d1b' } },
  specs: { grid: ['', 'r.r.r'], colors: { r: '#f4ebd0' } },
  ...Object.fromEntries(SCARVES.map((c, i) => [`scarf${i}`, { grid: ['', '', '', 'ccccc', 'c....'], colors: { c } }])),
  // At the collar, on the body's last row, under the face (higher it reads as a mouth).
  bowtie0: { grid: ['', '', '', '', '.tTt.'], colors: { t: '#d7665d', T: '#8f3a33' } },
  bowtie1: { grid: ['', '', '', '', '.tTt.'], colors: { t: '#4f6fa8', T: '#33497a' } },
  cheeks: { grid: ['', '', 'p...p'], colors: { p: '#e8697f' } },
  mustache: { grid: ['', '', '.mmm.'], colors: { m: '#5a3a26' } },
  backpack: { grid: ['', '', 'kk', 'KK', 'kk'], colors: { k: '#9a6a42', K: '#6b4029' }, x: -2, isBehind: true },
  pin: { grid: ['', '', '', '...y'], colors: { y: '#f3d26b' } },
}
// About one worker in six wears nothing.
const WARDROBE = ['', 'shades', 'specs', 'scarf', 'bowtie', 'cheeks', 'mustache', 'backpack', 'pin', '', 'scarf', 'specs'] as const
export function accessoryOf(key: string): string {
  const n = hashKey(`${key}|wear`)
  const kind = WARDROBE[n % WARDROBE.length] ?? ''
  if (kind === 'scarf') return `scarf${(n >> 5) % SCARVES.length}`
  if (kind === 'bowtie') return `bowtie${(n >> 5) % 2}`
  return kind
}

// What a worker holds for its task, by its right hand: a hammer, a pickaxe, a book, a lens, a scroll, a flask.
const TOOLS: Readonly<Record<Task, { grid: readonly string[]; colors: Colors; swing: boolean }>> = {
  develop: { grid: ['AA', 'N.', 'N.'], colors: { A: '#aab1bb', N: WOOD }, swing: true },
  debug: { grid: ['AAA', '.N.', '.N.'], colors: { A: '#aab1bb', N: WOOD }, swing: true },
  research: { grid: ['kK', 'kK'], colors: { k: '#f4ebd0', K: '#4f6fa8' }, swing: false },
  review: { grid: ['AA.', 'AA.', '..N'], colors: { A: '#bfe3f2', N: WOOD }, swing: false },
  plan: { grid: ['k', 'k', 'k'], colors: { k: '#f4ebd0' }, swing: false },
  test: { grid: ['g', 'L'], colors: { g: '#cfe9f2', L: '#5fb57a' }, swing: false },
}

const hsl = (hue: number, s: number, l: number): string => `hsl(${hue} ${s}% ${l}%)`

// Workers are drawn a touch larger than the scenery's art pixels, so they read beside the buildings.
const WORKER_SCALE = 1.15
// Captains all wear the crown; their bodies take one of these hues so a plaza of them reads as people.
const CAPTAIN_HUES = [14, 32, 152, 188, 214, 268, 304, 336]
const CROWN = '#d9a43a'

// What a worker with nothing to do gets up to, the same one every time for the same worker.
// Round the fire: a sip, a stroll, a juggled ball, a dance, a tune on the lute, a book, a kite, the
// birds fed. At the venues: fishing at the pond, watering the garden, petting the cat.
export const PLAYS = ['sip', 'stroll', 'juggle', 'dance', 'fish', 'water', 'pet', 'lute', 'read', 'kite', 'birds'] as const
export type Play = (typeof PLAYS)[number]
// What one does at a fire seat when its venue is full: never a stroll, so only strollers stroll.
const SEAT_PLAYS: readonly Play[] = ['sip', 'juggle', 'dance', 'lute', 'read', 'kite', 'birds']
// And at a seat with no room for a kite or the birds: something that keeps to its own spot.
const GROUNDED: readonly Play[] = ['sip', 'juggle', 'dance', 'lute', 'read']
export const hashKey = (key: string): number => [...key].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 11)
export const playOf = (key: string): Play => PLAYS[hashKey(key) % PLAYS.length] ?? 'sip'
// What a worker at play does standing at `at`, and whether it faces left: its own pastime, unless
// that belongs at a venue and it isn't standing there (the venue was full); then one for the fire.
export function pastimeAt(key: string, at: Spot): { play: Play; flip: boolean } {
  const own = playOf(key)
  const venue = venueOf(own)
  const spot = venue?.spots.find(s => s.x === at.x && s.y === at.y)
  if (spot) return { play: own, flip: spot.flip === true }
  const play = venue ? (SEAT_PLAYS[(hashKey(key) >> 4) % SEAT_PLAYS.length] ?? 'sip') : own
  if ((play === 'kite' || play === 'birds') && !hasRoomFor(play, at)) return { play: GROUNDED[(hashKey(key) >> 6) % GROUNDED.length] ?? 'sip', flip: false }
  return { play, flip: false }
}

// The ground a kite (up and to the right, on its string) or the birds (close about the feet)
// take from a worker standing at `at`, in village units.
export function reachOf(play: 'kite' | 'birds', at: Spot): Box {
  return play === 'kite' ? { x: at.x + 2, y: at.y - 37, w: 25, h: 23 } : { x: at.x - 12, y: at.y - 9, w: 24, h: 13 }
}
// Whether that ground keeps clear of every building, sign, tent, venue and other seat, and a kite's of the fire
// and the spots where a crowd stands at a door too (it must never hide the one waiting on the
// person). Decided by seat, so it stays the same.
const roomy = new Map<string, boolean>()
export function hasRoomFor(play: 'kite' | 'birds', at: Spot): boolean {
  const id = `${play}|${at.x},${at.y}`
  const known = roomy.get(id)
  if (known !== undefined) return known
  const box = reachOf(play, at)
  // A door's crowd: its first two lines, side by side.
  const crowds = Object.values(SPOTS).flatMap(d => [0, 22].flatMap(dy => Array.from({ length: CROWD }, (_, i) => ({ x: d.x + nudge(i) - 6, y: d.y + dy - 24, w: 12, h: 24 }))))
  const isInside = box.x >= 0 && box.y >= 0 && box.x + box.w <= VILLAGE_W
  const walls = BUILDINGS.map(b => ({ x: b.x, y: b.y, w: Math.max(...b.art.grid.map(r => r.length)) * P, h: b.art.grid.length * P }))
  const signs = BUILDINGS.map(b => ({ x: b.x + b.sign.x, y: b.y + b.sign.y - 6, w: BOARD_SIZE, h: BOARD_SIZE + (b.wall === null ? 16 : 6) }))
  // Whoever sits at the other seats, the same way.
  const seated = SEAT_LIST.filter(s => s.x !== at.x || s.y !== at.y).map(s => ({ x: s.x - 6, y: s.y - 24, w: 12, h: 24 }))
  const isRoomy = isInside && ![...walls, ...signs, ...TENTS, ...VENUES.map(v => v.box), ...seated, ...(play === 'kite' ? [...crowds, { x: FIRE_AT.x - 10, y: FIRE_AT.y - 10, w: 20, h: 16 }] : [])].some(o => overlaps(box, o))
  roomy.set(id, isRoomy)
  return isRoomy
}
// Each loop's length, so its phase can follow the clock: a fresh drawing carries on mid-move.
export const LOOP_MS = {
  work: 1_600, swing: 1_600, dance: 2_400, juggle: 2_800, sip: 5_000, bang: 1_800, zz: 3_200,
  fish: 6_400, drip: 1_200, pet: 1_600, heart: 5_600, strum: 1_600, note: 3_600, read: 7_000, kite: 9_000, birds: 3_600, tail: 5_000,
} as const
// A worker's loops all share one delay, `--d`, set once on the worker: taken over a span that every
// loop's length divides, so each loop is as far in as the clock says. `loopDelay` is one loop's share.
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
export const CLOCK_SPAN = Object.values(LOOP_MS).reduce((a: number, b: number) => (a * b) / gcd(a, b), 1)
export const workerDelay = (now: number, key: string): number => (now + hashKey(key) * 7_919) % CLOCK_SPAN
export const loopDelay = (loop: string, now: number, key: string): number => workerDelay(now, key) % ((LOOP_MS as Readonly<Record<string, number>>)[loop] ?? 1_000)

// --- Motion the scene and the drawing share: the scene asks where a worker is now, so a worker
// sent somewhere new sets off from exactly where the drawing has it. ---

// A CSS cubic-bezier as a function of time.
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  return t => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let lo = 0
    let hi = 1
    let s = t
    for (let i = 0; i < 28; i += 1) {
      s = (lo + hi) / 2
      if (at(x1, x2, s) < t) lo = s
      else hi = s
    }
    return at(y1, y2, s)
  }
}

type Ease = { css: string; at: (t: number) => number }
const ease = (x1: number, y1: number, x2: number, y2: number): Ease => ({ css: `cubic-bezier(${x1},${y1},${x2},${y2})`, at: cubicBezier(x1, y1, x2, y2) })
const STEADY_PACE: Ease = { css: 'linear', at: t => t }
const EASE_IN_OUT = ease(0.42, 0, 0.58, 1)
// A walk sets off and comes to rest gently: eased in on its first leg and out on its last, steady
// between. An eased leg gets this much more time, so it meets the steady pace at the join.
const WALK_ONE = ease(0.35, 0, 0.65, 1)
const WALK_START = ease(0.45, 0, 0.8, 0.75)
const WALK_END = ease(0.2, 0.25, 0.55, 1)
const EASED_LEG = 1.35

// Walking pace, in map units a second, and how short or long a walk may be.
const WALK_SPEED = 30
const WALK_MS = { min: 800, max: 9_000 }

// One leg of a walk, its start and end as fractions of the walk's time.
type Leg = { from: Spot; to: Spot; start: number; end: number; ease: Ease }
export type Route = { legs: Leg[]; ms: number }

// The way from one spot to another: along the dirt roads, which run from each door down to the road
// across the plaza (FIRE_AT.y) and along it. A step to a spot close by goes straight.
export function routeOf(from: Spot, to: Spot): Route {
  const isNear = Math.abs(from.y - to.y) < 12 && Math.abs(from.x - to.x) < 60
  // Out along its lane to the road, along the road, and in along the other's lane.
  const out = laneOf(from)
  const into = laneOf(to)
  const points = isNear
    ? [from, to]
    : [from, { x: out, y: from.y }, { x: out, y: FIRE_AT.y }, { x: into, y: FIRE_AT.y }, { x: into, y: to.y }, to]
  const stops = points.reduce<Spot[]>((list, p) => {
    const last = list[list.length - 1]
    return last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5 ? list : [...list, p]
  }, [])
  if (stops.length < 2) stops.push(to)
  const lengths = stops.slice(1).map((p, i) => Math.hypot(p.x - (stops[i]?.x ?? 0), p.y - (stops[i]?.y ?? 0)))
  const n = lengths.length
  const weights = lengths.map((len, i) => (n > 1 && (i === 0 || i === n - 1) ? len * EASED_LEG : len))
  const total = weights.reduce((a, b) => a + b, 0)
  const ms = Math.round(Math.min(WALK_MS.max, Math.max(WALK_MS.min, (total / WALK_SPEED) * 1_000)))
  let start = 0
  const legs = weights.map((weight, i): Leg => {
    const end = i === n - 1 ? 1 : total > 0 ? start + weight / total : (i + 1) / n
    const leg = { from: stops[i] ?? from, to: stops[i + 1] ?? to, start, end, ease: n === 1 ? WALK_ONE : i === 0 ? WALK_START : i === n - 1 ? WALK_END : STEADY_PACE }
    start = end
    return leg
  })
  return { legs, ms }
}

// Where a walk has got to, `elapsed` milliseconds in.
export function pointOn(route: Route, elapsed: number): Spot {
  const f = Math.min(1, Math.max(0, elapsed / route.ms))
  const leg = route.legs.find(l => f <= l.end) ?? route.legs[route.legs.length - 1]
  if (!leg) return { x: 0, y: 0 }
  const local = leg.ease.at(leg.end > leg.start ? (f - leg.start) / (leg.end - leg.start) : 1)
  return { x: leg.from.x + (leg.to.x - leg.from.x) * local, y: leg.from.y + (leg.to.y - leg.from.y) * local }
}

// A walk's keyframes, `dx` added to every x (the village's left edge in the map).
function walkKeyframes(id: string, route: Route, dx: number): string {
  const at = (p: Spot) => `transform:translate(${+(p.x + dx).toFixed(1)}px,${+p.y.toFixed(1)}px)`
  // A steady leg takes the walk's own (linear) timing, so only the eased ones name theirs.
  const frames = route.legs.map(l => `${+(l.start * 100).toFixed(2)}%{${at(l.from)}${l.ease === STEADY_PACE ? '' : `;animation-timing-function:${l.ease.css}`}}`)
  const last = route.legs[route.legs.length - 1]
  return `@keyframes ${id}{${frames.join('')}100%{${last ? at(last.to) : ''}}}`
}

// A stroller's little loop round its seat, in map units: it stands a while at each corner, then
// ambles on. The keyframes and the scene's sums both come from here.
// A gardener paces its row the same way: waters a while, steps along, waters, steps back.
type Wander = 'a' | 'b' | 'pace' | 'pace-l'
const WANDERS: Readonly<Record<Wander, { stops: readonly Spot[]; ms: number; hold: number; step: number }>> = {
  a: { stops: [{ x: 0, y: 0 }, { x: 18, y: -5 }, { x: 4, y: -14 }, { x: 0, y: 0 }], ms: 22_000, hold: 0.14, step: 0.3 },
  b: { stops: [{ x: 0, y: 0 }, { x: -16, y: -6 }, { x: -6, y: 6 }, { x: 0, y: 0 }], ms: 22_000, hold: 0.14, step: 0.3 },
  pace: { stops: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 0, y: 0 }], ms: 18_000, hold: 0.3, step: 0.5 },
  'pace-l': { stops: [{ x: 0, y: 0 }, { x: -6, y: 0 }, { x: 0, y: 0 }], ms: 18_000, hold: 0.3, step: 0.5 },
}
const strollOf = (key: string): 'a' | 'b' => ((hashKey(key) >> 2) % 2 === 0 ? 'a' : 'b')
// Which loop a worker at play wanders, standing at `at` (its seat or venue spot), if any.
const wanderOf = (key: string, at?: Spot): Wander | null => {
  const play = playOf(key)
  if (play === 'stroll') return strollOf(key)
  if (play !== 'water' || !at) return null
  const here = pastimeAt(key, at)
  return here.play !== 'water' ? null : here.flip ? 'pace-l' : 'pace'
}

// How far a stroller (or a gardener, at `at`) has wandered from its spot, `ms` after it got there;
// 0 for anyone else.
export function strollAt(key: string, ms: number, at?: Spot): Spot {
  const name = wanderOf(key, at)
  if (!name || ms <= 0) return { x: 0, y: 0 }
  const { stops, ms: loop, hold, step } = WANDERS[name]
  const t = (ms % loop) / loop
  for (let i = 0; i < stops.length - 1; i += 1) {
    const here = stops[i] ?? { x: 0, y: 0 }
    const next = stops[i + 1] ?? here
    const moveFrom = i * step + hold
    if (t <= moveFrom) return here
    if (t <= (i + 1) * step) {
      const k = EASE_IN_OUT.at((t - moveFrom) / (step - hold))
      return { x: here.x + (next.x - here.x) * k, y: here.y + (next.y - here.y) * k }
    }
  }
  return { x: 0, y: 0 }
}

export function strollKeyframes(name: Wander): string {
  const { stops, hold, step } = WANDERS[name]
  const at = (p: Spot | undefined) => `transform:translate(${p?.x ?? 0}px,${p?.y ?? 0}px)`
  // Each corner held from i*step for `hold`, the last to the loop's end: the same numbers
  // strollAt walks through.
  const pct = (f: number) => `${Math.round(f * 100)}%`
  const frames = stops.map((p, i) => `${pct(i * step)},${pct(i === stops.length - 1 ? 1 : i * step + hold)}{${at(p)}}`)
  return `@keyframes stroll-${name}{${frames.join('')}}`
}

// Shapes many workers share, each drawn once in <defs> and placed with <use>: a body per role and
// pose, the tools, the play props, the bubbles. A drawing in the page is held to 100,000 characters.
class Defs {
  private readonly ids = new Map<string, string>()
  readonly svg: string[] = []
  of(key: string, draw: () => string): string {
    const known = this.ids.get(key)
    if (known) return known
    const id = `d${this.ids.size}`
    this.ids.set(key, id)
    this.svg.push(`<g id="${id}">${draw()}</g>`)
    return id
  }
}

const use = (id: string, x = 0, y = 0): string => `<use href="#${id}"${x || y ? ` x="${x}" y="${y}"` : ''}/>`

// What a worker at play holds, drawn from its right hand at (hx, hy), mirrored when it faces left.
// The feet are at y 0. Each little motion follows the clock, so a redraw carries it on.
function propsOf(play: Play, flip: boolean, hx: number, hy: number, skin: string, defs: Defs): string {
  const loop = (cls: string, inner: string) => `<g class="${cls} l">${inner}</g>`
  const at = (inner: string) => `<g transform="${flip ? 'scale(-1 1) ' : ''}translate(${hx} ${hy})">${inner}</g>`
  const feet = -hy
  switch (play) {
    case 'fish': {
      // A rod over the water, its line down to a bobber that twitches, then dips with a ripple.
      const rod = defs.of('rod', () => sprite(['.....N', '....N.', '...N..', '..N...', '.N....', 'N.....'], { N: '#8b5a3c' }, 0, -9) + `<path d="M11.3 -8V${feet - 4}" stroke="#f4ebd0" stroke-width=".5" stroke-opacity=".8"/>`)
      const bobber = defs.of('bobber', () => sprite(['r', 'w'], { r: '#e2574c', w: '#fbf3e0' }, 0, 0))
      const ripple = defs.of('ripple', () => `<path fill="#cfe9f2" d="M0 0h2v1h-2zM8 0h2v1h-2z"/>`)
      return at(use(rod) + loop('fish', use(bobber, 10.3, feet - 4)) + loop('ripple', use(ripple, 6.3, feet - 0.5)))
    }
    case 'water': {
      // A watering can, dripping on the row.
      const can = defs.of('can', () => sprite(['.h..', 'cccs', 'ccc.'], { h: '#4a5560', c: '#7fa0b8', s: '#9fb9cc' }, 0, -1))
      const drops = defs.of('drops', () => `<path fill="#9fd3ea" d="M8 3h1v1.5h-1zM8.5 6h1v1.5h-1z"/>`)
      return at(use(can) + loop('drip', use(drops)))
    }
    case 'pet':
      // A hand stroking the cat beside it.
      return at(loop('pet', `<rect x="0" y="1" width="3" height="2" fill="${skin}" stroke="${OUT}" stroke-width=".6"/>`))
    case 'lute': {
      const lute = defs.of('lute', () => sprite(['....n', '...n.', 'LLn..', 'LLL..', '.L...'], { L: '#c98a4a', n: '#6b4029' }, -7, -2))
      return at(loop('strum', use(lute)))
    }
    case 'read': {
      // An open book; now and then a page turns.
      const book = defs.of('book', () => sprite(['ppKpp', 'ppKpp', 'BBBBB'], { p: '#f4ebd0', K: '#c9b998', B: '#8b5a3c' }, -10, 0))
      const turning = defs.of('book-turn', () => sprite(['...p.', 'ppKp.', 'ppKpp', 'BBBBB'], { p: '#f4ebd0', K: '#c9b998', B: '#8b5a3c' }, -10, -2))
      return at(loop('read-a', use(book)) + loop('read-b', use(turning)))
    }
    case 'kite': {
      // A kite on a string, drifting from side to side in three steps, as pixel art moves.
      const kite = defs.of('kite', () => sprite(['..k..', '.kkK.', 'kkKKK', '.KKK.', '..K..', '...r.', '..r..'], { k: '#f2a33a', K: '#e2574c', r: '#fbf3e0' }, 3, -21))
      const frame = (dx: number) => defs.of(`kite${dx}`, () => `<path d="M0.5 0.5L${8 + dx} -11" stroke="#f4ebd0" stroke-width=".5" stroke-opacity=".8"/>${use(kite, dx)}`)
      return at(loop('kite-a', use(frame(-2))) + loop('kite-b', use(frame(0))) + loop('kite-c', use(frame(2))))
    }
    case 'birds': {
      // Two little birds hop about the feet for crumbs, each to its own rhythm, keeping close so they
      // stay clear of the next seat.
      const bird = defs.of('bird', () => sprite(['.hy', 'bb.'], { b: '#c49a6c', h: '#8b5a3c', y: '#f3c14a' }, 0, 0) + `<path fill="#e9d6a8" d="M6 3h1v1h-1z"/>`)
      return `<g transform="translate(-8 -3)">${loop('bird-a', use(bird))}</g><g transform="translate(8 -3) scale(-1 1)">${loop('bird-b', use(bird))}</g>`
    }
    default:
      return ''
  }
}

// Where each working or waiting worker's name goes, in light letters with a dark edge and no box
// behind (`.nm`): there to read, not to look at. Workers at play or asleep go unnamed: the line over
// the map counts them, and the list above names everyone.
//
// A name sits right by its own worker or not at all: just under its feet, or else straight over its
// head (over its bar or "!" if one stands there), centred or slid along while it still reaches over the body. It must
// keep clear of every sign, every "!" and bar, every other worker and every name already placed; in a
// crowd where neither spot is clear the name is left out, since a name off to one side reads as a
// neighbour's. Anyone who needs the person is named first, then those at work, each top to bottom
// and left to right, so the same scene always names the same workers in the same places. Village
// units; `x`/`y` are the text's middle and baseline from the worker's feet, `box` where it lies.
export type NamePlace = { x: number; y: number; box: Box }
export const nameSizeOf = (width: number): number => Math.round(Math.max(7, 9 / mapOf(width).k) * 10) / 10
// How far above its feet a worker's head is, and what stands over it (its bar or "!"), if anything.
export function headOf(w: SceneWorker): { head: number; mark: Box | null } {
  const hat = (HATS[roleOf(w.role).hat] ?? HATS.beanie ?? []).length
  const head = -(hat + BODY.length) * P * WORKER_SCALE
  if (w.look === 'wait') return { head, mark: { x: w.x - 7, y: w.y + head - 19, w: 14, h: 18 } }
  if (w.look === 'work' && w.progress !== null) return { head, mark: { x: w.x - 11, y: w.y + head - 8, w: 22, h: 7 } }
  return { head, mark: null }
}
export function placeNames(workers: readonly SceneWorker[], width: number): Map<string, NamePlace> {
  const { w: mapW, vx } = mapOf(width)
  const size = nameSizeOf(width)
  const named = workers.filter(w => w.look !== 'chill' && w.look !== 'sleep')
  const bodies = workers.map(w => ({ key: w.key, box: { x: w.x - 6, y: w.y + headOf(w).head, w: 12, h: -headOf(w).head } }))
  const marks = named.flatMap(w => {
    const mark = headOf(w).mark
    return mark ? [{ key: w.key, box: mark }] : []
  })
  const signs = BUILDINGS.map(b => ({ x: b.x + b.sign.x, y: b.y + b.sign.y - 6, w: BOARD_SIZE, h: BOARD_SIZE + (b.wall === null ? 16 : 6) }))
  const placed = new Map<string, NamePlace>()
  const rank = (w: SceneWorker): number => (w.look === 'wait' ? 0 : w.look === 'work' ? 1 : 2)
  const order = [...named].sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x || (a.key < b.key ? -1 : 1))
  const r1 = (v: number) => Math.round(v * 10) / 10
  const ascent = size * 0.8
  const tall = size * 1.05
  for (const w of order) {
    const half = measure(w.name, size, true) / 2 + 2
    const { head, mark } = headOf(w)
    const top = mark ? mark.y - w.y : head
    const below = r1(3 + ascent)
    const above = r1(top - 1 - (tall - ascent))
    const slide = r1(Math.max(0, half - 4))
    // Over the head only where nothing stands there: above a bar or a "!" a name floats up over the
    // roofs, too far off to read as this worker's. With no clear spot the name is left out.
    const spots = [
      { x: 0, y: below }, { x: slide, y: below }, { x: -slide, y: below },
      ...(mark === null ? [{ x: 0, y: above }, { x: slide, y: above }, { x: -slide, y: above }] : []),
    ]
    for (const spot of spots) {
      // Kept inside the map, as far as the name is long.
      const cx = Math.min(mapW - vx - 3 - half, Math.max(3 - vx + half, w.x + spot.x)) - w.x
      const box = { x: w.x + cx - half, y: w.y + spot.y - ascent, w: half * 2, h: tall }
      if (box.y < 1 || box.y + box.h > MAP_TALL - 1) continue
      const isClear =
        !signs.some(o => overlaps(box, o)) &&
        !marks.some(o => overlaps(box, o.box)) &&
        ![...placed.values()].some(o => overlaps(box, o.box)) &&
        !bodies.some(o => o.key !== w.key && overlaps(box, o.box))
      if (isClear) {
        placed.set(w.key, { x: r1(cx), y: spot.y, box })
        break
      }
    }
  }
  return placed
}

function tagSvg(w: SceneWorker, place: NamePlace | undefined): string {
  if (!place) return ''
  return `<text x="${place.x}" y="${place.y}" class="nm">${escape(w.name)}</text>`
}

// A worker, and its name apart: names go in a layer over every worker so none hides behind
// another, each wrapped in the same walk and stroll so it keeps to its worker. `walks` gathers
// each walk's keyframes for the drawing's style.
function workerSvg(w: SceneWorker, vx: number, now: number, defs: Defs, name: NamePlace | undefined, walks: string[]): { body: string; tag: string } {
  const role = roleOf(w.role)
  const isCaptain = w.role === 'lead'
  const hue = isCaptain ? (CAPTAIN_HUES[hashKey(w.key) % CAPTAIN_HUES.length] ?? role.hue) : role.hue
  const isAsleep = w.look === 'sleep'
  const pastime = w.look === 'chill' ? pastimeAt(w.key, { x: w.x, y: w.y }) : null
  const play: Play | null = pastime?.play ?? null
  const isSitting = play === 'sip' || play === 'read' || play === 'pet'
  const hatGrid = HATS[role.hat] ?? HATS.beanie ?? []
  const width = Math.max(5, ...hatGrid.map(r => r.length))
  const left = -(width / 2) * P
  const S = WORKER_SCALE
  const skin = w.look === 'failed' ? '#d7665d' : isAsleep ? '#a39e95' : hsl(hue, 58, 70)
  const bodyOf = (sits: boolean): { id: string; top: number } => {
    const grid = [...hatGrid, ...(sits ? BODY_SITTING : BODY)].map(r => r.padEnd(width, '.'))
    const pose = w.look === 'failed' ? 'failed' : isAsleep ? 'asleep' : sits ? 'sitting' : 'up'
    const id = defs.of(`body|${role.hat}|${hue}|${isCaptain}|${pose}`, () => {
      const hat = isCaptain ? CROWN : hsl(hue, 52, isAsleep ? 34 : 40)
      return sprite(grid, { h: hat, a: '#f4ebd0', b: skin, B: hsl(hue, 45, isAsleep ? 50 : 58), e: OUT, f: '#3b2f2a' }, left, -grid.length * P)
    })
    return { id, top: -grid.length * P }
  }
  const body = bodyOf(isSitting)
  const top = body.top
  // What it wears, laid over (or, a backpack, behind) a body whose top is at `y`.
  const wear = accessoryOf(w.key)
  // Rosy cheeks vanish on a pink or red skin, so they are left off it.
  const isPinkish = hue >= 290 || hue <= 20 || w.look === 'failed'
  const kit = wear === 'cheeks' && isPinkish ? undefined : ACCESSORIES[wear]
  const dressed = (id: string, y: number): string => {
    if (!kit) return use(id)
    // Asleep it goes grey with the body.
    const colors = isAsleep ? Object.fromEntries(Object.keys(kit.colors).map(k => [k, k === k.toUpperCase() ? '#7d7a74' : '#9a958d'])) : kit.colors
    const on = use(defs.of(`wear|${wear}|${isAsleep}`, () => sprite(kit.grid, colors, 0, 0, kit.isBehind === true)), left + (kit.x ?? 0) * P, y + hatGrid.length * P)
    return kit.isBehind ? on + use(id) : use(id) + on
  }
  const tool = w.look === 'work' ? TOOLS[w.task] : undefined
  const elapsed = Math.max(0, now - w.since)
  const isWalking = elapsed < w.ms
  // On the way to play, a worker walks upright with empty hands: its pose and props wait for it to
  // arrive, timed here, since no redraw comes then. With nothing moving, it shows as arrived.
  const arrival = `style="animation-delay:${w.since + w.ms - now}ms"`
  const arrive = (inner: string) => (isWalking && inner ? `<g class="ar" ${arrival}>${inner}</g>` : inner)
  // The body's own loop: a slow bob at work, a sway when dancing; on the way, a step every half second.
  const loop = w.look === 'work' ? 'work' : play === 'dance' ? 'dance' : ''
  const parts = [`<ellipse cx="0" cy="1" rx="7" ry="2" class="sh"/>`]
  parts.push(`<g transform="scale(${S})">`)
  if (isWalking) parts.push(`<g class="step" style="animation-iteration-count:${(w.ms / 500).toFixed(3)};animation-delay:-${elapsed}ms">`)
  parts.push(`<g${loop ? ` class="${loop} l"` : ''}>`)
  const held: string[] = []
  if (play === 'sip') held.push(`<g class="sip l">${use(defs.of('mug', () => sprite(['m', 'm'], { m: '#9a6a42' }, 0, 0)), left + 5 * P, top + (hatGrid.length + 2) * P)}</g>`)
  if (play === 'juggle') held.push(`<g class="juggle l">${use(defs.of('ball', () => sprite(['rr', 'rr'], { r: '#e2574c' }, 0, 0)), left + 6 * P, top - 2)}</g>`)
  if (play && pastime) held.push(propsOf(play, pastime.flip, left + 5 * P, top + (hatGrid.length + 2) * P, skin, defs))
  if (isWalking && isSitting) {
    const up = bodyOf(false)
    parts.push(`<g class="lv" ${arrival}>${dressed(up.id, up.top)}</g>`, arrive(dressed(body.id, top) + held.join('')))
  } else parts.push(dressed(body.id, top), arrive(held.join('')))
  if (tool) parts.push(`<g${tool.swing ? ' class="swing l"' : ''}>${use(defs.of(`tool|${w.task}`, () => sprite(tool.grid, tool.colors, 0, 0)), left + 5 * P + 1, top + (hatGrid.length + 1) * P)}</g>`)
  parts.push(isWalking ? '</g></g></g>' : '</g></g>')
  const head = top * S
  // Over its head: progress as a unit's bar, a "!" when it needs the person, z's asleep.
  if (w.look === 'wait') {
    parts.push(`<g class="bang l">${use(defs.of('bang', () => sprite(['.www.', 'wwyww', 'wwyww', 'wwwww', 'wwyww', '.www.', '..w..'], { w: '#fbf3e0', y: '#d99a1e' }, 0, 0)), -5, head - 17)}</g>`)
  } else if (isAsleep) {
    parts.push(`<g class="zz l">${use(defs.of('zz', () => sprite(['zzz', '.z.', 'zzz'], { z: '#fbf3e0' }, 0, 0, false)), 8, head - 4)}</g>`)
  } else if (play === 'pet') {
    // Now and then a little heart rises over the cat, centred on it.
    const cat = venueOf('pet')?.at.x ?? w.x
    parts.push(arrive(`<g class="heart l">${use(defs.of('heart', () => sprite(['h.h', 'hhh', '.h.'], { h: '#f28aa0' }, 0, 0)), cat - w.x - 3, head - 2)}</g>`))
  } else if (play === 'lute') {
    parts.push(arrive(`<g class="note l">${use(defs.of('note', () => sprite(['..n', '..n', 'nnn', 'nn.'], { n: '#f7d154' }, 0, 0)), 7, head - 6)}</g>`))
  } else if (w.progress !== null && w.look === 'work') {
    const bw = 18
    const fill = Math.max(1, Math.round(bw * w.progress))
    parts.push(`<path class="pb" d="M${-bw / 2 - 1} ${head - 7}h${bw + 2}v5h${-bw - 2}z"/><path fill="${hsl(hue, 70, 62)}" d="M${-bw / 2} ${head - 6}h${fill}v3h${-fill}z"/>`)
  }
  const to = { x: vx + w.x, y: w.y }
  const tag = tagSvg(w, name)
  // A stroller wanders its little loop, counted from when it sat down, so it sets off from its seat
  // and the scene knows where it is when it leaves (a positive delay holds it still while it walks).
  // A gardener paces its row the same way.
  const wander = play === null ? null : wanderOf(w.key, { x: w.x, y: w.y })
  const stroll = (inner: string) => (wander ? `<g class="stroll-${wander}" style="animation-delay:${w.since + w.ms - now}ms">${inner}</g>` : inner)
  // Its walk along the roads, carried on from wherever it has got to by now.
  // Every loop in it takes the worker's one clock delay, `--d`; its name has no loops.
  const clock = `--d:-${workerDelay(now, w.key)}ms`
  let place = (inner: string, isTag = false) => `<g transform="translate(${to.x} ${to.y})"${isTag ? '' : ` style="${clock}"`}>${stroll(inner)}</g>`
  if (isWalking) {
    const id = `w${walks.length}`
    walks.push(walkKeyframes(id, routeOf({ x: w.fx, y: w.fy }, { x: w.x, y: w.y }), vx))
    place = (inner, isTag = false) => `<g class="walk" style="transform:translate(${to.x}px,${to.y}px);animation-name:${id};animation-duration:${w.ms}ms;animation-delay:-${elapsed}ms${isTag ? '' : `;${clock}`}">${stroll(inner)}</g>`
  }
  // A walker's name waits for it to arrive: it is placed for where the worker is going, so on the
  // way it could run into a name standing there.
  return { body: place(parts.join('')), tag: tag ? place(arrive(tag), true) : '' }
}

// The person's Still setting: everything holds still, whatever the OS asks. Reduced motion does the
// same: everyone is already where they are going, has arrived, and holds still.
const STILL = '*{animation:none!important}.smoke rect{opacity:.5}'

// The motion every drawing carries.
const BASE_MOTION = [
  // Names, shadows and unit bars, set once here rather than on every worker.
  `.nm{font-weight:650;text-anchor:middle;fill:#fbf3e0;stroke:${OUT};stroke-width:2.2px;stroke-linejoin:round;paint-order:stroke}.sh{fill:#000;fill-opacity:.22}.pb{fill:${OUT}}`,
  // Walks follow their own keyframes along the roads (their length sets their time), with a small
  // step on the way; work is a slow bob, and a tool is raised slowly and brought down quickly.
  '.walk{animation-fill-mode:both;animation-timing-function:linear}',
  '.step{animation:step .5s}@keyframes step{0%{transform:translateY(0);animation-timing-function:steps(1,end)}50%{transform:translateY(-1px);animation-timing-function:steps(1,end)}100%{transform:translateY(0)}}',
  '.work{animation:work 1.6s ease-in-out infinite}@keyframes work{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.5px)}}',
  '.swing{transform-box:fill-box;transform-origin:0 100%;animation:swing 1.6s infinite}',
  '@keyframes swing{0%{transform:rotate(-6deg);animation-timing-function:cubic-bezier(.42,0,.58,1)}60%{transform:rotate(-30deg);animation-timing-function:cubic-bezier(.5,0,1,1)}70%,80%{transform:rotate(12deg);animation-timing-function:cubic-bezier(0,0,.58,1)}100%{transform:rotate(-6deg)}}',
  '.smoke rect{animation:smoke 3.2s ease-out infinite;opacity:0}',
  '@keyframes smoke{0%{transform:translateY(0);opacity:.75}100%{transform:translateY(-14px);opacity:0}}',
  // The fire swaps between its two frames, as pixel art does, rather than fading one into the other.
  '.fire-b{animation:flick .5s steps(1,end) infinite}@keyframes flick{0%{opacity:0}50%{opacity:1}100%{opacity:0}}',
  '.bang{animation:bang 1.8s ease-in-out infinite}@keyframes bang{0%,100%{opacity:.6}50%{opacity:1}}',
  '.zz{animation:zz 3.2s ease-out infinite}@keyframes zz{0%{transform:translateY(0);opacity:.9}100%{transform:translateY(-6px);opacity:0}}',
  // The village cat flicks its tail now and then; the frame shown only then is hidden while still.
  `.tail-b{opacity:0}.tail-a,.tail-b{animation:${LOOP_MS.tail}ms steps(1,end) infinite}.tail-a{animation-name:tail-a}.tail-b{animation-name:tail-b}@keyframes tail-a{0%{opacity:1}80%{opacity:0}88%{opacity:1}}@keyframes tail-b{0%{opacity:0}80%{opacity:1}88%{opacity:0}}`,
  // On a dark page the village dims a little, like evening, so it doesn't glare.
  '@media (prefers-color-scheme:dark){.village{filter:brightness(.86) saturate(.92)}}',
  `@media (prefers-reduced-motion:reduce){${STILL}}`,
].join('')

// Each pastime's motion, carried only by a drawing with someone at it: slow, and in whole steps
// where it can be. Frames shown only part of the time are hidden while nothing moves.
const strollCss = (name: Wander) => `.stroll-${name}{animation:stroll-${name} ${WANDERS[name].ms}ms ease-in-out infinite}${strollKeyframes(name)}`
const PLAY_MOTION: Readonly<Record<Play, string>> = {
  // A stroll round the plaza with pauses, a sway, a juggled ball, a sip.
  stroll: strollCss('a') + strollCss('b'),
  dance: '.dance{transform-box:fill-box;transform-origin:50% 100%;animation:dance 2.4s ease-in-out infinite}@keyframes dance{0%,100%{transform:rotate(-6deg)}25%{transform:translateY(-1.5px)}50%{transform:rotate(6deg)}75%{transform:translateY(-1.5px)}}',
  juggle: '.juggle{animation:juggle 1.4s cubic-bezier(.2,.6,.4,1) infinite alternate}@keyframes juggle{from{transform:translateY(0)}to{transform:translateY(-9px)}}',
  sip: '.sip{animation:sip 5s ease-in-out infinite}@keyframes sip{0%,68%,100%{transform:translate(0,0)}78%,90%{transform:translate(-2px,-3px)}}',
  // A bobber that twitches, then dips with a ripple.
  fish: `.ripple{opacity:0}.fish{animation:fish ${LOOP_MS.fish}ms steps(1,end) infinite}@keyframes fish{0%{transform:translateY(0)}30%{transform:translateY(.6px)}34%{transform:translateY(0)}62%{transform:translateY(.6px)}66%{transform:translateY(0)}72%{transform:translateY(1.6px)}84%{transform:translateY(0)}}` +
    `.ripple{animation:ripple ${LOOP_MS.fish}ms steps(1,end) infinite}@keyframes ripple{0%{opacity:0}72%{opacity:.9}80%{opacity:.5}88%{opacity:0}}`,
  // A can's drip, and a gardener pacing its row.
  water: `.drip{animation:drip ${LOOP_MS.drip}ms steps(3,end) infinite}@keyframes drip{from{transform:translateY(0)}to{transform:translateY(3px)}}` + strollCss('pace') + strollCss('pace-l'),
  // A stroking hand, a pixel at a time, and a rising heart.
  pet: `.pet{animation:pet ${LOOP_MS.pet}ms steps(2,end) infinite}@keyframes pet{0%,100%{transform:translateX(0)}50%{transform:translateX(2px)}}` +
    `.heart{animation:heart ${LOOP_MS.heart}ms ease-out infinite}@keyframes heart{0%{transform:translateY(0);opacity:0}6%{opacity:1}40%,100%{transform:translateY(-8px);opacity:0}}`,
  // A strum, as slow as the work bob, and a floating note.
  lute: `.strum{animation:strum ${LOOP_MS.strum}ms steps(1,end) infinite}@keyframes strum{0%{transform:translateY(0)}50%{transform:translateY(-1px)}}` +
    `.note{animation:note ${LOOP_MS.note}ms ease-out infinite}@keyframes note{0%{transform:translate(0,0);opacity:0}12%{opacity:1}100%{transform:translate(3px,-9px);opacity:0}}`,
  // A page turned now and then.
  read: `.read-b{opacity:0}.read-a,.read-b{animation:${LOOP_MS.read}ms steps(1,end) infinite}.read-a{animation-name:read-a}.read-b{animation-name:read-b}@keyframes read-a{0%{opacity:0}6%{opacity:1}}@keyframes read-b{0%{opacity:1}6%{opacity:0}}`,
  // A kite drifting in three steps, as pixel art moves.
  kite: `.kite-a,.kite-c{opacity:0}.kite-a,.kite-b,.kite-c{animation:${LOOP_MS.kite}ms steps(1,end) infinite}.kite-a{animation-name:kite-a}.kite-b{animation-name:kite-b}.kite-c{animation-name:kite-c}` +
    '@keyframes kite-a{0%{opacity:1}25%{opacity:0}}@keyframes kite-b{0%{opacity:0}25%{opacity:1}50%{opacity:0}75%{opacity:1}}@keyframes kite-c{0%{opacity:0}50%{opacity:1}75%{opacity:0}}',
  // Birds hopping and pecking, each to its own rhythm.
  birds: `.bird-a,.bird-b{animation:${LOOP_MS.birds}ms steps(1,end) infinite}.bird-a{animation-name:bird-a}.bird-b{animation-name:bird-b}` +
    '@keyframes bird-a{0%{transform:translate(0,0)}20%{transform:translate(1px,-2px)}26%{transform:translate(2px,0)}50%{transform:translate(2px,1px)}56%{transform:translate(2px,0)}64%{transform:translate(2px,1px)}70%{transform:translate(2px,0)}84%{transform:translate(1px,-2px)}90%{transform:translate(0,0)}}' +
    '@keyframes bird-b{0%{transform:translate(0,0)}10%{transform:translate(0,1px)}16%{transform:translate(0,0)}40%{transform:translate(1px,-2px)}46%{transform:translate(2px,0)}60%{transform:translate(2px,1px)}66%{transform:translate(2px,0)}76%{transform:translate(1px,-2px)}82%{transform:translate(0,0)}}',
}
// One on its way to play shows its pose and props only once there (`.ar`), upright till then (`.lv`).
const ARRIVE_MOTION = '.ar{animation:ar 1ms backwards}@keyframes ar{from{opacity:0}}.lv{opacity:0;animation:lv 1ms backwards}@keyframes lv{from{opacity:1}}'
// Last, so it wins over each loop's own: every loop takes its worker's clock delay.
const CLOCKED_LOOPS = '.l{animation-delay:var(--d)}'

// The motion for a drawing with these pastimes in it, and with anyone on the way to one.
export function motionCss(plays: Iterable<Play>, isArriving = false): string {
  return BASE_MOTION + [...new Set(plays)].map(p => PLAY_MOTION[p]).join('') + (isArriving ? ARRIVE_MOTION : '') + CLOCKED_LOOPS
}
// Everything, as a drawing with every pastime would carry it.
export const COLONY_MOTION = motionCss(PLAYS, true)

// --- The scenery. ---

// What stands beside a building: the hall's flag, the library's book, an anvil and barrel, smoke, a cart.
function extrasOf(key: string, x: number, y: number, busy: ReadonlySet<string>): string {
  if (key === 'hall') return sprite(FLAG.grid, FLAG.colors, x + 29, y - 10)
  if (key === 'library') return sprite(BOOK.grid, BOOK.colors, x + 17, y + 30)
  if (key === 'workshop') return sprite(ANVIL.grid, ANVIL.colors, x + 34, y + 34) + sprite(BARREL.grid, BARREL.colors, x - 10, y + 22)
  if (key === 'forge' && busy.has('forge')) return `<g class="smoke">${[0, 1, 2].map(i => `<rect x="${x + 8 + i}" y="${y - 4 - i * 2}" width="4" height="4" fill="#d6d2cb"/>`).join('')}</g>`
  if (key === 'mine') return `<path d="M${x + 14} ${y + 18}v8M${x + 20} ${y + 18}v8" stroke="#6f6a63" stroke-width="1.5"/>` + sprite(CART.grid, CART.colors, x + 26, y + 18)
  return ''
}

// A venue's scenery, centred at (cx, cy) in the map: the pond with its reeds and a lily pad, the
// garden's furrows and sprouts, the village cat (its tail flicks now and then).
const CAT: Art = { grid: ['O...O', 'OOOOO', 'OeOeO', 'OOpOO', '.OOO.', 'OSOSO'], colors: { O: '#e39b4f', S: '#c47a35', e: OUT, p: '#f28aa0' } }
const TAIL = { a: ['.t', 't.', 't.'], b: ['t.', '.t', 't.'], colors: { t: '#e39b4f' } }
function venueSvg(key: string, cx: number, cy: number): string {
  if (key === 'pond') {
    const reeds = [cx - 24, cx - 21, cx + 21].map((x, i) => `M${x} ${cy - 6 + i * 2}h1.5v${6 - i}h-1.5z`).join('')
    return (
      blob(cx, cy, 12, 5, '#3e6b3a') + blob(cx, cy, 11, 4, '#4f95bf') + blob(cx + 2, cy - 2, 5, 1, '#62a6cd') +
      `<path fill="#9fd3ea" d="M${cx - 8} ${cy - 4}h4v1h-4zM${cx + 6} ${cy + 3}h3v1h-3z"/><path fill="#3d7542" d="${reeds}"/><path fill="#7a4f33" d="M${cx - 24} ${cy - 8}h1.5v2h-1.5zM${cx + 21} ${cy - 3}h1.5v2h-1.5z"/>` +
      `<path fill="#6fae5a" d="M${cx - 2} ${cy + 3}h5v2h-5zM${cx - 1} ${cy + 2}h2v1h-2z"/>`
    )
  }
  if (key === 'garden') {
    // Three furrows of sprouts, one tile repeated.
    const tile = '<path fill="#74532f" d="M0 3h6v2h-6z"/><path fill="#6fbf5a" d="M1 2h2v2h-2zM0 0h1v2h-1zM3 0h1v2h-1z"/>'
    return (
      `<pattern id="c-sprouts" x="${cx - 14}" y="${cy - 7}" width="6" height="6" patternUnits="userSpaceOnUse">${tile}</pattern>` +
      `<rect x="${cx - 17}" y="${cy - 10}" width="34" height="22" fill="#6b4a2e"/><rect x="${cx - 16}" y="${cy - 9}" width="32" height="20" fill="#8a6440"/>` +
      `<rect x="${cx - 15}" y="${cy - 7}" width="30" height="18" fill="url(#c-sprouts)"/><path fill="#f2a7b8" d="M${cx - 12} ${cy - 8}h2v2h-2zM${cx + 6} ${cy - 8}h2v2h-2z"/>`
    )
  }
  if (key === 'cat') {
    const x = cx - 5
    const y = cy - 12
    return `<ellipse cx="${cx}" cy="${cy}" rx="6" ry="2" fill="#000" fill-opacity=".2"/>` + sprite(CAT.grid, CAT.colors, x, y) + `<g class="tail-a">${sprite(TAIL.a, TAIL.colors, x + 10, y + 4)}</g><g class="tail-b">${sprite(TAIL.b, TAIL.colors, x + 10, y + 4)}</g>`
  }
  return ''
}

// The shapes placed again and again, each drawn once; a tree carries its own shadow.
function sceneryDefs(): string {
  const tree = (id: string, art: Art) => `<g id="${id}"><ellipse cx="11" cy="${art.grid.length * P}" rx="9" ry="3" fill="#000" fill-opacity=".18"/>${sprite(art.grid, art.colors, 0, 0)}</g>`
  return tree('c-tree', TREE) + tree('c-pine', PINE) + tree('c-bush', BUSH) + `<g id="c-tent">${sprite(TENT.grid, TENT.colors, 0, 0)}</g>`
}

// The scenery: grass, plaza and paths, buildings and their signs, trees and flowers. `vx` is the
// village's left edge. The same for the same width and busy buildings, so it is kept.
let sceneryKept: { key: string; svg: string } | null = null

function scenery(w: number, vx: number, busy: ReadonlySet<string>): string {
  const key = `${w}|${vx}|${busy.has('forge')}`
  if (sceneryKept?.key === key) return sceneryKept.svg
  const out: string[] = []
  out.push(`<rect width="${w}" height="${MAP_TALL}" fill="${GRASS}"/><rect width="${w}" height="${MAP_TALL}" fill="url(#grass)"/>`)
  const at = (s: Spot): Spot => ({ x: vx + s.x, y: s.y })
  const fire = at(FIRE_AT)

  // Paths, then the plaza over their ends.
  const paths = ['hall', 'library', 'workshop', 'tower', 'forge', 'mine', 'tents'].map(k => path(fire, SPOTS[k] ?? FIRE_AT, vx))
  out.push(`<g fill="${DIRT_RIM}">${paths.map(p => p.rim).join('')}</g><g fill="${DIRT}">${paths.map(p => p.fill).join('')}</g>`)
  out.push(blob(fire.x, fire.y, 26, 14, DIRT_RIM), blob(fire.x, fire.y, 25, 13, DIRT))
  for (let i = 0; i < 7; i += 1) out.push(`<rect x="${Math.round(fire.x - 40 + rand(i + 1) * 80)}" y="${Math.round(fire.y - 18 + rand(i + 31) * 36)}" width="2" height="2" fill="#dcbc87"/>`)

  // Reserved ground: nothing grows on buildings, signs, paths or the plaza.
  const taken: Box[] = BUILDINGS.map(b => ({ x: vx + b.x - 6, y: b.y - 8, w: (Math.max(...b.art.grid.map(r => r.length)) + 6) * P, h: (b.art.grid.length + 8) * P }))
  taken.push(...BUILDINGS.map(b => ({ x: vx + b.x + b.sign.x - 4, y: b.y + b.sign.y - 8, w: BOARD_SIZE + 8, h: BOARD_SIZE + 20 })))
  taken.push({ x: fire.x - 58, y: fire.y - 32, w: 116, h: 64 }, { x: vx + 46, y: 120, w: 64, h: 60 })
  taken.push(...VENUES.map(v => ({ ...v.box, x: vx + v.box.x })))
  for (const k of Object.keys(SPOTS)) {
    const s = at(SPOTS[k] ?? FIRE_AT)
    taken.push({ x: Math.min(s.x, fire.x) - 8, y: fire.y - 8, w: Math.abs(s.x - fire.x) + 16, h: 16 }, { x: s.x - 8, y: Math.min(s.y, fire.y) - 8, w: 16, h: Math.abs(s.y - fire.y) + 22 })
  }
  const isFree = (b: Box) => !taken.some(t => b.x < t.x + t.w && b.x + b.w > t.x && b.y < t.y + t.h && b.y + b.h > t.y)

  // Flowers and tufts, scattered.
  const flowers = ['#f2a7b8', '#f5e27a', '#fbf3e0', '#b9a7f0']
  const dots = new Map<string, string>()
  const dot = (color: string, d: string) => dots.set(color, (dots.get(color) ?? '') + d)
  for (let i = 0; i < Math.round(w / 5); i += 1) {
    const x = Math.round(rand(i * 3 + 7) * (w - 6))
    const y = Math.round(rand(i * 3 + 8) * (MAP_TALL - 6))
    if (!isFree({ x, y, w: 6, h: 6 })) continue
    if (rand(i * 3 + 9) < 0.45) dot(flowers[i % flowers.length] ?? '#fbf3e0', `M${x} ${y}h2v2h-2z`)
    else dot('#79ad62', `M${x} ${y + 2}h2v2h-2zM${x + 4} ${y + 2}h2v2h-2zM${x + 2} ${y}h2v2h-2z`)
  }
  out.push(...[...dots].map(([color, d]) => `<path fill="${color}" d="${d}"/>`))

  // Trees: a few placed in the village, and forest filling whatever lies beyond it.
  const trees: { id: string; h: number; x: number; y: number }[] = []
  const plant = (art: Art, x: number, y: number) => trees.push({ id: art === TREE ? 'c-tree' : art === PINE ? 'c-pine' : 'c-bush', h: art.grid.length * P, x, y })
  plant(TREE, vx + 96, 4)
  plant(PINE, vx + 202, 2)
  plant(PINE, vx + 8, 14)
  plant(TREE, vx + 300, 16)
  plant(TREE, vx + 100, 52)
  plant(PINE, vx + 206, 44)
  plant(PINE, vx + 12, 140)
  plant(TREE, vx + 288, 142)
  plant(BUSH, vx + 138, 154)
  plant(BUSH, vx + 18, 176)
  plant(BUSH, vx + 186, 154)
  plant(TREE, vx + 154, 172)
  plant(BUSH, vx + 266, 178)
  plant(PINE, vx + 300, 168)
  for (let gx = 0; gx * 24 < w + 24; gx += 1) {
    for (let gy = 0; gy * 28 < MAP_TALL + 20; gy += 1) {
      const x = gx * 24 + Math.round(rand(gx * 17 + gy) * 8) - 4
      const y = gy * 28 + Math.round(rand(gx * 5 + gy * 13) * 10) - 8
      if (x > vx - 22 && x < vx + VILLAGE_W) continue
      const pick = rand(gx * 7 + gy * 3)
      plant(pick < 0.45 ? PINE : pick < 0.85 ? TREE : BUSH, x, y)
    }
  }

  // Everything that stands, back to front; a building's sign stands with it.
  const standing = [
    ...BUILDINGS.map(b => ({
      y: b.y + b.art.grid.length * P,
      svg: sprite(b.art.grid, b.art.colors, vx + b.x, b.y) + extrasOf(b.key, vx + b.x, b.y, busy) + signSvg(b.task, vx + b.x + b.sign.x, b.y + b.sign.y, b.wall === null ? null : vx + b.x + b.wall),
    })),
    ...trees.map(t => ({ y: t.y + t.h, svg: useArt(t.id, t.x, t.y) })),
    { y: 152, svg: useArt('c-tent', vx + 60, 134) + useArt('c-tent', vx + 84, 140) },
    { y: fire.y + 8, svg: sprite(BENCH_V.grid, BENCH_V.colors, fire.x - 30, fire.y - 4) + sprite(BENCH_V.grid, BENCH_V.colors, fire.x + 26, fire.y - 4) + sprite(BENCH_H.grid, BENCH_H.colors, fire.x - 7, fire.y + 16) },
    { y: fire.y + 4, svg: sprite(FIRE.a, FIRE.colors, fire.x - 8, fire.y - 8) + `<g class="fire-b">${sprite(FIRE.b, FIRE.colors, fire.x - 8, fire.y - 8)}</g>` },
    ...VENUES.map(v => ({ y: v.key === 'cat' ? v.at.y : 0, svg: venueSvg(v.key, vx + v.at.x, v.at.y) })),
  ]
  standing.sort((a, b) => a.y - b.y)
  out.push(...standing.map(s => s.svg))
  sceneryKept = { key, svg: out.join('') }
  return sceneryKept.svg
}

// --- The line over the map: what everyone is doing, in words, once. ---

const DOING: Readonly<Record<Task, string>> = { develop: 'developing', research: 'researching', review: 'reviewing', test: 'testing', plan: 'planning', debug: 'debugging' }

// How many workers are doing what: everyone, drawn or not.
export function countOf(workers: readonly SceneWorker[]): Count {
  const count: Count = { tasks: {}, wait: 0, chill: 0, done: 0 }
  for (const w of workers) {
    if (w.look === 'work') count.tasks[w.task] = (count.tasks[w.task] ?? 0) + 1
    else if (w.look === 'wait') count.wait += 1
    else if (w.look === 'chill') count.chill += 1
    else count.done += 1
  }
  return count
}

// The line's parts: who needs the person first, then the busiest task, then the rest:
// "1 needs you", "2 developing · 1 researching · 3 chilling · 1 done". Past `room` pixels, the
// tasks fold into "3 at work".
export function tallyParts(count: Count, room = Infinity): { urgent: string; rest: string } {
  const urgent = count.wait ? `${count.wait} ${count.wait === 1 ? 'needs' : 'need'} you` : ''
  const after = [count.chill ? `${count.chill} chilling` : '', count.done ? `${count.done} done` : '']
  const tasks = (Object.entries(count.tasks) as [Task, number][]).sort((a, b) => b[1] - a[1]).map(([task, n]) => `${n} ${DOING[task]}`)
  const join = (list: string[]) => list.filter(Boolean).join(' · ')
  const rest = join([...tasks, ...after])
  if (measure(join([urgent, rest]), 11.5) <= room) return { urgent, rest }
  const working = Object.values(count.tasks).reduce((a, b) => a + (b ?? 0), 0)
  return { urgent, rest: join([working ? `${working} at work` : '', ...after]) }
}

export function tallyOf(workers: readonly SceneWorker[] | Count, room = Infinity): string {
  const parts = tallyParts(Array.isArray(workers) ? countOf(workers) : (workers as Count), room)
  return [parts.urgent, parts.rest].filter(Boolean).join(' · ')
}

// A drawing the page draws for a Client is held to 100,000 characters as it travels (its source
// escaped, beside its alt); past that the region is dropped. Kept under, with room to spare.
export const DRAWING_LIMIT = 96_000
const RANK: Readonly<Record<Look, number>> = { wait: 0, work: 1, chill: 2, failed: 3, sleep: 4 }

// The colony as one SVG `scene.width` pixels wide, its walks and loops carried on to `now`. A crowd
// too big to draw within the limit leaves out the least busy first; the line over the map still
// counts everyone.
export function colonySvg(scene: ColonyScene, now: number): { source: string; height: number; alt: string } {
  let shown = scene.workers
  for (;;) {
    const drawing = drawColony(scene, shown, now)
    const size = JSON.stringify(drawing.source).length
    if (size <= DRAWING_LIMIT || shown.length === 0) return drawing
    const drop = Math.max(1, Math.ceil((shown.length * (size - DRAWING_LIMIT)) / size))
    const order = shown.map((w, i) => ({ w, i })).sort((a, b) => RANK[b.w.look] - RANK[a.w.look] || b.i - a.i)
    const out = new Set(order.slice(0, drop).map(o => o.i))
    shown = shown.filter((_, i) => !out.has(i))
  }
}

function drawColony(scene: ColonyScene, workers: readonly SceneWorker[], now: number): { source: string; height: number; alt: string } {
  const { width } = scene
  const { k, w, vx } = mapOf(width)
  const mapW = width - 2 * PAD
  const mapH = Math.round(MAP_TALL * k)
  const top = 4
  const out: string[] = []

  // The header: who needs the person leads, in the waiting colour.
  const count = scene.count ?? countOf(scene.workers)
  const tally = tallyParts(count, mapW - 62)
  const urgent = tally.urgent ? `<tspan class="wait-t">${escape(tally.urgent)}</tspan>${tally.rest ? ' · ' : ''}` : ''
  out.push(`<text x="${PAD}" y="${top + 16}" font-size="12.5" font-weight="650">Colony</text><text x="${PAD + 58}" y="${top + 16}" font-size="11.5" class="faint">${urgent}${escape(tally.rest)}</text>`)

  const my = top + HEAD
  out.push(`<defs><pattern id="grass" width="16" height="16" patternUnits="userSpaceOnUse"><rect x="2" y="3" width="2" height="2" fill="#679c57"/><rect x="10" y="9" width="2" height="2" fill="#517f44"/><rect x="6" y="13" width="2" height="2" fill="#679c57"/><rect x="13" y="1" width="2" height="2" fill="#517f44"/></pattern>`)
  out.push(sceneryDefs())
  out.push(`<clipPath id="colony"><rect x="${PAD}" y="${my}" width="${mapW}" height="${mapH}" rx="10"/></clipPath></defs>`)
  out.push(`<g clip-path="url(#colony)"><g class="village" transform="translate(${PAD} ${my}) scale(${k.toFixed(3)})">`)
  const busy = new Set(workers.filter(wk => wk.look === 'work').map(wk => BUILDING_OF[wk.task]))
  out.push(scenery(w, vx, busy))

  // Lower on the map is nearer: drawn last, in front; names over everyone. Names keep to about
  // 9 pixels on screen however small the village is drawn.
  const defs = new Defs()
  const walks: string[] = []
  const nameSize = nameSizeOf(width)
  const names = placeNames(workers, width)
  const drawn = [...workers].sort((a, b) => a.y - b.y).map(wk => workerSvg(wk, vx, now, defs, names.get(wk.key), walks))
  if (defs.svg.length > 0) out.push(`<defs>${defs.svg.join('')}</defs>`)
  out.push(...drawn.map(d => d.body), ...drawn.map(d => d.tag))
  out.push(`</g><rect x="${PAD + 0.5}" y="${my + 0.5}" width="${mapW - 1}" height="${mapH - 1}" rx="10" fill="none" stroke="#000" stroke-opacity=".25"/></g>`)

  // What follows the clock in the scenery (kept between drawings) gets its phase here: the fire's
  // flicker and the forge's smoke carry on through a redraw instead of starting together.
  const beat = (ms: number, lag = 0) => `-${(now + ms * 1_000 - lag) % ms}ms`
  const clocked = `.nm{font-size:${nameSize}px}.fire-b{animation-delay:${beat(500)}}.tail-a,.tail-b{animation-delay:${beat(LOOP_MS.tail)}}${[0, 1, 2].map(i => `.smoke rect:nth-child(${i + 1}){animation-delay:${beat(3_200, i * 1_067)}}`).join('')}`

  const height = my + mapH + 12
  const plays = workers.flatMap(wk => (wk.look === 'chill' ? [pastimeAt(wk.key, { x: wk.x, y: wk.y }).play] : []))
  const isArriving = workers.some(wk => (wk.look === 'chill' || names.has(wk.key)) && now - wk.since < wk.ms)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${THEME}${motionCss(plays, isArriving)}${clocked}${walks.join('')}${scene.isStill ? STILL : ''}</style>${out.join('')}</svg>`
  return { source, height, alt: clean(`Colony: ${tallyOf(count) || 'nobody yet'}.`) }
}
