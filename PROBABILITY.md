# The Probability Series — Master Doc

Seven strategy essays written *while the system was being built* — most within
hours of the work they describe, none revised after the fact. They are kept
as snapshots, wrong turns included, because the series' own conclusion
(006) demands it: the derivation is the product. This doc is the index, the
through-line, and an honest ledger of how each essay's calls have held up.

**Reading order is writing order.** Each essay assumes the previous.

---

## The arc in one paragraph

001 asked *where does this go* and answered: the trust substrate is the
wedge, the compounding skill library is the endgame. 002 asked *how does it
reach other hands* and answered: by shrinking — package it, put MCP on top,
let the demo distribute itself. 003 found the capability frontier — valid ≠
correct — and called for contracts on every skill; the gate was built the
same day. 004 surveyed the field and found it converging on every one of
these ideas from three directions, concluding the defensible asset is the
working *combination* and the window is closing. 005 generalized the whole
design: graphs become agents, agents become apps — the rungs are
relationships, not rewrites, and the same versioned artifact climbs with
its receipts intact. 006 (unfinished) names what the receipts were always
for: not rollback — meaning. *Context without provenance is data; context
with provenance is meaning.* 007 names the architecture all of it implies:
agents are transient executors, the repository is the persistent cognitive
substrate — the minds are visitors, the repo is the resident.

---

## 001 — Where This Goes as a Product (2026-06-09)

**Thesis:** intelligence that compiles into cheap, inspectable, reusable
artifacts. Three endgames: (1) trust substrate for agents, (2) compounding
skill library, (3) English-to-native compiler. **The bet: #1 as wedge, #2
as endgame.** Resist the canvas war. The named gap: valid ≠ correct —
"every library graph carries its own test suite" (graphs with CI).

| Call | Status |
|---|---|
| "Script it" — one repeatable demo artifact | ✓ `demo_real_stakes.ts` |
| "Raise the stakes" — real GitHub damage + rollback + replay | ✓ ran 2026-06-10, sandbox + scoped tokens |
| Graphs with CI | ✓ built (003 → contract gate) |
| Treat the demo loop as the product's regression test | ◐ demos exist; not yet encoded as automated e2e |
| Resist the canvas | ✓ held — editor untouched since |

## 002 — How This Becomes a Product for Others (2026-06-09)

**Thesis:** it ships by *shrinking* — npm package + MCP server as the front
door; SaaS and marketplace only after strangers save graphs. Three things
that change when others touch it: the graph format becomes a public
contract; `run_js` becomes a security boundary; bring-your-own-keys.

| Call | Status |
|---|---|
| `specVersion` on the graph format | ✓ stamped on every save |
| run_js hardening before strangers *run* graphs | ○ open, correctly deferred to packaging |
| Package + MCP server | ○ open, deliberately held until asked for |
| "The demo is the distribution" | ◐ four one-command demos exist; recording not yet made |

## 003 — How It Evolves From Here (2026-06-10)

