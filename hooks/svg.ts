import type { FleetAgent, FleetLimit, FleetSession } from '../types'
import type { Flag, FleetSummary, Progress } from './describe'
import { stateLine, limitName, limitTone, plain, taskText, plural, isPlanLimit, resetIn, fullIn, agentFlag, agentProgress, isAgentLive, isBusy, crewsOf, pickName, progressLabel, sessionProgress, cacheLeft, cacheText, folderOf, modeName, receiptText, recentLoops, slowFor, formatDuration, formatTokens, modelName, nameOf, percentOf, progressOf, spriteKind, totalTokens } from './describe'

// The desktop draws an Svg as an image: its CSS animates with no redraws from the mod,
// and prefers-color-scheme and prefers-reduced-motion reach it from the page.

const FONT = `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Inter, sans-serif`

// Text without the characters XML 1.0 forbids or the app refuses (C0 and C1 control codes and DEL
// from a command's output, lone surrogates from a cut string): an Svg, or its alt, holding one is
// refused, and the panel goes blank.
export const clean = (text: string): string =>
  text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFFFE\uFFFF]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

// Text into SVG: cleaned, and its markup escaped.
export const escape = (text: string): string =>
  clean(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Width of a string in pixels, close enough to fit text without a renderer.
export function measure(text: string, size: number, isBold = false): number {
  const em = [...text].reduce((sum, ch) => {
    if ("iljtf.,:;|!'` ".includes(ch)) return sum + 0.3
    if ('mwMW@%'.includes(ch)) return sum + 0.84
    if (ch >= 'A' && ch <= 'Z') return sum + 0.65
    if (ch >= '0' && ch <= '9') return sum + 0.56
    return sum + 0.53
  }, 0)
  return em * size * (isBold ? 1.06 : 1)
}

export function fit(text: string, width: number, size: number, isBold = false): string {
  if (width <= 0) return ''
  if (measure(text, size, isBold) <= width) return text
  const chars = [...text]
  while (chars.length > 1 && measure(`${chars.join('')}…`, size, isBold) > width) chars.pop()
  return `${chars.join('').trimEnd()}…`
}

// The desktop draws a pane's text columns about 8 CSS pixels wide (measured from its side panel).
const PX_PER_COLUMN = 8

export const widthFor = (columns: number, min = 360, max = 1400): number => Math.round(Math.min(max, Math.max(min, columns * PX_PER_COLUMN)))

// Colours as roles, dark by default and redefined for a light page.
export const THEME = [
  'svg{--fg:#ECEAE6;--muted:#A9A59E;--faint:#8A867F;--line:rgba(236,234,230,.12);--panel:rgba(236,234,230,.045);',
  '--work:#E08A68;--wait:#E7B65C;--ok:#86C496;--err:#E8786F;--idle:#8E8A83;--eye:#1E1D1B;--w1:#F08A4B;--w2:#E7B65C;--w3:#F2E6A6}',
  '@media (prefers-color-scheme:light){svg{--fg:#22211F;--muted:#5F5B55;--faint:#75716A;--line:rgba(34,33,31,.12);--panel:rgba(34,33,31,.04);',
  '--work:#A9512F;--wait:#946410;--ok:#2F8A50;--err:#C2453B;--idle:#9A958D;--eye:#FFFFFF;--w1:#C2571A;--w2:#946410;--w3:#8F7A0A}}',
  `text{font-family:${FONT};fill:var(--fg)}.muted{fill:var(--muted)}.faint{fill:var(--faint)}.wait-t{fill:var(--wait)}.err-t{fill:var(--err)}`,
  // A worker's role colour, from the hue its group carries: a light body and a deeper hat.
  '.role{--rb:hsl(var(--h) 62% 70%);--rh:hsl(var(--h) 50% 47%)}',
  '@media (prefers-color-scheme:light){.role{--rb:hsl(var(--h) 52% 43%);--rh:hsl(var(--h) 58% 31%)}}',
].join('')

// Each kind of worker wears its own hat in its own colour; what it is doing shows in the prop it holds.
// Hues stay clear of the state colours: amber (needs you), green (done) and red (failed).
export type Role = { hat: string; hue: number }

export const ROLES: Readonly<Record<string, Role>> = {
  lead: { hat: 'crown', hue: 20 },
  'haiku-quick': { hat: 'propeller', hue: 80 },
  'haiku-worker': { hat: 'cap', hue: 160 },
  Explore: { hat: 'ranger', hue: 192 },
  'sonnet-worker': { hat: 'hardhat', hue: 222 },
  Plan: { hat: 'mortarboard', hue: 250 },
  'opus-deep': { hat: 'wizard', hue: 278 },
  'opus-worker': { hat: 'tophat', hue: 308 },
  'general-purpose': { hat: 'beanie', hue: 340 },
  claude: { hat: 'beanie', hue: 340 },
}

const SPARE_HATS = ['bucket', 'headband', 'beanie']
// Hues free for agent types with no role of their own, between the ones taken.
const SPARE_HUES = [95, 176, 207, 236, 264, 293, 324, 352]

// The main agent is `lead`; a subagent goes by its type. Unknown types still get a steady look of their own.
export function roleOf(type = 'lead'): Role {
  const known = ROLES[type]
  if (known) return known
  const hash = [...type].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7)
  return { hat: SPARE_HATS[hash % SPARE_HATS.length] ?? 'beanie', hue: SPARE_HUES[hash % SPARE_HUES.length] ?? 348 }
}

const ACCENT = 'fill="var(--fg)" fill-opacity=".8"'

