import type { ClientModule, JsonValue } from 'claude-code'

import type { ColonyScene } from './colony'
import { colonySvg } from './colony'

// The colony, drawn in the desktop page itself. The panel is drawn afresh on every redraw, and an
// image drawn afresh restarts its animations; this region is kept across those redraws, so the
// village draws again only when its scene changes, timed by the page's own clock.

// The environment's element factory: the table hands out no Svg, but the page draws one.
declare const h: (type: string, props: Record<string, unknown>) => ReturnType<ClientModule>

// The page also says whether it is on screen, which only it can tell: its clock ticks every TICK_MS
// at full speed on screen and is throttled off screen. While the latest ticks come on time it posts
// `{ seen: true }` about once a second; off screen it goes quiet, and the hooks module stops drawing
// the panel until it hears again.
// With `probe` set (the fleet folder holds `.debug`), it also reports every PROBE_REPORT_MS how late
// the ticks came and what each redraw cost, as `probe`.
export type ColonyProps = ColonyScene & { probe?: boolean }
const TICK_MS = 250
const ON_TIME_MS = 600
const SEEN_POST_MS = 1_000
const PROBE_REPORT_MS = 5_000

let latest: ColonyProps | null = null
let draws: number[] = []

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

const ColonyView: ClientModule<ColonyProps, true> = (scene, surface) => {
  latest = scene
  if (surface.state === undefined) {
    surface.setState(true)
    let last = Date.now()
    let recent: number[] = []
    // Ticks since the last word that the page is on screen: one every SEEN_POST_MS of clock.
    let unposted = 0
    let since = last
    let gaps: number[] = []
    surface.every(TICK_MS, () => {
      const t = Date.now()
      const gap = t - last
      last = t
      recent = [...recent.slice(-3), gap]
      gaps.push(gap)
      unposted += 1
      const isOnTime = recent.length === 4 && quantile([...recent].sort((a, b) => a - b), 0.5) < ON_TIME_MS
      let probe: { [key: string]: JsonValue } | undefined
      if (latest?.probe && t - since >= PROBE_REPORT_MS) {
        const sorted = [...gaps].sort((a, b) => a - b)
        probe = {
          ticks: gaps.length,
          expected: Math.round((t - since) / TICK_MS),
          p50: quantile(sorted, 0.5),
          p95: quantile(sorted, 0.95),
          max: sorted[sorted.length - 1] ?? 0,
          stalls: gaps.filter(g => g >= TICK_MS * 2.5).length,
          draws: draws.length,
          drawMs: draws.map(ms => Math.round(ms)),
          workers: latest.workers.length,
          onTime: isOnTime,
        }
        gaps = []
        draws = []
        since = t
      }
      if ((isOnTime && unposted >= SEEN_POST_MS / TICK_MS) || probe) {
        if (isOnTime) unposted = 0
        surface.post(probe ? { seen: isOnTime, probe } : { seen: true })
      }
    })
  }
  const start = Date.now()
  const drawing = colonySvg(scene, start)
  if (scene.probe) draws.push(Date.now() - start)
  return h('Svg', { source: drawing.source, alt: drawing.alt, width: scene.width, height: drawing.height })
}

export default ColonyView
