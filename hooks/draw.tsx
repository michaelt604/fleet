import type { EngineInterface, RenderElement } from 'claude-code'

import type { FleetLimit, FleetSession, FleetView } from '../types'
import type { FleetSummary } from './describe'
import { stateLine, waitText, limitName, limitTone, agentProgress, progressLabel, ago, isAgentLive, plain, taskText, recentLoops, isBusy, isHostId, isPlanLimit, resetIn, fullIn, plural, formatTokens, meter, modelName, nameOf, percentOf, progressOf, sprite, spriteKind, totalTokens } from './describe'
import { colonyHeight, colonySvg } from './colony'
import { colonyScene } from './colony-scene'
import { bandSvg, clean, ctxOf, dashboardSvg, hasAgentRows, visibleAgents, widthFor } from './svg'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const SVG_LIMIT = 130_000
// All the row pictures together: a bigger fleet shows its first sessions and counts the rest.
const TOTAL_LIMIT = 400_000

// `resting`: dormant sessions left out of the list; `listTop`: the first row the panel's list shows.
export type Board = { list: FleetSession[]; sum: FleetSummary; limits: FleetLimit[]; v: FleetView; mineId: string | undefined; now: number; resting?: number; listTop?: number }

export type Actions = {
  open: () => void
  hideBand: () => void
  toggle: (key: 'isCompact' | 'showColony') => void
  // Opens the desktop app's own window for a session by its id.
  go: (id: string) => void
  // Moves the panel's list by that many sessions, held to the rows there are.
  scrollList: (by: number) => void
}

// Every surface but the terminal draws an Svg; the terminal's table names it but draws nothing.
const hasSvg = (ui: Ui, surface: string): ui is Ui & { Svg: NonNullable<Extract<Ui, { Svg: unknown }>['Svg']> } => surface !== 'terminal' && 'Svg' in ui

const stateColor = (state: string) => (state === 'waiting' ? 'warning' : state === 'working' ? 'claude' : state === 'failed' ? 'error' : state === 'done' ? 'success' : 'inactive')

// The drawing's words for a reader that can't see it; cleaned, since the app refuses an alt holding
// a control character (a command's output can carry one). The header's are what its picture shows:
// the counts and the plan limits (each row has its own).
const altOf = (b: Board): string =>
  clean(
    [
      `Fleet: ${plural(b.sum.sessions, 'session')}, ${b.sum.working} working, ${b.sum.waiting} need you${b.sum.agents > 0 ? `, ${plural(b.sum.agents, 'agent')}` : ''}.`,
      ...b.limits.map(l => {
        const resets = l.resetsAt !== null ? Date.parse(l.resetsAt) : NaN
        return `${limitName(l.kind, true)} limit ${Math.round(l.percentUsed)}% used${Number.isFinite(resets) && resets > b.now ? `, resets in ${resetIn(resets - b.now)}` : ''}${l.fullInMs !== undefined ? `, full in about ${fullIn(l.fullInMs)} at this pace` : ''}.`
      }),
    ].join(' '),
  )

// A row's words: how it stands, and for one that waits, what it waits on.
const rowAltOf = (s: FleetSession, b: Board): string => clean(`${nameOf(s)}: ${s.state === 'waiting' ? `needs you: ${plain(s.now)}` : stateLine(s, b.now)}`)

// What the subagents' picture holds, counting the background loops too.
const agentsAltOf = (s: FleetSession, b: Board): string => {
  const loops = recentLoops(s, b.now).length
  return clean(`${nameOf(s)}: ${[visibleAgents(s, b.now).length > 0 ? plural(visibleAgents(s, b.now).length, 'agent') : '', loops > 0 ? plural(loops, 'background loop') : ''].filter(Boolean).join(', ')}`)
}

