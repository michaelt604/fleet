import type { ClientModule } from 'claude-code'

import type { ColonyScene } from './colony'
import { colonySvg } from './colony'

// The colony, drawn in the desktop page itself. The panel is drawn afresh on every redraw, and an
// image drawn afresh restarts its animations; this region is kept across those redraws, so the
// village draws again only when its scene changes, timed by the page's own clock.

// The environment's element factory: the table hands out no Svg, but the page draws one.
declare const h: (type: string, props: Record<string, unknown>) => ReturnType<ClientModule>

// With `probe` set (the fleet folder holds `.debug`), the page reports how it keeps time: a tick every
// PROBE_MS on its frame clock, how late each arrives, and what each redraw cost, summed every
// PROBE_REPORT_MS and posted to the hooks module, which writes it beside the pane dump.
export type ColonyProps = ColonyScene & { probe?: boolean }
const PROBE_MS = 100
const PROBE_REPORT_MS = 5_000

let draws: number[] = []

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

const ColonyView: ClientModule<ColonyProps, true> = (scene, surface) => {
  if (scene.probe && surface.state === undefined) {
    surface.setState(true)
    let last = Date.now()
    let since = last
    let gaps: number[] = []
    surface.every(PROBE_MS, () => {
      const t = Date.now()
      gaps.push(t - last)
      last = t
      if (t - since < PROBE_REPORT_MS) return
      const sorted = [...gaps].sort((a, b) => a - b)
      surface.post({
        at: t,
        ticks: gaps.length,
        expected: Math.round((t - since) / PROBE_MS),
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
        max: sorted[sorted.length - 1] ?? 0,
        stalls: gaps.filter(g => g >= PROBE_MS * 2.5).length,
        draws: draws.length,
        drawMs: draws.map(ms => Math.round(ms)),
        workers: scene.workers.length,
        walking: scene.workers.filter(w => w.fx !== w.x || w.fy !== w.y).length,
      })
      gaps = []
      draws = []
      since = t
    })
  }
  const start = Date.now()
  const drawing = colonySvg(scene, start)
  if (scene.probe) draws.push(Date.now() - start)
  return h('Svg', { source: drawing.source, alt: drawing.alt, width: scene.width, height: drawing.height })
}

export default ColonyView