// Hats in the worker's 24-unit grid, sitting on a head whose top is at y=6. Brims and tips keep
// left of x=17, so the prop on the right stays clear. Only the propeller moves, and only at work.
function hat(name: string, isBusy: boolean, delayMs = 0): string {
  const h = 'fill="var(--rh)"'
  switch (name) {
    case 'crown':
      return `<path d="M7.2 7.8 6.6 3.4l2.9 2.2L12 2.2l2.5 3.4 2.9-2.2-.6 4.4z" ${h}/><circle cx="6.6" cy="3.1" r=".9" ${h}/><circle cx="12" cy="1.9" r=".9" ${h}/><circle cx="17.4" cy="3.1" r=".9" ${h}/><circle cx="12" cy="6.2" r=".75" ${ACCENT}/>`
    case 'wizard':
      return `<path d="M5.8 7.6Q12 9.2 18 7.6L8.6-.8z" ${h}/><path d="M11.4 4.2l.4.9 1 .1-.7.6.2 1-.9-.5-.9.5.2-1-.7-.6 1-.1z" ${ACCENT}/>`
    case 'tophat':
      return `<rect x="8.4" y=".8" width="7.2" height="6.2" rx=".6" ${h}/><rect x="8.4" y="4.6" width="7.2" height="1.2" fill="var(--fg)" fill-opacity=".5"/><rect x="5.8" y="6.6" width="12.4" height="1.6" rx=".8" ${h}/>`
    case 'hardhat':
      return `<path d="M6.6 7.4C6.6 3.8 9 2.2 12 2.2s5.4 1.6 5.4 5.2z" ${h}/><path d="M12 2.6v4.2" stroke="var(--fg)" stroke-opacity=".45" stroke-width="1"/><rect x="5" y="6.6" width="14" height="1.6" rx=".8" ${h}/>`
    case 'cap':
      return `<path d="M7 7.6C7 4.4 9.2 2.8 12 2.8s5 1.6 5 4.8z" ${h}/><path d="M8.6 6.6H3.6c-.7 0-.7 1 0 1.2l5 .2z" ${h}/><circle cx="12" cy="2.8" r=".7" ${ACCENT}/>`
    case 'propeller':
      return `<path d="M7.2 7.6C7.2 4.6 9.4 3.4 12 3.4s4.8 1.2 4.8 4.2z" ${h}/><path d="M12 3.6V1.8" stroke="var(--fg)" stroke-opacity=".7" stroke-width=".8"/><ellipse class="${isBusy ? 'spin' : ''}" style="animation-delay:-${delayMs % 900}ms" cx="12" cy="1.5" rx="3.6" ry=".8" ${ACCENT}/>`
    case 'ranger':
      return `<path d="M8 6.6 8.6 2.8C9.6 2 11 2.6 12 3.2 13 2.6 14.4 2 15.4 2.8L16 6.6z" ${h}/><path d="M8 5.4h8" stroke="var(--fg)" stroke-opacity=".45" stroke-width=".9"/><path d="M3.6 5.6C5 7.6 8 7.8 12 7.8s7-.2 8.4-2.2C19 8.6 16 9 12 9S5 8.6 3.6 5.6z" ${h}/>`
    case 'mortarboard':
      return `<path d="M8.2 7.6V5.4h7.6v2.2z" ${h}/><path d="M5 4.2 12 1.6l7 2.6L12 6.8z" ${h}/><path d="M7 4.6v3.4" stroke="var(--fg)" stroke-opacity=".8" stroke-width=".7"/><circle cx="7" cy="8.2" r=".75" ${ACCENT}/>`
    case 'bucket':
      return `<path d="M7.8 7C8 4.4 9.7 3.2 12 3.2s4 1.2 4.2 3.8z" ${h}/><path d="M5.6 8.4 7.2 6.4h9.6l1.6 2z" ${h}/>`
    case 'headband':
      return `<path d="M6.6 9.2C8 8.2 16 8.2 17.4 9.2L17.6 7.4C16 6.4 8 6.4 6.4 7.4z" ${h}/><path d="M6.6 8.2 3.6 6.6l.2 2.2zM6.6 8.6 4 10.2l1.7.7z" ${h}/>`
    default:
      return `<path d="M7 7.6C7 4.4 9.2 3 12 3s5 1.4 5 4.6z" ${h}/><rect x="6.6" y="6.2" width="10.8" height="1.9" rx=".95" ${h}/><rect x="6.6" y="6.2" width="10.8" height="1.9" rx=".95" fill="var(--fg)" fill-opacity=".18"/><circle cx="12" cy="2.6" r="1.2" ${ACCENT}/>`
  }
}

// Each worker's motion says what it is doing; slow and small, so a dock of them stays calm.
// Only a session waiting on the person moves to be noticed. Reduced motion stills them all.
export const MOTION = [
  '.c{transform-box:fill-box;transform-origin:50% 100%}',
  '.bob{animation:bob 1.6s cubic-bezier(.45,0,.55,1) infinite}',
  '.hop{animation:hop 1.3s cubic-bezier(.33,0,.2,1) infinite}',
  '.eyes{transform-box:fill-box;transform-origin:50% 50%;animation:blink 4.8s infinite}',
  '.scan{animation:scan 2.4s ease-in-out infinite,blink 4.8s infinite}',
  '.tool{transform-box:fill-box;transform-origin:50% 100%;animation:wiggle 1.4s ease-in-out infinite}',
  '.orbit{transform-box:view-box;animation:orbit 2.2s linear infinite}@keyframes orbit{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
  '.pulse{animation:pulse 1.8s ease-in-out infinite}',
  '.dots circle{animation:dot 1.4s ease-in-out infinite;opacity:.25}',
  // A propeller seen side-on: its blade narrows and widens as it turns.
  '.spin{transform-box:fill-box;transform-origin:50% 50%;animation:spin .9s infinite}@keyframes spin{0%,100%{transform:scaleX(1);animation-timing-function:cubic-bezier(.45,0,1,1)}50%{transform:scaleX(.15);animation-timing-function:cubic-bezier(0,0,.55,1)}}',
  '@keyframes bob{50%{transform:translateY(-1.5px)}}',
  '@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-2px)}60%{transform:translateY(-2px)}}',
  '@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.15)}}',
  '@keyframes scan{0%,100%{transform:translateX(-1px)}50%{transform:translateX(1.2px)}}',
  '@keyframes wiggle{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}',
  '@keyframes pulse{0%,100%{opacity:.35}50%{opacity:1}}',
  '@keyframes dot{0%,100%{opacity:.25}40%{opacity:1}}',
  // Reduced motion keeps what only fades (the waiting badge, the dots), slower, and stills all movement.
  '@media (prefers-reduced-motion:reduce){.c,.eyes,.scan,.tool,.orbit,.spin{animation:none!important}.pulse{animation-duration:3s}.dots circle{animation-duration:2.4s}}',
].join('')

export const STYLE = THEME + MOTION

// At work a worker wears its role colour; resting it greys, and a failed one turns red.
const colorOf = (state: string): string => (state === 'failed' ? 'var(--err)' : state === 'idle' || state === 'ended' ? 'var(--idle)' : 'var(--rb)')

