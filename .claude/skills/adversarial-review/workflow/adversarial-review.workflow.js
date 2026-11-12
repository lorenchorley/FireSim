export const meta = {
  name: 'adversarial-review',
  description: 'Five isolated reviewers (Haiku, high effort), then one judge (Sonnet, xhigh). Reports come back as text and are saved by ar.py, so they never enter the main session.',
  whenToUse: 'Run the adversarial-review skill pipeline from one script, when the user has asked for a workflow',
  phases: [
    { title: 'Review', detail: 'five reviewers in parallel, one lens each' },
    { title: 'Judge', detail: 'one judge rules on the reports' },
  ],
}

// args: { skillDir, runDir, lenses: ["prose / Facts and numbers", ...] }
// The run directory must already hold pack.md and run.md (SKILL.md step 1).
// Models and efforts are the fixed settings of the skill. Do not change them here.
const { skillDir, runDir, lenses } = args || {}
if (!skillDir || !runDir || !Array.isArray(lenses) || lenses.length === 0) {
  throw new Error('args needs skillDir, runDir and a non-empty lenses array')
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    report: { type: 'string', description: 'The full report, in the layout given in reviewer-prompt.md' },
    findings: { type: 'integer', description: 'Number of findings in the report' },
    must_fix: { type: 'integer', description: 'How many of them are rated must-fix' },
    verdict: { type: 'string', enum: ['Send as is', 'Fix first', 'Do not send'] },
  },
  required: ['report', 'findings', 'must_fix', 'verdict'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ruling: { type: 'string', description: 'The full ruling, parts A to E, as judge-prompt.md describes' },
    digest: { type: 'string', description: 'The digest, at most 45 lines' },
  },
  required: ['ruling', 'digest'],
}

// Same launch message as SKILL.md step 3, plus the output mode. Paths only: no opinions, no summary.
const reviewerMessage = (i, lens) => [
  `You are reviewer R${i + 1}.`,
  `Read ${skillDir}/reviewer-prompt.md and follow it exactly.`,
  'Parameters',
  `- REVIEWER_ID: R${i + 1}`,
  `- LENS: ${lens}`,
  `- PACK_PATH: ${runDir}/pack.md`,
  `- REPORT_PATH: ${runDir}/report-R${i + 1}.md`,
  '- OUTPUT_MODE: return',
].join('\n')

// A reviewer can fill the structured output with a stub ("Test", a one-line promise) and still pass the schema.
// The layout in reviewer-prompt.md ends with a Totals line and a Verdict line, so a real report has both.
const complete = r => !!(r && typeof r.report === 'string' && /Totals:\s*\d+\s+findings/i.test(r.report) && /Verdict:/i.test(r.report))
const RETRY_NOTE = '- NOTE: the previous reply held no complete report. Put the whole report, in the layout of reviewer-prompt.md ending with the Totals and Verdict lines, in the report field. A summary, a test message or a promise to send it later is not a report.'

const runReviewer = (lens, i, retry = false) =>
  agent(reviewerMessage(i, lens) + (retry ? '\n' + RETRY_NOTE : ''), {
    label: `R${i + 1} ${lens}`,
    phase: 'Review',
    schema: REVIEW_SCHEMA,
    agentType: 'general-purpose',
    model: 'haiku',
    effort: 'high',
  })

phase('Review')
// Barrier on purpose: the judge needs all the reports together.
const reviews = await parallel(lenses.map((lens, i) => () => runReviewer(lens, i)))
for (let i = 0; i < reviews.length; i++) {
  if (!complete(reviews[i])) {
    log(`R${i + 1} returned ${reviews[i] ? 'an incomplete report' : 'nothing'}; starting it once more`)
    const again = await runReviewer(lenses[i], i, true).catch(() => null)
    reviews[i] = complete(again) ? again : null
  }
}
const done = reviews.map((r, i) => (r ? i : -1)).filter(i => i >= 0)
if (done.length === 0) throw new Error('no reviewer returned a report')
if (done.length < reviews.length) {
  log(`continuing without ${reviews.length - done.length} reviewer(s): ${reviews.map((r, i) => (r ? null : 'R' + (i + 1))).filter(Boolean).join(', ')}`)
}

phase('Judge')
const blocks = done.map(i => `=== report-R${i + 1}.md ===\n${reviews[i].report}\n=== end ===`).join('\n\n')
const judgeMessage = [
  'You are the judge.',
  `Read ${skillDir}/judge-prompt.md and follow it exactly.`,
  'Parameters',
  `- PACK_PATH: ${runDir}/pack.md`,
  '- REPORT_PATHS: none on disk yet. The reports follow below, each between "=== report-Rn.md ===" and "=== end ===".',
  `- RULING_PATH: ${runDir}/ruling.md`,
  `- DIGEST_PATH: ${runDir}/digest.md`,
  '- OUTPUT_MODE: return',
  '',
  blocks,
].join('\n')

const judged = await agent(judgeMessage, {
  label: 'judge',
  phase: 'Judge',
  schema: JUDGE_SCHEMA,
  agentType: 'general-purpose',
  model: 'sonnet',
  effort: 'xhigh',
})

// Only short facts go back to the main session. The reports and the ruling are saved from the
// agents' own records by `ar.py extract` (run by `ar.py report`).
return {
  reviewers: reviews.map((r, i) =>
    r ? { id: `R${i + 1}`, findings: r.findings, must_fix: r.must_fix, verdict: r.verdict } : { id: `R${i + 1}`, failed: true }),
  digest: judged ? judged.digest : null,
  judgeFailed: !judged,
}
