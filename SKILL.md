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
3. **DRAFT** — copy `goal-template.md` and fill **every** REQUIRED slot. Never drop one.
4. **CHECK** — run the checks below; fix any failure before emitting.
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

## Budget & portability

Keep the **`/goal` condition text** (everything after `/goal `) **≤4000 chars** — the cap is on the condition, not your whole turn. If task context (schemas, long criteria, docs) would blow the budget, offload it: resolve a dir at runtime — `${XDG_CACHE_HOME:-$HOME/.cache}/gigaloop/`, fallback `${TMPDIR:-/tmp}/gigaloop/` — `mkdir -p`, write `<slug>-<timestamp>.md`, then in the goal add "Read `<resolved path>` now" plus, in the kill switch, "stop if that file is missing." **Never** hardcode a user-specific absolute path — it must publish and run on any machine. Never offload the kill switch, done condition, or autonomy block.

## The checks (all must pass before EMIT)

1. Kill switch names concrete categories (or explicit "none expected").
2. Done condition names an exact command **and** says "paste the output."
3. Autonomy block present, verbatim.
4. No Fable anti-patterns: no "show/explain your reasoning", no token/turn countdown, no "summarize if context fills up", kill switch is not a vague adjective.
5. ≤4000 chars (offload overflow to a portable sidecar).
6. Emitted message is the `/goal` line only (no INGEST/CLARIFY preamble), produced **now** — not promised for later. (Exception: the no-task and irreversible-target cases correctly end the turn on picker questions instead.)
7. Kill switch does **not** list the operator's own requested action (that would deadlock the loop); it lists only beyond-scope irreversible actions.

**REQUIRED:** copy the fill-in template and verbatim blocks from `goal-template.md`.
