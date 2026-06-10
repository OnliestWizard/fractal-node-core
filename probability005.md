# Probability 005 — The Ladder: Graphs Become Agents, Agents Become Apps

*Fable's read, 2026-06-10 — follow-up to [probability004](probability004.md).
Prompted by the user's one-liner: "graphs become agents, agents become apps
and so on." Written the day the library hit seven gated skills and the
spec-to-tested-code service ran end-to-end.*

## No rung adds code

A graph becomes an agent without changing a byte of its JSON — what changes
is its **relationship to time**: something triggers it without a human. An
agent becomes an app by gaining a **relationship to other parties**: an
interface plus a promise (file an issue shaped like X, get Y back). An app
becomes a product by gaining a **relationship to money**: metering, tenancy,
someone to call when it breaks.

The IR is constant all the way up. The rungs are relationships layered onto
the same artifact. In normal stacks each layer is a rewrite — script →
service → SaaS each get rebuilt. Here the *same versioned object* climbs,
which means rollback, lineage, and replay climb with it for free.

| Rung | Adds | Amortizes |
|---|---|---|
| graph | — | reasoning (compile once, run forever) |
| library skill | contract gate | tasks (reuse across problems) |
| agent | a trigger | attention (no human in the loop) |
| app | an interface promise | users |
| marketplace | provenance + pricing | builders |

## The strangest implication: the org chart compiles

Once `inbox_sweep` is itself a library skill, a bigger graph composes the
entire inbox as one node. A "department" graph — inbox, gardener, weekly
reporter, edges between them — is not an architecture diagram of the system;
it **is** the system: executable, versioned, contract-tested. Organizations
of agents are graphs of apps, same type, recursively.

"Multi-agent orchestration" elsewhere means message-passing between opaque
processes. Here the operational structure itself is an inspectable artifact
you can diff between versions. You could replay the company.

## Agents need memory; the world is the database

A sweep that runs every five minutes must know which issues it already
handled. Keep state in a store, or keep state *in the world* — labels on
issues, comments as receipts, commits as facts — and make every sweep a
reconciliation loop: observe, diff against desired, act only on the gap.
The Kubernetes insight, and this system is accidentally perfectly shaped for
it: **the playground repo is already the agent's memory.** Issues are its
inbox, labels its checkboxes, commit history its journal.

State and receipts sharing one substrate means the audit trail is not a
side-channel log — it's the database itself. An agent whose memory is its
public record can't quietly believe something it can't show.

## Contracts change shape at each rung

- **Graph contracts** are unit tests — built (probability003).
- **Agent contracts** are invariants over time: never act twice on the same
  issue, never touch outside the sandbox, always leave a receipt.
- **App contracts** are interface promises to strangers.

The gate generalizes accordingly. Today `save_graph` refuses a skill that
fails its tests; the agent-rung version is a **deploy gate** — a new version
of `inbox_sweep` must pass a canary run against test issues before it
inherits the pulse. Versioned agents plus rollback equals blue/green
deployment *for behavior*. "Roll the agent back like a bad deploy" is the
sentence the probability004 compliance surveys are begging for.

## The marketplace's missing piece was always the receipts

A skill's version history with its contract evidence is its **résumé**:
provenance, pass rates, lineage of who composed it and what it composed.
probability002's marketplace idea lacked a quality signal; the receipts are
the quality signal. Skills don't need star ratings — they have records.

## Where the ladder strains

1. **LLM nodes leak determinism.** Replay shows faithfully what *did*
   happen; a rerun won't match. Contracts on LLM output stay soft (the
   explainer-haiku lesson), and the fuzziness compounds with altitude.
2. **The prompt ceiling.** Around ~50 skills the catalog can't be listed in
   full; composition needs retrieval ("which skills fit this task"). Seeding
   and pruning decisions feed directly into when this hits.
3. **Rung costs are non-graph costs.** Uptime, cost caps, injection defense
   — they recur at every rung. There is no one-time hardening that buys the
   whole ladder. The graphs compose for free; the rungs are paid in ops.

## Sequencing (unchanged, sharpened)

The ladder doesn't overturn probability002/004 — it explains them. Ship
first (the repo is ready; the window argument stands). The first rung —
agent — is one small build: a triage router + an `inbox_sweep` skill + a
pulse in the server. Automating against the owner's issues is safe today;
opening the inbox to strangers crosses the run_js/injection/cost boundary
and waits for hardening. A live automated inbox on a public sandbox is the
demo that runs itself, for strangers, forever — the best distribution
artifact this project could have.

## The one-line answer

The project began as "define logic once, run on any platform" and grew into
**"define behavior once, run at any altitude"** — same fractal insight,
rotated 90 degrees. The ladder is climbed one paid rung at a time, and the
first rung is a heartbeat.
