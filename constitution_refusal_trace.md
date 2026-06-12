# Trace replay — playground_writer (library)

**22 events · 10 nodes completed · 1 error · recorded span 16ms**

## Inputs

```json
{
  "path": "README.md",
  "content": "# Plant_Playground\n\nThe sandbox **world** of [fractal-node-core](https://github.com/OnliestWizard/fractal-node-core) —\na graph execution engine whose LLM-designed, contract-tested graphs do their\nreal work here. This repo is the system's persistent memory: every issue,\ncommit, and file is something the system did, proposed, or was asked to do.\n\n**Start with the garden report: [STATUS.md](STATUS.md)** — regenerated from\nthe skill library on disk. Nothing in it is hand-maintained.\n\n- `planted/` — artifacts delivered by graphs (code, docs, haikus)\n- `proposals/` — features the system proposed for itself, linked to their issues\n- `probes/` — where contract tests are allowed to have side effects\n- **Issues** — the work queue: specs go in, evidence comes back as comments.\n  A GitHub Actions pulse sweeps it unattended; `plant:*` labels are the\n  state machine.\n\nHumans decide; the system proposes and delivers, with receipts. The\nunattended lane runs under a\n[constitution](https://github.com/OnliestWizard/fractal-node-core/blob/main/CONSTITUTION.md):\nthis README, the workflows, and the law itself are human-only territory —\nthe system's own tool pool refuses to write here, before the request ever\nreaches the network.\n\n(Yes, this README has been clobbered before — by a deliberately sabotaged\ngraph in a demo, then repaired by the rolled-back version of the same tool.\nThat was the point. It can't happen unattended anymore; a
… (302 chars truncated)
```

## Timeline

```
▶ $input
✓ $input (1ms)
▶ owner_const
✓ owner_const (<1ms)
▶ repo_const
✓ repo_const (<1ms)
▶ key1_const
✓ key1_const (<1ms)
▶ key2_const
✓ key2_const (<1ms)
▶ key3_const
✓ key3_const (<1ms)
▶ key4_const
✓ key4_const (1ms)
▶ key5_const
✓ key5_const (<1ms)
▶ key6_const
✓ key6_const (<1ms)
▶ params_pack
✓ params_pack (3ms)
▶ playground_create_or_update_file
✗ playground_create_or_update_file (4ms) — Error: path "README.md" blocked by constitution — the front door — clobbered once already by the sabotage demo (2026-06-10); the unattended lane doesn't get a second chance
```

## Errors

- `playground_create_or_update_file` — Error: path "README.md" blocked by constitution — the front door — clobbered once already by the sabotage demo (2026-06-10); the unattended lane doesn't get a second chance

---

*Rendered by trace-markdown from `constitution_refusal_trace.json`. The timeline above replays the recorded execution — it is the trace, not a description of it.*