**Thesis:** everything shipped so far is *accountability* machinery; none
of it makes damage less likely. The move: **graphs carry their own test
suites and `save_graph` refuses to version a failing graph.** Unlocks the
compounding chain (untested skills can't compound). Don't build: substrate
sequels, canvas, premature hardening.

| Call | Status |
|---|---|
| Contract gate on save_graph | ✓ built same day, live-refused the demo sabotage |
| The compounding chain demonstration | ✓ same day — `demo_compounding_chain.ts`, plus skills-as-nodes (a mechanism Plant *invented* by assuming it existed) |
| Demo beat-4 upgrade (gate refusal + force-save) | ○ open |
| Persist runtime graph id (lineage gap) | ○ open |
| "Resist substrate sequels" | ◐ held by us; note the system's own first proposal (issue #4) was a substrate sequel — the temptation is now shared |

## 004 — The Field, Mid-2026 (2026-06-10)

**Thesis:** the ideas are converging from three directions — compile-once
research (PlanCompiler is this architecture in a paper), skill-library
frameworks (SkillOpt's validation-gated edits ≈ the contract gate), and
governance demand (compliance guides listing this repo's feature set as
requirements). **Defensible: the working combination + the fractal
property. The idea-novelty window is closing; ship.**

| Call | Status |
|---|---|
| Go-public checklist (README, license, config, sweep, history) | ✓ complete |
| The visibility flip | ○ pending — user's gut: pre-flight gauntlet first (fresh-clone test, failure drills, editor verdict, cost honesty). Fair: every demo's first run found a real bug. |

*Addendum 2026-06-11:* Raindrop 2.0 ("self-healing agents", YC, $15M) ships
failure→eval conversion — the contract thesis arriving outside-in from the
observability category. Confirms the convergence; sharpens the pitch
(inside-out vs outside-in); contributes a queued feature: **failed traces
auto-draft contract tests**. Details in 004.

## 005 — The Ladder (2026-06-10)

**Thesis:** graph → agent → app → product, where **no rung adds code** —
each adds a relationship (time, parties, money) to the *same versioned
artifact*, so receipts climb the ladder for free. The org chart compiles.
The world (the sandbox repo) is the agent's memory — reconciliation loops,
receipts and state on one substrate. Deploy gates = blue/green for
behavior. Strains: LLM determinism leak, ~50-skill prompt ceiling →
retrieval, rung costs are ops costs.

| Call | Status |
|---|---|
| First rung: triage router + `inbox_sweep` + a pulse | ○ designed, not built — owner-only until hardening |
| Seeding (`library_gardener`) after shipping | ○ agreed sequence |
| Stronger expectation ops (prereq for seeded contracts) | ○ open |

## 006 — Provenance Is the Product (2026-06-10, unfinished)

**Thesis:** rollback is a feature; what provenance buys is
*intelligibility*. An artifact alone says what; only its derivation says
what it means. Understanding precedes trust. Models are the mirror — trained
on conclusions with the chain of custody stripped. This repo publishes its
derivation, not just its conclusions.

**Deliberately unfinished** — the open thought (training on derivations
instead of conclusions; whether the trace-carrying IR sketches that) waits
for slower, human-paced thinking. The gap is its own receipt.

## 007 — Agents Are Visitors (2026-06-11)

**Thesis:** the inversion under everything: agents are transient executors,
the repository is the persistent cognitive substrate (memory, skills,
plans, governance, history, operational state). The minds are
interchangeable visitors; the repo is the resident. Consequences: model
upgrades are free (the gate re-verifies the library under the new mind),
executor plurality is already real, and the gate is what makes the store
*cognitive* rather than archival — memory that refuses bad writes. Proven
involuntarily by the laptop crash: the executor died mid-thought and
nothing was lost that had been committed.

| Call | Status |
|---|---|
| Plans is the weakest pillar — first rung (inbox_sweep) starts fixing it | ○ designed, not built |
| Retrieval becomes the binding constraint (~skill 30) | ○ watch — library at 7 |
| Lineage queryability (runtime-id gap) is the same problem | ○ open since 003 |

---

## Standing strategy (the current synthesis)

1. **Pre-flight, then flip.** Fresh-clone gauntlet, failure drills, editor
   verdict, cost line — explicit exit criteria so "more work" can't become
   forever (004's window argument still binds).
2. **Then the heartbeat** — inbox_sweep + pulse, owner-only. The governance
   kit finally doing the unattended job it was built for.
3. **Then the garden** — expectation ops with teeth, the gardener, pruning,
   eventually retrieval.
4. **Hold the line on:** canvas, substrate sequels, premature hardening,
   SaaS before strangers ask.

## What the series got right early

The two oldest claims aged best: *the models commoditize, the trust
substrate doesn't* (001) — written before the field's papers confirmed the
convergence — and *the demo is the distribution* (002), which every
milestone since has reinforced: the system's best artifacts are the
recordings of it keeping its own promises.