// One button per other session that waits on the person and is a desktop one (a terminal has no
// app window to open).
function openers(ui: Ui, b: Board, act: Actions): RenderElement | null {
  const waiting = b.list.filter(s => s.state === 'waiting' && s.hostId !== undefined && isHostId(s.hostId) && s.id !== b.mineId)
  if (waiting.length === 0) return null
  const { Box, Button } = ui
  return (
    <Box flexDirection="column" marginTop={1}>
      {waiting.map((s, i) => {
        const wait = waitText(s, b.now)
        return <Button key={`go-${s.id}`} plain hotkey={i < 9 ? String(i + 1) : undefined} label={clean(`${nameOf(s)} needs you${wait ? ` ${wait}` : ''} · Open`)} onPress={() => act.go(s.id)} />
      })}
    </Box>
  )
}

function controls(ui: Ui, b: Board, act: Actions, isDesktop: boolean): RenderElement {
  const { Box, Button } = ui
  return (
    <Box flexDirection="row" columnGap={2} marginTop={isDesktop ? 0 : 1}>
      {isDesktop && <Button key="colony" plain dimColor label={b.v.showColony === false ? 'Show colony' : 'Hide colony'} onPress={() => act.toggle('showColony')} />}
      <Button key="compact" plain dimColor label={b.v.isCompact ? 'Detailed' : 'Compact'} onPress={() => act.toggle('isCompact')} />
    </Box>
  )
}

// The pictures a desktop dashboard is made of: the header, and one for each session's row. Each is held under the app's limit
// on an Svg (131,072 characters, or it goes blank). One mode serves every row, the poorest any row
// needs: as set, compact, then compact with at most three subagent rows. The rows together are held
// to TOTAL_LIMIT: past it the rest of the sessions are counted, not drawn. Null when a row is too big
// even in the smallest mode.
type Card = { source: string; height: number }
type RowCards = { main: Card; agents: Card | null }
export function fittingCards(b: Board, width: number): { header: Card; rows: RowCards[]; hidden: number; mode: number } | null {
  const input = { list: b.list, sum: b.sum, limits: b.limits, mineId: b.mineId, now: b.now, isCompact: b.v.isCompact, isStill: b.v.isStill }
  const header = dashboardSvg({ ...input, part: 'header' }, width)
  if (header.source.length > SVG_LIMIT) return null
  const modes = [input, { ...input, isCompact: true }, { ...input, isCompact: true, agentCap: 3 }]
  const cardsOf = (x: (typeof modes)[number], i: number): RowCards => {
    // A row with subagents is two pictures.
    const s = b.list[i]
    const isSplit = s !== undefined && hasAgentRows(s, b.now)
    return { main: dashboardSvg({ ...x, part: isSplit ? { main: i } : i }, width), agents: isSplit ? dashboardSvg({ ...x, part: { agents: i } }, width) : null }
  }
  for (let m = 0; m < modes.length; m += 1) {
    const x = modes[m] ?? input
    const all = b.list.map((_, i) => cardsOf(x, i))
    if (all.some(c => c.main.source.length > SVG_LIMIT || (c.agents?.source.length ?? 0) > SVG_LIMIT)) continue
    // Every row fits in this mode, the first one that does; then only the total is left to hold.
    const rows: RowCards[] = []
    let total = 0
    for (const c of all) {
      const size = c.main.source.length + (c.agents?.source.length ?? 0)
      if (total + size > TOTAL_LIMIT) break
      total += size
      rows.push(c)
    }
    return { header, rows, hidden: b.list.length - rows.length, mode: m }
  }
  return null
}

// The desktop's code-font line in pixels, what a pane's body rows count in. Assumed, not reported:
// a little over the real one, so the room is undershot rather than the colony pushed out of view.
const LINE_PX = 20
// What a line of Buttons or dim text under the list takes.
const LINE_ROW_PX = 28

// The furthest the list can scroll, as last drawn in the panel; scrollList holds to it.
let maxTop = 0
export const listMaxTop = (): number => maxTop

// The session rows the panel shows when the list scrolls in `room` pixels above the colony: from the
// first row asked for, as many as fit (always one). `last` is the furthest first row that still
// fills the room, so a list that grew shorter shows no gap under its end.
export function listWindow(heights: readonly number[], room: number, top: number): { from: number; to: number; last: number } {
  let last = heights.length - 1
  let used = heights[last] ?? 0
  while (last > 0 && used + (heights[last - 1] ?? 0) <= room) {
    last -= 1
    used += heights[last] ?? 0
  }
  last = Math.max(0, last)
  const from = Math.min(Math.max(0, top), last)
  let to = from
  let sum = 0
  while (to < heights.length && (to === from || sum + (heights[to] ?? 0) <= room)) {
    sum += heights[to] ?? 0
    to += 1
  }
  return { from, to, last }
}

