import type { ClientModule } from 'claude-code'

import type { ColonyScene } from './colony'
import { colonySvg } from './colony'

// The colony, drawn in the desktop page itself. The panel is drawn afresh on every redraw, and an
// image drawn afresh restarts its animations; this region is kept across those redraws, so the
// village draws again only when its scene changes, timed by the page's own clock.

// The environment's element factory: the table hands out no Svg, but the page draws one.
declare const h: (type: string, props: Record<string, unknown>) => ReturnType<ClientModule>

const ColonyView: ClientModule<ColonyScene> = scene => {
  const drawing = colonySvg(scene, Date.now())
  return h('Svg', { source: drawing.source, alt: drawing.alt, width: scene.width, height: drawing.height })
}

export default ColonyView
