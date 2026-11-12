# Extended lenses (experimental, not read by reviewers by default)

Three lenses added after run 3 was scored against the benchmark answer key. About half of the key items the run missed were claims the plan makes about the existing repository, and the `plans` set in `lenses.md` has no lens for them. They stay out of the default run until the benchmark shows they lift recall without adding noise. Each names what is out of its scope, so the lenses do not overlap.

**Claims against the repo**
List every factual statement the plan makes about the existing code, documentation, defaults, sizes, versions and test status. Check each against the files in the sources and quote the file and line. File a finding when the source says something different, or when the plan relies on something the sources do not support. For each finding, state the failing case: what the source says, and what the plan does as a result. Out of scope: whether the design is good, and facts that need the web (list those under "Could not check").

**Measurement method**
For every gate, benchmark or test the plan defines, work out what could make its result mean something other than what the plan claims: a wrong baseline, hardware or build, too few samples, a single site or seed, a setting the app does not use by default, warm-up, thermal state. Describe the concrete run that gives a misleading pass or a misleading fail. Out of scope: whether the thresholds are the right size, and cost.

**Operations and security parity**
Compare the plan's new runtime, build or delivery path with what the existing app already guarantees: security guards and their tests, signing and install rules, saved data, background and kill behaviour, offline rules, release checks. Find each guarantee that the new path drops or weakens without saying so, and name the existing file that holds it. Out of scope: performance and schedule.

## How to use them

`lenses.md` does not list these, so default runs never see this note about their origin. To run one, put its full text in the `LENS` parameter after the set and name, for example `extended / Claims against the repo: <text>`. The reviewer prompt already says to use lens text given in the message.
