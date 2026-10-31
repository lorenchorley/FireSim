# Studies

Exploratory work that is **not part of the app**. Nothing in this folder is built, tested by `npm test`, bundled or shipped: the
app is built from `index.html` and `src/`, type-checked over `src/`, `tests/`, `e2e/` and the config files, and tested from `src/` and `tests/`,
and nothing in `src/` imports from here.

A study answers one question with an experiment that can be re-run from its own folder. Findings that should change the app go into
a plan in [`docs/plans/`](../docs/plans/) first.

| Topic | Question | Status |
|---|---|---|
| [cliff-from-photo](cliff-from-photo/) | Can photographs of a cliff improve how FireSim draws it, and what the fire model knows about it? | ongoing, 1 study; a stretch goal in no release |
| [adaptive-simulation-quality](adaptive-simulation-quality/) | Can the simulation spend more detail where the terrain is complex and where it matters to the fire? | not started; a stretch goal in no release; not to be studied straight away |
| [simulation-validity](simulation-validity/) | How can we verify that the simulation is valid: against a precomputed high-quality run, other models, real fires, or checks that need no reference? | not started; a stretch goal in no release; recorded, with a first desk search (2026-10-31); nothing run |

## How a topic is laid out

```
studies/<topic>/
  README.md                the topic: question, why it matters, status, what is known, open questions, log of studies
  NN-short-name/           one study
    README.md              question, method, findings with numbers, limits, how to reproduce, files
    requirements.txt       pinned versions
    inputs/                the input and a README with its source, licence status and checksum
    scripts/               numbered steps and a run_all.sh
    data/                  small, derived, committed (compressed arrays, a mesh); no third-party pictures
    results/               committed figures, tables and models
    work/                  git-ignored: large or rebuildable by-products
```

## Rules

- **Public repository.** Write the source and the licence next to any photograph, map or other third-party material you commit, and keep a
  checksum. If the owner decides to commit something whose licence is not known, record that decision and its date next to it, say which
  files show it, and fill in the source as soon as it is known. Prefer results that can be made, and re-made, without the third-party input.
- **Pin and record.** Package versions in `requirements.txt`; model names, revisions and licences in the study README. A model or data
  set licensed for non-commercial use can be used to learn something, but say so, because it cannot go into the product.
- **Say what is measured and what is guessed.** Every study README separates the two, and states the assumptions that set the scale.
- **Keep it small.** A few MB of data and results per study. Store arrays compressed (float16 is usually enough) and regenerate the rest.
- **Number the studies** and add a row to the topic's log, including studies that failed or were dropped.