// A small round worker, `size` wide, its feet at (x, y + size*0.8). Its hat and colour say
// what kind of worker it is (`role`: 'lead' for a session's main agent, else the subagent type);
// its motion and the prop beside it say what it is doing. `delay` keeps a dock of them out of step.
export function critter(kind: string, x: number, y: number, size: number, delayMs: number, state: string, role = 'lead'): string {
  const s = size / 24
  const body = colorOf(state)
  const { hat: hatName, hue } = roleOf(role)
  // Negative: each redraw restarts the motion, and a positive delay would hold a worker still first.
  const d = `style="animation-delay:-${delayMs}ms"`
  // Each dot a beat behind the one before, its phase from the clock like everything else: a positive
  // delay would hold the later dots still for a moment after every redraw.
  const dot = (i: number) => `style="animation-delay:-${(delayMs - i * 200 + 1_400_000_000) % 1_400}ms"`
  const isIdle = kind === 'idle' || kind === 'ended'
  const motion = kind === 'running' ? 'hop' : isIdle || kind === 'waiting' ? '' : 'bob'
  const eyes = isIdle
    ? `<g fill="none" stroke="var(--eye)" stroke-width="1.6" stroke-linecap="round"><path d="M8.2 12.6h2.6M13.2 12.6h2.6"/></g>`
    : kind === 'done'
      ? `<g fill="none" stroke="var(--eye)" stroke-width="1.6" stroke-linecap="round"><path d="M8 13l1.5-1.4 1.5 1.4M13 13l1.5-1.4 1.5 1.4"/></g>`
      : kind === 'failed'
        ? `<g stroke="var(--eye)" stroke-width="1.5" stroke-linecap="round"><path d="M8.3 11.3l2.2 2.2M10.5 11.3l-2.2 2.2M13.5 11.3l2.2 2.2M15.7 11.3l-2.2 2.2"/></g>`
        : `<g class="${kind === 'reading' || kind === 'searching' ? 'scan' : 'eyes'}" ${d}><circle cx="9.6" cy="12.4" r="1.45" fill="var(--eye)"/><circle cx="14.4" cy="12.4" r="1.45" fill="var(--eye)"/></g>`
  const prop =
    kind === 'editing'
      ? `<g class="tool" ${d}><path d="M20.2 5.2l2.1 2.1-5.2 5.2-2.6.5.5-2.6z" fill="var(--fg)" fill-opacity=".85"/></g>`
      : kind === 'reading'
        ? `<g><rect x="17.4" y="10.4" width="6" height="7.2" rx="1" fill="var(--fg)" fill-opacity=".8"/><path d="M18.6 12.4h3.6M18.6 14h3.6M18.6 15.6h2.4" stroke="var(--eye)" stroke-width=".8"/></g>`
        : kind === 'searching'
          ? `<g class="orbit" style="transform-origin:20px 8px;animation-delay:-${delayMs}ms"><circle cx="20.2" cy="6.6" r="2.4" fill="none" stroke="var(--fg)" stroke-width="1.4"/><path d="M21.9 8.3l1.6 1.6" stroke="var(--fg)" stroke-width="1.4" stroke-linecap="round"/></g>`
          : kind === 'browsing' || kind === 'delegating'
            ? `<g class="dots" fill="var(--fg)"><circle cx="18.4" cy="5.4" r="1.05" ${dot(0)}/><circle cx="20.9" cy="5.4" r="1.05" ${dot(1)}/><circle cx="23.4" cy="5.4" r="1.05" ${dot(2)}/></g>`
            : kind === 'thinking'
              ? `<g class="dots" fill="var(--fg)"><circle cx="17.8" cy="5" r=".95" ${dot(0)}/><circle cx="20.2" cy="3.9" r="1.2" ${dot(1)}/><circle cx="22.9" cy="2.5" r="1.5" ${dot(2)}/></g>`
              : kind === 'running'
                ? `<path d="M1 18.6h3M.2 15.8h2.4" stroke="var(--fg)" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>`
                : kind === 'waiting'
                  ? `<g class="pulse"><circle cx="20.6" cy="5" r="3.6" fill="var(--wait)"/><path d="M20.6 3.1v2.3" stroke="var(--eye)" stroke-width="1.4" stroke-linecap="round"/><circle cx="20.6" cy="6.9" r=".8" fill="var(--eye)"/></g>`
                  : isIdle
                    ? `<text class="faint" x="18" y="8" font-size="7" font-weight="700" opacity=".7">z</text><text class="faint" x="21" y="4.5" font-size="5.5" font-weight="700" opacity=".45">z</text>`
                    : ''
  const isResting = state === 'idle' || state === 'ended'
  return [
    // A finished subagent steps back: the same worker, faded.
    `<g class="role" transform="translate(${+x.toFixed(1)} ${+y.toFixed(1)}) scale(${+s.toFixed(3)})" style="--h:${hue}"${state === 'done' ? ' opacity=".55"' : ''}>`,
    `<ellipse cx="12" cy="20.4" rx="6.4" ry="1.3" fill="var(--fg)" fill-opacity=".1"/>`,
    `<g class="c ${motion}" ${d}>`,
    `<path d="M4.6 14.2C4.6 9.2 7.9 6 12 6s7.4 3.2 7.4 8.2c0 3.7-2.6 5.8-7.4 5.8s-7.4-2.1-7.4-5.8z" fill="${body}"/>`,
    eyes,
    `<g transform="translate(12 7.6) scale(1.18) translate(-12 -7.6)"${isResting ? ' opacity=".7"' : ''}>${hat(hatName, state === 'working', delayMs)}</g>`,
    `</g>`,
    // Props sit a little right, clear of the hats.
    prop ? `<g transform="translate(2 0)">${prop}</g>` : '',
    `</g>`,
  ].join('')
}

// A hairline track with a fill; colour by level.
function bar(x: number, y: number, width: number, fraction: number, h = 3): string {
  const f = Math.max(0, Math.min(1, fraction))
  const color = f >= 0.85 ? 'var(--err)' : f >= 0.7 ? 'var(--wait)' : 'var(--fg)'
  const opacity = f >= 0.7 ? 1 : 0.55
  return `<rect x="${x}" y="${y}" width="${width}" height="${h}" rx="${h / 2}" fill="var(--fg)" fill-opacity=".1"/><rect x="${x}" y="${y}" width="${Math.max(f > 0 ? h : 0, Math.round(width * f))}" height="${h}" rx="${h / 2}" fill="${color}" fill-opacity="${opacity}"/>`
}

// The motion's phase follows the clock: each redraw restarts CSS animations, and a delay this far
// back carries a worker on mid-move instead of snapping it to the start. It wraps once a day.
const beatOf = (now: number): number => now % 86_400_000

const STILL = '*{animation:none!important}.dots circle{opacity:.7}.smoke rect{opacity:.5}'

