# fractal-node-core

**Autonomy with receipts.** A graph execution engine where an LLM designs the
graphs, the graphs are values — versioned, permissioned, contract-tested,
replayable — and every action the system takes can be audited, rolled back,
and watched again.

Expensive reasoning happens once, at compile time: GPT-4o designs a typed
JSON graph from a sentence. After that the graph executes deterministically,
forever, for free. The system can save its own graphs as skills, test them
before versioning, and compose them into bigger skills — it grows a library.

## Two demos, one command each

**The real-stakes loop** — the system designs a GitHub-writing tool, tests
it, versions it; a sabotaged change does real damage to a real repo; one
call rolls back; the damage replays from the trace; the restored tool
repairs it.

```bash
npx tsx demo_real_stakes.ts
```

**The compounding chain** — the system designs a skill, saves it through a
contract-test gate, then receives a task that never mentions the library —
and composes its own saved skills to solve it. Ends with a haiku on GitHub
written through two layers of self-authored composition.

```bash
npx tsx demo_compounding_chain.ts
```

## Why this is different

Most agent systems re-reason on every run and leave no usable evidence
behind. Here the unit of work is an inspectable artifact with governance
built into the substrate, not bolted on outside:

| Receipt | What it gives you |
|---|---|
| **Versioning** | every `save_graph` is content-hashed history; rollback is one call |
| **Contract tests** | a graph carries its own test suite; `save_graph` runs it and *refuses to version a failing graph* |
| **Permissions** | `allowedTools` threads as a stack of sets — nesting only narrows, never widens; skills gate by name |
| **Lineage** | graphs spawned by graphs carry `parentGraphId` |
| **Replay** | any trace replays as synthetic events, at recorded pace — watch a past run without re-executing |
| **Paper dashboard** | traces render to committed markdown receipts; `STATUS.md` regenerates from the library itself — GitHub is the UI, zero servers |

And the fractal property: a node's subgraph is the same type as the graph it
lives in. A saved skill **is a node** — name it in any graph and it executes
as a child, lineage stamped, permissions inherited. The `plant` node designs
new graphs at runtime, so graphs grow graphs.

## Quickstart

```bash
git clone https://github.com/OnliestWizard/fractal-node-core
cd fractal-node-core && npm install
cp .env.example .env.local   # then fill it in — see the comments there

npm test            # 240+ tests, no API keys needed
npm run typecheck

# design a graph from a sentence (needs OPENAI_API_KEY)
npx tsx run_plant.ts "fetch a URL and summarize it" --out graph.json

# create inputs.json supplying the graph's $input ports — for the task above:
#   { "url": "https://en.wikipedia.org/wiki/Haiku" }
npx tsx run_execute.ts --graph graph.json --inputs-file inputs.json --out trace.json

# replay the trace at recorded pace, or render it as a markdown receipt
npx tsx run_replay.ts --trace trace.json --speed 1
npx tsx render_trace.ts --trace trace.json

# regenerate the library's front page (--push commits it to the sandbox repo)
npx tsx generate_status.ts
```

For the GitHub demos you need a **sandbox repo you own** (the demos write
real commits to it, deliberately) and two fine-grained PATs — read-wide,
write-narrow. `.env.example` walks through it.

There's also an execution server (`npm run server`: validate / execute with
SSE streaming / plant / replay) and a visual editor (`cd editor && npm run
dev`) that renders graphs on a canvas and animates runs live.

## How it works

```
"do X" ──► lib/plant.ts (GPT-4o, self-correcting against the validator)
                │
                ▼
        SerializedGraph — pure JSON: typed ports, edges, subgraphs,
                │         contract tests, lineage ids
                ▼
        lib/execute-engine.ts — topological execution, parallel where
                │         independent; forEach/while/retry/router/agent
                │         nodes; MCP tools; library skills as nodes;
                │         permission gating; event stream
                ▼
        graphs/ library — versioned history under .versions/, gated by
                          the graph's own contract tests
```

- `core/` — types, validator, serializer, the legacy registry executor and
  emit pipeline
- `lib/` — the canonical engine, Plant compiler, MCP pool, graph store,
  replay, contract-test runner, trace→markdown renderer, status report
- `examples/` — runnable graph JSONs (routers, agents, meta-graphs, the
  self-improvement loop)
- `PROBABILITY.md` — master index of the strategy series; `probability001-007.md`
  are the essays themselves, written in real time as the system was built
- `sessionstate.md` — the unedited build log

MCP servers are configured in `mcp.json` — secret-free; `${VAR}` references
resolve from `.env.local` at connect time. Ships wired for filesystem +
GitHub (the GitHub entry appears twice on purpose: one read-only token for
all repos, one write token scoped to the sandbox).

## Emitters

The same graph JSON also emits native code — JS (ES modules), Kotlin
(`suspend fun`), Swift (`async throws`) — with platform-appropriate I/O.
LLM/agent nodes emit stubs; deterministic logic ports cleanly. This is the
least-developed direction of the project, kept because the IR makes it
nearly free.

## Honest status

Solo project, moving fast. Things to know before you rely on it:

- `run_js` executes LLM-generated code in a Node `vm` context — that is a
  convenience, **not a security boundary**. Don't run untrusted graphs.
- Plant currently speaks OpenAI (gpt-4o family); the engine itself is
  model-agnostic.
- The graph spec carries `specVersion: "1"` — breaking changes will bump it
  with a migration story.
- Built and tested on Windows + Node 22; nothing intentionally
  platform-specific outside the docs.
