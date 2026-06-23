# gigagoal

A Claude Code skill that turns "what you're trying to do" into **one copy-pasteable `/goal` line** — a completion condition for an autonomous, validation-gated loop.

You run `/gigagoal <task>`; it reads the conversation and emits a single `/goal …` line. You paste that into [`/goal`](https://code.claude.com/docs/en/goal) and Claude works toward it across turns until the condition is met.

## Why

Hand-written `/goal` conditions reliably omit three things, and each one breaks a long loop:

- **a kill switch** → the loop blows through an irreversible action (a real send, a prod restart);
- **a "paste the evidence" done condition** → the loop gets marked complete on unproven prose (the `/goal` evaluator reads only the transcript and runs no tools);
- **an autonomy block** → the loop stalls asking permission instead of working.

gigagoal never lets a goal ship missing them, and it adds a calibrated kill switch, a self-clearing completion clause, a one-shot character budget, and a stuck-loop circuit breaker.

## Install

Personal skill (all your projects):

```bash
git clone https://github.com/GigaGoods/gigagoal-skill ~/.claude/skills/gigagoal
```

Then invoke it in any Claude Code session with `/gigagoal`. (Claude Code watches `~/.claude/skills/` and picks it up without a restart.)

## Use

```
/gigagoal migrate the auth module to the new client and keep the tests green
```

It emits a `/goal` line you copy and run. Every generated goal contains: a context header, the verbatim autonomy block, a kill switch scoped to *beyond-scope* irreversible actions (never the action you asked for — that would deadlock the loop), a transcript-provable done condition, a heartbeat + circuit-breaker + 200-turn backstop, and a positive self-clearing completion clause.

If a goal needs heavy context, gigagoal offloads it to a sidecar file and references the path inside the goal, keeping the line under the 4000-char limit.

## Repo layout

| File | What it is |
|---|---|
| `SKILL.md` | The skill itself — procedure, checks, kill-switch tiers, budget rules. This is the canonical source. |
| `goal-template.md` | The fill-in template with the verbatim blocks gigagoal copies from. |
| `evals/lint.mjs` | **Goal linter** — mechanical checks on an emitted `/goal` (see below). |
| `evals/evals.json` | Behavioral scenario cases for the [skill-creator](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/skill-creator) plugin. |

## Check a goal (the linter)

The linter is the runnable harness. It mechanically verifies an emitted `/goal` — no LLM, no network:

```bash
node evals/lint.mjs path/to/goal.txt              # lint a goal file
pbpaste | node evals/lint.mjs                      # macOS clipboard (Linux: xclip -o | node evals/lint.mjs)
node evals/lint.mjs --self-test                    # GOOD fixture must PASS; BAD + OVERBUDGET must FAIL
GIGAGOAL_GOOD=my-good-goal.txt node evals/lint.mjs --self-test   # check against your own known-good goal
```

It checks: under the 4000-char cap, no trailing `Sidecar:` note, paste-the-evidence done condition, all three verbatim autonomy paragraphs, no self-blocking completion sentinel, kill switch present, no inline conditionals in the done block, no Fable-5 anti-patterns, and the circuit-breaker / heartbeat / backstop. Exit `0` = clean, `1` = at least one failure. The skill runs this same linter as a self-gate before it emits a goal.

## Cross-runtime portability

gigagoal follows the [agentskills.io](https://agentskills.io) standard and works across runtimes, but two pieces are Claude Code-specific and degrade gracefully elsewhere:

- The **dynamic context injection** in `SKILL.md` (cwd / branch / recent commits, via Claude Code's bang-backtick syntax) is Claude Code-only. Other runtimes (Codex CLI, Cursor, Copilot) silently skip it — the skill still works; the generated goal just won't have a pre-filled context header, so paste those values as `/gigagoal` args.
- `disable-model-invocation: true` is also Claude Code-only; runtimes that don't recognize the key ignore it safely.
- **Codex CLI `/goal`** uses the same architecture (verifiable condition + a separate evaluator model + loop-until-done), so gigagoal goals work there too — with one delta: Codex marks completion with an explicit `TASK_COMPLETE` token. gigagoal adds that automatically when targeting Codex (see "Targeting Codex's /goal" in `SKILL.md`); the kill switch, validation, autonomy, and budget are identical.

The linter (`evals/lint.mjs`) only needs Node and is fully cross-platform.

## License

MIT — see [LICENSE](LICENSE).
