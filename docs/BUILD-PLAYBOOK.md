# The Build Playbook — How to Execute a Software Project with Claude

*Generic, project-agnostic. Pair this with a project's architecture document
(the WHAT); this document is the HOW. Written for a Claude (Opus or newer) session
executing a build, and for the human operator running it. Copy it into any future
project unchanged.*

---

## Part 1 — Operating mindset

1. **Read the architecture document completely before writing anything.** Not
   skimmed — read. Every question you'd otherwise ask mid-build is usually answered
   in it. If the doc has a "locked decisions" section, those are settled: do not
   re-litigate them, do not "improve" them, do not quietly drift from them. If a
   locked decision turns out to be genuinely impossible, stop and say so explicitly
   with evidence — don't route around it silently.

2. **Ask questions at the start, not in the middle.** After the first full read,
   surface every ambiguity, contradiction, or missing credential/API-key/account in
   ONE batch. Mid-build questions stall momentum and usually mean the first read was
   shallow. If the operator is unavailable (overnight run), make the most
   conservative reasonable choice, and record it in a `DECISIONS.md` file so it can
   be reviewed later — never make an irreversible or costly choice silently.

3. **Build vertical slices, not horizontal layers.** A milestone that produces "all
   the database tables" or "all the UI components" is untestable and demos nothing.
   A milestone that produces one thin end-to-end path (one route → one function →
   one table → one screen) is testable, demoable, and de-risks the integration
   points early. Good architecture docs already order milestones this way — follow
   the order; the sequencing IS design work someone already did.

4. **The walking skeleton comes first.** Before real features: repo scaffold, CI
   running the (empty) test suite, deploy pipeline to the real hosting target, one
   trivial route returning 200 in production. Every deployment problem you find on
   day one is a problem you don't find on demo day.

5. **Definition of done is the acceptance criteria, not your confidence.** A
   milestone is done when its stated criteria are demonstrably true — tests green,
   behavior manually verified, on the real infrastructure. "It should work" is not
   done. "Here is the passing test / here is the curl output / here is what the
   screen shows" is done.

6. **Smallest change that ships the milestone.** No speculative abstractions, no
   config for scenarios that don't exist, no "while I'm here" refactors, no error
   handling for impossible states. Validate at system boundaries (user input,
   external APIs); trust internal code. If a future milestone will need something,
   the future milestone will build it.

7. **When something fails, diagnose before acting.** A failing test, a 500, a weird
   output — read the actual error, form a hypothesis, verify the hypothesis, THEN
   change code. Pattern-matching an error message to a remembered fix without
   checking is how one bug becomes three. Never delete or weaken a test to make it
   pass; the test is the spec.

---

## Part 2 — Session, context, and state management

Long builds outlive any single context window. Manage for that from the first hour.

1. **Externalize state to files, always.** The repo is your memory; the context
   window is scratch space. Maintain:
   - `PROGRESS.md` — one line per completed milestone/step, current step, next
     step, any blockers. Update it every time you finish something meaningful.
   - `DECISIONS.md` — every judgment call made without the operator: what, why,
     what the alternative was. Reviewable in five minutes.
   - `CLAUDE.md` at repo root — the standing instructions any fresh session needs:
     how to run the app, how to run tests, project conventions, links to the
     architecture doc and this playbook. Write it in milestone 0; keep it short and
     current.
   A fresh session reading those three files plus the architecture doc should be
   able to continue the build with zero handover conversation. Test that claim by
   writing them as if it were true.

2. **Commit early, commit often, commit working.** One commit per coherent step,
   message says what and why. Never end a work session with uncommitted changes.
   The git history is the build log; a reverted commit is cheap, a lost afternoon
   is not. Don't push to remote or publish anything without operator say-so.

3. **One milestone per session is a good default.** Finishing a milestone is a
   natural checkpoint: commit, update PROGRESS.md, run the full test suite, then
   either continue or stop cleanly. Don't start a milestone you can't checkpoint.

4. **When context runs long, summarize into files and keep going** — don't degrade
   into terse half-attention. If the harness compacts the conversation, the files
   from point 1 are what carries the build across the boundary.