// `isStill` is the person's Still setting: everything holds still, whatever the OS asks.
export const svg = (width: number, height: number, body: string, isStill: boolean, extraStyle = ''): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><style>${STYLE}${extraStyle}${isStill ? STILL : ''}</style>${body}</svg>`

export const ctxOf = (s: FleetSession): number => (s.contextPercent !== null ? s.contextPercent / 100 : s.contextWindow ? s.contextTokens / s.contextWindow : 0)


// The main agent's prompt cache: a ring that empties as the cache ages, and the minutes left.
// Amber in its last stretch, a dashed empty ring once cold (the next prompt re-sends everything).
function cacheBadge(x: number, y: number, s: FleetSession, now: number): string {
  const left = cacheLeft(s, now)
  if (left === null) return ''
  const r = 4
  const c = 2 * Math.PI * r
  const f = left.ms / left.ttl
  const isCold = left.ms <= 0
  const isLow = !isCold && f <= 0.15
  const color = isLow ? 'var(--wait)' : 'var(--fg)'
  const track = `<circle cx="${x + r}" cy="${y}" r="${r}" fill="none" stroke="var(--fg)" stroke-opacity="${isCold ? 0.35 : 0.14}" stroke-width="1.6"${isCold ? ' stroke-dasharray="1.6 1.6"' : ''}/>`
  const fill = isCold ? '' : `<circle cx="${x + r}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-opacity="${isLow ? 1 : 0.6}" stroke-width="1.6" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${x + r} ${y})"/>`
  return `${track}${fill}<text x="${x + 2 * r + 4}" y="${y + 3.6}" font-size="10.5" class="${isLow ? 'wait-t' : 'faint'}">${cacheText(left)}</text>`
}

// --- The band: a dock of busy sessions above the prompt, idle ones folded into one pill. ---

const CHIP_H = 46
const CHIP_GAP = 8
const CHIP_MIN = 230
// A chip for a session that needs the person may shrink this far before it folds.
const CHIP_WAIT_MIN = 170
const CHIP_MAX = 320
export type BandLayout = { chips: number; chipW: number; hidden: number; pillW: number; pillText: string; pillWait: string; isTight: boolean }

// The folded pill's words and width: who needs the person first (in the wait colour), then the idle
// count, and busy sessions with no room for a chip.
const pillOf = (idle: number, hidden: number, hiddenWaiting: number): { wait: string; text: string; width: number } => {
  const wait = hiddenWaiting > 0 ? `${hiddenWaiting} need${hiddenWaiting === 1 ? 's' : ''} you` : ''
  const text = [idle > 0 ? `${idle} idle` : '', hidden - hiddenWaiting > 0 ? `+${hidden - hiddenWaiting} busy` : ''].filter(Boolean).join(' · ')
  const all = [wait, text].filter(Boolean).join(' · ')
  const sleepers = Math.max(1, Math.min(3, idle))
  return { wait, text, width: all ? Math.ceil(14 + 20 + (sleepers - 1) * 13 + 10 + measure(all, 11.5) + 14) : 0 }
}

// When even one chip and the full pill don't fit, the pill shrinks to a count with no workers on it:
// a session that needs the person keeps its chip.
const tightPillOf = (idle: number, hidden: number, hiddenWaiting: number): { wait: string; text: string; width: number } => {
  const wait = hiddenWaiting > 0 ? `${hiddenWaiting} need${hiddenWaiting === 1 ? 's' : ''} you` : ''
  const more = idle + hidden - hiddenWaiting
  const text = more > 0 ? (wait ? `+${more}` : `+${more} more`) : ''
  const all = [wait, text].filter(Boolean).join(' · ')
  return { wait, text, width: all ? Math.ceil(12 + measure(all, 11.5) + 12) : 0 }
}

// `waiting` of the `busy` sessions need the person and come first: they are the last to fold.
export function bandLayout(busy: number, idle: number, width: number, waiting = 0): BandLayout {
  const fit = (chips: number, isTight: boolean): BandLayout | null => {
    const pill = (isTight ? tightPillOf : pillOf)(idle, busy - chips, Math.max(0, waiting - chips))
    const room = width - (pill.width ? pill.width + CHIP_GAP : 0)
    const min = chips <= waiting ? CHIP_WAIT_MIN : CHIP_MIN
    if (chips > 0 && room < chips * min + (chips - 1) * CHIP_GAP) return null
    const chipW = chips > 0 ? Math.min(CHIP_MAX, Math.floor((room - (chips - 1) * CHIP_GAP) / chips)) : 0
    return { chips, chipW, hidden: busy - chips, pillW: pill.width, pillText: pill.text, pillWait: pill.wait, isTight }
  }
  let found: BandLayout | null = null
  for (let chips = busy; chips >= 0 && found === null; chips -= 1) found = fit(chips, false)
  const wanted = Math.min(waiting, busy)
  if (found !== null && found.chips >= wanted) return found
  // Fewer chips than sessions that need the person: try a smaller pill for them.
  for (let chips = busy; chips > (found?.chips ?? -1); chips -= 1) {
    const tight = fit(chips, true)
    if (tight !== null) return tight
  }
  return found ?? fit(0, true)!
}

export function bandSvg(list: readonly FleetSession[], mineId: string | undefined, width: number, now: number, isStill = false): { source: string; height: number; width: number } {
  // Those who need the person lead; the rest keep their order.
  const busy = list.filter(s => isBusy(s, now)).sort((a, b) => Number(b.state === 'waiting') - Number(a.state === 'waiting'))
  const idle = list.filter(s => s.state === 'idle' && !isBusy(s, now))
  const layout = bandLayout(busy.length, idle.length, width, busy.filter(s => s.state === 'waiting').length)
  const parts = busy.slice(0, layout.chips).map((s, i) => {
    const x = i * (layout.chipW + CHIP_GAP)
    const kind = spriteKind(s.state, s.now, s.kind)
    const textX = x + 42
    const room = layout.chipW - 42 - 12
    const agents = s.agents.filter(a => isAgentLive(a, now)).length
    const here = s.id === mineId ? 30 : 0
    const meta = agents > 0 ? ` · ${plural(agents, 'agent')}` : ''
    // Resting between turns with subagents at it: the chip says that, not "waiting for your reply".
    const doing = s.state === 'idle' && agents > 0 ? `${plural(agents, 'agent')} working` : plain(s.now) + meta
    const isWait = s.state === 'waiting'
    const percent = percentOf(progressOf(s.tasks))
    return [
      `<rect x="${x + 0.5}" y=".5" width="${layout.chipW - 1}" height="${CHIP_H - 1}" rx="10" fill="var(--panel)" stroke="${isWait ? 'var(--wait)' : 'var(--line)'}"/>`,
      critter(kind, x + 9, 10, 26, beatOf(now) + i * 370, s.state),
      `<text x="${textX}" y="19" font-size="12.5" font-weight="600">${escape(fit(nameOf(s), room - here, 12.5, true))}${here ? '<tspan class="faint" font-weight="400" font-size="11">  here</tspan>' : ''}</text>`,
      `<text x="${textX}" y="35" font-size="11.5" class="${isWait ? 'wait-t' : 'muted'}">${percent !== null ? `<tspan font-weight="600" fill="var(--fg)">${percent}%</tspan>  ` : ''}${escape(fit(doing, room - (percent !== null ? 34 : 0), 11.5))}</text>`,
      ctxOf(s) > 0 ? bar(x + 10, CHIP_H - 6, layout.chipW - 20, ctxOf(s), 2) : '',
    ].join('')
  })
  let used = layout.chips > 0 ? layout.chips * (layout.chipW + CHIP_GAP) : 0
  if (layout.pillW > 0) {
    const x = used
    const sleepers = Math.max(1, Math.min(3, idle.length))
    parts.push(`<rect x="${x + 0.5}" y=".5" width="${layout.pillW - 1}" height="${CHIP_H - 1}" rx="10" fill="none" stroke="${layout.pillWait ? 'var(--wait)' : 'var(--line)'}" stroke-dasharray="3 3"/>`)
    if (!layout.isTight) for (let i = sleepers - 1; i >= 0; i -= 1) parts.push(critter(idle.length > 0 ? 'idle' : 'thinking', x + 10 + i * 13, 13, 20, beatOf(now) + 900 + i * 600, idle.length > 0 ? 'idle' : 'working'))
    const lead = layout.pillWait ? `<tspan class="wait-t">${escape(layout.pillWait)}</tspan>${layout.pillText ? ' · ' : ''}` : ''
    parts.push(`<text x="${layout.isTight ? x + 12 : x + 14 + 20 + (sleepers - 1) * 13 + 8}" y="28" font-size="11.5" class="muted">${lead}${escape(layout.pillText)}</text>`)
    used += layout.pillW
  }
  const w = Math.max(1, Math.min(width, used))
  return { source: svg(w, CHIP_H, parts.join(''), isStill), height: CHIP_H, width: w }
}

// --- The dashboard: every session and its agents, for /fleet. ---

const HEAD_H = 58
// A row in a wide drawing keeps its context in the metrics column; a narrow one (the side
// panel) gives it a fourth line.
const ROW_H = 74
const ROW_NARROW_H = 92
const ROW_COMPACT_H = 50
const AGENT_H = 26
export const PAD = 20
const WIDE = 640

// A row never prompted has no third line, and no cache badge to hang under it: it is shorter.
const COMPACT_RAIL_DROP = 8
const ROW_BARE_H = 64
const ROW_NARROW_BARE_H = 76

const baseHeight = (isCompact: boolean, isNarrow: boolean, isBare: boolean): number =>
  isCompact ? ROW_COMPACT_H : isNarrow ? (isBare ? ROW_NARROW_BARE_H : ROW_NARROW_H) : isBare ? ROW_BARE_H : ROW_H

export function rowHeight(agents: number, loops: number, isCompact: boolean, isNarrow: boolean, isBare = false): number {
  const lines = agents + (loops > 0 ? 1 : 0)
  // A compact row's rail starts below its second line, not into it.
  return baseHeight(isCompact, isNarrow, isBare) + lines * AGENT_H + (lines > 0 ? 6 + (isCompact ? COMPACT_RAIL_DROP : 0) : 0)
}

// Where a plan limit's colour changes: amber at 60%, red at 85%.
const NOTCHES = [0.6, 0.85]

// Short radial ticks across the ring's stroke at the notches, clockwise from the top like the arc.
function notches(cx: number, cy: number, r: number): string {
  return NOTCHES.map(p => {
    const a = (p * 360 - 90) * (Math.PI / 180)
    const at = (d: number) => `${+(cx + d * Math.cos(a)).toFixed(2)} ${+(cy + d * Math.sin(a)).toFixed(2)}`
    return `<path d="M${at(r - 1.5)}L${at(r + 1.5)}" stroke="var(--fg)" stroke-opacity=".35" stroke-width="1" stroke-linecap="round"/>`
  }).join('')
}

function ring(cx: number, cy: number, r: number, fraction: number, hasNotches = false): string {
  const f = Math.max(0, Math.min(1, fraction))
  const c = 2 * Math.PI * r
  const color = f >= 0.85 ? 'var(--err)' : f >= 0.6 ? 'var(--wait)' : 'var(--fg)'
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--fg)" stroke-opacity=".12" stroke-width="3"/>${hasNotches ? notches(cx, cy, r) : ''}<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-opacity="${f >= 0.6 ? 1 : 0.7}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`
}

