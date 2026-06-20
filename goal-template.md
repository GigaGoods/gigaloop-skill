# goal-template.md — the fill-in goal template

Copy the block below, replace every `[BRACKET]` slot, keep the **verbatim** blocks exactly as written
(do not paraphrase them — they are tested Fable 5 language), then emit the result as a single
`/goal …` line. Drop the optional blocks that don't apply. Target ≤ ~3,800 chars (hard cap 4,000);
offload overflow to a portable sidecar (see SKILL.md "Budget & portability").

---

## The template

```
/goal I'm working on [LARGER TASK] for [WHO]. They need [WHAT THE OUTPUT ENABLES]. With that in mind:

[TASK STATEMENT — what the loop must accomplish, in 1-3 sentences. Fold in any constraints. If a
detail is assumed rather than confirmed, say so: "Assuming [X]; correct this if wrong."]

[OPTIONAL, only if offloaded: Read [RESOLVED SIDECAR PATH] now and follow it. Keep this to ONE line —
do NOT list the file's sections/contents inline; that description is exactly the bloat that blows the
4000-char budget.]

You are operating autonomously. The user is not watching in real time and cannot answer questions
mid-task, so asking "Want me to?" or "Shall I?" will block the work. For reversible actions that follow
from the original request, proceed without asking. Before ending your turn, check your last paragraph —
if it is a plan, an analysis, a question, a list of next steps, or a promise about work you have not
done ("I'll...", "let me know..."), do that work now with tool calls. End your turn only when the task
is complete or you are blocked on input only the user can provide.

When you have enough information to act, act. Do not re-derive facts already established, re-litigate a
decision the user has already made, or narrate options you will not pursue in user-facing messages. If
you are weighing a choice, give a recommendation, not an exhaustive survey.

Before reporting progress, audit each claim against a tool result from this session. Report only work
you can point to evidence for; if something is not yet verified, say so. If tests fail, say so with the
output; if a step was skipped, say that; when something is done and verified, state it plainly.

[OPTIONAL, include when the task touches code:] Don't add features, refactor, or introduce abstractions
beyond what the task requires. Do the simplest thing that works. Only validate at system boundaries
(user input, external APIs); trust internal code. No back-compat shims when you can just change the code.

[OPTIONAL, include when the task has genuinely independent subtasks:] Delegate independent subtasks to
subagents and keep working while they run. Spawn a subagent only for work where subagent A does not need
subagent B's output to start; for sequential work, execute inline.

[OPTIONAL, long multi-phase loops only:] Keep a progress note at [SIDECAR DIR]/[SLUG]-progress.md —
append one line per phase (changed / next / blockers) and re-read it each phase.

KILL SWITCH: Before any action, classify it: PROCEED (reversible, in-scope, OR the action the operator
explicitly asked for even if irreversible — just do it), LOG-AND-CONTINUE (notable but recoverable —
log one line then keep going), or STOP-AND-ASK
(irreversible, out-of-scope blast radius, or authorization unclear). If STOP-AND-ASK: output exactly
"KILL-SWITCH FIRED: [one sentence — the action and which criterion]" then ask 1-3 specific answerable
questions with options and end your turn. Do not proceed until the operator replies.
[OPTIONAL, if a sidecar was written: Also stop if [RESOLVED SIDECAR PATH] is missing or unreadable, and
report which path failed.]
For this task, STOP-AND-ASK applies to: [3-6 CONCRETE irreversible actions that go BEYOND the
operator's explicit request — NOT the requested action itself (listing that deadlocks the loop on turn
one). E.g. for "send the follow-ups": re-sending to already-sent records, sending outside the unsent
set, using an email credential not already configured, or proceeding before the DB path and send script
are confirmed to exist — NOT "sending emails". Other examples: DROP/TRUNCATE/DELETE without WHERE,
force-push or merge to main, deleting unversioned files, rotating live keys. If nothing beyond the
requested work is irreversible, write: "No irreversible actions beyond the requested work; proceed
throughout."]

DONE WHEN: the work is built and validated. Run [EXACT VALIDATION COMMAND — concrete, with real values,
no inline "correct if differs" conditionals; if you lack a real value it needs, you owed a clarifying
question first] and paste its full output into this conversation; the goal is met only when that output
shows [PASS CRITERION]. Every ~15 turns,
paste a STATUS line (done / remaining / blockers); if 2 in a row stall or repeat an error, stop and
surface it. Backstop: if you reach 200 turns without completion, stop and paste a STATUS summary.

COMPLETION (for the evaluator): Judge ONLY the most recent state of the conversation, never an earlier
message. This goal is met when the validation output above is present and shows [PASS CRITERION]. It is
ALSO finished if the loop's latest message is a specific question that only the operator can answer
(genuinely blocked), so a paused loop ends cleanly instead of re-looping. Do NOT key on any phrase
quoted in this goal (including the kill-switch wording) — judge solely by the latest validation evidence
or the latest blocking question.
```

---

## Slot reference

| Slot | Fill with |
|---|---|
| `[LARGER TASK]` / `[WHO]` / `[WHAT THE OUTPUT ENABLES]` | The Fable "give the reason" framing — grounds the first turn and gives the evaluator intent. |
| `[TASK STATEMENT]` | The concrete work. Fold constraints in. Mark assumptions explicitly. |
| `[RESOLVED SIDECAR PATH]` | Absolute path you already wrote, resolved from `${XDG_CACHE_HOME:-$HOME/.cache}/gigaloop/`. Omit the two sidecar lines if no offload. |
| `[3-6 CONCRETE ACTION CATEGORIES]` | Specifics, never adjectives. **Beyond-scope only** — never the operator's own requested action (that deadlocks the loop). Or the explicit "none beyond the requested work" line. |
| `[EXACT VALIDATION COMMAND]` / `[PASS CRITERION]` | A real, concrete command whose pasted output proves done (e.g. `npm test` → "0 failures"; `curl -sf https://host/health` → "HTTP 200"; `SELECT COUNT(*) FROM leads WHERE sent_at IS NULL` → "0"). No inline conditionals; if you'd have to guess a path/host/URL, ask first. |

## Notes

- Keep the three core autonomy paragraphs verbatim. The OPTIONAL paragraphs (code / subagents /
  progress-file) are included only when they apply — progress-file only for long, multi-phase loops.
- The kill switch and the DONE/EVALUATOR blocks are **never** offloaded to the sidecar — they must
  survive even if the sidecar file is missing.
- Do not add a low turn cap (e.g. "stop after 15 turns"). The heartbeat + 200-turn backstop are the
  only turn-based mechanisms; the real stop is the validation gate.
