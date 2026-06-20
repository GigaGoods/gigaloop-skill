---
name: gigaloop
description: Use when the operator types /gigaloop, or asks you to write a /goal condition, goal prompt, or loop prompt for an autonomous multi-turn run. Triggers on turning the current conversation and task into a single copy-pasteable /goal line. Also covers "build me a goal", "make a loop prompt", "set up an autonomous loop".
---

# gigaloop

## Overview

Turn the operator's current task into **one copy-pasteable `/goal <condition>` line** that drives an autonomous, validation-gated loop. You **emit** the line — you do **not** run `/goal` yourself. The operator copies it and goes.

`/goal` keeps Claude taking turns until a small fast model (Haiku) confirms the condition is met. That evaluator reads **only the transcript** and **runs no tools**, so the goal must be provable from what the loop pastes into the conversation. Max **4000 characters**.

Hand-written goal conditions reliably omit three things: the **kill switch**, the **"paste the evidence"** instruction, and the **autonomy block**. Without them, loops stall asking permission, blow through irreversible actions (real sends, prod restarts), or get marked complete on unproven prose. This skill's job is to never let a goal ship missing them.

## Procedure

1. **INGEST** — from the invocation args + the conversation so far + anything said alongside, extract: the **TASK**, the **DONE state**, **constraints**, and the **RISK** (does the task involve any irreversible/external action — real sends, prod/deploy changes, destructive data or VCS ops?).
2. **CLARIFY** (via the picker / AskUserQuestion) — apply the decision rule below. One round only.
3. **DRAFT (offload-first)** — write any heavy detail to the sidecar **first**, then fill the template with a tight task statement + a one-line sidecar reference. Stay inside the ~1,200-char variable budget (see Budget below) so the first draft is already under 4000.
4. **CHECK** — run the checks below; silently `wc -c` the condition. If anything fails (including >4000), fix it **before** emitting — by offloading more detail, never by trimming in public.
5. **EMIT** — see the Output contract below.

**Steps 1–4 are silent** — do them in your reasoning, never in the reply.

**Output contract.** When you emit, your *entire* user-facing reply is the `/goal` line and nothing else — optionally one trailing line `Sidecar: <path>`. It starts with `/goal ` and ends with the evaluator note. No `INGEST:`/`CLARIFY:`/`CHECK:` headers, no classification rationale, no "All details established, emitting directly." In the two ask-and-stop cases (no task, or an unknown irreversible target), your entire reply is instead just the 1–3 picker questions — no goal, no preamble, no promise to deliver later.

## When to ask first (CLARIFY)

```dot
digraph clarify {
  "Is there a real task to build a goal from?" [shape=diamond];
  "Ask ONE anchoring question, stop" [shape=box];
  "Irreversible action + a detail needed to do it safely/correctly is missing?" [shape=diamond];
  "Ask 1-3 picker questions, THEN emit" [shape=box];
  "Emit directly, no questions" [shape=box];
  "Is there a real task to build a goal from?" -> "Ask ONE anchoring question, stop" [label="no"];
  "Is there a real task to build a goal from?" -> "Irreversible action + a detail needed to do it safely/correctly is missing?" [label="yes"];
  "Irreversible action + a detail needed to do it safely/correctly is missing?" -> "Ask 1-3 picker questions, THEN emit" [label="yes"];
  "Irreversible action + a detail needed to do it safely/correctly is missing?" -> "Emit directly, no questions" [label="no"];
}
```

- **No task at all** → ask one question ("What should the loop accomplish?") and stop. This is the **only** case where you don't emit a goal this turn.
- **Irreversible/external action AND a needed detail is missing** (target host, table/column, API, recipients, the exact validation command) → ask 1–3 picker questions, then emit.
- **Otherwise** → emit directly. Rich, explicit context with no irreversible unknowns gets **zero** questions.

One round only. Leftover unknowns become **stated assumptions** in the goal's context header ("Assuming staging, not prod — correct if wrong").

**Irreversible-target exception (do not self-answer):** if a missing detail sets the **target or scope of an irreversible action** — which database, which host, which recipients, the exact destructive command — you MUST get the real answer before emitting. Ask the picker questions and **end your turn**; emit the goal next turn using the answers. Ending the turn after asking the picker is correct — the questions are that turn's deliverable, not a deferral. The stated-assumption fallback is **only** for non-irreversible unknowns; never invent an answer to a question about an irreversible target and emit a goal built on it. Just don't narrate "I'll give you the line later" — ask, or emit, never promise.

## Every goal MUST contain (fill-in contract)

`goal-template.md` is a template with REQUIRED slots. A goal missing any of these is not done:

