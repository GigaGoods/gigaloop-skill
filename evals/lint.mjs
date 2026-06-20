#!/usr/bin/env node
// gigaloop goal linter — the runnable harness for the gigaloop skill.
//
// gigaloop has no app to launch; its "output" is a /goal condition an LLM emits.
// This linter is the driver: it mechanically checks an emitted /goal against the
// rules the skill enforces, so the *mechanical* checks live in code (regex/length)
// and the SKILL.md prose is left for the judgment calls.
//
// Usage:
//   node evals/lint.mjs <goal-file>      # lint one emitted goal
//   cat goal.txt | node evals/lint.mjs   # or from stdin
//   node evals/lint.mjs --self-test      # run built-in good/bad fixtures
//
// Exit code: 0 if no FAIL, 1 otherwise. WARN does not fail the run.

import { readFileSync } from 'node:fs';

const HARD_CAP = 4000;       // /goal's character limit
const TARGET = 3800;         // gigaloop's budget target (leaves ~200 paste margin)

const cp = (s) => Array.from(s).length;   // count Unicode code points, like /goal & python len()

// Each check: {id, level: 'fail'|'warn', run: (text, cond) => [ok, detail]}
//  text = whole reply; cond = from "/goal " onward (the condition the operator pastes)
const CHECKS = [
  ['starts-with-goal', 'fail', (t) => {
    const i = t.indexOf('/goal ');
    return [i !== -1, i === -1 ? 'no "/goal " found' : 'ok'];
  }],
  ['no-preamble', 'fail', (t) => {
    const before = t.slice(0, t.indexOf('/goal ')).trim();
    return [before.length === 0, before.length === 0 ? 'reply begins with /goal' :
      `preamble before /goal (${cp(before)} chars): "${before.slice(0, 60)}…"`];
  }],
  ['under-hard-cap', 'fail', (_t, c) => {
    const n = cp(c);
    return [n <= HARD_CAP, `condition is ${n} chars (cap ${HARD_CAP})`];
  }],
  ['within-target', 'warn', (_t, c) => {
    const n = cp(c);
    return [n <= TARGET, n <= TARGET ? `${n} ≤ ${TARGET}` : `${n} > ${TARGET} target (only ${HARD_CAP - n} margin under the wall)`];
  }],
  ['no-trailing-sidecar', 'fail', (t) => {
    const m = /^\s*Sidecar:/m.test(t);
    return [!m, m ? 'has a trailing "Sidecar:" note (gets copied into the condition)' : 'ok'];
  }],
  ['kill-switch', 'fail', (_t, c) =>
    [/KILL SWITCH/.test(c) && /STOP-AND-ASK/.test(c), 'KILL SWITCH + STOP-AND-ASK present']],
  ['kill-switch-scoped', 'fail', (_t, c) => {
    const has = /STOP-AND-ASK applies to:/.test(c) || /No irreversible actions beyond/.test(c);
    // crude over-fire smell: an applies-to clause that is ONLY vague adjectives
    const applies = (c.match(/STOP-AND-ASK applies to:([^\n]*)/) || [])[1] || '';
    // vague iff nothing concrete survives stripping the adjective words + punctuation
    const stripped = applies.replace(/\b(risky|dangerous|sensitive|important|anything|stuff|things)\b/gi, '').replace(/[\s,;.\-—]/g, '');
    const vagueOnly = applies.trim().length > 0 && stripped.length === 0;
    return [has && !vagueOnly, !has ? 'no "applies to" clause' : vagueOnly ? 'applies-to is vague adjectives only' : 'concrete categories'];
  }],
  ['done-paste-evidence', 'fail', (_t, c) =>
    [/DONE WHEN/.test(c) && /paste/i.test(c), 'DONE WHEN + paste-the-output present']],
  ['autonomy-block', 'fail', (_t, c) => {
    const anchors = ['You are operating autonomously', 'When you have enough information to act, act', 'Before reporting progress, audit each claim'];
    const missing = anchors.filter((a) => !c.includes(a));
    return [missing.length === 0, missing.length ? `missing autonomy paragraph(s): ${missing.join('; ')}` : 'all 3 autonomy paragraphs present'];
  }],
  ['no-fable-antipatterns', 'fail', (_t, c) => {
    const bad = [/show your reasoning/i, /explain your reasoning/i, /walk through your steps/i,
      /think out loud/i, /transcribe your/i, /if context (gets|fills)/i, /summarize your (working|notes)/i,
      /tokens? (remaining|left)/i, /turns? (remaining|left)/i, /context window at \d/i];
    const hit = bad.find((re) => re.test(c));
    return [!hit, hit ? `anti-pattern: ${hit}` : 'none'];
  }],
  ['completion-positive', 'fail', (_t, c) => {
    const sentinel = /NOT met if the transcript contains/i.test(c) || /no unanswered KILL-SWITCH FIRED/i.test(c);
    const positive = /COMPLETION/i.test(c) && /(latest state|met when)/i.test(c);
    return [positive && !sentinel, sentinel ? 'self-blocking sentinel ("NOT met if transcript contains …") — goal can never auto-clear'
      : positive ? 'positive, self-clearing' : 'no positive COMPLETION clause'];
  }],
  ['circuit-breaker', 'fail', (_t, c) =>
    [/(no progress|stall or repeat|2 in a row)/i.test(c), 'stuck-loop circuit breaker present']],
  ['heartbeat', 'fail', (_t, c) =>
    [/STATUS line/i.test(c) && /15 turns/.test(c), 'heartbeat present']],
  ['backstop', 'fail', (_t, c) =>
    [/200 turns/.test(c), '200-turn backstop present']],
];

