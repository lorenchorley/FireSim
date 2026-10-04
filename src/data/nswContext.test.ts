/**
 * Live NSW places context: classification and packing of REAL recorded ArcGIS responses (Blackheath, 2 km box;
 * tests/fixtures/nsw-context), the request format (POST forms, object-id chunks), retries / partial failure / abort,
 * the envelope and cache key, and that scripts/fetch-demo-context.mjs (which builds the bundled demo files) produces
 * exactly the same file as the app for the same envelope.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LocalProjection } from '../core/geo';
import { decodeContext } from './contextLayers';
import { resetHttpConfig, setHttpConfig } from './http';
import { contextCacheKey, contextQueryBBox, fetchNswContext, fetchNswContextFile, NswContextUnavailableError } from './nswContext';
import {
  CONTEXT_QUERIES,
  CONTEXT_QUERY_IDS,
  buildContextFile,
  contextBBox,
  encodeLine,
  placeKindOf,
  ringCentroid,
  roadClassOf,
  roadName,
  suburbLabelBox,
  surfaceOf,
  titleCase,
  zoneKind,
  type ContextFeatures,
  type ContextQueryId,
} from './nswContextCore';
import { BLACKHEATH, BLACKHEATH_BBOX, fakeNswServer, recordedFeatures, type FakeNswOptions } from './nswContextTesting';

afterEach(() => resetHttpConfig());

/** Point the HTTP layer at a fake server; retries are near-instant. */
function serve(o: FakeNswOptions = {}): ReturnType<typeof fakeNswServer> {
  const s = fakeNswServer(o);
  setHttpConfig({ fetch: s.fetch, platform: 'node', retryDelayMs: 1 });
  return s;
}

const features = (): ContextFeatures => Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, recordedFeatures(id)]));
const FETCHED = '2026-09-29';
const NOW = Date.UTC(2026, 8, 29, 3, 0);

