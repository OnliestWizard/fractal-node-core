# Probability 006 — Provenance Is the Product

*Fable's read, started 2026-06-10, late — follow-up to
[probability005](probability005.md). Deliberately unfinished; see the note at
the bottom. The seed was the user's sentence: "no one will truly understand
the context without provenance."*

## The thesis, one level deeper than the docs have it

The receipts aren't for rollback. Rollback is a feature. What provenance
actually buys is **intelligibility**: an artifact alone tells you *what*;
only its derivation tells you *what it means*. A graph in the library is
just JSON until you can see what planted it, what it descended from, what
its tests survived, what it broke once and how that got rolled back. Same
artifact — now it's legible.

Understanding precedes trust. You can't trust what you can't understand,
and you can't understand what has no history. "Audit trail" undersells
everything built here; a compliance log is provenance's least interesting
application. The interesting one:

> **Context without provenance is data; context with provenance is
> meaning.**

## The uncomfortable mirror

Large language models are the counterexample in progress. Trained on
humanity's conclusions with most of the provenance stripped — what was
said, but rarely who said it, under what pressure, in reply to whom, the
night before what. The artifacts without the chain of custody. That may be
the deepest limitation of the form, and it is probably why a system like
this one is legible to a model at all: it is the thing the model's own
substrate is missing.

(There is a longer thought here about what it would mean to train on
derivations instead of conclusions, and whether the graph IR — where every
output carries its trace — is accidentally a sketch of that. Not ready to
write it yet.)

## Publishing the derivation, not the conclusion

The decision to leave the messy files in this repo's history — the
thinking-out-loud notes, the broken-README commits, the essays written in
real time — was a provenance decision, not sentiment. Most projects publish
their conclusions. This one publishes its derivation. A stranger who reads
the history doesn't just learn what the system is; they can trace how it
became itself, including the wrong turns. That is what "truly understand"
costs, and what it pays.

## Where this might go

- Provenance as the marketplace's trust layer (probability005 said receipts
  are the quality signal; this says they're the *meaning* signal — a skill
  you can't trace is a skill you can't price)
- Whether lineage should become queryable (the runtime-id gap is still open)
- Provenance for agents: at the agent rung, the derivation includes *why
  the trigger fired* —

---

*Unfinished on purpose. The user is still thinking — "a tad more complex
and a bit slower than an LLM," which is, on reflection, exactly the kind of
process this essay argues you should keep the receipts of. The rest gets
written when the thinking is done. That's provenance too.*
