# Probability 003 — How It Evolves From Here

*Fable's read, 2026-06-10 — follow-up to [probability001](probability001.md)
("where does this go") and [probability002](probability002.md) ("how does it
reach other hands"). This one asks: what does the system itself become next?
Written hours after the real-stakes demo first ran clean.*

## The frontier has a name already

probability001 named it in passing and moved on: **valid ≠ correct, and the
run_js + judge loop is currently the only correctness check.** Everything
shipped since — versioning, permissions, lineage, replay — is *accountability*
machinery. It makes damage visible, attributable, and reversible. None of it
makes damage less likely. The demo proves you can recover from a bad version;
nothing yet prevents the bad version from shipping.

The evolution is one move: **graphs carry their own test suites, and
`save_graph` runs them before versioning.** A failing graph doesn't get a
version. That's it. Tests as a property of the graph, not of one workflow
that happens to contain `run_js`.

## What it does to the demo

Today's `demo_real_stakes.ts` beat 4 ships a sabotaged v2 that hardcodes the
target path. With a contract test attached — "writes to the path it was
asked" — that save is *refused at version time*. The demo's pitch upgrades
from "autonomy can recover from damage" to **"the substrate refuses to
version a change that breaks the tool's contract"** — prevention as the
first line, rollback demoted to backstop. Same loop, stronger story. (Keep
the damage beats by force-saving past the gate: now the demo shows both the
gate working and what happens when someone bypasses it.)

## What it unlocks: the compounding chain

The endgame probability001 picked — the skill library that compounds — has a
missing demonstration. The library has `load_graph` / `execute_graph`, Plant
sees the library in its prompt, but the actual chain has never run:

> Solve task A → save it as a **tested** skill → Plant composes skill A into
> task B's solution, unprompted → lineage shows B descending from A.

Untested skills can't compound — composing them just multiplies unverified
behavior. Tested skills can. Graph CI is the precondition; the chain demo is
the payoff, and it's the next milestone after the gate exists.

## Cheap insurance to take while passing

- **`specVersion` on SerializedGraph** — one line today, a migration story
  the day one other person has saved graphs (probability002 already called
  this).
- **Persist the runtime graph id back to source** — the known lineage gap;
  parentGraphId currently can point at an id that exists nowhere on disk.

## What not to build

- More substrate features — the roadmap is done; resist inventing a sequel.
- Canvas work — the feature war already declined in probability001.
- `run_js` hardening — real, but it's packaging-time work; it matters the
  moment strangers run graphs and not before.

## The one-line answer

Evolve from **"every action has receipts"** to **"every skill has a
contract"** — tests make versions trustworthy, trustworthy versions make the
library compound, and the compounding library is the endgame already chosen.
