# Constitution — human-only territory in the unattended lane

`allowedTools` governs which **tools** a graph may call. The constitution
governs which **territory** those tools may touch. It applies to the
unattended lane (sweep, pulse) — when a human runs a graph by hand, the
human *is* the authority and no law applies.

The machine-readable law is [`constitution.json`](constitution.json); this
file is its human-readable form. Every rule carries its reason — receipts
apply to law too.

## Protected territories (in the sandbox repo)

| Territory | Why |
|---|---|
| `.github/**` | The heartbeat. Workflows and CODEOWNERS are law, not territory — an agent that can edit its own cron can grant itself time. |
| `README.md` | The front door. Clobbered once already by the sabotage demo (2026-06-10); the unattended lane doesn't get a second chance. |
| `constitution.json`, `CONSTITUTION.md` | The law may not amend itself. |

Everything else the write token can reach — `planted/**`, `proposals/**`,
`probes/**`, `STATUS.md` — is working territory, deliberately free.

## Enforcement layers, outermost first

1. **The token split** (the outer wall): the agent's write PAT reaches only
   the sandbox repo. The core repo — engine, law, essays — is unreachable
   by construction. The constitution cannot be amended by the governed.
2. **The engine rail** (structural): `lib/constitution.ts` wraps the MCP
   pool, so every tool call in the whole nested execution — skills,
   routers, agent loops — passes the law before it reaches the network. A
   refused write never spawns the server. Properties with teeth: a
   *corrupt* `constitution.json` refuses to run rather than failing open,
   and a guarded tool call carrying no readable path is refused (fail
   closed — territory the law can't see is not territory outside the law).
3. **CODEOWNERS** (declarative): `.github/CODEOWNERS` names the owner for
   every path, so any PR-lane change to law requires the named human.
4. **Push ruleset** (optional, the user's button): for substrate-level
   enforcement on the sandbox repo itself — Settings → Rules → Rulesets →
   New push ruleset → restrict file paths `.github/**` — GitHub then
   refuses pushes touching those paths regardless of what any token wants.
   Honest caveat: the agent authenticates with the owner's PAT, so GitHub
   cannot tell agent from owner; a bypass for the owner is a bypass for
   the agent. The engine rail above is the layer that actually
   distinguishes them.

## Amendment

A human edits `constitution.json` by hand, in this repo, and commits it.
There is no API, no builtin, and no graph that can do it — that absence is
the design.