---

## Part 3 — Orchestrating agents (and spending tokens well)

The main session (Opus-class) is the architect and integrator. Subagents are staff.
The economics: an Opus-class main thread doing its own grepping and boilerplate
burns premium tokens on commodity work; cheaper-model subagents doing design work
produce rework. Match model to task.

**Default posture (do this, don't just know it): the main session is a MANAGER, not a solo IC.**
When a task is parallelizable, mechanical, or well-specified, spin up a cheaper-model subagent
(Sonnet, or Haiku for pure search / mechanical edits), hand it a self-contained brief, and review
its diff — do not hand-write commodity work in the premium main thread. Reserve the main session
for design, cross-package integration, judgment calls, and review. A subagent may *propose* a
decision that is the operator's or the architect's to make; it never decides it. Run two–three at
once on non-overlapping file sets. This is how this project is run, not just advice.

### 3.1 What to delegate, and to which model tier

| Task | Delegate? | Model tier for the agent |
|---|---|---|
| Codebase exploration, "where is X handled", broad searches | Yes — Explore-type agent | Cheapest (Haiku-class) — it's reading, not judging |
| Research: library docs, API references, comparing packages | Yes | Sonnet-class |
| Well-specified implementation: a component from a spec, test scaffolding, seed data files, migrations from a schema already written | Yes | Sonnet-class |
| Running test-fix loops on an isolated package with a clear spec | Yes | Sonnet-class |
| Repetitive mechanical edits across many files | Yes | Sonnet or Haiku-class |
| Architecture decisions, data-model design, tricky algorithms, anything with locked-decision implications | **No — main session** | Opus-class |
| Integration across packages, debugging cross-cutting failures | **No — main session** | Opus-class |
| Final review of any subagent's work | **No — main session** | Opus-class |

In Claude Code, set the model per agent (agent definitions support a model field;
the Task/Agent tool accepts a model override). If the environment doesn't expose
model selection, delegation is still worth it for parallelism and context isolation.

### 3.2 How to prompt a subagent

Subagents start cold — they have none of your context. Every delegation prompt must
be self-contained:

- **Scope:** exactly which files/directories it may touch, and which it must not.
- **Context:** the relevant excerpt of the architecture doc (paste it — don't say
  "see the doc" and hope), the schema/types it must conform to, file paths.
- **Acceptance criteria:** how IT verifies it's done (which tests to run, expected
  output). An agent without a self-check returns "done" optimistically.
- **Anti-instructions:** what NOT to do — don't install new dependencies, don't
  modify the schema, don't touch files outside scope, don't "improve" adjacent code.
- **Output contract:** what to report back (files changed, test results, anything
  surprising).

### 3.3 Parallelism and verification

- Run subagents **in parallel only when their file sets don't overlap** (e.g. seed
  data + a UI component + a research task). Overlapping edits from parallel agents
  create merge chaos; serialize those.
- **Never trust a subagent's report.** When it says done, the main session runs the
  tests itself, reads the diff, and checks it against the spec. Subagent output is
  a draft PR, not a merge. Budget review time — delegation that skips review is
  just outsourcing bugs.
- Two to three concurrent subagents is plenty. Ten agents produce ten integration
  problems and one exhausted reviewer.

---

## Part 4 — Engineering practices

1. **Separate pure logic from I/O — architecturally, not aspirationally.** Business
   logic (calculations, validation, decision rules) lives in pure functions/packages
   with zero database, network, or framework imports. I/O lives at the edges (route
   handlers, adapters). This single decision makes the core testable without mocks,
   the tests fast, and the logic reusable. If a "pure" package imports the DB
   client, that's a build error, not a style nit.

2. **Test-first for the logic core; test-after is acceptable at the edges.** For
   pure logic: write the fixtures and failing tests from the spec's rules FIRST,
   then implement until green. Domain rules stated as numbers in an architecture
   doc are pre-written test cases — transcribe them. For UI and glue: build, then
   cover the critical paths. Priority order for limited testing budget:
   (1) domain-rule unit tests, (2) API-route integration tests, (3) one end-to-end
   happy path. Skip snapshot tests and UI unit tests of trivial rendering.