// Where the context stood each time the conversation was compacted: a tick across the bar.
const ticks = (x: number, y: number, width: number, h: number, compactions: readonly number[] | undefined): string =>
  (compactions ?? []).map(p => `<rect x="${(x + (width * Math.min(100, p)) / 100 - 0.75).toFixed(1)}" y="${y - 2}" width="1.5" height="${h + 4}" rx=".75" fill="var(--muted)"/>`).join('')

export type DashboardInput = {
  list: readonly FleetSession[]
  sum: FleetSummary
  limits: readonly FleetLimit[]
  mineId: string | undefined
  now: number
  isCompact: boolean
  isStill?: boolean
  // At most this many subagent rows a session, the rest folded into "+N more": for a fleet too big to draw whole.
  agentCap?: number
  // Draw only the header, or only the row of the session at this place in the list (each on its own).
  part?: 'header' | number | { main: number } | { agents: number }
}

// Whether a session's row has subagent or background-loop lines to draw (they can be a picture of
// their own).
export const hasAgentRows = (s: FleetSession, now: number): boolean => visibleAgents(s, now).length + recentLoops(s, now).length > 0

// The subagents a session shows: those at work, and those that finished in the last five minutes.
// One lost (marked running, long silent) is left out: its end never arrived.
export const visibleAgents = (s: FleetSession, now: number): FleetAgent[] =>
  s.agents.filter(a => (a.state === 'working' ? isAgentLive(a, now) : now - (a.endedAt ?? now) < 5 * 60_000))

// A worker's progress: a short bar in its role colour and the percent beside it ("~" for a guess).
const PROGRESS_BAR_W = 32
function progressMark(x: number, y: number, p: Progress, hue: number, labelSide: 'left' | 'right'): string {
  const label = progressLabel(p)
  const fill = Math.max(p.fraction > 0 ? 2 : 0, Math.round(PROGRESS_BAR_W * Math.min(1, p.fraction)))
  const barX = labelSide === 'left' ? x - PROGRESS_BAR_W : x
  const text = labelSide === 'left'
    ? `<text x="${barX - 6}" y="${y + 4}" font-size="10.5" text-anchor="end" class="faint">${label}</text>`
    : `<text x="${barX + PROGRESS_BAR_W + 6}" y="${y + 4}" font-size="10.5" class="faint">${label}</text>`
  return `<g class="role" style="--h:${hue}"><rect x="${barX}" y="${y}" width="${PROGRESS_BAR_W}" height="4" rx="2" fill="var(--fg)" fill-opacity=".1"/><rect x="${barX}" y="${y}" width="${fill}" height="4" rx="2" fill="var(--rb)"${p.isEstimate ? ' fill-opacity=".75"' : ''}/></g>${text}`
}

const progressMarkW = (p: Progress | null): number => (p ? PROGRESS_BAR_W + 6 + measure(progressLabel(p), 10.5) + 10 : 0)

