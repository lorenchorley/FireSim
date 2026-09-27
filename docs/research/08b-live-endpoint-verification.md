# 08b — Live endpoint verification (BLOCKED)

**Date:** 2026-09-27
**Branch:** `claude/firesim-live-fixtures`
**Outcome:** No data could be fetched. Every target host was refused by this sandbox's
egress proxy, so no DEM, imagery, fire-history, vegetation, weather, RFS or DEA fixtures
were produced.

## Method

Each host was probed with `curl` through the sandbox's pre-configured HTTPS proxy
(`curl -s -o /dev/null -m 30 -w "%{http_code} %{time_total}s %{size_download}B"`,
followed by `curl -sI https://<host>/`). The proxy answered the `CONNECT` with
**HTTP 403 Forbidden** (`text/plain`) before any TLS session to the origin was opened.
The proxy's status endpoint logged each one as `connect_rejected — gateway answered 403
to CONNECT (policy denial or upstream failure)`.

## Results

| Host | Probe URL | Result |
|---|---|---|
| `api.open-meteo.com` | `/v1/forecast?latitude=-33.7&longitude=150.3&current=temperature_2m` | **Blocked** (proxy 403 on CONNECT) |
| `archive-api.open-meteo.com` | `/v1/archive?latitude=-33.7&longitude=150.3&start_date=2024-01-01&end_date=2024-01-02&daily=precipitation_sum` | **Blocked** (proxy 403) |
| `historical-forecast-api.open-meteo.com` | `/v1/forecast?latitude=-33.7&longitude=150.3&start_date=2024-01-01&end_date=2024-01-02&hourly=temperature_2m` | **Blocked** (proxy 403) |
| `mapprod3.environment.nsw.gov.au` | `/arcgis/rest/services?f=json` | **Blocked** (proxy 403) |
| `maps.six.nsw.gov.au` | `/arcgis/rest/services?f=json` | **Blocked** (proxy 403) |
| `www.rfs.nsw.gov.au` | `/feeds/majorIncidents.json` | **Blocked** (proxy 403) |
| `hotspots.dea.ga.gov.au` | `/` | **Blocked** (proxy 403) |

Response times (~0.2–0.3 s) show how long the proxy took to refuse. They say nothing
about the origin servers. None of the origins were reached, so status codes, payload
sizes, CORS headers (`Access-Control-Allow-Origin`), field names and differences from
`08-data-sources-apis.md` are all **unverified**.

## Files not produced

- `public/demo/<id>/dem5m.png|json`, `imagery.jpg|json`, `fire-history.geojson`,
  `vegetation.geojson` for all 8 demo sites: 0 bytes added per site.
- `tests/fixtures/live/*` (Open-Meteo forecast/archive/replay, RFS major incidents and
  FDR/TOBAN, DEA hotspots): none.

## To unblock

Allow these domains in the cloud environment's network access settings (or pick a
broader access level), then re-run this task:

```
api.open-meteo.com
archive-api.open-meteo.com
historical-forecast-api.open-meteo.com
mapprod3.environment.nsw.gov.au
maps.six.nsw.gov.au
www.rfs.nsw.gov.au
hotspots.dea.ga.gov.au
```

See https://code.claude.com/docs/en/claude-code-on-the-web for the network policy options.
Until then the app should keep using its synthetic or demo data and the documented
(unverified) endpoint shapes in `08-data-sources-apis.md`.
