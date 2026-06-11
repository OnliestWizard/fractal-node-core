# Probability 004 — The Field, Mid-2026

*Fable's read, 2026-06-10 — follow-up to [probability003](probability003.md).
The question: how does this compare to other people's ideas, projects, and
direction? Based on a literature/market sweep done the day graph CI shipped.*

## The short version

The ideas are converging on this project from three directions at once —
but nobody has the combination.

## 1. The compile-once thesis is now mainstream research

probability001's economic argument ("Plant spends expensive reasoning once;
the graph executes forever after") is no longer contrarian — it's the premise
of multiple spring-2026 papers:

- [Compiled AI](https://arxiv.org/html/2604.05150v1) — generation cost fixed
  at compile time, execution near-free, "amortized O(1) inference cost-scaling."
- [PlanCompiler](https://arxiv.org/html/2604.13092v1) — "typed node
  registries, static graph validation, and topological compilation."
  That is line-for-line this architecture (core/types.ts, validateGraph,
  core/topo.ts), independently derived.
- [AWO meta-tools](https://arxiv.org/pdf/2601.22037) — compiles recurring
  agent behavior into deterministic reusable composite actions.

## 2. The skill-library direction is getting crowded

The Voyager vision is now a [survey category](https://arxiv.org/pdf/2507.21046):

- [SAGE](https://arxiv.org/abs/2512.17102) — RL-driven skill accumulation
  across task chains (8.9% better completion, 59% fewer tokens).
- [AgentFactory](https://arxiv.org/pdf/2603.18000) — meta-agent that builds
  and reuses executable subagents.
- [SkillFoundry](https://arxiv.org/html/2604.03964v1) — self-evolving domain
  skill libraries.
- Microsoft's [SkillOpt](https://explainx.ai/blog/microsoft-skillopt-self-improving-agent-skills-2026)
  — "validation-gated edits"; the closest published cousin to the graph CI
  gate, but it validates skill text, not contract-tested executable artifacts.

## 3. The demand side is screaming for the governance pillar

- A [2026 survey](https://www.tierzero.ai/blog/ai-agent-audit-trail/): two
  thirds of orgs can't tell whether a production action was human or agent;
  a third have no evidence-quality audit trail at all.
- [Compliance guides](https://medium.com/@Indext_Data_Lab/ai-agent-audit-the-complete-2026-governance-and-compliance-guide-aa945b2d2f67)
  now cite SOC 2 CC8.1 — authorization, testing, *rollback* for every agent
  change — as table stakes. Enterprise requirement lists ("immutable logging,
  versioning, monitoring, replay") read like this repo's feature list.
- Vendors ([Straiker](https://www.straiker.ai/solution/ai-compliance-governance),
  [Tyk](https://tyk.io/learning-center/ai-agent-api-governance-auth-audit-trails-and-zero-trust/))
  bolt audit onto *opaque* agents from outside.

### Addendum (2026-06-11): Raindrop 2.0 — the outside-in version, funded

[Raindrop](https://www.raindrop.ai/) ("Sentry for AI agents", YC,
[$15M seed](https://pulse2.com/raindrop-15-million-seed-funding/)) shipped
["self-healing agents"](https://www.raindrop.ai/blog/introducing-raindrop-2/):
detect a production failure → triage agent finds root cause → coding agent
fixes it → **the failure is converted into an eval so it can't regress** —
plus [Workshop](https://github.com/raindrop-ai/workshop), an open-source
local debugger that generates evals from real failures.

This is the observability category climbing toward the substrate: they
started with receipts and are now acting on failures. "Failure becomes an
eval" is probability003's contract thesis arriving from the commercial
direction. The architectural contrast is the pitch, sharpened: Raindrop is
**outside-in** (instrument an opaque agent, infer what happened, patch from
outside; works with ANY stack at production scale) — this system is
**inside-out** (the substrate IS the trace; failures are structural, not
inferred; guarantees are total but only for graphs born in the IR).
Wedge vs reach.

Feature worth stealing, queued: **a failed trace becomes a contract test** —
auto-draft a GraphTestCase from a failed run's inputs and failure point and
offer it to the graph's suite. The explainer-haiku incident did this
manually; mechanizing it means the library compounds *lessons*, not just
skills. Slots next to the expectation-ops work.

## What's actually different here

Each neighbor has one pillar; this has the combination:

- Research skill libraries treat skills as code snippets or prompt text —
  not a **typed, validated, versioned IR with permissions and lineage**.
- Governance vendors audit from outside the agent. Here the governance lives
  **inside the execution substrate** — the audit trail *is* the execution
  format.
- The compilation papers compile but don't self-author at runtime. None has
  `plant` as a node inside the graph it produces. **The fractal property is
  the thing to defend hardest.**
- Nobody else appears to gate *versioning* on contract tests the way
  `save_graph` now refuses a failing graph.

Where others are genuinely ahead: durability at scale (Temporal-class),
multi-tenancy, RL-driven skill improvement (SAGE's numbers beat a judge
loop), benchmarks, and distribution. This is one person, 221 tests, a demo.

## What it means

The convergence validates every bet in probability001–003 — and it means the
idea-novelty window is closing. What stays defensible is the **working
combination**, which makes probability002's "shrink and ship" (package + MCP
server, let the self-demo distribute) more urgent, not less. The regulatory
tailwind is literally writing the trust-substrate sales pitch. Right now the
whole loop running on a laptop is still rare; by next year it may not be.
