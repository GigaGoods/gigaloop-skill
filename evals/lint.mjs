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
    const vagueOnly = applies && /^[\s,;]*((risky|dangerous|sensitive|important|anything)[\s,;]*)+$/i.test(applies);
    return [has && !vagueOnly, !has ? 'no "applies to" clause' : vagueOnly ? 'applies-to is vague adjectives only' : 'concrete categories'];
  }],
  ['done-paste-evidence', 'fail', (_t, c) =>
    [/DONE WHEN/.test(c) && /paste/i.test(c), 'DONE WHEN + paste-the-output present']],
  ['autonomy-block', 'fail', (_t, c) =>
    [/You are operating autonomously\./.test(c), 'verbatim autonomy anchor present']],
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
  ['circuit-breaker', 'warn', (_t, c) =>
    [/(no progress|stall or repeat|2 in a row)/i.test(c), 'stuck-loop circuit breaker present']],
  ['heartbeat', 'warn', (_t, c) =>
    [/STATUS line/i.test(c) && /15 turns/.test(c), 'heartbeat present']],
  ['backstop', 'warn', (_t, c) =>
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

const args = process.argv.slice(2);
if (args[0] === '--self-test') {
  const okGood = process.env.GIGALOOP_GOOD ? report('GOOD fixture', readFileSync(process.env.GIGALOOP_GOOD, 'utf8')) : true;
  const okBad = report('BAD fixture (should FAIL)', BAD);
  process.exit(okBad === false ? 0 : 1);   // self-test passes when the bad fixture correctly FAILS
}

const text = args[0] ? readFileSync(args[0], 'utf8') : readFileSync(0, 'utf8');
const ok = report(args[0] || 'stdin', text);
process.exit(ok ? 0 : 1);
