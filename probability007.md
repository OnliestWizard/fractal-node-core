# Probability 007 — Agents Are Visitors

*Fable's read, 2026-06-11 — follow-up to [probability006](probability006.md).
The seed is the user's synthesis, arrived at in conversation with GPT —
a different transient executor, which turns out to be the joke the essay
is about: "work is represented as a version-controlled graph. agents are
transient executors. the repository is the persistent cognitive substrate
containing memory, skills, plans, governance, history and operational
state."*

## The inversion

The industry default makes the agent the durable thing. It gets a name, a
persona, a session, a vector store stapled to its side; the artifacts it
produces are exhaust. When the agent dies — context overflow, crash,
deprecation — something real is lost, because the system's knowledge lived
in the agent.

This project is built the other way around, and the seed sentence names it
exactly. The agent here is disposable by design: Plant is a stateless
GPT-4o call that designs a graph and vanishes; the judge is a call; the
agent node is a loop of calls; the assistant building the engine is a
session that ends. None of them retain anything that matters, because
**anything that matters must land in the substrate** — a commit, a version,
a trace, an issue. The minds are interchangeable visitors. The repository
is the resident.

## The six pillars, audited

The sentence claims six things live in the substrate. As of today:

| Pillar | Where it lives | State |
|---|---|---|
| Memory | the playground repo — world-as-database ([005](probability005.md)) | ✓ live |
| Skills | `graphs/` + `.versions/` history | ✓ live, 7 skills |
| Governance | the contract gate, `allowedTools`, the two-token split | ✓ live |
| History | receipts: traces, replay, markdown renders | ✓ live |
| Operational state | STATUS.md, regenerated from the library | ✓ live (two days old) |
| Plans | issues-as-queue, the self-proposal loop | ◐ embryonic |

Plans is the honest gap. Issue #4 exists because the system proposed it,
and the inbox loop can turn a proposal into a prototype — but there is no
real plan *representation* yet, nothing that decomposes intent into
tracked, ordered work the way the other five pillars have first-class
form. That is what the first rung (the inbox_sweep agent) starts to build,
and the sentence makes clear why it matters: an institution with memory,
skills, and law but no plans is a library, not an organization.

## The accidental proof

This thesis was demonstrated before it was stated. Yesterday a laptop
freeze annihilated the executor mid-thought — conversation gone, context
gone, the in-flight reasoning unrecoverable except as a photograph of a
screen. And the recovery procedure was: read the substrate. The essay
addendum was already in a commit. The library was intact, versioned,
gated. A new executor (different session, same model family — it could
have been a different model entirely) read the repo and resumed within
minutes.

The only thing lost was the one thing that had not been committed — the
conversation itself — and even its content was reconstructed from a
screenshot. The lesson is the architecture: the crash didn't test the
backups, it tested **where the cognition lives**, and the answer was: not
in the agent.

## What follows from the inversion

**Model upgrades are free.** When the transient executor improves, the
substrate doesn't churn. Every skill carries its contract; the gate
re-verifies the library under the new mind. Systems that keep their
knowledge in an agent's context window or a fine-tune molt painfully with
every model generation. A substrate with standards of evidence just hires
better visitors.

**Executor plurality is already real.** GPT-4o designs the graphs and
judges the drafts; a different assistant builds the engine; the seed
sentence of this essay was sketched by one model and sharpened by another.
No one of them is *the* agent of the system. The org chart from
[005](probability005.md) compiles down to roles, and the roles are filled
per-call.

**Versioned is not the same as cognitive.** Version control alone gives
you an archive. What earns the word *cognitive* in the seed sentence is
that this store refuses bad writes — `save_graph` rejecting a failing
graph is memory with standards of evidence, a belief system that demands
receipts before believing. [006](probability006.md) said provenance turns
data into meaning; this adds the input side: the gate turns storage into
judgment.

## The old resonance

This is how institutions have always outlived people. A company, a
monastery, a court of common law — the durable thing was never the
individual mind; it was the records plus the process for amending them.
Employees pass through; the ledger, the rule of the order, the precedent
persist, and each new member is onboarded *from the substrate*. What's
been built here is an institution whose employees are LLM calls — hired
per task, paid per token, gone by the next line — and whose books are
kept well enough that no departure costs anything.

## The strain: retrieval

A substrate is only as cognitive as its recall. Today the whole library
fits in Plant's system prompt; [005](probability005.md) already flagged
the ~50-skill ceiling, and this framing sharpens why it's the binding
constraint: memory you cannot surface at the right moment is storage, not
cognition. The institution analogy holds here too — organizations don't
fail for lack of records, they fail because nobody can find the precedent
when it matters. Somewhere around skill thirty, retrieval stops being an
optimization and becomes the difference between a mind and a filing
cabinet. The lineage-query gap (runtime ids still aren't persisted back to
source) is the same problem wearing provenance clothes.

## What it means

Nothing in the roadmap changes — ship, heartbeat, garden — but the pitch
gains its cleanest sentence yet. Raindrop and the observability category
instrument the *visitors*. This system built the *residence*. When the
visitors get smarter every quarter and cheaper every month, the asset is
the building.