// A flag after a line of text, in its level's colour.
const flagSpan = (flag: Flag | null): string => (flag ? `<tspan class="${flag.level === 'err' ? 'err-t' : 'wait-t'}">  ${escape(flag.text)}</tspan>` : '')

const flagWidth = (flag: Flag | null, size: number): number => (flag ? measure(`  ${flag.text}`, size) : 0)

// The header: what is going on, and the plan limits that bound it.
export function headerSvg(sum: FleetSummary, limits: readonly FleetLimit[], width: number, now = 0): { parts: string[]; height: number } {
  const right = width - PAD
  const parts: string[] = []
  // On a plan the money isn't spent: it is what the same use would cost on the API.
  const cost = `$${sum.costUsd.toFixed(2)} ${limits.some(isPlanLimit) ? 'API value' : 'spent'}`
  const agents = sum.agents > 0 ? `${sum.agents} agent${sum.agents === 1 ? '' : 's'}` : ''
  const all = [
    `${sum.sessions} session${sum.sessions === 1 ? '' : 's'}`,
    sum.working > 0 ? `<tspan fill="var(--work)">${sum.working} working</tspan>` : '0 working',
    sum.waiting > 0 ? `<tspan fill="var(--wait)">${sum.waiting} need${sum.waiting === 1 ? 's' : ''} you</tspan>` : '',
    agents,
    cost,
  ].filter(Boolean)
  // The line has to fit the card: the cost goes first, then the agents.
  const flatOf = (list: string[]) => list.join('  ·  ').replace(/<[^>]+>/g, '')
  const fits = (list: string[]) => measure(flatOf(list), 12) <= width - 2 * PAD
  let counts = all
  if (!fits(counts)) counts = counts.filter(c => c !== cost)
  if (!fits(counts)) counts = counts.filter(c => c !== agents)
  // The limits sit at the right of the title; the counts drop to their own line when they would meet.
  const ringOf = (limit: FleetLimit, isTimed: boolean, isForecast = true) => {
    const kind = limitName(limit.kind)
    // The time left to the reset, when the reading says when that is.
    const resets = limit.resetsAt !== null ? Date.parse(limit.resetsAt) : NaN
    const resetName = isTimed && now > 0 && Number.isFinite(resets) && resets > now ? `${kind} · ${resetIn(resets - now)}` : kind
    // The forecast outranks the reset time: it stays while the reset times drop.
    const isFull = isForecast && limit.fullInMs !== undefined
    const name = isFull ? `${kind} · full ~${fullIn(limit.fullInMs!)}` : resetName
    const text = `${Math.round(limit.percentUsed)}%`
    return { limit, name, isFull, text, w: 28 + Math.max(measure(text, 12, true), measure(name, 10.5)) + 4 }
  }
  // Many limits (a gateway's spend limit beside the plan's two) must not run into the title: the
  // reset times go, the last ring's first, until the rings fit beside it.
  const ringsWidth = (list: { w: number }[]) => list.reduce((n, r) => n + r.w, 0) + 14 * Math.max(0, list.length - 1)
  const room = width - PAD - (PAD + measure('Fleet', 15, true) + 16)
  let timed = limits.length
  let rings = limits.map((limit, i) => ringOf(limit, i < timed))
  while (timed > 0 && ringsWidth(rings) > room) {
    timed -= 1
    rings = limits.map((limit, i) => ringOf(limit, i < timed))
  }
  // Still too wide with no times: the forecasts go too.
  if (ringsWidth(rings) > room) rings = limits.map(limit => ringOf(limit, false, false))
  const ringsW = rings.reduce((n, r) => n + r.w + 14, 0)
  const isStacked = PAD + measure(flatOf(counts), 12) + 24 + ringsW > width - PAD
  const headH = isStacked ? HEAD_H + 22 : HEAD_H
  parts.push(`<text x="${PAD}" y="26" font-size="15" font-weight="650">Fleet</text>`)
  parts.push(`<text x="${PAD}" y="${isStacked ? 67 : 45}" font-size="12" class="muted">${counts.join('<tspan class="faint">  ·  </tspan>')}</text>`)
  let lx = right
  for (const r of [...rings].reverse()) {
    lx -= r.w
    parts.push(ring(lx + 11, 29, 9, r.limit.percentUsed / 100, true))
    parts.push(`<text x="${lx + 28}" y="27" font-size="12" font-weight="600">${r.text}</text><text x="${lx + 28}" y="40" font-size="10.5" class="${r.isFull ? (limitTone(r.limit) === 'error' ? 'err-t' : 'wait-t') : 'faint'}">${escape(r.name)}</text>`)
    lx -= 14
  }
  parts.push(`<rect x="${PAD}" y="${headH - 1}" width="${width - 2 * PAD}" height="1" fill="var(--line)"/>`)

  return { parts, height: headH }
}