// The colony under the list, a drawing of its own. On the desktop it is a Client: the page keeps
// that region across the panel's redraws and draws it again only when the scene changes, so a walk
// is never restarted. Elsewhere it is an Svg drawn with the panel.
function colony(ui: Ui, b: Board, width: number): RenderElement | null {
  if (b.v.showColony === false || b.list.length === 0) return null
  const scene = colonyScene(b.list, b.now, width, b.v.isStill)
  if ('Client' in ui) {
    const { Client } = ui
    // The page keeps a surface module it has loaded, even across a plugin reload, so a colony change
    // would never reach an open panel. The module's file and key carry the release, so a new one
    // loads fresh: rename both together whenever the colony's drawing changes.
    return <Client key="colony-19" module="./colony-view-19.tsx" props={scene} />
  }
  if (!('Svg' in ui)) return null
  const drawing = colonySvg(scene, b.now)
  const { Svg } = ui
  return drawing.source.length <= SVG_LIMIT ? <Svg source={drawing.source} alt={drawing.alt} width={width} height={drawing.height} /> : null
}

// What the list leaves out, under it: the sessions put away for resting too long.
const restingNote = (ui: Ui, b: Board): RenderElement | null => {
  const { Text } = ui
  return b.resting ? <Text dimColor>{`${plural(b.resting, 'session')} idle over 12h hidden · /fleet ended shows them`}</Text> : null
}

