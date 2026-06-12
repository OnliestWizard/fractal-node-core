# Margins — annotations on history

**2 notes on 1 commit** · rendered 2026-06-12 10:40 UTC

Notes attach to commits after the fact without changing their hashes — the now
comments on the then without overwriting it. Canonical store: `refs/notes/plant`
(git notes); GitHub no longer displays notes, so this file is the rendered
surface. Regenerate with `npx tsx annotate.ts --render`.

## `188881f` lychee — 2026-06-10

- **correction** (2026-06-12 10:21, OnliestWizard) — re `graphs/haiku_writer.json`: This version's contract was only 'haiku exists' — it let a 2KB recursion essay ship as a haiku. Corrected in salak (df16d03): expectation ops lineCount=3 + maxLength=120, re-gated live. First demonstration of valid-vs-correct in the library.
- **forensics** (2026-06-12 10:39, OnliestWizard) — re `graphs/haiku_writer.json`: bisect: first version that passes today's contract tests — 2 probes over 2 candidates.

---

*Generated from the notes ref. The history these notes describe is immutable; the margins are not.*