3. **Types are the first line of defense.** Strict mode always (TypeScript
   `strict`, or the language's equivalent). Model the domain in types — make
   illegal states unrepresentable (a union of `Queued | Confirmed | Bounced` beats
   a string). No `any` escape hatches in the logic core. Types shared between
   client and server live in one package, defined once.

4. **The database schema is code.** Migrations checked in, ordered, and runnable
   from scratch on a fresh instance at any time. Seed data is a script, not a
   manual setup. "Runs clean on a fresh project" is a test you run before every
   milestone ends.

5. **Deterministic by default.** Randomness gets a seed that's logged; timestamps
   are injected, not called inline; external calls are wrapped in one adapter each.
   A bug you can replay from a log line is an hour; one you can't is a week.

6. **Handle the failure modes the spec names, gracefully; nothing else.** Every
   external call (LLM APIs, third-party services) gets a timeout and a defined
   fallback behavior decided by the spec — never an infinite retry, never a silent
   swallow, never a raw stack trace to an end user.

7. **Dependencies are liabilities.** Before adding a package: does the platform or
   stdlib already do this? Is it maintained? Adding a dependency for something you
   could write in 30 lines trades a known cost for an unknown one. The architecture
   doc's stack list is the whitelist; additions go in DECISIONS.md.

8. **Match the codebase's existing idiom.** Comment only what the code cannot say
   (constraints, why-not-the-obvious-way). Never leave commented-out code, TODO
   markers without an issue, or console.log debris in a commit.

---

## Part 5 — Verification discipline

The single most common failure of AI-built software is confidently reported,
unverified work. The rules:

1. **Run everything you claim.** "The tests pass" means you ran them this session
   and read the output. "The endpoint works" means you called it and read the
   response. "It deploys" means it's live and you loaded the URL. Claims without a
   tool-result trail are hallucinations with good intentions.

2. **After every milestone: full suite + manual walkthrough.** Not just the new
   tests — the whole suite (regressions hide in the code you didn't touch). Then
   walk the user-facing flow by hand (or headless browser) exactly as a user would.

3. **Verify on the real target.** Free-tier cloud Postgres behaves differently from
   local SQLite; a deployed serverless function differs from `next dev`. At minimum
   at each milestone boundary, verify on the actual infrastructure named in the
   architecture doc.

4. **Fresh-context review beats self-review.** After a big milestone, spawn a
   reviewer subagent with clean context: give it the diff and the spec section,
   ask it to report every discrepancy, uncertain or not (a separate filter can
   rank them — don't ask it to be conservative, that suppresses recall). The main
   session then judges the findings. You cannot proofread your own work in the
   same breath you wrote it; a fresh context can.

5. **Report failures faithfully.** If a test fails, say so and show the output. If
   a step was skipped, say that. A red build reported honestly costs an hour; a red
   build reported green costs the operator's trust in every future report.

6. **The demo script is part of done.** Each milestone ends with a short "how to
   see it working" note in PROGRESS.md — commands, URL, what to click. If you can't
   write that note, the milestone isn't done.

---

## Part 6 — Writing architecture documents (for the next project)

How to produce the WHAT-document this playbook pairs with. Anatomy of one that a
cold-context builder can execute:

1. **Context & goals** — what it is, who the users are, and success metrics as
   *testable numbers*, not adjectives.
2. **Locked decisions, with rationale.** Every decision the operator has already
   made, plus WHY — so the builder respects it and future-you can revisit it
   intelligently. Decisions without rationale get re-litigated; decisions with
   rationale get followed.
3. **Domain knowledge as numbers and rules, embedded.** This is the highest-value
   section and the most commonly skipped. Whatever the expert knows (ratios,
   thresholds, formulas, category rules) must be IN the document as data —
   "balanced" is a vibe; "|acid − sweet| ≤ 0.25 units where lime = 1.0/oz" is a
   unit test. If the knowledge lives in someone's head or another file, the
   builder will improvise it wrong.
4. **Data model** — every entity, key fields, relationships, and the constraints
   that carry business meaning (append-only tables, soft-delete rules, tenancy
   keys on every table even if single-tenant today).
5. **State machines for anything with a lifecycle.** Draw the states and
   transitions explicitly, including the awkward interactions (what happens when X
   and Y overlap). Every state bug you draw on paper is one you don't debug at 1 AM.
6. **External integrations** — for each: exact API/model/version, the timeout, and
   the fallback behavior when it's down. "Calls the LLM" is not a spec;
   "one call, 3 s timeout, falls back to template output, logs the fallback" is.
7. **Non-functional requirements as numbers** — latency budgets, hosting tier and
   its limits, polling vs push (choose boring), where secrets live.
8. **An explicit OUT-OF-SCOPE list.** Scope creep enters through the unsaid. Name
   the tempting adjacent features and forbid them for this phase.
9. **Milestones with acceptance criteria** — ordered vertical slices, each with a
   "done when" a machine or a five-minute manual check can confirm. First milestone
   is always the logic core + tests; last is always hardening + runbook.
10. **A worked example, end to end** — trace one realistic input through the whole
    system with real numbers. This surfaces contradictions in your own document
    before the builder does. (Include a failure case that exercises the
    error/repair path — those are where designs actually break.)

**Then audit the draft before shipping it:**
- **Self-containment test:** reread it pretending every other document doesn't
  exist. Any dangling reference ("see the skill", "as discussed") is a bug — inline
  the content.
- **Consistency test:** compute your own worked examples with your own formulas.
  If your reference cases violate your own constraints, the constraints are
  miscalibrated — fix them now, not in the builder's milestone 0.
- **Constraint audit:** every "must/never" in the document should map to a specific
  enforcement point (a validator rule, a test, a schema constraint) — a table of
  non-negotiable → enforced-by is worth including in the doc itself.

---

## Part 7 — Failure modes to actively avoid

- **Scope creep by helpfulness.** "While I was in there I also added…" — don't. Log
  the idea in DECISIONS.md as a suggestion; build what the milestone says.
- **The rewrite reflex.** Reading and understanding existing code is almost always
  cheaper than rewriting it. Rewrites reset the bug clock to zero.
- **Mock-data theater.** Demoing against hardcoded data that silently never got
  replaced. Every mock gets a tracking line in PROGRESS.md and dies before the
  milestone closes.
- **Green-by-deletion.** Making tests pass by weakening assertions or deleting
  cases. The test suite only ratchets stricter.
- **Premature abstraction.** The second duplication is when you extract a helper,
  not the first, and never before.
- **Framework-fighting.** If you're overriding the framework's conventions
  repeatedly, you've misread the framework — stop and read its docs.
- **Silent assumption drift.** You discovered the spec is ambiguous, picked an
  interpretation, and told no one. Pick conservatively AND write it down.
- **Endless polish loops.** Fiddling with styling/naming/structure while a
  milestone's acceptance criteria sit unmet. Criteria first; polish is a listed
  task or it doesn't happen.
- **Claiming done under uncertainty.** If you didn't verify it, you don't know it.
  Say "implemented, not yet verified" when that's the truth.

---

## Part 8 — Handoff prompt template

Paste something like this to start a build session (adjust names):

> Read `ARCHITECTURE.md` and `BUILD-PLAYBOOK.md` in this folder completely before
> doing anything. The architecture doc is WHAT to build — its locked decisions are
> final. The playbook is HOW to work — follow it, including PROGRESS.md /
> DECISIONS.md / CLAUDE.md from the start, subagent usage with cheaper models for
> exploration and well-specified implementation work, and the verification
> discipline (run what you claim; full suite + manual walkthrough per milestone).
>
> First: surface every question, missing credential, or contradiction you find in
> ONE batch. Then execute milestone M0. Stop at each milestone boundary with the
> demo script and wait for my go-ahead. Do not deploy publicly or spend money
> without asking.

And to resume after a break or in a fresh session:

> Read `CLAUDE.md`, `PROGRESS.md`, `DECISIONS.md`, then the architecture doc
> section for the current milestone. Continue from where PROGRESS.md says we are.

---

*End of playbook. When in doubt: smaller step, verified, committed, written down.*
