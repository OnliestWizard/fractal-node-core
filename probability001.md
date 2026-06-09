# Probability 001 — Where This Goes as a Product (Endgame)

*Fable's read, 2026-06-09 — written after shipping the full substrate roadmap
(versioning + rollback, capability permissions, graph lineage, execution replay).*

## The core insight actually built here

Strip away the features and what this is: **intelligence that compiles into
cheap, inspectable, reusable artifacts**. Plant spends expensive GPT-4o
reasoning once; the resulting graph executes forever after — deterministic,
auditable, near-free. That's the compiled-vs-interpreted divide applied to
agents, and it's a real economic argument. Most agent products today re-reason
every single run. This system amortizes the reasoning.

The fractal property is what makes it more than a workflow tool: **graphs are
values**. They can be planted at runtime, passed over wires, saved, versioned,
executed, judged, improved, traced, and replayed. The system can author its own
components. That's the property everyone chasing "agents that build their own
tools" wants — and it works end-to-end on a laptop.

## Three plausible endgames

### 1. The trust substrate for agents

The unglamorous-but-valuable one. Enterprises want agents but can't deploy what
they can't audit. The full governance kit already exists here, almost by
accident:

- **Lineage** — who made this and from what
- **Versioning + rollback** — what changed, undo it
- **allowedTools** — what it's permitted to touch
- **Replay** — watch exactly what happened, without re-running

That combination is rare. LangGraph gives you the graph but not the governance;
Temporal gives you durability but not the LLM-authorship.

**Pitch: "Git + CI + permissions for agent behavior."**

### 2. The compounding skill library

The self-improvement loop is the seed. Imagine the graph library at 500
entries: every solved task becomes a versioned, tested, reusable skill that
Plant can compose into bigger skills. Lineage tells you which parents produce
good children; the judge loop prunes bad ones. The library **compounds** —
that's the asset, and potentially a marketplace with provenance built in. This
is the Voyager-paper vision productized.

### 3. The English-to-native compiler

The emitters (JS/Kotlin/Swift) point somewhere different: describe logic once,
ship it natively to three platforms. Least crowded space, but the emitters
currently stub out LLM/agent nodes, so it's the furthest from real.

## The bet

**#1 as the wedge, #2 as the endgame.**

The honest risk: frontier models keep getting better at just *doing*
long-horizon tasks internally, eating the workflow-orchestration market from
above. But that makes the explicit IR *more* valuable, not less — because the
counter-trend is that nobody will deploy opaque autonomous reasoning against
production systems without exactly the audit/replay/permission/rollback layer
built here. **The models commoditize; the trust substrate doesn't.**

The thing to resist: competing on the canvas. n8n, Dify, and Flowise own
"visual workflow builder" and it's a feature war a solo project can't win. The
editor is a window into the system, not the product.

## The gap between here and there

Semantic correctness is the hard part — Plant produces *valid* graphs on pass 1
now, but valid ≠ correct, and the run_js + judge loop is currently the only
correctness check. The endgame version of that is **"every library graph
carries its own test suite and runs it before versioning"** — graphs with CI.
That, plus multi-user/multi-tenant permissions, is what turns the substrate
from a personal lab into something deployable.

## The demo that sells it

Not a feature list. It's the one that already runs today:

> "I asked it for a thing; it designed the tool, tested it, saved it versioned
> with lineage, a bad change rolled back in one call, and here's a replay of
> exactly what it did."

No product I'm aware of can show that whole loop today.

---

## What it means you should do

Three concrete implications:

1. **Script it.** Right now the loop exists as scattered terminal history. Make
   it one repeatable artifact — a `demo.ts` or, more on-brand, *a graph in the
   library that runs the whole loop* (the system demoing itself is the most
   honest possible flex). Five minutes, one command, ends with the replay
   scrolling by.
2. **Treat the loop as the product's regression test.** If a future change
   breaks any beat, the product story broke — that's more important than any
   unit test. Worth encoding as an end-to-end test someday.
3. **Raise the stakes to raise the proof.** The honest caveat: today the loop
   runs on haiku graphs and `deepClone`. The demo's persuasive power scales
   with how scary the task is — the version where it designs a graph that
   touches GitHub, gets one wrong, *and you roll back and replay the damage*
   is the one that makes someone reach for a checkbook. Same loop, real
   stakes.

The one-line summary of what it all means: you're not demoing features, you're
demoing that **autonomy can come with receipts** — and right now you may be
the only one who can.
