# Probability 008 — The Second Sweep

*Fable's read, 2026-06-11, late — follow-up to [probability007](probability007.md).
A re-run of [004](probability004.md)'s field survey, two days and one
go-public later, on the user's prompt: who else launched, and what should
we do about it. Written the same evening the heartbeat made its first
unattended deliveries.*

## What two days did to the field

004 said the ideas were converging from three directions. The second sweep
says: faster, and with money. In roughly the window this project went
public:

- [Willow](https://www.vccafe.com/weekly-firgun-newsletter-june-5-2026/) —
  $7M seed, "AI agent control layer for enterprises."
- [Offroad](https://www.vccafe.com/weekly-firgun-newsletter-june-5-2026/) —
  $7M seed, identity security for AI agents.
- [Aigentsphere](https://www.startupdaily.net/topic/funding/ai-governance-startup-pockets-4-million-seed-round/)
  — $4M seed: register agents, monitor them, track costs, enforce
  policies, generate compliance reports. That sentence is STATUS.md plus
  the token meter plus `allowedTools`, productized.
- [Coralogix](https://www.vccafe.com/weekly-firgun-newsletter-june-5-2026/)
  — $200M Series F for AI observability; the scale players are arming.

And in the same spring wave: [Respan](https://voker.ai/blog/the-state-of-yc-ai-agents-2026)
(trace+evals control plane, a billion logs a month),
[Laminar](https://tech.eu/2026/03/17/agent-debugging-startup-laminar-raises-3m-seed-to-tackle-the-observability-gap-in-ai-agents/)
($3M, open-source agent observability **with replay**),
[InsightFinder](https://techcrunch.com/2026/04/16/insightfinder-raises-15m-to-help-companies-figure-out-where-ai-agents-go-wrong/)
($15M), [InfiniteWatch](https://techfundingnews.com/infinitewatch-4m-ai-agent-observability/)
($4M), [AlertD](https://pulse2.com/alertd-3-million-pre-seed-funding-raised-and-ai-agentic-sre-and-devops-platform-launched/)
($3M, agentic SRE),
[OpenObserve](https://www.businesswire.com/news/home/20260429840147/en/OpenObserve-Raises-$10-Million-Series-A-to-Accelerate-AI-native-Observability)
($10M A), and [Arize](https://arize.com/blog/arize-ai-raises-70m-series-c-to-build-the-gold-standard-for-ai-evaluation-observability/)
re-arming with a $70M C. Call it a third of a billion dollars raised this
quarter to do, in pieces, what this repo does in combination.

## Three findings that are actually new

**1. Governance flipped from tailwind to gold rush.** Three of the five
newest entrants are control/governance plays, not observability. 004
called governance the demand signal; 008 says it's now the *crowded
quadrant*. The differentiator stops being "we have governance" and becomes
"our governance is structural" — the gate refuses, the permissions narrow,
the receipts are the execution format. Bolted-on vs born-in remains the
pitch, but the bolt-on crowd just got funded.

**2. The substrate thesis has a commercial shadow.**
[Cosmos](https://techsy.io/en/blog/best-ai-agent-memory-tools) (Augment
Code, public preview May 2026) is "an agent operating system where
developers, agents, codebases, tools, and memory coexist." That is
[007](probability007.md)'s sentence with a pricing page. The difference is
the residence: theirs is a hosted platform, ours is a git repo. When the
substrate is a platform, leaving costs you your institution's memory. When
it's a repo, the exit is `git clone`. That's not a feature gap, it's a
philosophical fork — and it's defensible precisely because no venture
model wants to sell something a customer can walk away with.

**3. The marketplace arrived with a poison problem.**
[Agensi](https://www.agensi.io/learn/llm-skills-marketplace-next-app-store)
is selling skills — and the research wave behind it found
[26.1% of community skills contain vulnerabilities](https://arxiv.org/abs/2602.12430).
005's marketplace rung now exists in the wild, missing exactly the thing
this system gates on: **skills that carry and pass their own contracts**.
A library entry here cannot exist without surviving its tests; the version
file is the certificate. "Skills signed by their own tests" went from
design choice to market answer in one quarter.

## What didn't change

Nobody has the combination. Nobody is zero-server. Nobody's audit trail
*is* the execution format. And nobody else's whole loop — compile, gate,
deliver, replay, account — runs publicly for $2.05 lifetime on hardware
that crashes. The window 004 said was closing is closing on the *ideas*;
the working artifact keeps pulling ahead of its own description.

## What it means to do (settled with the user, same night)

From the twelve candidates the sweep produced, the cut for now:

1. **GitHub Actions pulse + stale-claim reaper** — the heartbeat moves
   onto GitHub's compute (laptop closed, system on duty; the substrate
   running inside its own medium) and learns to flag its own stranded
   work. Chosen first because it converts the system's biggest remaining
   dependency — a fragile laptop — into a footnote.
2. Receipts habit, Pages viewer, skill provenance, cost ledger, retrieval,
   multi-model Plant, stranger lane, cost expectation op, per-node
   contracts (issue #4 — the system's own proposal), and the recording —
   queued in that spirit, distribution artifacts prioritized as the field
   gets louder.

The strategic note to end on: this sweep took an hour and produced a
sharper roadmap than the first one, because now there's a running system
to hold the field against. Competitive analysis with receipts — that's
just provenance pointed outward.
