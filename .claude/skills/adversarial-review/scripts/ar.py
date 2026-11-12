#!/usr/bin/env python3
"""Helper for the adversarial-review skill. Run with: python3 -I ar.py <command> ...

Commands
  extract  --run-dir DIR            save reviewers' final messages as report-Rn.md when the file is missing
  report   --run-dir DIR ...        build the run report draft (front matter, settings, yield, isolation audit)
  publish  --run-dir DIR ...        copy the run to reviews/run-N/, the report to reviews/reports/, rebuild the indexes
  index    --reviews-dir DIR        rebuild INDEX.md and SKILL-FEEDBACK.md from the reports

Run reports are named AR-<NNN>_<YYYY-MM-DD>_<lensset>_<work-slug>.md. See run-report-format.md.
Standard library only. Reads subagent transcripts, which are harness files: if they cannot be found, the
report says so and leaves those fields empty instead of failing.
"""
import argparse, glob, json, os, re, shutil, subprocess, sys
from datetime import datetime, timezone

VALID_VERDICTS = ("valid", "partly valid", "valid but minor")
RID = re.compile(r"R\d+\.\d+")
NAME_RE = re.compile(r"^AR-(\d{3})_(\d{4}-\d{2}-\d{2})_([a-z]+)_([a-z0-9-]+)\.md$")


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")


def slugify(s, n=40):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return (s[:n].strip("-")) or "work"


