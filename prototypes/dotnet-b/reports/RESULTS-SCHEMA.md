# Result files

Every measurement a stage reports is also written as JSON next to its report (`reports/<stage>-results.json`) so that another agent can
re-read it:

```json
{
  "stage": "1-kernel",
  "when": "2026-11-12T00:00:00Z",
  "machine": { "label": "container", "cpu": "model name", "cores": 4, "os": "Linux x.y", "runtime": ".NET 11.0.0" },
  "indicative": true,
  "runs": [
    { "name": "spread-step ts", "impl": "ts", "threads": 1, "n": 20, "medianMs": 0.0, "p95Ms": 0.0, "minMs": 0.0, "maxMs": 0.0, "notes": "" }
  ],
  "gate": { "bar": "all-core C# >= 1.5x TypeScript on desktop", "measured": "0.0x", "result": "pass | stop | not run", "why": "" },
  "notRun": ["what could not be run here and what it needs"]
}
```
`indicative: true` for anything run in the container; phone runs say the phone model and Android version in `machine.label`.