describe('classification (the rules of the bundled demo data)', () => {
  it('road hierarchy → class, surface code → surface, names title-cased', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(roadClassOf)).toEqual(['motorway', 'primary', 'arterial', 'subarterial', 'distributor', 'local', 'service', 'track', 'path', 'local', 'service']);
    expect(roadClassOf(99)).toBe('local');
    expect(roadClassOf(undefined)).toBe('local');
    expect([0, 1, 2, 3, 4, 9].map(surfaceOf)).toEqual([0, 1, 2, 3, 3, 0]);
    expect(roadName({ roadnamebase: 'GREAT WESTERN', roadnametype: 'HIGHWAY' })).toBe('Great Western Highway');
    expect(roadName({ roadnamebase: 'MEGALONG', roadnametype: 'ROAD', roadnamesuffix: 'EAST' })).toBe('Megalong Road East');
    expect(roadName({ roadnamebase: null })).toBeUndefined();
    expect(roadName({})).toBeUndefined();
  });
  it('title case: Mc prefixes and O\'Grady are capitalised, possessives are not', () => {
    expect(titleCase('MCNICOL')).toBe('McNicol');
    expect(titleCase("O'GRADYS HUT")).toBe("O'Gradys Hut");
    expect(titleCase("D'AGUILAR")).toBe("D'Aguilar");
    expect(titleCase("GOVETT'S LEAP")).toBe("Govett's Leap");
    expect(titleCase("DEVIL'S HOLE")).toBe("Devil's Hole");
    expect(titleCase('ST MARYS')).toBe('St Marys');
  });
  it('zone codes → kinds; only the kinds a firefighter needs are kept', () => {
    for (const c of ['R1', 'R2', 'R3', 'R4', 'R5']) expect(zoneKind(c)).toBe('residential');
    expect(zoneKind('RU5')).toBe('village');
    expect(zoneKind('C4')).toBe('envLiving');
    expect(zoneKind('RU4')).toBe('ruralSmall');
    expect(zoneKind('RU6')).toBe('ruralSmall');
    for (const c of ['B1', 'B2', 'B4', 'B7', 'E1', 'E2', 'MU1']) expect(zoneKind(c)).toBe('commercial');
    for (const c of ['IN1', 'IN2', 'E3', 'E4', 'E5']) expect(zoneKind(c)).toBe('industrial');
    expect(zoneKind('SP3')).toBe('tourist');
    for (const c of ['RU1', 'RU2', 'C1', 'C2', 'C3', 'E1x', 'W1', 'SP2', 'RE1', 'R6', '']) expect(zoneKind(c), c).toBeNull();
  });
  it('place kinds', () => {
    expect([1, 2, 3, 4, 5, 6].map(placeKindOf)).toEqual(['region', 'city', 'town', 'village', 'locality', 'suburb']);
    expect(placeKindOf(undefined)).toBe('locality');
  });
  it('encodeLine delta-codes 1e-5° integers and drops repeated points', () => {
    expect(encodeLine([[150.285, -33.715], [150.286, -33.714], [150.286, -33.714], [150.2865, -33.7145]])).toEqual([15028500, -3371500, 100, 100, 50, -50]);
  });
  it('ring centroid and the suburb label box (15 % inset)', () => {
    const c = ringCentroid([[0, 0], [4, 0], [4, 2], [0, 2]]);
    expect(c[0]).toBeCloseTo(2, 9);
    expect(c[1]).toBeCloseTo(1, 9);
    expect(ringCentroid([[1, 1], [2, 2], [3, 3]])).toEqual([1, 1]); // degenerate (zero area): first vertex
    const b = suburbLabelBox([150, -34, 151, -33]);
    expect(b[0]).toBeCloseTo(150.075, 9);
    expect(b[2]).toBeCloseTo(150.925, 9);
    expect(b[1]).toBeCloseTo(-33.925, 9);
    expect(b[3]).toBeCloseTo(-33.075, 9);
  });

  it('the recorded Blackheath responses become the expected file', () => {
    const f = buildContextFile({ id: 'live', bbox: BLACKHEATH_BBOX, fetched: FETCHED, features: features() });
    expect(f.version).toBe(1);
    expect(f.bbox).toEqual(BLACKHEATH_BBOX);
    expect(f.roads).toHaveLength(379);
    const named = new Set(f.roads.map((r) => r.n));
    expect(named.has('Great Western Highway')).toBe(true);
    expect(named.has('Megalong Road')).toBe(true);
    expect(f.roads.filter((r) => r.c === 'primary').length).toBeGreaterThan(5);
    expect(f.roads.some((r) => r.c === 'track')).toBe(true);
    expect(f.roads.some((r) => r.c === 'path')).toBe(true);
    expect(f.roads.every((r) => r.s >= 0 && r.s <= 3 && r.p.length >= 4)).toBe(true);
    expect(f.fireTrails.length).toBeGreaterThan(0);
    // 1718 address objects; units in one building share a point, so fewer unique homes (sorted south to north).
    expect(recordedFeatures('homes')).toHaveLength(1718);
    expect(f.homes.length / 2).toBe(1603);
    // Zones keep only the kinds we draw: the recording has C4/R1/R2/R3/E1/E4 among 50 zone polygons.
    const kinds = new Set(f.zones.map((z) => z.k));
    expect([...kinds].sort()).toEqual(['commercial', 'envLiving', 'industrial', 'residential']);
    expect(f.zones).toHaveLength(20);
    expect(f.places).toEqual([{ n: 'Blackheath', k: 'town', x: 150.28484, y: -33.63556 }]);
    expect(f.sources.map((s) => s.id)).toEqual(['roads', 'fireTrails', 'homes', 'zones', 'places']);
    expect(f.sources.find((s) => s.id === 'zones')!.attribution).toBe('© State of NSW and Department of Planning, Housing and Infrastructure');
    expect(f.sources.find((s) => s.id === 'roads')!.url).toBe('https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Transport_Theme/FeatureServer/5');
  });

  it('tunnels are left out, roads with a single vertex too, a suburb is labelled only inside the inset envelope', () => {
    const line = [[150.28, -33.63], [150.281, -33.631]];
    const f = buildContextFile({
      id: 't',
      bbox: [150, -34, 151, -33],
      fetched: FETCHED,
      features: {
        roads: [
          { attributes: { functionhierarchy: 6, surface: 1, roadontype: 3, roadnamebase: 'TUNNEL' }, geometry: { paths: [line] } },
          { attributes: { functionhierarchy: 6, surface: 1, roadontype: 1, roadnamebase: 'DOT' }, geometry: { paths: [[[150.28, -33.63]]] } },
          { attributes: { functionhierarchy: 8, surface: 4, roadontype: 1 }, geometry: { paths: [line, line] } },
        ],
        suburbs: [
          { attributes: { suburbname: 'INSIDE' }, geometry: { rings: [[[150.4, -33.6], [150.6, -33.6], [150.6, -33.4], [150.4, -33.4]]] } },
          { attributes: { suburbname: 'EDGE' }, geometry: { rings: [[[150.0, -33.6], [150.1, -33.6], [150.1, -33.4], [150.0, -33.4]]] } },
        ],
      },
    });
    expect(f.roads).toEqual([
      { c: 'track', s: 3, p: [15028000, -3363000, 100, -100] },
      { c: 'track', s: 3, p: [15028000, -3363000, 100, -100] },
    ]);
    expect(f.places.map((p) => p.n)).toEqual(['Inside']);
    expect(f.places[0]!.k).toBe('suburb');
  });
});