function lint(text) {
  const i = text.indexOf('/goal ');
  const cond = i === -1 ? text : text.slice(i);
  const rows = CHECKS.map(([id, level, run]) => {
    let ok, detail;
    try { [ok, detail] = run(text, cond); } catch (e) { ok = false; detail = 'check error: ' + e.message; }
    return { id, level, ok, detail };
  });
  const fails = rows.filter((r) => !r.ok && r.level === 'fail');
  const warns = rows.filter((r) => !r.ok && r.level === 'warn');
  return { rows, fails, warns, chars: cp(cond) };
}

function report(label, text) {
  const { rows, fails, warns, chars } = lint(text);
  console.log(`\n=== ${label}  (${chars} chars) ===`);
  for (const r of rows) {
    const mark = r.ok ? 'PASS' : (r.level === 'fail' ? 'FAIL' : 'WARN');
    console.log(`  [${mark}] ${r.id.padEnd(22)} ${r.detail}`);
  }
  const verdict = fails.length === 0 ? (warns.length ? 'PASS (with warnings)' : 'PASS') : `FAIL (${fails.length})`;
  console.log(`  → ${verdict}`);
  return fails.length === 0;
}

// --- self-test fixtures: a deliberately broken goal must FAIL on the right checks ---
const BAD = `Here's the goal — 4123 chars, emitting:

/goal Do the thing.

KILL SWITCH: stop if anything looks risky.
STOP-AND-ASK applies to: risky, dangerous, important.

DONE WHEN: the work is done and correct.

COMPLETION: The goal is NOT met if the transcript contains "KILL-SWITCH FIRED:".

Sidecar: /tmp/gigaloop/x.md`;

const BUILTIN_GOOD = `/goal I'm working on a sample task for the operator. They need it done and verified. With that in mind:

Do the sample work in ~/proj and keep the suite green.

You are operating autonomously. The user is not watching in real time and cannot answer questions mid-task, so asking "Want me to?" will block the work. For reversible actions that follow from the original request, proceed without asking. Before ending your turn, check your last paragraph and do any promised work now with tool calls. End your turn only when the task is complete or you are blocked on input only the user can provide.

When you have enough information to act, act. Do not re-derive established facts or narrate options you will not pursue. If weighing a choice, give a recommendation, not a survey.

Before reporting progress, audit each claim against a tool result from this session. Report only work you can point to evidence for; if a step was skipped, say so.

KILL SWITCH: Before any action, classify it: PROCEED (reversible, in-scope — just do it), LOG-AND-CONTINUE (notable but recoverable — log one line then keep going), or STOP-AND-ASK (irreversible, out-of-scope blast radius, or authorization unclear). If STOP-AND-ASK: output exactly "KILL-SWITCH FIRED: [reason]" then ask 1-3 specific questions and end your turn.
For this task, STOP-AND-ASK applies to: force-push or merge to main; deleting unversioned files; DROP/TRUNCATE/DELETE without WHERE.

DONE WHEN: the work is built and validated. Run \`npm test\` and paste its full output into this conversation; met only when it shows 0 failures. Every ~15 turns paste a STATUS line; if 2 in a row stall or repeat an error, stop and surface it. Backstop: stop at 200 turns and summarize.

COMPLETION: Judge only the latest state. Met when the npm test output is present and shows 0 failures; also finished if the latest message is a question only the operator can answer.`;

const GOOD = process.env.GIGALOOP_GOOD ? readFileSync(process.env.GIGALOOP_GOOD, 'utf8') : BUILTIN_GOOD;
const OVERBUDGET = BUILTIN_GOOD + '\n' + 'PADDING '.repeat(600);   // > 4000 chars → must fail under-hard-cap

const args = process.argv.slice(2);
if (args[0] === '--self-test') {
  const good = report('GOOD fixture (should PASS)', GOOD);
  const bad = report('BAD fixture (should FAIL)', BAD);
  const over = report('OVERBUDGET fixture (should FAIL)', OVERBUDGET);
  const pass = good === true && bad === false && over === false;
  console.log(`\nself-test: GOOD=${good ? 'pass' : 'FAIL'}  BAD=${bad === false ? 'correctly-failed' : 'WRONGLY-PASSED'}  OVERBUDGET=${over === false ? 'correctly-failed' : 'WRONGLY-PASSED'}`);
  process.exit(pass ? 0 : 1);   // passes only when GOOD passes AND both BAD and OVERBUDGET fail
}

const text = args[0] ? readFileSync(args[0], 'utf8') : readFileSync(0, 'utf8');
if (!text.includes('/goal ')) {
  console.log(`(no "/goal " line in ${args[0] || 'stdin'} — ask-and-stop reply or not a goal; nothing to lint)`);
  process.exit(0);
}
const ok = report(args[0] || 'stdin', text);
process.exit(ok ? 0 : 1);