// The full dashboard: an SVG card where the surface draws one, aligned text on the terminal. In a pane
// (`bodyRows` known) with the colony shown, the list scrolls in the room above it, so the colony stays in view.
export function dashboard(ui: Ui, surface: string, b: Board, act: Actions, columns: number, frame: number, bodyRows?: number): RenderElement {
  const { Box, Text } = ui
  if (hasSvg(ui, surface)) {
    const width = widthFor(columns, 360, 1600)
    const cards = fittingCards(b, width)
    const { Svg } = ui
    // A fleet too big to draw within the app's limit even in its smallest form falls through to text.
    if (cards) {
      const { Button } = ui
      const heights = cards.rows.map(c => c.main.height + (c.agents?.height ?? 0))
      const isColony = b.v.showColony !== false && b.list.length > 0
      const waitingHere = b.list.filter(s => s.state === 'waiting' && s.hostId !== undefined && isHostId(s.hostId) && s.id !== b.mineId).length
      const fixed = cards.header.height + colonyHeight(width) + LINE_ROW_PX * (1 + waitingHere + (b.resting ? 1 : 0) + (cards.hidden > 0 ? 1 : 0)) + (waitingHere > 0 ? LINE_PX : 0)
      const total = heights.reduce((n, x) => n + x, 0)
      const room = bodyRows !== undefined && isColony ? bodyRows * LINE_PX - fixed : Infinity
      // Past the room, the pager's own line comes out of it too.
      const win = total > room ? listWindow(heights, room - LINE_ROW_PX, b.listTop ?? 0) : { from: 0, to: cards.rows.length, last: 0 }
      if (bodyRows !== undefined) maxTop = win.last
      const isPaged = win.from > 0 || win.to < cards.rows.length
      return (
        <Box flexDirection="column">
          <Svg key="head" source={cards.header.source} alt={altOf(b)} width={width} height={cards.header.height} />
          {cards.rows.map((card, i) => {
            const s = b.list[i]
            if (!s || i < win.from || i >= win.to) return null
            return (
              <Box key={`r-${s.id}`} flexDirection="column">
                <Svg key={`row-${s.id}`} source={card.main.source} alt={rowAltOf(s, b)} width={width} height={card.main.height} />
                {card.agents ? <Svg key={`agents-${s.id}`} source={card.agents.source} alt={agentsAltOf(s, b)} width={width} height={card.agents.height} /> : null}
              </Box>
            )
          })}
          {isPaged && (
            <Box key="pager" flexDirection="row" columnGap={2}>
              {win.from > 0 && <Button key="up" plain dimColor label="▲ Up" onPress={() => act.scrollList(-1)} />}
              <Text dimColor>{`Sessions ${win.from + 1}–${win.to} of ${cards.rows.length}`}</Text>
              {win.to < cards.rows.length && <Button key="down" plain dimColor label="▼ Down" onPress={() => act.scrollList(1)} />}
            </Box>
          )}
          {cards.hidden > 0 && <Text dimColor>+{cards.hidden} more sessions</Text>}
          {restingNote(ui, b)}
          {openers(ui, b, act)}
          {colony(ui, b, width)}
          {controls(ui, b, act, true)}
        </Box>
      )
    }
  }

  const row = (s: FleetSession) => {
    const ctx = ctxOf(s)
    const agents = visibleAgents(s, b.now)
    const quiet = s.state === 'idle' || s.state === 'ended'
    const tokens = totalTokens(s.tokens)
    const stats = [s.costUsd !== null ? `$${s.costUsd.toFixed(2)}` : '', tokens > 0 ? `${formatTokens(tokens)} tok` : '', s.toolsTotal > 0 ? `${s.toolsTotal} tools` : ''].filter(Boolean).join(' · ')
    return (
      <Box key={`s-${s.id}`} flexDirection="row" marginBottom={b.v.isCompact ? 0 : 1}>
        <Box width={11} flexShrink={0}>
          <Text color={stateColor(s.state)}>{sprite(spriteKind(s.state, s.now, s.kind), frame, b.v.isStill)}</Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <Text wrap="truncate-end">
              <Text bold dimColor={quiet}>
                {nameOf(s)}
              </Text>
              <Text dimColor>
                {s.id === b.mineId ? '  this session' : ''}  {modelName(s.model)}
                {s.effort ? ` ${s.effort}` : ''}
              </Text>
            </Text>
            <Text color={s.state === 'waiting' ? 'warning' : s.state === 'working' ? 'claude' : 'inactive'}>
              {stateLine(s, b.now)}
            </Text>
          </Box>
          <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
            <Text color={s.state === 'waiting' ? 'warning' : undefined} dimColor={quiet} wrap="truncate-end">
              {s.state === 'idle' && s.last ? `Replied: ${plain(s.last)}` : plain(s.now)}
            </Text>
            <Text color={ctx >= 0.85 ? 'error' : ctx >= 0.7 ? 'warning' : 'inactive'}>
              {meter(ctx, 8)} {Math.round(ctx * 100)}%
            </Text>
          </Box>
          {!b.v.isCompact && (taskText(s) !== '' || stats !== '') && (
            <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
              <Text dimColor wrap="truncate-end">
                {taskText(s) ? `Asked: ${taskText(s)}` : ''}
              </Text>
              <Text dimColor>{stats}</Text>
            </Box>
          )}
          {agents.map((a, i) => (
            <Box key={`a-${s.id}-${a.id}`} flexDirection="row" columnGap={1}>
              <Text dimColor>{i === agents.length - 1 ? '└' : '├'}</Text>
              <Text color={stateColor(a.state === 'working' ? 'working' : a.state)}>{sprite(spriteKind(a.state, a.now, a.kind), frame + i + 1, b.v.isStill)}</Text>
              <Text wrap="truncate-end">
                <Text bold>{a.name || a.type}</Text>
                <Text dimColor> {a.name ? `${a.type} ` : ''}{modelName(a.model)} </Text>
                {a.state === 'done' ? 'done' : plain(a.now)}
                <Text dimColor>
                  {'  '}
                  {agentProgress(a) !== null ? `${progressLabel(agentProgress(a))} · ` : ''}
                  {ago((a.endedAt ?? b.now) - a.startedAt)}
                  {totalTokens(a.tokens) > 0 ? ` · ${formatTokens(totalTokens(a.tokens))} tok` : ''}
                </Text>
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <Text bold>Fleet</Text>
        <Text dimColor>{plural(b.sum.sessions, 'session')}</Text>
        {b.sum.working > 0 ? <Text color="claude">{b.sum.working} working</Text> : <Text dimColor>none working</Text>}
        {b.sum.waiting > 0 && <Text color="warning">{plural(b.sum.waiting, 'needs', 'need')} you</Text>}
        {b.sum.agents > 0 && <Text dimColor>{plural(b.sum.agents, 'agent')}</Text>}
        <Text dimColor>${b.sum.costUsd.toFixed(2)} {b.limits.some(isPlanLimit) ? 'API value' : 'spent'}</Text>
        {b.limits.map(limit => {
          const resets = limit.resetsAt !== null ? Date.parse(limit.resetsAt) : NaN
          return (
            <Text key={`limit-${limit.kind}`} color={limitTone(limit)}>
              {limitName(limit.kind)} {Math.round(limit.percentUsed)}%
              {limit.fullInMs !== undefined ? ` · full ~${fullIn(limit.fullInMs)}` : Number.isFinite(resets) && resets > b.now ? ` · ${resetIn(resets - b.now)}` : ''}
            </Text>
          )
        })}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {b.list.length === 0 ? <Text dimColor>No sessions yet. Sessions started after the fleet mod was installed appear here.</Text> : b.list.map(row)}
      </Box>
      {restingNote(ui, b)}
      {openers(ui, b, act)}
      {controls(ui, b, act, false)}
    </Box>
  )
}

// The band above the prompt: busy sessions in a row, idle ones folded into a count.
export function band(ui: Ui, surface: string, b: Board, act: Actions, bodyColumns: number, frame: number): RenderElement | null {
  const live = b.list.filter(s => s.state !== 'ended')
  const agents = b.sum.agents
  if (live.length <= 1 && agents === 0) return null
  const { Box, Button, Text } = ui

  if (hasSvg(ui, surface)) {
    const strip = bandSvg(live, b.mineId, widthFor(bodyColumns, 280, 1300) - 90, b.now, b.v.isStill)
    const { Svg } = ui
    return (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Svg source={strip.source} alt={altOf(b)} width={strip.width} height={strip.height} />
        <Button key="fleet-open" plain dimColor label="Fleet" onPress={act.open} />
        <Button key="fleet-hide" plain dimColor role="dismiss" label="×" onPress={act.hideBand} />
      </Box>
    )
  }

  const busy = live.filter(s => isBusy(s, b.now)).slice(0, 3)
  const idle = live.filter(s => s.state === 'idle' && !isBusy(s, b.now)).length
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2}>
        <Text dimColor>Fleet</Text>
        {b.sum.working > 0 && <Text color="claude">{b.sum.working} working</Text>}
        {b.sum.waiting > 0 && <Text color="warning">{plural(b.sum.waiting, 'needs', 'need')} you</Text>}
        {agents > 0 && <Text dimColor>{plural(agents, 'agent')}</Text>}
        {idle > 0 && <Text dimColor>{idle} idle</Text>}
        <Button key="fleet-open" plain dimColor label="Details" onPress={act.open} />
        <Button key="fleet-hide" plain dimColor label="×" onPress={act.hideBand} />
      </Box>
      {busy.map(s => (
        <Box key={`band-${s.id}`} flexDirection="row" columnGap={1}>
          <Text color={stateColor(s.state)}>{sprite(spriteKind(s.state, s.now, s.kind), frame, b.v.isStill)}</Text>
          <Text bold>{nameOf(s)}</Text>
          <Text color={s.state === 'waiting' ? 'warning' : undefined} dimColor={s.state !== 'waiting'} wrap="truncate-end">
            {percentOf(progressOf(s.tasks)) !== null ? `${percentOf(progressOf(s.tasks))}% · ` : ''}
            {s.state === 'idle' && s.agents.some(a => isAgentLive(a, b.now)) ? `${plural(s.agents.filter(a => isAgentLive(a, b.now)).length, 'agent')} working` : plain(s.now)}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