def kv_file(path):
    """Read `key: value` lines from run.md."""
    out = {}
    for line in read(path).splitlines():
        m = re.match(r"^\s*-?\s*([a-z_]+):\s*(.*?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


# ---------------------------------------------------------------- transcripts
def transcript_dirs(given):
    if given:
        return given
    home = os.path.expanduser("~")
    return glob.glob(os.path.join(home, ".claude", "projects", "*", "*", "subagents"))


def _text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")
    return ""


def _result_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""


def load_agents(match, dirs):
    agents = []
    for d in dirs:
        for f in sorted(glob.glob(os.path.join(d, "**", "agent-*.jsonl"), recursive=True)):
            recs, first, nuser = [], "", 0
            try:
                with open(f, encoding="utf-8") as fh:
                    for line in fh:
                        try:
                            o = json.loads(line)
                        except ValueError:
                            continue
                        recs.append(o)
                        m = o.get("message") or {}
                        if nuser < 3 and m.get("role") == "user":
                            nuser += 1  # workflow agents get the relayed user request first, the task second
                            first += " " + _text_of(m.get("content"))
                            if nuser == 3 and match not in first:
                                break
            except OSError:
                continue
            if not first or match not in first:
                continue
            agents.append(summarise_agent(f, recs, first))
    return agents


def summarise_agent(path, recs, first):
    meta = {}
    try:
        meta = json.load(open(path[:-6] + ".meta.json", encoding="utf-8"))
    except (OSError, ValueError):
        pass
    m = re.search(r"You are reviewer (R\d+)", first)
    if m:
        role, rid = "reviewer", m.group(1)
    elif re.search(r"You are the judge", first):
        role, rid = "judge", "judge"
    else:
        role, rid = "other", os.path.basename(path)[6:14]
    models, efforts, tools, refused = set(), set(), [], 0
    pending, last_usage, last_text, handback, structured = {}, None, "", None, None
    ts = []
    for o in recs:
        if o.get("timestamp"):
            ts.append(o["timestamp"])
        if o.get("perTurnEffort"):
            efforts.add(str(o["perTurnEffort"]))
        msg = o.get("message") or {}
        c = msg.get("content")
        if msg.get("role") == "assistant":
            if msg.get("model"):
                models.add(msg["model"])
            if msg.get("usage"):
                last_usage = msg["usage"]
        if isinstance(c, list):
            for b in c:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    inp = b.get("input") or {}
                    if b.get("name") == "StructuredOutput":
                        structured = inp
                        continue
                    if b.get("name") == "SubagentHandback":
                        if isinstance(inp.get("message"), str):
                            handback = inp["message"]
                        continue
                    tools.append((b.get("name"), inp))
                    pending[b.get("id")] = b.get("name")
                elif b.get("type") == "text" and msg.get("role") == "assistant":
                    last_text = b.get("text", "")
                elif b.get("type") == "tool_result":
                    if (pending.get(b.get("tool_use_id")) in ("Write", "Edit", "NotebookEdit")
                            and "should return findings as text" in _result_text(b.get("content"))):
                        refused += 1
    tokens = None
    if last_usage:
        tokens = sum(int(last_usage.get(k) or 0) for k in
                     ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"))
    minutes = None
    if len(ts) >= 2:
        try:
            a = datetime.fromisoformat(ts[0].replace("Z", "+00:00"))
            b = datetime.fromisoformat(ts[-1].replace("Z", "+00:00"))
            minutes = round((b - a).total_seconds() / 60, 1)
        except ValueError:
            pass
    relay = re.search(r"\[Workflow harness [^\]]*user request\][^\n]*\n(.*?)\[Workflow harness", first, re.S)
    return {
        "path": path, "agent": os.path.basename(path)[6:-6], "role": role, "id": rid, "first": first,
        "relayed": len(relay.group(1).strip()) if relay else 0,
        "meta_model": meta.get("model"), "meta_effort": meta.get("effort"), "description": meta.get("description"),
        "models": sorted(models), "efforts": sorted(efforts), "tools": tools, "refused": refused,
        "tokens": tokens, "minutes": minutes, "start": ts[0] if ts else "", "end": ts[-1] if ts else "",
        "final": handback if handback is not None else last_text, "structured": structured,
    }


# ---------------------------------------------------------------- parsing
def parse_report(text, rid):
    ids = []
    for m in re.finditer(r"^(?:#{1,6}\s*|\*\*|-\s*)?(R\d+\.\d+)\b", text, re.M):
        if m.group(1) not in ids:
            ids.append(m.group(1))
    sev = {"must-fix": 0, "should-fix": 0, "nitpick": 0}
    for m in re.finditer(r"severity[\s*:\-]*\**\s*(must-fix|should-fix|nitpick)|\[(must-fix|should-fix|nitpick)\b", text, re.I):
        sev[(m.group(1) or m.group(2)).lower()] += 1
    verdicts = re.findall(r"(Send as is|Fix first|Do not send)", text)
    return {
        "ids": ids, "n": len(ids), "sev": sev,
        "covered": len(re.findall(r"already covered\?", text, re.I)),
        "verdict": verdicts[-1] if verdicts else "",
        "chars": len(text),
        "capped": len(ids) <= 8,
    }


def parse_ledger(text):
    """Return rows: id, priority, verdict, ids(list), claim. Accepts the fixed table and the older free format."""
    rows, seen = [], set()
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            head = [c.strip().lower() for c in lines[i].strip().strip("|").split("|")]
            def col(*names):
                for n in names:
                    for j, h in enumerate(head):
                        if n in h:
                            return j
                return None
            ci, cp, cv = 0, col("priority"), col("verdict", "ruling")
            cr, cc = col("reviewer", "merged", "ids"), col("claim", "finding", "problem")
            i += 2
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                def get(j):
                    return cells[j] if j is not None and j < len(cells) else ""
                rid_ = re.sub(r"[^A-Za-z0-9]", "", get(ci))
                if re.match(r"^[MSOXN]\d+[a-z]?$", rid_) and rid_ not in seen and cv is not None:
                    seen.add(rid_)
                    rows.append({"id": rid_, "priority": get(cp), "verdict": get(cv),
                                 "ids": RID.findall(get(cr)), "own": "own" in get(cr).lower(), "claim": get(cc)})
                i += 1
            continue
        i += 1
    prio = {"M": "Must fix", "S": "Should fix", "O": "Optional", "X": "None", "N": "Own"}
    for line in lines:  # older free format: "S1. Title (R3.1, R5.1). Valid."
        m = re.match(r"^\**\s*([MSOXN]\d+[a-z]?)[.:)]\s+(.*)$", line)
        if not m or m.group(1) in seen:
            continue
        body = m.group(2)
        v = re.search(r"\b(Valid but minor|Partly valid|Valid|Rejected|Cannot verify)\b", body)
        seen.add(m.group(1))
        rows.append({"id": m.group(1), "priority": prio[m.group(1)[0]],
                     "verdict": v.group(1) if v else ("Rejected" if m.group(1)[0] == "X" else ""),
                     "ids": RID.findall(body), "own": bool(re.search(r"\bown\b", body, re.I)), "claim": body[:120]})
    return rows


# ---------------------------------------------------------------- isolation audit
PATH_TOKEN = re.compile(r"(?:/|\./|[A-Za-z0-9_.-]+/)[A-Za-z0-9_@~./+-]*[A-Za-z0-9_]")


def touched(agent):
    out = []
    for name, inp in agent["tools"]:
        if name in ("Read", "Write", "Edit", "NotebookEdit"):
            out.append((name, inp.get("file_path", "")))
        elif name in ("Glob", "Grep"):
            out.append((name, (inp.get("path") or "") + " " + (inp.get("pattern") or "")))
        elif name == "Bash":
            out.append((name, inp.get("command", "")))
    return out


def listed(tok, pack):
    parts = [p for p in tok.split("/") if p]
    return any("/".join(parts[-n:]) in pack for n in (3, 2) if len(parts) >= n) or tok in pack


def audit(agent, pack, run_dir, skill_dir, forbid):
    flags, reads = [], set()
    own = agent["id"]
    no_git = bool(re.search(r"git history|do not use git", pack, re.I))
    roots = sorted({r.rstrip("/") for r in re.findall(r"(/[A-Za-z0-9_./-]{3,})", pack)})

    def is_listed(tok):
        if listed(tok, pack) or any(tok == r or tok.startswith(r + "/") for r in roots):
            return True
        rel = tok.lstrip("./")
        return any(os.path.isdir(r) and os.path.exists(os.path.join(r, rel)) for r in roots)
    for tool, s in touched(agent):
        if agent["role"] == "reviewer":
            for m in re.finditer(r"report-(R\d+)", s):
                if m.group(1) != own:
                    flags.append("%s touched %s" % (tool, m.group(0)))
            for m in re.finditer(r"[\w./-]*(?:ruling|digest)\.md", s):
                if not listed(m.group(0), pack):
                    flags.append("%s touched %s (not listed in the pack)" % (tool, m.group(0)))
        if no_git and (re.search(r"(^|[\s/])\.git/", s) or re.search(
                r"\bgit\s+(?:-C\s+\S+\s+)?(log|show|rev-list|cat-file|diff|archive|fetch|checkout|grep|ls-tree)\b", s)):
            m = re.search(r"\bgit\s+[^;|&\n]*", s)
            flags.append("%s used git although the pack forbids it: %s" % (tool, (m.group(0) if m else s)[:90]))
        for pat in forbid:
            if re.search(pat, s):
                flags.append("%s matched forbidden pattern %r" % (tool, pat))
        if tool != "Bash":
            toks = [s.split(" ")[0]] if tool in ("Read", "Write", "Edit") else PATH_TOKEN.findall(s)
        else:
            toks = PATH_TOKEN.findall(s)
        for t in toks:
            if t and "/" in t and not t.startswith(("http", "//")):
                reads.add(t)
        if agent["role"] != "reviewer" or tool in ("Write", "Edit"):
            pass
    skill_dir = skill_dir.rstrip("/")
    other = sorted(t for t in reads if not t.startswith(run_dir.rstrip("/")) and skill_dir not in t
                   and not t.startswith(("/usr", "/bin", "/dev", "/tmp/claude", "/proc")))
    unlisted = [t for t in other if not is_listed(t)]
    return sorted(set(flags)), other, unlisted


# ---------------------------------------------------------------- report
def find_reviews_dir(given):
    if given:
        return given
    try:
        root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        root = os.getcwd()
    return os.path.join(root, "docs", "adversarial-validation", "reviews")


def next_number(reviews):
    nums = [0]
    for p in glob.glob(os.path.join(reviews, "run-*")):
        m = re.match(r"run-(\d+)$", os.path.basename(p))
        if m:
            nums.append(int(m.group(1)))
    for p in glob.glob(os.path.join(reviews, "reports", "AR-*.md")):
        m = NAME_RE.match(os.path.basename(p))
        if m:
            nums.append(int(m.group(1)))
    return max(nums) + 1


def skill_version(skill_dir):
    ver = ""
    m = re.search(r"Skill version:\s*(\d+)", read(os.path.join(skill_dir, "SKILL.md")))
    if m:
        ver = m.group(1)
    commit = ""
    try:
        commit = subprocess.check_output(["git", "-C", skill_dir, "log", "-1", "--format=%h", "--", "."], text=True, stderr=subprocess.DEVNULL).strip()
        dirty = subprocess.check_output(["git", "-C", skill_dir, "status", "--porcelain", "--", "."], text=True, stderr=subprocess.DEVNULL).strip()
        if dirty:
            commit += "+uncommitted"
    except Exception:
        pass
    return ver, commit


def do_extract(run, agents):
    """Save reviewers' reports and the judge's ruling and digest from the agents' own records, when the files are missing."""
    out, revs, judge = [], {}, None
    for x in agents:  # the last transcript of an id wins (a retry replaces a failed attempt)
        if x["role"] == "reviewer":
            revs[x["id"]] = x
        elif x["role"] == "judge":
            judge = x
    for rid, x in sorted(revs.items()):
        target = os.path.join(run, "report-%s.md" % rid)
        st = x.get("structured") or {}
        if os.path.exists(target):
            out.append("%s: report file exists, left as it is" % rid)
        elif isinstance(st.get("report"), str) and st["report"].strip():
            write(target, st["report"])
            out.append("%s: saved the structured report verbatim (%d characters)" % (rid, len(st["report"])))
        elif x["final"] and len(x["final"]) > 300 and re.search(r"%s\.\d+" % rid, x["final"]):
            write(target, x["final"])
            out.append("%s: saved the final message verbatim (%d characters)" % (rid, len(x["final"])))
        else:
            out.append("%s: NO REPORT (no file, and nothing in the agent's output is a report)" % rid)
    if judge:
        st = judge.get("structured") or {}
        for key, fname in (("ruling", "ruling.md"), ("digest", "digest.md")):
            target = os.path.join(run, fname)
            if not os.path.exists(target) and isinstance(st.get(key), str) and st[key].strip():
                write(target, st[key])
                out.append("judge: saved %s from the structured output (%d characters)" % (fname, len(st[key])))
    if not revs:
        out.append("no reviewer transcripts found for %s" % run)
    return out


def cmd_extract(a):
    run = os.path.abspath(a.run_dir)
    for line in do_extract(run, load_agents(a.match or run, transcript_dirs(a.transcripts))):
        print(line)


def cmd_report(a):
    run = os.path.abspath(a.run_dir)
    reviews = find_reviews_dir(a.reviews_dir)
    skill_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    kv = kv_file(os.path.join(run, "run.md"))
    pack = read(os.path.join(run, "pack.md"))
    date = a.date or kv.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    work = a.work or kv.get("work") or (re.search(r"[Ww]ork[^\n]*?:\s*`?([^\s`]+)", pack) or [None, "unknown"])[1]
    lens_set = (a.lens_set or kv.get("lens_set") or "custom").lower().split()[0]
    lenses = a.lenses or kv.get("lenses") or ""
    orchestration = a.orchestration or kv.get("orchestration") or "manual"
    purpose_source = a.purpose_source or kv.get("purpose_source") or "unknown"
    n = a.number or next_number(reviews)
    slug = slugify(os.path.splitext(os.path.basename(work.rstrip("/")))[0])
    rid_name = "AR-%03d" % n
    fname = "%s_%s_%s_%s.md" % (rid_name, date, re.sub(r"[^a-z]", "", lens_set) or "custom", slug)

    dirs = transcript_dirs(a.transcripts)
    agents = load_agents(a.match or run, dirs)
    extracted = [l for l in do_extract(run, agents) if "saved" in l]
    notes = []
    if not agents:
        notes.append("no subagent transcripts found for this run directory: settings, tokens and the isolation audit are empty")
    reviewers = {}
    for x in agents:
        if x["role"] == "reviewer":
            reviewers.setdefault(x["id"], []).append(x)
    retries = sum(len(v) - 1 for v in reviewers.values())
    judge = [x for x in agents if x["role"] == "judge"]

    rep = {}
    for rid in sorted(set(list(reviewers) + [re.search(r"report-(R\d+)\.md", p).group(1)
                                             for p in glob.glob(os.path.join(run, "report-R*.md"))
                                             if re.search(r"report-(R\d+)\.md", p)])):
        txt = read(os.path.join(run, "report-%s.md" % rid))
        if not txt:
            notes.append("%s has no report file" % rid)
        rep[rid] = parse_report(txt, rid)
        if txt and rep[rid]["n"] == 0:
            notes.append("%s report has no findings in the Rn.k layout (older layout, or none)" % rid)
        if txt and not rep[rid]["capped"]:
            notes.append("%s filed %d findings, over the cap of eight" % (rid, rep[rid]["n"]))
    ledger_text = read(os.path.join(run, "ruling.md"))
    rows = parse_ledger(ledger_text)
    if not rows:
        notes.append("the ruling has no readable ledger")
    digest = read(os.path.join(run, "digest.md")).strip()
    call = (re.search(r"Overall call:\s*(.*)", digest) or [None, ""])[1].strip()
    if not call:
        found = re.findall(r"(ready to send|fix the must-fix items and resend|rethink)", ledger_text, re.I)
        call = found[-1].lower() if found else ""

    def cnt(pred):
        return sum(1 for r in rows if pred(r))
    n_must = cnt(lambda r: r["priority"].lower().startswith("must"))
    n_should = cnt(lambda r: r["priority"].lower().startswith("should"))
    n_opt = cnt(lambda r: r["priority"].lower().startswith("optional"))
    n_rej = cnt(lambda r: r["verdict"].lower().startswith("rejected"))
    rev_must = sum(v["sev"]["must-fix"] for v in rep.values())
    raised = sum(v["n"] for v in rep.values())

    # per reviewer yield
    yrows = []
    for rid, v in sorted(rep.items()):
        mine = [r for r in rows if any(i.startswith(rid + ".") for i in r["ids"])]
        ok = [r for r in mine if r["verdict"].lower() in VALID_VERDICTS]
        part = [r for r in mine if r["verdict"].lower() == "partly valid"]
        rej = [r for r in mine if r["verdict"].lower().startswith("rejected")]
        uniq = [r for r in ok if len({i.split(".")[0] for i in r["ids"]}) == 1 and not r["own"]]
        yrows.append((rid, v, len(ok), len(part), len(rej), len(uniq)))

    # settings and audit
    forbid = list(a.forbid or [])
    srows, audit_rows, flag_lines, total_tokens = [], [], [], 0
    refused = 0
    starts, ends = [], []
    other_tokens = 0
    for x in agents:
        if x["role"] in ("reviewer", "judge"):
            total_tokens += x["tokens"] or 0
        else:
            other_tokens += x["tokens"] or 0
        refused += x["refused"]
        if x["start"]:
            starts.append(x["start"]); ends.append(x["end"])
        srows.append(x)
        if x["role"] == "reviewer":
            fl, other, unl = audit(x, pack, run, skill_dir, forbid)
            audit_rows.append((x, fl, other, unl))
            flag_lines += ["%s: %s" % (x["id"], f) for f in fl]
        elif x["role"] == "judge":
            wrote = [s for t, s in touched(x) if t in ("Write", "Edit")]
            bad = [w for w in wrote if os.path.basename(w) not in ("ruling.md", "digest.md")]
            for w in bad:
                flag_lines.append("judge wrote outside ruling.md and digest.md: %s" % w)
    wall = None
    try:
        s0 = min(datetime.fromisoformat(t.replace("Z", "+00:00")) for t in starts)
        s1 = max(datetime.fromisoformat(t.replace("Z", "+00:00")) for t in ends)
        wall = round((s1 - s0).total_seconds() / 60, 1)
    except ValueError:
        pass
    rev_models = sorted({",".join(x["models"]) or x["meta_model"] or "" for x in agents if x["role"] == "reviewer"})
    rev_eff = sorted({",".join(x["efforts"]) or x["meta_effort"] or "" for x in agents if x["role"] == "reviewer"})
    j = judge[-1] if judge else None
    isolation = "not audited" if not audit_rows else ("clean" if not flag_lines else "flags:%d" % len(flag_lines))
    ver, commit = skill_version(skill_dir)
    ver = a.skill_version or ver
    commit = a.skill_commit or commit

    fm = [("run_id", rid_name), ("date", date), ("work", work), ("work_slug", slug), ("lens_set", lens_set),
          ("lenses", lenses), ("purpose_source", purpose_source), ("orchestration", orchestration),
          ("skill_version", ver or "unknown"), ("skill_commit", commit or "unknown"),
          ("run_dir", "reviews/run-%d" % n), ("reviewers", len(rep)),
          ("reviewer_model", "/".join(rev_models) or "unknown"), ("reviewer_effort", "/".join(rev_eff) or "unknown"),
          ("judge_model", (j and (",".join(j["models"]) or j["meta_model"])) or "unknown"),
          ("judge_effort", (j and (",".join(j["efforts"]) or j["meta_effort"])) or "unknown"),
          ("findings_raised", raised), ("reviewer_must_fix", rev_must), ("ledger_items", len(rows)),
          ("ledger_must_fix", n_must), ("ledger_should_fix", n_should), ("ledger_optional", n_opt),
          ("ledger_rejected", n_rej), ("overall_call", call or "unknown"), ("subagent_tokens", total_tokens or "unknown"), ("other_agent_tokens", other_tokens),
          ("wall_minutes", wall if wall is not None else "unknown"),
          ("orchestrator_context_delta", a.context_delta if a.context_delta is not None else "unknown"),
          ("isolation", isolation), ("write_refusals", refused), ("retries", retries),
          ("parse_warnings", len(notes))]
    scoring = read(os.path.join(run, "scoring.md"))
    recall_keys = (("Recall strict, all items", "recall_strict_all"), ("Recall strict, in-scope items", "recall_strict_in_scope"),
                   ("Recall lenient, in-scope items", "recall_lenient_in_scope"),
                   ("Reviewer-level recall, in-scope items", "recall_reviewer_level_in_scope"))
    counts_block = []
    if scoring:
        for label, key in recall_keys:
            m = re.search(r"^%s:\s*(\d+)\s*/\s*(\d+)" % re.escape(label), scoring, re.M | re.I)
            if m:
                fm.append((key, "%s/%s" % (m.group(1), m.group(2))))
        counts_block = [l for l in scoring.splitlines()
                        if re.match(r"^(in scope|needs web|needs other source|needs artifact|Matched|Partly matched|Raised, not ruled|Rejected|Not found|Recall|Reviewer-level recall)\b", l, re.I)]
    out = ["---"] + ["%s: %s" % (k, v) for k, v in fm] + ["---", "",
           "# %s | %s | %s | %s" % (rid_name, date, lens_set, slug), "", "## Summary", "",
           "- Overall call: %s" % (call or "unknown"),
           "- Reviewers filed %d findings (%d must-fix). The judge's ledger has %d items: %d must fix, %d should fix, %d optional, %d rejected."
           % (raised, rev_must, len(rows), n_must, n_should, n_opt, n_rej),
           "- Severity at the source against the ruling: reviewers rated %d must-fix, the judge kept %d." % (rev_must, n_must),
           "- Isolation audit: %s." % isolation,
           "- Subagent tokens: %s. Wall time: %s minutes. Orchestrator context change: %s tokens."
           % (total_tokens or "unknown", wall if wall is not None else "unknown",
              a.context_delta if a.context_delta is not None else "not recorded"), "",
           "## Settings observed", "",
           "| Role | Agent | Model | Effort set | Effort observed | Tokens | Minutes | Tool calls | Writes refused |",
           "|---|---|---|---|---|---|---|---|---|"]
    for x in sorted(srows, key=lambda y: (y["role"] != "reviewer", y["id"])):
        out.append("| %s | %s | %s | %s | %s | %s | %s | %d | %d |" % (
            x["id"] if x["role"] != "other" else "other", x["agent"][:8], ",".join(x["models"]) or x["meta_model"] or "?",
            x["meta_effort"] or "?", ",".join(x["efforts"]) or "?", x["tokens"] or "?", x["minutes"] or "?",
            len(x["tools"]), x["refused"]))
    out += ["", "## Yield", "",
            "| Reviewer | Raised | Must-fix | Should-fix | Nitpick | Ruled valid | Partly valid | Rejected | Only this reviewer | Report characters |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    for rid, v, ok, part, rej, uniq in yrows:
        out.append("| %s | %d | %d | %d | %d | %d | %d | %d | %d | %d |" % (
            rid, v["n"], v["sev"]["must-fix"], v["sev"]["should-fix"], v["sev"]["nitpick"], ok, part, rej, uniq, v["chars"]))
    out += ["", "Ruled counts come from the ledger rows that name the reviewer's finding ids. A finding the judge folded into another row is counted there once per row. 'Only this reviewer' counts valid rows raised by a single reviewer.", "",
            "## Isolation audit", ""]
    if not audit_rows:
        out.append("Not audited: no transcripts.")
    for x, fl, other, unl in audit_rows:
        out.append("- %s: %s. Distinct paths outside the run directory and the skill: %d, of which not named in the pack: %d."
                   % (x["id"], "clean" if not fl else "%d flags" % len(fl), len(other), len(unl)))
        for f in fl:
            out.append("  - FLAG: %s" % f)
        for t in unl[:6]:
            out.append("  - not in pack: %s" % t)
    out += ["", "The audit reads each reviewer's tool calls. It looks for other reviewers' reports, rulings the pack does not list, git history, and any pattern passed with --forbid. It shows what was touched, not what was read into the model's head, and the path matching for shell commands is a heuristic.", "",
            "## Flags (automatic)", ""]
    flags = []
    if refused:
        flags.append("%d tool calls were refused with 'Subagents should return findings as text'. Reports were saved from the reviewers' final messages." % refused)
    for e in extracted:
        flags.append("saved from an agent's own output: " + e)
    relayed = sorted({x["relayed"] for x in agents if x.get("relayed")})
    if relayed:
        flags.append("the workflow harness gave every agent the user's triggering request verbatim (%d characters). Check that it says nothing about the work under review." % relayed[0])
    if retries:
        flags.append("%d reviewer retries." % retries)
    flags += notes
    flags += list(a.note or [])
    flags += ["isolation: %s" % f for f in flag_lines]
    if rev_must and n_must == 0:
        flags.append("reviewers rated %d must-fix and the judge kept none." % rev_must)
    if not flags:
        out.append("None.")
    for i, f in enumerate(flags, 1):
        out.append("- FLAG-%s-%d | %s" % (rid_name.replace("-", ""), i, f))
    if counts_block:
        out += ["", "## Scoring against an answer key", "",
                "The run's ledger was scored against a known answer key by a separate agent. The full table is in `scoring.md` in the run directory.", ""]
        out += ["- " + l.strip() for l in counts_block]
    out += ["", "## Skill feedback", "",
            "One line per item, in this exact form. Leave the line below as it is if there is nothing to add.", "",
            "`- SF-%s-1 | area: <reviewer-prompt|judge-prompt|skill|lenses|scripts|harness> | observation: <what happened> | proposal: <what to change> | evidence: <where>`" % rid_name.replace("-", ""), "",
            "<!-- SF-LINES -->", "",
            "## Judge digest (verbatim)", "", "```", digest or "(no digest)", "```"]
    text = "\n".join(out)
    draft = os.path.join(run, "RUN-REPORT.draft.md")
    write(draft, text)
    write(os.path.join(run, ".report-name"), fname)
    print("draft: %s" % draft)
    print("will be published as reports/%s" % fname)
    print("overall call: %s | raised %d (must-fix %d) | ledger %d (M%d S%d O%d X%d) | isolation %s"
          % (call or "unknown", raised, rev_must, len(rows), n_must, n_should, n_opt, n_rej, isolation))
    print("tokens %s | wall %s min | flags %d | notes %d" % (total_tokens or "unknown", wall, len(flags), len(notes)))


def cmd_publish(a):
    run = os.path.abspath(a.run_dir)
    reviews = find_reviews_dir(a.reviews_dir)
    draft = os.path.join(run, "RUN-REPORT.draft.md")
    name = read(os.path.join(run, ".report-name")).strip()
    text = read(draft)
    if not text or not name:
        sys.exit("run `report` first: no draft or no report name in %s" % run)
    m = NAME_RE.match(name)
    n = int(m.group(1))
    dest = os.path.join(reviews, "run-%d" % n)
    target = os.path.join(reviews, "reports", name)
    if os.path.exists(target) or (os.path.exists(dest) and not a.report_only):
        sys.exit("run-%d or %s already exists; nothing was overwritten" % (n, name))
    if not a.report_only:
        os.makedirs(dest)
        for f in sorted(os.listdir(run)):
            p = os.path.join(run, f)
            if os.path.isfile(p) and not f.startswith(".") and f != "RUN-REPORT.draft.md":
                shutil.copy2(p, os.path.join(dest, f))
        print("copied the run to %s" % dest)
    write(target, text)
    print("wrote %s" % target)
    build_index(reviews)


def front_matter(text):
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    out = {}
    if m:
        for line in m.group(1).splitlines():
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip()
    return out


def build_index(reviews):
    files = sorted(glob.glob(os.path.join(reviews, "reports", "AR-*.md")))
    rows, sf = [], []
    changelog = read(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "CHANGELOG.md"))
    applied = set(re.findall(r"SF-AR\d{3}-\d+", " ".join(l for l in changelog.splitlines() if "Implements" in l)))
    for f in files:
        t = read(f)
        fm = front_matter(t)
        base = os.path.basename(f)
        rows.append("| %s | %s | %s | %s | %s | v%s | %s / %s | %s / %s | %s | M%s S%s O%s X%s | %s | %s | [%s](reports/%s) |" % (
            fm.get("run_id", "?"), fm.get("date", "?"), fm.get("lens_set", "?"), fm.get("work_slug", "?"),
            fm.get("orchestration", "?"), fm.get("skill_version", "?"), fm.get("reviewer_model", "?"),
            fm.get("reviewer_effort", "?"), fm.get("judge_model", "?"), fm.get("judge_effort", "?"),
            fm.get("findings_raised", "?"), fm.get("ledger_must_fix", "?"), fm.get("ledger_should_fix", "?"),
            fm.get("ledger_optional", "?"), fm.get("ledger_rejected", "?"), fm.get("subagent_tokens", "?"),
            fm.get("isolation", "?"), base, base))
        for line in t.splitlines():
            m = re.match(r"^- (SF-AR\d{3}-\d+) \| area: (.*?) \| observation: (.*?) \| proposal: (.*?)(?: \| evidence: (.*))?$", line)
            if m and "<" not in m.group(2):
                sf.append((m.group(1), fm.get("run_id", "?"), m.group(2), m.group(3), m.group(4), m.group(5) or ""))
    head = ("# Review runs: index (generated)\n\nGenerated by `.claude/skills/adversarial-review/scripts/ar.py index`. Do not edit by hand. "
            "Search by run id (`AR-003`), lens set (`lens_set: plans`), or any front matter key in `reports/`.\n\n"
            "| Run | Date | Lens set | Work | Orchestration | Skill | Reviewers (model / effort) | Judge (model / effort) | Raised | Ledger | Tokens | Isolation | Report |\n"
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
    write(os.path.join(reviews, "INDEX.md"), head + "\n".join(rows))
    sfh = ("# Skill feedback from run reports (generated)\n\nCollected from the `Skill feedback` section of each run report. "
           "An item is marked applied when `CHANGELOG.md` in the skill directory has an `Implements:` line naming its id.\n\n"
           "| Id | Run | Area | Observation | Proposal | Evidence | Status |\n|---|---|---|---|---|---|---|\n")
    sfr = ["| %s | %s | %s | %s | %s | %s | %s |" % (i, r, ar, ob, pr, ev, "applied" if i in applied else "open")
           for i, r, ar, ob, pr, ev in sf]
    write(os.path.join(reviews, "SKILL-FEEDBACK.md"), sfh + "\n".join(sfr))
    print("indexed %d reports, %d feedback items (%d open)" % (len(files), len(sf), sum(1 for x in sf if x[0] not in applied)))


def cmd_index(a):
    build_index(find_reviews_dir(a.reviews_dir))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("extract", "report", "publish", "index"):
        s = sub.add_parser(name)
        s.add_argument("--run-dir")
        s.add_argument("--reviews-dir")
        s.add_argument("--transcripts", action="append")
        if name == "extract":
            s.add_argument("--match")
        if name == "report":
            s.add_argument("--match", help="string that identifies this run in the agents' launch messages (default: the run directory)")
            s.add_argument("--date"); s.add_argument("--work"); s.add_argument("--lens-set"); s.add_argument("--lenses")
            s.add_argument("--orchestration"); s.add_argument("--purpose-source"); s.add_argument("--number", type=int)
            s.add_argument("--context-delta", type=int); s.add_argument("--forbid", action="append")
            s.add_argument("--skill-version"); s.add_argument("--skill-commit"); s.add_argument("--note", action="append")
        if name == "publish":
            s.add_argument("--report-only", action="store_true", help="write only the report (the run directory already exists)")
    a = p.parse_args()
    if a.cmd != "index" and not a.run_dir:
        sys.exit("--run-dir is required")
    {"extract": cmd_extract, "report": cmd_report, "publish": cmd_publish, "index": cmd_index}[a.cmd](a)


if __name__ == "__main__":
    main()