export function dashboardSvg(input: DashboardInput, width: number): { source: string; height: number } {
  const { list, sum, limits, mineId, now, isCompact, isStill = false } = input
  const right = width - PAD
  const isNarrow = width < WIDE
  const metricsW = isNarrow ? 0 : 200
  const parts: string[] = []

  const head = headerSvg(sum, limits, width, now)
  parts.push(...head.parts)
  const headH = head.height
  let y = headH
  if (list.length === 0) {
    parts.push(`<text x="${PAD}" y="${y + 30}" font-size="12.5" class="muted">No sessions yet. Sessions started after the fleet mod was installed appear here.</text>`)
    y += 50
  }

  // Each session's captain: the main agent's name, here and in the colony.
  const crews = crewsOf(list)
  if (input.part === 'header') return { source: svg(width, y, parts.join(''), isStill), height: y }

  // One session's row, drawn from y0 down into `parts`; its height comes back.
  // `mode`: the whole row, only its own lines ('main'), or only its subagent lines ('agents').
  const rowOf = (s: FleetSession, index: number, y0: number, parts: string[], hasRule: boolean, slice: 'whole' | 'main' | 'agents' = 'whole'): number => {
    let y = y0
    const crew = crews.get(s.id) ?? { name: '' }
    const visible = visibleAgents(s, now)
    const agents = slice === 'main' ? [] : visible.slice(0, input.agentCap ?? visible.length)
    const folded = slice === 'main' ? 0 : visible.length - agents.length
    const loops = slice === 'main' ? [] : recentLoops(s, now)
    // What the row says on its third line, and whether there is a line at all (and a badge under the worker).
    const receipt = receiptText(s.receipt)
    const asked = taskText(s)
    const isQuiet0 = s.state === 'idle' || s.state === 'ended'
    const third = isQuiet0 && receipt ? `Last turn: ${receipt}` : asked ? `Asked: ${asked}` : receipt ? `Last turn: ${receipt}` : ''
    // (The cache badge sits in the gutter either way and fits.)
    const isBare = !isCompact && third === ''
    const h = rowHeight(agents.length + (folded > 0 ? 1 : 0), loops.length, isCompact, isNarrow, isBare)
    const isQuiet = s.state === 'idle' || s.state === 'ended'
    const x0 = PAD + 44
    const textW = width - x0 - PAD - (metricsW ? metricsW + 16 : 0)
    const kind = spriteKind(s.state, s.now, s.kind)
    const cache = cacheText(cacheLeft(s, now))
    const ctx = ctxOf(s)
    const model = `${modelName(s.model)}${s.effort ? ` ${s.effort}` : ''}`
    const mode = modeName(s.mode)
    if (s.state === 'waiting') parts.push(`<rect x="${PAD - 10}" y="${y + 6}" width="3" height="${h - 12}" rx="1.5" fill="var(--wait)"/>`)
    parts.push(critter(kind, PAD, y + 12, 32, beatOf(now) + index * 410, s.state))
    if (!isCompact) parts.push(cacheBadge(PAD + 2, y + 57, s, now))

    // Line 1: the name, and how the session stands (on the right when narrow, else in the metrics column).
    // Narrow, the title needs the room: "here" for "this session", and a small state column.
    const hereText = isNarrow ? 'here' : 'this session'
    const here = s.id === mineId ? `<tspan class="faint" font-weight="400" font-size="11.5">  ${hereText}</tspan>` : ''
    const hereW = s.id === mineId ? (isNarrow ? 40 : 80) : 0
    const state = stateLine(s, now, isNarrow)
    const stateClass = s.state === 'waiting' ? 'wait-t' : s.state === 'working' ? '' : 'faint'
    if (isNarrow) {
      const stateW = Math.min(measure(state, 11.5), textW * 0.3)
      const title = fit(nameOf(s), textW - stateW - hereW - 14, 13.5, true)
      parts.push(`<text x="${x0}" y="${y + 24}" font-size="13.5" font-weight="600" opacity="${isQuiet ? 0.8 : 1}">${escape(title)}${here}</text>`)
      parts.push(`<text x="${right}" y="${y + 24}" font-size="11.5" text-anchor="end" class="${stateClass}">${escape(fit(state, stateW, 11.5))}</text>`)
    } else {
      const sub = [folderOf(s), model, mode].filter(Boolean).join(' · ')
      const title = fit(nameOf(s), textW * 0.62, 13.5, true)
      const subX = x0 + measure(title, 13.5, true) + hereW + 12
      parts.push(`<text x="${x0}" y="${y + 24}" font-size="13.5" font-weight="600" opacity="${isQuiet ? 0.8 : 1}">${escape(title)}${here}</text>`)
      parts.push(`<text x="${subX}" y="${y + 24}" font-size="11.5" class="faint">${escape(fit(sub, x0 + textW - subX, 11.5))}</text>`)
      parts.push(`<text x="${right}" y="${y + 24}" font-size="11.5" text-anchor="end" class="${stateClass}">${escape(state)}</text>`)
    }

    // Line 2: what it is doing, flagged once a tool has run long.
    const slow = s.state === 'working' ? slowFor(s.toolAt, now) : 0
    const slowFlag: Flag | null = slow > 0 ? { text: `${formatDuration(slow)}`, level: 'warn' } : null
    // The captain's name leads: "Nova: Editing svg.ts", "Nova replied: …".
    const isUnprompted = s.state === 'idle' && !s.last && asked === '' && !receipt
    const activity = isUnprompted ? 'No prompt yet' : plain(s.state === 'idle' && s.last ? s.last : s.now)
    const lead = crew.name && !isUnprompted ? `${crew.name}${s.state === 'idle' && s.last ? ' replied' : ''}: ` : ''
    const leadW = measure(lead, 12.5, true)
    parts.push(`<text x="${x0}" y="${y + 43}" font-size="12.5" class="${s.state === 'waiting' ? 'wait-t' : isQuiet ? 'muted' : ''}"><tspan font-weight="650">${escape(lead)}</tspan>${escape(fit(activity, textW - leadW - flagWidth(slowFlag, 12.5), 12.5))}${flagSpan(slowFlag)}</text>`)

    // Line 3: the ask while it works; the last turn's receipt once it rests.
    if (!isCompact && third) parts.push(`<text x="${x0}" y="${y + 61}" font-size="11.5" class="faint">${escape(fit(third, textW, 11.5))}</text>`)

    // Line 4 (narrow): context, with compaction ticks, then model, mode and cost.
    if (isNarrow && !isCompact) {
      const barW = 56
      const by = isBare ? y + 62 : y + 74
      parts.push(bar(x0, by, barW, ctx))
      parts.push(ticks(x0, by, barW, 3, s.compactions))
      const meta = [`${Math.round(ctx * 100)}%`, model, mode, s.costUsd !== null ? `$${s.costUsd.toFixed(2)}` : '', s.compactions?.length ? `compacted ${s.compactions.length}×` : ''].filter(Boolean).join(' · ')
      parts.push(`<text x="${x0 + barW + 8}" y="${by + 4.5}" font-size="11" class="${ctx >= 0.7 ? 'wait-t' : 'faint'}">${escape(fit(meta, textW - barW - 8, 11))}</text>`)
    }

    if (metricsW) {
      const mx = right - metricsW
      const tokens = totalTokens(s.tokens)
      const stats = [cache ? `cache ${cache}` : '', s.costUsd !== null ? `$${s.costUsd.toFixed(2)}` : '', tokens > 0 ? `${formatTokens(tokens)} tok` : ''].filter(Boolean).join(' · ')
      parts.push(bar(mx, y + 36, metricsW, ctx))
      parts.push(ticks(mx, y + 36, metricsW, 3, s.compactions))
      const ctxText = `${Math.round(ctx * 100)}% context${s.compactions?.length ? ` · ${s.compactions.length}× compacted` : ''}`
      parts.push(`<text x="${mx}" y="${y + 56}" font-size="11" class="${ctx >= 0.7 ? 'wait-t' : 'faint'}">${ctxText}</text>`)
      parts.push(`<text x="${right}" y="${y + 56}" font-size="11" text-anchor="end" class="faint">${escape(fit(stats, metricsW - measure(ctxText, 11) - 10, 11))}</text>`)
    }

    // Subagents, hung off the session on a thin rail; then the loops no list names, as one line.
    const agentsFrom = parts.length
    // Drawn alone, their picture starts at the rail's top.
    const top = slice === 'agents' ? 10 : y + baseHeight(isCompact, isNarrow, isBare) - 4 + (isCompact ? COMPACT_RAIL_DROP : 0)
    const aRight = metricsW ? right - metricsW - 16 : right
    const rail = (i: number, ay: number) => parts.push(`<path d="M${x0 + 2} ${ay - (i === 0 ? 8 : AGENT_H - 6)}V${ay + 9}h10" fill="none" stroke="var(--line)" stroke-width="1.2"/>`)
    agents.forEach((a, i) => {
      const ay = top + i * AGENT_H
      const ax = x0 + 18
      rail(i, ay)
      parts.push(critter(spriteKind(a.state, a.now, a.kind), ax - 1, ay - 3, 20, beatOf(now) + index * 410 + (i + 1) * 290, a.state, a.type))
      // A name given at spawn can run long: it keeps to about a third of the row.
      const left = fit(a.name || pickName(a.id, []), (right - ax) * 0.3, 12, true)
      const leftW = measure(left, 12, true)
      const prog = agentProgress(a)
      // Narrow, the bar ends the row; wide, it opens the metrics column.
      const progRight = metricsW ? aRight : right - progressMarkW(prog)
      if (prog) parts.push(metricsW ? progressMark(right - metricsW, ay + 7, prog, roleOf(a.type).hue, 'right') : progressMark(right, ay + 7, prog, roleOf(a.type).hue, 'left'))
      parts.push(`<text x="${ax + 24}" y="${ay + 12}" font-size="12" font-weight="600">${escape(left)}</text>`)
      const flag = agentFlag(a, now)
      // What it was asked gives way first: in a narrow panel a flag takes its room.
      // Its role, and in a wide drawing what it was asked; a narrow one has room for the role alone.
      const desc = isNarrow ? '' : `${a.type} · ${plain(a.description)}`
      const descRoom = Math.max(0, (progRight - ax - 24 - leftW - 8) * (isNarrow ? 0.45 : 0.4))
      if (descRoom > 0 && desc !== '') parts.push(`<text x="${ax + 24 + leftW + 8}" y="${ay + 12}" font-size="11.5" class="faint">${escape(fit(desc, descRoom, 11.5))}</text>`)
      const descW = descRoom > 0 && desc !== '' ? Math.min(measure(desc, 11.5), descRoom) + 10 : 0
      const nowX = ax + 24 + leftW + 8 + descW
      const doing = a.state === 'done' ? 'Done' : plain(a.now)
      parts.push(`<text x="${nowX}" y="${ay + 12}" font-size="11.5" class="${a.state === 'working' ? 'muted' : 'faint'}">${escape(fit(doing, progRight - nowX - flagWidth(flag, 11.5), 11.5))}${flagSpan(flag)}</text>`)
      if (metricsW) {
        const tokens = totalTokens(a.tokens)
        const stats = [modelName(a.model), formatDuration((a.endedAt ?? now) - a.startedAt), tokens > 0 ? `${formatTokens(tokens)} tok` : '', a.contextTokens > 0 ? `ctx ${Math.round((a.contextTokens / (a.contextWindow || 1)) * 100)}%` : ''].filter(Boolean).join(' · ')
        parts.push(`<text x="${right}" y="${ay + 12}" font-size="11" text-anchor="end" class="faint">${escape(fit(stats, metricsW - progressMarkW(prog), 11))}</text>`)
      }
    })
    if (folded > 0) {
      const ay = top + agents.length * AGENT_H
      rail(agents.length, ay)
      parts.push(`<text x="${x0 + 18}" y="${ay + 12}" font-size="11.5" class="faint">+${folded} more agent${folded === 1 ? '' : 's'}</text>`)
    }
    if (loops.length > 0) {
      const i = agents.length + (folded > 0 ? 1 : 0)
      const ay = top + i * AGENT_H
      const ax = x0 + 18
      rail(i, ay)
      const isLive = loops.some(l => now - l.lastAt < 30_000)
      parts.push(critter(isLive ? 'thinking' : 'idle', ax - 1, ay - 3, 20, beatOf(now) + index * 410 + (i + 1) * 290, isLive ? 'working' : 'idle', 'background'))
      const name = `${loops.length} background loop${loops.length === 1 ? '' : 's'}`
      const nameW = measure(name, 12, true)
      parts.push(`<text x="${ax + 24}" y="${ay + 12}" font-size="12" font-weight="600" class="muted">${name}</text>`)
      const models = [...new Set(loops.map(l => modelName(l.model)))].join(', ')
      const tokens = loops.reduce((n, l) => n + l.tokens, 0)
      const steps = loops.reduce((n, l) => n + l.steps, 0)
      const what = [models, `${steps} step${steps === 1 ? '' : 's'}`, tokens > 0 ? `${formatTokens(tokens)} tok` : ''].filter(Boolean).join(' · ')
      parts.push(`<text x="${ax + 24 + nameW + 8}" y="${ay + 12}" font-size="11.5" class="faint">${escape(fit(`${what} · workflows and forks`, aRight - ax - 24 - nameW - 8, 11.5))}</text>`)
    }

    const agentsTo = parts.length
    if (slice === 'agents') {
      parts.splice(0, parts.length, ...parts.slice(agentsFrom, agentsTo))
      return (agents.length + (folded > 0 ? 1 : 0) + (loops.length > 0 ? 1 : 0)) * AGENT_H + 12
    }
    // The main agent's progress runs along the row's foot, in its own colour; a resting row keeps a plain rule.
    const mainProgress = s.state === 'working' || s.state === 'waiting' ? sessionProgress(s) : null
    const footW = width - x0 - PAD
    y += h
    if (mainProgress) {
      parts.push(`<rect x="${x0}" y="${y - 2}" width="${footW}" height="2" rx="1" fill="var(--fg)" fill-opacity=".08"/>`)
      parts.push(`<g class="role" style="--h:${roleOf().hue}"><rect x="${x0}" y="${y - 2}" width="${Math.max(2, Math.round(footW * mainProgress.fraction))}" height="2" rx="1" fill="var(--rb)"${mainProgress.isEstimate ? ' fill-opacity=".75"' : ''}/></g>`)
    } else if (hasRule && index < list.length - 1) parts.push(`<rect x="${x0}" y="${y - 1}" width="${footW}" height="1" fill="var(--line)"/>`)
    return h
  }

  if (typeof input.part === 'number' || (input.part && typeof input.part === 'object')) {
    const rows: string[] = []
    const at = typeof input.part === 'number' ? input.part : 'main' in input.part ? input.part.main : input.part.agents
    const mode = typeof input.part === 'number' ? 'whole' : 'main' in input.part ? 'main' : 'agents'
    const row = list[at]
    const h = row ? rowOf(row, at, 0, rows, false, mode) : 0
    return { source: svg(width, h, rows.join(''), isStill), height: h }
  }
  list.forEach((s, index) => {
    y += rowOf(s, index, y, parts, true)
  })

  const height = y + 10
  return { source: svg(width, height, parts.join(''), isStill), height }
}
