# Probability 002 — How This Becomes a Product for Others

*Fable's read, 2026-06-09 — follow-up to [probability001](probability001.md),
which asked "where does this go"; this asks "how does it get into someone
else's hands."*

## The form-factor question comes first

There are three realistic shapes, and the answer is library-first, not SaaS:

1. **An npm package / SDK** — "the trust substrate as a dependency." Someone
   building agents installs it and gets versioning, lineage, allowedTools,
   and replay around *their* graphs. The cheapest path to other people's
   hands, and it matches what the system actually is: a substrate, not an
   app.
2. **A hosted service** — multi-tenant, accounts, billing. The endgame from
   probability001, but the most expensive shape. For a solo project it's
   premature: time goes to auth and tenancy instead of the thing that's
   differentiated.
3. **An MCP server** — the sleeper option. Wrap `plant` / `execute` /
   `replay` / `rollback` as MCP tools and anyone running Claude Code or any
   MCP client can use the substrate from inside the agent they already have.
   Zero UI to build, and the distribution channel (MCP server directories)
   already exists. Thematically perfect, too: the agent gets a place to
   compile and govern its own skills.

**The pragmatic sequence is 1 + 3:** extract the core as a clean package,
put an MCP server on top as the front door.

## What actually changes when others touch it

Three things probability001 doesn't fully name:

- **The graph format becomes a public contract.** Right now the IR can
  change whenever. The moment one other person has saved graphs, the spec
  needs a version field and a migration story. Cheap to add now, painful to
  add later.
- **`run_js` becomes a security boundary instead of a convenience.**
  LLM-authored JavaScript executing on my machine is my risk to take;
  executing on someone else's machine, it's their threat model. The sandbox
  story (isolated-vm, deno-style permissions, or "run_js graphs are opt-in")
  is probably the single biggest piece of real engineering between here and
  "others."
- **Bring-your-own-keys.** Plant's reasoning costs money; users plug in
  their own model keys from day one, or you're subsidizing strangers.

## The marketing is already written

The "Script it" item in probability001 is literally step zero of
productization. The self-demoing graph isn't just a flex — for an
open-source library, **the demo is the distribution**. People share the
five-minute "it built a tool, broke it, rolled back, and replayed the
damage" recording, and that's how the first ten users find it.

## The one-line answer

It becomes a product for others by **shrinking, not growing** — package the
substrate, expose it over MCP, harden `run_js`, freeze the graph spec, and
let the self-demo do the selling. The SaaS and marketplace versions only
make sense after strangers are already saving graphs.