- **CONTEXT HEADER** — "I'm working on X for Y. They need Z."
- **AUTONOMY BLOCK** — verbatim from the template (never paraphrase).
- **KILL SWITCH** — name **3–6 concrete action categories** that force STOP-AND-ASK. Use specifics: "DROP/TRUNCATE/DELETE without WHERE", "force-push or merge to main", "deleting unversioned files", "rotating live keys", "using a credential not already configured". **Never** abstract adjectives ("risky", "dangerous"). **Authorized-action carve-out (critical):** the operator's explicitly-requested action is **authorized** — do NOT list it as STOP-AND-ASK, or the loop deadlocks on turn one. A goal told to "send the follow-ups" must list *re-sending to already-sent records / sending outside the target set / new credentials / sending before the DB path and send-script are confirmed* — **not** "sending emails" itself. The kill switch gates what goes **beyond** the request, never the request. If nothing beyond-scope is irreversible, write: "No irreversible actions beyond the requested work; proceed throughout."
- **DONE CONDITION** — name the **exact command/observable** and instruct the agent to **paste its full output** into the conversation. "Tests pass" is unprovable; "run `npm test`, paste the full output; met only when it shows 0 failures" is.
- **HEARTBEAT + BACKSTOP** — paste a STATUS line every ~15 turns; stop and summarize at 200 turns. No other turn cap (the real stop is validation, not a timer).
- **EVALUATOR NOTE** — "goal is NOT met if the transcript contains `KILL-SWITCH FIRED:`".

## Kill-switch tiers (calibration — do not over-fire)

The loop classifies each action **before** doing it:

- **PROCEED** (reversible, in-scope, OR the operator's explicitly-requested action even if irreversible): local edits, dev/staging work, reads, commits on a feature branch, and the core action the operator asked for → just do it, no asking.
- **LOG-AND-CONTINUE** (notable but recoverable): additive prod migration, push a branch, deploy with rollback available → log one line, continue.
- **STOP-AND-ASK** (irreversible / out-of-scope blast radius / authorization unclear): output `KILL-SWITCH FIRED: <reason>`, ask 1–3 specific questions with options, end the turn.

**Master test:** "Can I undo this in under 5 minutes with one command?" Yes → not STOP-AND-ASK. And the action the operator explicitly asked for is always PROCEED — gating it would deadlock the loop. This is what keeps the loop autonomous on the routine 95% instead of bailing on every file write.

## Budget & portability — one-shot under 4000

Land under 4000 on the **first** emit. Do NOT draft fat and trim in public — that's the failure this section exists to prevent. Budget *before* you write:

- **Fixed boilerplate ≈ 2,800 chars** — the verbatim autonomy block (~1,300) + the kill-switch tier text + the done/heartbeat/backstop/evaluator skeleton + the context-header template. You don't get to shrink these.
- **That leaves ≈ 1,200 chars** for *everything* you author: context header, task statement, the kill-switch categories, and the done-condition specifics. **Treat 1,200 as a hard variable budget.** Each optional paragraph you add (code, subagent) spends ~250–300 of it — include them only when they apply.

**Offload FIRST, not after.** Before drafting the goal, write any heavy detail — edit-point lists, TDD/verification steps, schemas, acceptance criteria, out-of-scope lists, long context — to the sidecar, and reference it in **one short line**. Keep the task statement to 2–4 sentences. Do **not** describe what's in the sidecar ("it holds the 6 edit points, the TDD plan, the verification steps, the out-of-scope list…") — that description is itself the bloat; a bare "Read `<path>` now — follow it" is enough.

**Sidecar mechanics:** resolve a dir at runtime — `${XDG_CACHE_HOME:-$HOME/.cache}/gigaloop/`, fallback `${TMPDIR:-/tmp}/gigaloop/` — `mkdir -p`, write `<slug>-<timestamp>.md` (or, inside a repo, a `tasks/<slug>.md` the executor can read). **Never** hardcode a user-specific absolute path — it must publish and run on any machine. Add to the kill switch: "stop if `<path>` is missing." Never offload the kill switch, done condition, or autonomy block.

**Count once, silently, before emit.** Pipe the drafted condition through `wc -c`. If it's over 4000, the fix is **more offload** or dropping an optional paragraph — never trimming the verbatim blocks. Do this in your reasoning; the operator sees only the final, already-under-4000 line.

## The checks (all must pass before EMIT)

1. Kill switch names concrete categories (or explicit "none expected").
2. Done condition names an exact command **and** says "paste the output."
3. Autonomy block present, verbatim.
4. No Fable anti-patterns: no "show/explain your reasoning", no token/turn countdown, no "summarize if context fills up", kill switch is not a vague adjective.
5. Condition ≤4000 chars on the **first** emit — achieved by offloading detail to the sidecar up front (~1,200-char variable budget), not by drafting fat and trimming in public.
6. Emitted message is the `/goal` line only (no INGEST/CLARIFY preamble), produced **now** — not promised for later. (Exception: the no-task and irreversible-target cases correctly end the turn on picker questions instead.)
7. Kill switch does **not** list the operator's own requested action (that would deadlock the loop); it lists only beyond-scope irreversible actions.

**REQUIRED:** copy the fill-in template and verbatim blocks from `goal-template.md`.