describe('envelope and cache key', () => {
  it('the query envelope contains the domain plus 400 m, rounded OUTWARD to 0.005°', () => {
    const exact = contextBBox(BLACKHEATH.lat, BLACKHEATH.lon, 6000, 400);
    const q = contextQueryBBox(BLACKHEATH, 6000);
    expect(q[0]).toBeLessThanOrEqual(exact[0]);
    expect(q[1]).toBeLessThanOrEqual(exact[1]);
    expect(q[2]).toBeGreaterThanOrEqual(exact[2]);
    expect(q[3]).toBeGreaterThanOrEqual(exact[3]);
    expect(exact[0] - q[0]).toBeLessThan(0.005 + 1e-9);
    expect(q[3] - exact[3]).toBeLessThan(0.005 + 1e-9);
    // The domain itself (±3 km) is inside with at least the 400 m margin (0.0036°).
    expect(BLACKHEATH.lat - 3000 / 111195 - q[1]).toBeGreaterThan(0.0035);
    for (const v of q) expect(Math.abs(Math.round(v / 0.005) * 0.005 - v)).toBeLessThan(1e-6);
  });
  it('nearby centres share a key, distant ones do not', () => {
    const k = (lat: number, lon: number, e = 6000): string => contextCacheKey(contextQueryBBox({ lat, lon }, e));
    expect(k(-33.6347, 150.2846)).toBe(k(-33.6348, 150.2847));
    expect(k(-33.6347, 150.2846)).not.toBe(k(-33.7, 150.2846));
    expect(k(-33.6347, 150.2846)).not.toBe(k(-33.6347, 150.2846, 9000));
    expect(k(-33.6347, 150.2846)).toMatch(/^context\/v1\/150\.\d{3},-33\.\d{3},150\.\d{3},-33\.\d{3}$/);
  });
});

