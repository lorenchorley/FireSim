/**
 * The wind glyph height parameter of the render dev page (`dev.ts`, never built into the app): `wh=`, checked here so that the check is
 * tested in node (devParams.test.ts) though the page, which needs a DOM and the demo data, is not.
 */
import { WIND_HEIGHTS, type WindHeight } from './wind/glyphTypes';

/**
 * `wh=` must be one of `WIND_HEIGHTS` as text (`fire`, `50`, `100`, `300`, `1000`, `2000`) and is `fire` when absent. Anything else
 * (`abc`, `7`, `100.5`, an empty value) is a typo, and the dev page says so instead of drawing a height the engine never made.
 */
export function devWindHeight(q: URLSearchParams): WindHeight {
  const raw = q.get('wh');
  if (raw === null) return 'fire';
  const h = WIND_HEIGHTS.find((x) => String(x) === raw);
  if (h === undefined) throw new RangeError(`wh=${raw} is not a wind height: use ${WIND_HEIGHTS.join(', ')}`);
  return h;
}