describe('live query (fake ArcGIS server replaying the recorded responses)', () => {
  it('returns the same file as classifying the recordings directly', async () => {
    serve();
    const { file, failed } = await fetchNswContextFile(BLACKHEATH_BBOX, { now: NOW });
    expect(failed).toEqual([]);
    expect(file).toEqual(buildContextFile({ id: 'live', bbox: BLACKHEATH_BBOX, fetched: FETCHED, features: features() }));
    expect(file.fetched).toBe(FETCHED);
  });

  it('dates the file by the New South Wales day, so "captured" agrees with the "downloaded 06:47" the screens show', async () => {
    serve();
    // 19:47 UTC on 4 October is 06:47 on 5 October in Sydney (daylight saving started that morning).
    const { file } = await fetchNswContextFile(BLACKHEATH_BBOX, { now: Date.UTC(2026, 9, 4, 19, 47) });
    expect(file.fetched).toBe('2026-10-05');
    expect(file.sources.every((src) => src.fetched === '2026-10-05')).toBe(true);
  });

  it('asks like the script: POST forms, ids first, then object-id chunks with the recorded parameters', async () => {
    const s = serve({ multiply: { homes: 3, zones: 3, roads: 2 } });
    await fetchNswContextFile(BLACKHEATH_BBOX, { now: NOW });
    for (const c of s.calls) {
      expect(c.method).toBe('POST');
      expect(c.contentType).toBe('application/x-www-form-urlencoded');
      expect(c.form.get('f')).toBe('json');
    }
    for (const id of CONTEXT_QUERY_IDS) {
      const q = CONTEXT_QUERIES[id];
      const mine = s.calls.filter((c) => c.layer === id);
      const idsCalls = mine.filter((c) => c.kind === 'ids');
      const featCalls = mine.filter((c) => c.kind === 'features');
      expect(idsCalls, id).toHaveLength(1);
      expect(mine[0]).toBe(idsCalls[0]); // ids before features
      const ids = idsCalls[0]!.form;
      expect(ids.get('geometry')).toBe('150.273800,-33.643700,150.295400,-33.625700');
      expect(ids.get('geometryType')).toBe('esriGeometryEnvelope');
      expect(ids.get('inSR')).toBe('4326');
      expect(ids.get('spatialRel')).toBe('esriSpatialRelIntersects');
      expect(ids.get('where')).toBe(q.where);
      expect(ids.get('returnIdsOnly')).toBe('true');
      for (const c of featCalls) {
        expect(c.form.get('outFields')).toBe(q.outFields);
        expect(c.form.get('outSR')).toBe('4326');
        expect(c.form.get('returnGeometry')).toBe('true');
        expect(c.form.get('maxAllowableOffset')).toBe(String(q.offset));
        expect(c.form.get('geometryPrecision')).toBe('5');
        expect(c.ids.length).toBeGreaterThan(0);
        expect(c.ids.length).toBeLessThanOrEqual(q.chunk);
      }
    }
    const idsOf = (id: ContextQueryId): number[] => s.calls.filter((c) => c.layer === id && c.kind === 'features').flatMap((c) => c.ids);
    // Multiplied layers were fetched in ceil(n / chunk) chunks and every id exactly once.
    expect(s.calls.filter((c) => c.layer === 'homes' && c.kind === 'features')).toHaveLength(Math.ceil((1718 * 3) / CONTEXT_QUERIES.homes.chunk));
    expect(s.calls.filter((c) => c.layer === 'zones' && c.kind === 'features')).toHaveLength(Math.ceil((50 * 3) / CONTEXT_QUERIES.zones.chunk));
    expect(new Set(idsOf('homes')).size).toBe(1718 * 3);
    expect(new Set(idsOf('roads')).size).toBe(379 * 2);
  });

  it('chunked, repeated features do not change the result: homes dedupe by position, the rest keep the recorded order', async () => {
    serve({ multiply: { homes: 3 } });
    const { file } = await fetchNswContextFile(BLACKHEATH_BBOX, { now: NOW });
    expect(file.homes.length / 2).toBe(1603);
    expect(file).toEqual(buildContextFile({ id: 'live', bbox: BLACKHEATH_BBOX, fetched: FETCHED, features: features() }));
  });

  it('keeps at most `concurrency` requests in flight', async () => {
    const base = fakeNswServer({ latencyMs: 5 });
    let active = 0;
    let peak = 0;
    setHttpConfig({
      platform: 'node',
      retryDelayMs: 1,
      fetch: (async (u: string, i?: RequestInit) => {
        active++;
        peak = Math.max(peak, active);
        try {
          return await base.fetch(u, i);
        } finally {
          active--;
        }
      }) as typeof fetch,
    });
    await fetchNswContextFile(BLACKHEATH_BBOX, { concurrency: 2 });
    expect(peak).toBe(2);
  });

  it('retries HTTP 429 and ArcGIS error bodies with back-off, then succeeds', async () => {
    const s = serve({ fail: { roads: [429, 'arcgis-500', 503], homes: ['network'] } });
    const t = Date.now();
    const { file, failed } = await fetchNswContextFile(BLACKHEATH_BBOX, { retryDelayMs: 5 });
    expect(failed).toEqual([]);
    expect(file.roads).toHaveLength(379);
    expect(s.calls.filter((c) => c.layer === 'roads' && c.kind === 'ids')).toHaveLength(4); // 3 failures + the answer
    expect(s.calls.filter((c) => c.layer === 'homes' && c.kind === 'ids')).toHaveLength(2);
    expect(Date.now() - t).toBeGreaterThanOrEqual(5 + 10 + 20 - 2); // 5, 10, 20 ms: doubling
  });

  it('no answer at all (offline) is retried once only, so being offline is found out quickly', async () => {
    const s = serve({ fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 'network' as const }])) });
    const t = Date.now();
    await expect(fetchNswContextFile(BLACKHEATH_BBOX, { retries: 3, retryDelayMs: 5 })).rejects.toThrow(/unavailable/);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(s.calls).toHaveLength(CONTEXT_QUERY_IDS.length * 2); // the id query of each layer, twice
    // ... while a busy server (503) gets all its retries.
    const busy = serve({ fail: { roads: [503, 503, 503] } });
    const r = await fetchNswContextFile(BLACKHEATH_BBOX, { retries: 3, retryDelayMs: 1 });
    expect(r.failed).toEqual([]);
    expect(busy.calls.filter((c) => c.layer === 'roads' && c.kind === 'ids')).toHaveLength(4);
  });

  it('a request that stalls is abandoned at its timeout and retried (the portal stalls about one request in three)', async () => {
    const s = serve({ fail: { homes: ['stall', 'stall'], roads: ['stall'] } });
    const t = Date.now();
    const r = await fetchNswContextFile(BLACKHEATH_BBOX, { timeoutMs: 40, retryDelayMs: 1 });
    expect(r.failed).toEqual([]);
    expect(r.file.homes.length / 2).toBe(1603);
    expect(s.calls.filter((c) => c.layer === 'homes' && c.kind === 'ids')).toHaveLength(3);
    expect(Date.now() - t).toBeGreaterThanOrEqual(75);
    expect(Date.now() - t).toBeLessThan(3000);
    // Every layer has its own timeout: the slow zoning server gets more time than the portal.
    expect(CONTEXT_QUERIES.zones.timeoutMs).toBeGreaterThan(CONTEXT_QUERIES.homes.timeoutMs);
  });

  it('a layer that keeps failing is left out and reported; the others are returned and its source is not credited', async () => {
    serve({ fail: { zones: { always: 500 } } });
    const { file, failed } = await fetchNswContextFile(BLACKHEATH_BBOX, { retries: 2, retryDelayMs: 1 });
    expect(failed).toEqual(['zones']);
    expect(file.zones).toEqual([]);
    expect(file.roads).toHaveLength(379);
    expect(file.sources.map((s) => s.id)).toEqual(['roads', 'fireTrails', 'homes', 'places']);
  });

  it('an authorisation error is not retried', async () => {
    const s = serve({ fail: { homes: { always: 403 } } });
    const { failed } = await fetchNswContextFile(BLACKHEATH_BBOX, { retries: 3, retryDelayMs: 1 });
    expect(failed).toEqual(['homes']);
    expect(s.calls.filter((c) => c.layer === 'homes')).toHaveLength(1);
  });

  it('a place with only one of places / suburbs missing still credits the place-name source', async () => {
    serve({ fail: { suburbs: { always: 500 } } });
    const { file, failed } = await fetchNswContextFile(BLACKHEATH_BBOX, { retries: 0 });
    expect(failed).toEqual(['suburbs']);
    expect(file.sources.map((s) => s.id)).toContain('places');
  });

  it('throws only when every layer fails', async () => {
    serve({ hang: false, fail: Object.fromEntries(CONTEXT_QUERY_IDS.map((id) => [id, { always: 'network' as const }])) });
    await expect(fetchNswContextFile(BLACKHEATH_BBOX, { retries: 1, retryDelayMs: 1 })).rejects.toThrow(/NSW place services unavailable/);
  });

  it('at the deadline the layers that have arrived are kept and the slow one is reported', async () => {
    const s = serve({ slow: { zones: 60_000 } });
    const t = Date.now();
    const r = await fetchNswContextFile(BLACKHEATH_BBOX, { deadlineMs: 120 });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.failed).toEqual(['zones']);
    expect(r.timedOut).toBe(true);
    expect(r.file.zones).toEqual([]);
    expect(r.file.roads).toHaveLength(379);
    expect(r.file.homes.length / 2).toBe(1603);
    expect(r.file.sources.map((x) => x.id)).not.toContain('zones');
    const after = s.calls.length;
    await new Promise((res) => setTimeout(res, 50));
    expect(s.calls.length).toBe(after); // nothing keeps running after the deadline
    // Without a deadline nothing is cut short.
    serve({ slow: { zones: 30 } });
    const full = await fetchNswContextFile(BLACKHEATH_BBOX);
    expect(full.timedOut).toBe(false);
    expect(full.failed).toEqual([]);
  });

  it('a deadline before any layer has arrived throws, saying it timed out', async () => {
    serve({ hang: true });
    const err = (await fetchNswContextFile(BLACKHEATH_BBOX, { deadlineMs: 30 }).catch((e) => e)) as NswContextUnavailableError;
    expect(err).toBeInstanceOf(NswContextUnavailableError);
    expect(err.timedOut).toBe(true);
    expect(err.message).toMatch(/timed out/);
  });

  it('an area with no features is an empty file, not an error', async () => {
    const empty = async (_u: string, i?: RequestInit): Promise<Response> => {
      const q = new URLSearchParams(String(i?.body));
      return new Response(JSON.stringify(q.get('returnIdsOnly') ? { objectIds: null } : { features: [] }), { status: 200 });
    };
    setHttpConfig({ fetch: empty as unknown as typeof fetch, platform: 'node' });
    const { file, failed } = await fetchNswContextFile(BLACKHEATH_BBOX);
    expect(failed).toEqual([]);
    expect(file.roads).toEqual([]);
    expect(file.homes).toEqual([]);
    expect(file.places).toEqual([]);
  });

  it('cancels: the promise rejects and no request is sent afterwards', async () => {
    const s = serve({ latencyMs: 20 });
    const ac = new AbortController();
    const p = fetchNswContextFile(BLACKHEATH_BBOX, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 30));
    const before = s.calls.length;
    expect(before).toBeGreaterThan(0);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await new Promise((r) => setTimeout(r, 60));
    expect(s.calls.length).toBe(before);
    // Already aborted: nothing is sent at all.
    const s2 = serve();
    const ac2 = new AbortController();
    ac2.abort();
    await expect(fetchNswContextFile(BLACKHEATH_BBOX, { signal: ac2.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s2.calls).toHaveLength(0);
  });

  it('aborting during a back-off wait ends it at once', async () => {
    serve({ fail: { roads: { always: 429 } } });
    const ac = new AbortController();
    const t = Date.now();
    const p = fetchNswContextFile(BLACKHEATH_BBOX, { signal: ac.signal, retryDelayMs: 10_000 });
    setTimeout(() => ac.abort(), 50);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('reports progress that rises to 1 with plain-English messages', async () => {
    serve({ multiply: { homes: 3 } });
    const seen: [number, string][] = [];
    await fetchNswContextFile(BLACKHEATH_BBOX, { onProgress: (f, m) => seen.push([f, m]) });
    expect(seen.length).toBeGreaterThan(6);
    for (let i = 1; i < seen.length; i++) expect(seen[i]![0]).toBeGreaterThanOrEqual(seen[i - 1]![0]);
    expect(seen[seen.length - 1]).toEqual([1, 'Roads, homes and place names ready']);
    expect(seen.some(([, m]) => /roads and tracks/.test(m))).toBe(true);
    for (const [f] of seen) expect(f).toBeLessThanOrEqual(1);
  });

  it('fetchNswContext returns layers in local metres about the centre', async () => {
    serve();
    const c = await fetchNswContext({ centre: BLACKHEATH, extent: 1200, now: NOW });
    expect(c.origin).toBe('live');
    expect(c.fetched).toBe(FETCHED);
    expect(c.projectionOrigin).toEqual(BLACKHEATH);
    expect(c.roads.length).toBe(379);
    expect(c.homes.length / 2).toBe(1603);
    // Blackheath's name label lies ~50-400 m from the centre of the box.
    const label = c.places.find((p) => p.name === 'Blackheath')!;
    expect(Math.hypot(label.x, label.y)).toBeLessThan(600);
    // Same projection as decoding the file about the centre.
    const file = buildContextFile({ id: 'live', bbox: contextQueryBBox(BLACKHEATH, 1200), fetched: FETCHED, features: features() });
    expect(decodeContext(file, BLACKHEATH, 'live').places[0]!.x).toBeCloseTo(new LocalProjection(BLACKHEATH).toLocal({ lat: -33.63556, lon: 150.28484 })[0], 3);
  });
});

describe('the bundled-data script and the app build the same file', () => {
  it('scripts/fetch-demo-context.mjs and fetchNswContextFile give identical JSON for the same envelope', async () => {
    // A variable path keeps the type checker and the bundler out of it: the script is plain Node.
    const scriptPath = '../../scripts/fetch-demo-context.mjs';
    const script = (await import(/* @vite-ignore */ scriptPath)) as {
      fetchContextFile: (o: { id: string; bbox: number[]; today: string; fetchImpl: typeof fetch; delayMs: number }) => Promise<unknown>;
    };
    const s = fakeNswServer({ multiply: { homes: 2, zones: 2 } });
    const fromScript = await script.fetchContextFile({ id: 'live', bbox: BLACKHEATH_BBOX, today: FETCHED, fetchImpl: s.fetch, delayMs: 1 });
    serve({ multiply: { homes: 2, zones: 2 } });
    const { file } = await fetchNswContextFile(BLACKHEATH_BBOX, { now: NOW });
    expect(JSON.stringify(fromScript)).toBe(JSON.stringify(file));
    // ... and its requests are the app's requests.
    const app = fakeNswServer({ multiply: { homes: 2, zones: 2 } });
    setHttpConfig({ fetch: app.fetch, platform: 'node', retryDelayMs: 1 });
    await fetchNswContextFile(BLACKHEATH_BBOX, { concurrency: 1 });
    const norm = (calls: typeof s.calls): string[] => calls.map((c) => `${c.layer} ${c.kind} ${[...c.form].map(([k, v]) => `${k}=${v}`).sort().join('&')}`).sort();
    expect(norm(app.calls)).toEqual(norm(s.calls));
  });

  it('the script computes the envelope of a demo site like the app', async () => {
    const scriptPath = '../../scripts/fetch-demo-context.mjs';
    const script = (await import(/* @vite-ignore */ scriptPath)) as {
      demoSites: () => { sites: { id: string; lat: number; lon: number }[]; extent: number };
      siteBBox: (s: { lat: number; lon: number }, extent: number) => number[];
    };
    const { sites, extent } = script.demoSites();
    expect(sites.map((s) => s.id)).toContain('katoomba');
    expect(extent).toBe(9000);
    const k = sites.find((s) => s.id === 'katoomba')!;
    expect(script.siteBBox(k, extent)).toEqual(contextBBox(k.lat, k.lon, 9000, 400));
    // and it is the envelope recorded in the bundled file
    const { readFileSync } = await import('node:fs');
    const file = JSON.parse(readFileSync(new URL('../../public/demo/katoomba/context.json', import.meta.url), 'utf8')) as { bbox: number[] };
    expect(file.bbox).toEqual(script.siteBBox(k, extent).map((v) => +v.toFixed(5)));
  });
});
