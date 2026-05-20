#!/usr/bin/env node
/* =============================================================
 * RTS test suite — round-trip and snapshot tests.
 *
 * Runs with: node tests/rts-tests.js
 *
 * Why these tests exist:
 *   The Builder generates statement strings; the Validator parses
 *   them. Historically the two have drifted (e.g. a missing comma
 *   in the Validator's regex caused the Validator to flag the
 *   Builder's own standard wording as non-conforming). Round-trip
 *   tests guard against that whole class of bug.
 *
 * What's tested:
 *   1. The shared YAML config parses cleanly.
 *   2. Builder output for a representative set of state objects
 *      matches a snapshot (changes show up as a clear diff).
 *   3. Every builder snapshot, fed back through the Validator's
 *      template-matching logic, lands in 'exact', 'pattern' or
 *      'author' status — never 'non'.
 *   4. The standard preregistration timing phrases (including the
 *      comma-bearing ones) all validate.
 *
 * Dependencies:
 *   - node (>=20)
 *   - python3 with PyYAML (used to parse the YAML config so this
 *     suite doesn't need npm packages installed)
 * ============================================================= */

const fs        = require('fs');
const path      = require('path');
const { execSync } = require('child_process');

// Tiny test runner — keeps the dependency surface to zero.
let _passed = 0, _failed = 0;
const _failures = [];
function test(name, fn) {
  try {
    fn();
    _passed++;
    process.stdout.write('.');
  } catch (e) {
    _failed++;
    _failures.push({ name, error: e });
    process.stdout.write('F');
  }
}
function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || 'eq failed') + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   ' + JSON.stringify(actual));
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

// =============================================================
// Load shared modules (utils + the YAML payload from rts-config.js).
// rts-utils.js publishes onto globalThis, so we just require() it.
// =============================================================
const ROOT      = path.resolve(__dirname, '..');
require(path.join(ROOT, 'rts-config.js'));
const RTS = require(path.join(ROOT, 'rts-utils.js'));

// Parse the YAML via python3 (avoids needing js-yaml installed).
// We pipe the YAML through stdin so we don't need to write a temp
// file (which can fail in restricted-permission environments).
function loadConfig() {
  const yaml = globalThis.RTS_CONFIG_YAML;
  const json = execSync(
    `python3 -c "import yaml,json,sys; print(json.dumps(yaml.safe_load(sys.stdin.read())))"`,
    { input: yaml, encoding: 'utf8' }
  );
  return JSON.parse(json);
}

const cfgRaw = loadConfig();

// =============================================================
// Helpers — minimal inlining of the Builder's statement-construction
// so the test doesn't have to spin up a DOM. Mirrors applyBuilder /
// applyTemplate / formatSentenceFragment in rts-builder.html.
// =============================================================
function placeholderText(question) {
  if (!question) return '[authors to provide info]';
  if (question.placeholder_full)    return '[' + question.placeholder_full + ']';
  if (question.friendly_placeholder) return '[authors to provide ' + question.friendly_placeholder + ']';
  if (question.type === 'url')      return '[authors to provide link]';
  if (question.type === 'textarea') return '[authors to provide details]';
  if (question.type === 'text')     return '[authors to provide info]';
  return '[authors to provide info]';
}

function formatSentenceFragment(text) {
  let out = text.replace(/\.\s*$/, '');
  if (out.length >= 1 && /[A-Z]/.test(out[0]) && (out.length < 2 || !/[A-Z]/.test(out[1]))) {
    out = out[0].toLowerCase() + out.slice(1);
  }
  return out;
}

function applyTemplate(tpl, sectState, questions) {
  questions = questions || {};
  Object.keys(questions).forEach(qid => {
    if (!questions[qid]?.optional) return;
    const v = sectState[qid];
    const isBlank = (v === undefined || v === null || (typeof v === 'string' && !v.trim()));
    if (isBlank) {
      const re = new RegExp(' \\([^)]*\\{' + qid + '\\}[^)]*\\)', 'g');
      tpl = tpl.replace(re, '');
    }
  });
  return tpl.replace(/\{(\w+)\}/g, (_m, qid) => {
    let v = sectState[qid];
    const q = questions[qid];
    if (v === undefined || v === null) return placeholderText(q);
    if (typeof v === 'string') {
      v = v.trim();
      if (!v) return placeholderText(q);
      if (q?.sentence_fragment) v = formatSentenceFragment(v);
      return v;
    }
    return placeholderText(q);
  });
}

function applyBuilder(builder, sectState, questions) {
  questions = questions || {};
  if (!builder) return null;
  if (builder.type === 'static_text') return builder.text || null;
  if (builder.type === 'branch') {
    const v = sectState[builder.branch_on];
    if (!v) return null;
    const tpl = builder.templates?.[v];
    return tpl ? applyTemplate(tpl, sectState, questions) : null;
  }
  if (builder.type === 'conditional') {
    for (const rule of (builder.rules || [])) {
      const matches = Object.entries(rule.when || {}).every(([qid, exp]) => sectState[qid] === exp);
      if (!matches) continue;
      const requiresMet = (rule.requires || []).every(qid => {
        const v = sectState[qid];
        if (v === undefined || v === null) return false;
        if (typeof v === 'string') return v.trim() !== '';
        return true;
      });
      if (!requiresMet) continue;
      return applyTemplate(rule.template || '', sectState, questions);
    }
    return null;
  }
  return null;
}

// =============================================================
// Validator — mirror of the policy-based validator in rts-validator.html.
// Each POLICY[subKey](body) returns 'ok' or 'review' (Missing is
// detected separately, by checking which components are absent from
// the parsed input — see the validator app for the full implementation).
// =============================================================
const norm = (s) => RTS.normalizeWhitespace(s);

const NO_CONFLICTS_TEXT = "All authors declare they have no conflicts of interest.";
const NO_FUNDING_TEXT   = "This research received no funding.";
const NO_AI_TEXT        = "No artificial intelligence assisted technologies were used in this research or the creation of this article.";
const NO_PREREG_TEXT    = "No aspects of this study were preregistered.";
const FUNDERS_NO_ROLE   = "The funders did not have any role in study design, implementation, analysis, reporting or interpretation.";

// Validator's preregistration sentence patterns.
const TIMING = '(?: prior to data collection| after data collection,? but before data access| after data access,? but before data analysis)?';
const URL    = '(?: \\([^)]+\\))?';
const PREREG_PATTERNS = [
  /^No aspects of (?:this|the) study were preregistered\.$/i,
  new RegExp('^The .+? (?:were|was) preregistered(?: and the .+? (?:were|was) partly preregistered)?' + URL + TIMING + '\\.$', 'i'),
  new RegExp('^The .+? (?:were|was) partly preregistered' + URL + TIMING + '\\.$', 'i'),
  /^The .+? (?:were|was) not preregistered\.$/i,
  /^There were no deviations from the preregistration\.$/i,
  /^There were (?:major|minor|major and minor) deviations from the preregistration(?: \(for details see .+?\))?\.$/i,
];
function validatePreregSentence(sentence) {
  return PREREG_PATTERNS.some(p => p.test(sentence));
}

const ABBREV = /\b(?:e\.g|i\.e|cf|etc|vs|Dr|Mr|Mrs|Ms|Prof|St|No|Inc|Ltd|et al|approx|fig|figs|p|pp|vol|chap)\.$/i;
function splitSentences(text) {
  const out = [];
  let buf = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '.' && depth === 0) {
      const next     = text[i + 1] || '';
      const nextNext = text[i + 2] || '';
      const followedByGap = next === ' ' || next === '\n' || next === '\t';
      const startsCapital = /[A-Z]/.test(nextNext);
      const isEnd = i === text.length - 1;
      if (isEnd || (followedByGap && (startsCapital || nextNext === ''))) {
        if (!ABBREV.test(buf.trim())) {
          out.push(buf.trim());
          buf = '';
          while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
        }
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

function validatePublicAvailability(body, leadText) {
  const re = new RegExp('^' + leadText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+\\(([^)]+)\\)\\.\\s*$', 'i');
  const m = norm(body).match(re);
  if (m && RTS.isValidUrl(m[1].trim())) return 'ok';
  return 'review';
}

const POLICY = {
  conflicts_of_interest(body) {
    return norm(body) === NO_CONFLICTS_TEXT ? 'ok' : 'review';
  },
  funding(body) {
    const t = norm(body);
    if (t === NO_FUNDING_TEXT) return 'ok';
    if (t.endsWith(FUNDERS_NO_ROLE)) return 'ok';
    return 'review';
  },
  artificial_intelligence(body) {
    return norm(body) === NO_AI_TEXT ? 'ok' : 'review';
  },
  ethics(body) {
    const t = norm(body);
    const m = t.match(/^This research received ethics approval from\s+(\S.+?)(?:\s+\(ID:\s*.+?\))?\.\s*$/i);
    return (m && m[1].trim().length > 0) ? 'ok' : 'review';
  },
  preregistration(body) {
    if (norm(body) === NO_PREREG_TEXT) return 'ok';
    const sentences = splitSentences(body);
    return sentences.every(s => validatePreregSentence(s)) ? 'ok' : 'review';
  },
  materials(body) { return validatePublicAvailability(body, 'All study materials are publicly available'); },
  data(body)      { return validatePublicAvailability(body, 'All primary data are publicly available'); },
  analysis_scripts(body) { return validatePublicAvailability(body, 'All analysis scripts are publicly available'); },
};

function policyStatus(subKey, body) {
  const fn = POLICY[subKey];
  if (!fn) throw new Error('No POLICY for subKey: ' + subKey);
  return fn(body);
}

// =============================================================
// Test cases — builder snapshots
// =============================================================
const gd  = cfgRaw.sections.general_disclosures.subsections;
const stp = cfgRaw.study_template.subsections;

console.log('Running RTS test suite...\n');

// ---- Schema sanity ----
test('config: parses and contains expected sections', () => {
  ok(cfgRaw.sections, 'sections present');
  ok(cfgRaw.sections.general_disclosures, 'general_disclosures present');
  ok(cfgRaw.study_template, 'study_template present');
  ok(cfgRaw.rr_overlay, 'rr_overlay present');
});

// ---- Builder snapshots ----
test('coi: no conflicts — exact wording', () => {
  const out = applyBuilder(gd.conflicts_of_interest.builder, { coi1: 'no' }, gd.conflicts_of_interest.questions);
  eq(out, 'All authors declare they have no conflicts of interest.');
});

test('coi: some authors — uses {coi3} prefix and standard tail', () => {
  const out = applyBuilder(gd.conflicts_of_interest.builder, { coi1: 'yes', coi2: 'some', coi3: 'Author A serves on the board of Acme.' }, gd.conflicts_of_interest.questions);
  eq(out, 'Author A serves on the board of Acme. The other authors declare they have no conflicts of interest.');
});

test('funding: no funding — exact wording', () => {
  const out = applyBuilder(gd.funding.builder, { fund1: 'no' }, gd.funding.questions);
  eq(out, 'This research received no funding.');
});

test('funding: yes + funder role — concatenates fund2 + fund4', () => {
  const out = applyBuilder(gd.funding.builder, { fund1: 'yes', fund2: 'ARC Grant DP1.', fund3: 'yes', fund4: 'The funder advised on study design.' }, gd.funding.questions);
  eq(out, 'ARC Grant DP1. The funder advised on study design.');
});

test('funding: yes + fund2 typed but fund3 not yet answered → preview shows fund2 alone', () => {
  // The catch-all rule lets the author see their work in the preview as
  // soon as they start typing, even before they reach the "did funders
  // play a role?" question.
  const out = applyBuilder(gd.funding.builder, { fund1: 'yes', fund2: 'ARC Grant DP1.' }, gd.funding.questions);
  eq(out, 'ARC Grant DP1.');
});

test('ai: no AI — exact wording', () => {
  const out = applyBuilder(gd.artificial_intelligence.builder, { ai1: 'no' }, gd.artificial_intelligence.questions);
  eq(out, 'No artificial intelligence assisted technologies were used in this research or the creation of this article.');
});

test('ethics: yes + board + ID — wraps eth4 as "(ID: …)"', () => {
  const out = applyBuilder(gd.ethics.builder, { eth1: 'yes', eth2: 'yes', eth3: 'the University of Sydney HREC', eth4: '2023/HE001' }, gd.ethics.questions);
  eq(out, 'This research received ethics approval from the University of Sydney HREC (ID: 2023/HE001).');
});

test('ethics: yes + board, no ID — collapses the "(ID: …)" wrapper', () => {
  // The collapse logic now handles arbitrary wrapper text (was previously
  // limited to bare "({qid})"), so "(ID: {eth4})" disappears cleanly when
  // eth4 is blank.
  const out = applyBuilder(gd.ethics.builder, { eth1: 'yes', eth2: 'yes', eth3: 'the University of Sydney HREC' }, gd.ethics.questions);
  eq(out, 'This research received ethics approval from the University of Sydney HREC.');
});

test('ethics: not required — eth6 is normalised as a sentence fragment', () => {
  // User typed "No human participants were involved." — leading capital + trailing period
  const out = applyBuilder(gd.ethics.builder, { eth1: 'no', eth6: 'No human participants were involved.' }, gd.ethics.questions);
  eq(out, 'This research did not require ethics approval because no human participants were involved.');
});

// ---- Materials / Data / Analysis branches ----
test('materials: all → URL embedded', () => {
  const out = applyBuilder(stp.materials.builder, { m1: 'all', m2: 'https://osf.io/abc' }, stp.materials.questions);
  eq(out, 'All study materials are publicly available (https://osf.io/abc).');
});
test('data: some → some + restricted explanation', () => {
  const out = applyBuilder(stp.data.builder, { d1: 'some', d3: 'https://osf.io/xyz', d4: 'Interview transcripts contain identifying info.' }, stp.data.questions);
  eq(out, 'Some primary data are publicly available (https://osf.io/xyz) but access to other primary data is restricted. Interview transcripts contain identifying info.');
});
test('analysis: none → restricted explanation only', () => {
  const out = applyBuilder(stp.analysis_scripts.builder, { a1: 'none', a5: 'Scripts contain proprietary code.' }, stp.analysis_scripts.questions);
  eq(out, 'Access to the analysis scripts is restricted. Scripts contain proprietary code.');
});

// ---- "No applicable materials" branch ----
test('materials: n_a → "Not applicable."', () => {
  const out = applyBuilder(stp.materials.builder, { m1: 'n_a' }, stp.materials.questions);
  eq(out, 'Not applicable.');
});
test('materials: n_a option carries a confirm block (so the Builder will prompt)', () => {
  const opt = stp.materials.questions.m1.options.find(o => o.value === 'n_a');
  ok(opt, 'n_a option exists');
  ok(opt.confirm, 'n_a has a confirm block');
  ok(/materials/i.test(opt.confirm.message), 'message restates the materials definition');
  ok(/instruments|stimuli/i.test(opt.confirm.message), 'message includes specific examples');
});

// ---- Preregistration ----
test('preregistration: no → fixed sentence', () => {
  const r = RTS.buildPreregistration({ q1: 'no' }, stp.preregistration.questions);
  eq(r.body, 'No aspects of this study were preregistered.');
});

test('preregistration: yes + all aspects + before-collection timing', () => {
  const r = RTS.buildPreregistration({
    q1: 'yes',
    q2: 'https://osf.io/preregabc',
    q3: { aims: 'preregistered', methods: 'preregistered', analyses: 'preregistered' },
    q4: 'before_collection',
    q5: 'no',
  }, stp.preregistration.questions);
  ok(r.body.includes('prior to data collection'), 'timing phrase appears');
  ok(r.body.includes('There were no deviations'), 'deviations sentence appears');
});

test('preregistration: timing variants with commas all generate as expected', () => {
  // Was the original bug: validator regex omitted commas. Generate
  // each timing variant and assert the comma is present in output.
  const variants = [
    { q4: 'after_collection', expectedFragment: 'after data collection, but before data access' },
    { q4: 'after_access',     expectedFragment: 'after data access, but before data analysis' },
  ];
  variants.forEach(v => {
    const r = RTS.buildPreregistration({
      q1: 'yes',
      q2: 'https://osf.io/preregabc',
      q3: { aims: 'preregistered', methods: 'preregistered', analyses: 'preregistered' },
      q4: v.q4,
      q5: 'no',
    }, stp.preregistration.questions);
    ok(r.body.includes(v.expectedFragment), `output should contain "${v.expectedFragment}", got: ${r.body}`);
  });
});

// ---- Round-trip: builder output → validator policy status ----
// Each test: take the Builder's output for a representative state, feed
// it through the new POLICY validator, assert the expected ok/review.
function roundTrip(subKey, body, expected) {
  const got = policyStatus(subKey, body);
  if (got !== expected) {
    throw new Error(`expected ${expected}, got ${got}\n  body: ${body}`);
  }
}

// ---- COI: 'no' is the only OK case
test('policy/coi: "no conflicts" → ok', () => {
  const out = applyBuilder(gd.conflicts_of_interest.builder, { coi1: 'no' }, gd.conflicts_of_interest.questions);
  roundTrip('conflicts_of_interest', out, 'ok');
});
test('policy/coi: any disclosed conflict → review', () => {
  const out = applyBuilder(gd.conflicts_of_interest.builder, { coi1: 'yes', coi2: 'some', coi3: 'Author A serves on the board of Acme.' }, gd.conflicts_of_interest.questions);
  roundTrip('conflicts_of_interest', out, 'review');
});

// ---- Funding ----
test('policy/funding: "no funding" → ok', () => {
  const out = applyBuilder(gd.funding.builder, { fund1: 'no' }, gd.funding.questions);
  roundTrip('funding', out, 'ok');
});
test('policy/funding: yes + funder had no role → ok', () => {
  const out = applyBuilder(gd.funding.builder, { fund1: 'yes', fund2: 'ARC Grant.', fund3: 'no' }, gd.funding.questions);
  roundTrip('funding', out, 'ok');
});
test('policy/funding: yes + funder had role → review', () => {
  const out = applyBuilder(gd.funding.builder, { fund1: 'yes', fund2: 'ARC Grant.', fund3: 'yes', fund4: 'Funder advised on study design.' }, gd.funding.questions);
  roundTrip('funding', out, 'review');
});
test('policy/funding: yes + fund2 only (mid-edit) → review', () => {
  const out = applyBuilder(gd.funding.builder, { fund1: 'yes', fund2: 'ARC Grant.' }, gd.funding.questions);
  roundTrip('funding', out, 'review');
});

// ---- Artificial intelligence ----
test('policy/ai: "no AI" → ok', () => {
  const out = applyBuilder(gd.artificial_intelligence.builder, { ai1: 'no' }, gd.artificial_intelligence.questions);
  roundTrip('artificial_intelligence', out, 'ok');
});
test('policy/ai: any reported use → review', () => {
  const out = applyBuilder(gd.artificial_intelligence.builder, { ai1: 'yes', ai2: 'ChatGPT was used to check code.' }, gd.artificial_intelligence.questions);
  roundTrip('artificial_intelligence', out, 'review');
});

// ---- Ethics ----
test('policy/ethics: yes + board (no ID) → ok', () => {
  const out = applyBuilder(gd.ethics.builder, { eth1: 'yes', eth2: 'yes', eth3: 'University of Sydney HREC' }, gd.ethics.questions);
  roundTrip('ethics', out, 'ok');
});
test('policy/ethics: yes + board + ID → ok', () => {
  const out = applyBuilder(gd.ethics.builder, { eth1: 'yes', eth2: 'yes', eth3: 'University of Sydney HREC', eth4: '2023/HE001' }, gd.ethics.questions);
  roundTrip('ethics', out, 'ok');
});
test('policy/ethics: not required → review', () => {
  const out = applyBuilder(gd.ethics.builder, { eth1: 'no', eth6: 'No human participants were involved.' }, gd.ethics.questions);
  roundTrip('ethics', out, 'review');
});
test('policy/ethics: yes but board without approval (custom statement) → review', () => {
  const out = applyBuilder(gd.ethics.builder, { eth1: 'yes', eth2: 'no', eth5: 'Approval was waived for this archival data analysis.' }, gd.ethics.questions);
  roundTrip('ethics', out, 'review');
});

// ---- Preregistration ----
test('policy/preregistration: "no aspects" → ok', () => {
  const r = RTS.buildPreregistration({ q1: 'no' }, stp.preregistration.questions);
  roundTrip('preregistration', r.body, 'ok');
});
test('policy/preregistration: full standard pattern → ok', () => {
  const r = RTS.buildPreregistration({
    q1: 'yes',
    q2: 'https://osf.io/preregabc',
    q3: { aims: 'preregistered', methods: 'preregistered', analyses: 'preregistered' },
    q4: 'before_collection',
    q5: 'no',
  }, stp.preregistration.questions);
  roundTrip('preregistration', r.body, 'ok');
});
test('policy/preregistration: sentence not matching standard → review', () => {
  // Author has manually typed a non-standard preregistration sentence.
  roundTrip('preregistration', 'We registered our hypotheses on OSF before data collection started.', 'review');
});

// ---- Materials / Data / Analysis Scripts ----
test('policy/materials: all + valid URL → ok', () => {
  const out = applyBuilder(stp.materials.builder, { m1: 'all', m2: 'https://osf.io/abc' }, stp.materials.questions);
  roundTrip('materials', out, 'ok');
});
test('policy/materials: some → review', () => {
  const out = applyBuilder(stp.materials.builder, { m1: 'some', m3: 'https://osf.io/xyz', m4: 'Survey under copyright.' }, stp.materials.questions);
  roundTrip('materials', out, 'review');
});
test('policy/materials: n_a → review (data editor must judge)', () => {
  const out = applyBuilder(stp.materials.builder, { m1: 'n_a' }, stp.materials.questions);
  roundTrip('materials', out, 'review');
});
test('policy/materials: all + invalid URL → review', () => {
  // Builder won't normally produce this, but a manually edited statement might.
  roundTrip('materials', 'All study materials are publicly available (not-a-url).', 'review');
});

test('policy/data: all + valid URL → ok', () => {
  const out = applyBuilder(stp.data.builder, { d1: 'all', d2: 'https://osf.io/abc' }, stp.data.questions);
  roundTrip('data', out, 'ok');
});
test('policy/data: none → review', () => {
  const out = applyBuilder(stp.data.builder, { d1: 'none', d5: 'Identifying info; cannot share.' }, stp.data.questions);
  roundTrip('data', out, 'review');
});

test('policy/analysis_scripts: all + valid URL → ok', () => {
  const out = applyBuilder(stp.analysis_scripts.builder, { a1: 'all', a2: 'https://osf.io/abc' }, stp.analysis_scripts.questions);
  roundTrip('analysis_scripts', out, 'ok');
});
test('policy/analysis_scripts: some → review', () => {
  const out = applyBuilder(stp.analysis_scripts.builder, { a1: 'some', a3: 'https://osf.io/xyz', a4: 'Internal scripts.' }, stp.analysis_scripts.questions);
  roundTrip('analysis_scripts', out, 'review');
});

// ---- Preregistration validator regex coverage ----
test('preregistration regex: every timing phrase the builder emits is recognised', () => {
  const phrases = [
    'The methods were preregistered (https://osf.io/x) prior to data collection.',
    'The methods were preregistered (https://osf.io/x) after data collection, but before data access.',
    'The methods were preregistered (https://osf.io/x) after data access, but before data analysis.',
  ];
  phrases.forEach(s => ok(validatePreregSentence(s), 'should match: ' + s));
});

test('preregistration regex: "no aspects" exact form', () => {
  ok(validatePreregSentence('No aspects of this study were preregistered.'));
  ok(validatePreregSentence('No aspects of the study were preregistered.'));
});

test('preregistration regex: deviations + location', () => {
  ok(validatePreregSentence('There were major and minor deviations from the preregistration (for details see Supplementary Table 1).'));
  ok(validatePreregSentence('There were no deviations from the preregistration.'));
});

// ---- RR overlay ----
test('rr overlay: AI templates switch to future tense', () => {
  // Apply overlay to a clone
  const cfg = JSON.parse(JSON.stringify(cfgRaw));
  cfg.sections.__study__ = JSON.parse(JSON.stringify(cfgRaw.study_template));
  RTS.applyRROverlay(cfg, cfgRaw.rr_overlay, ['__study__']);

  const aiBuilder = cfg.sections.general_disclosures.subsections.artificial_intelligence.builder;
  const out = applyBuilder(aiBuilder, { ai1: 'no' }, cfg.sections.general_disclosures.subsections.artificial_intelligence.questions);
  eq(out, 'No artificial intelligence assisted technologies will be used in this research or the creation of this article.');
});

test('rr overlay: preregistration becomes a fixed Stage 1 sentence', () => {
  const cfg = JSON.parse(JSON.stringify(cfgRaw));
  cfg.sections.__study__ = JSON.parse(JSON.stringify(cfgRaw.study_template));
  RTS.applyRROverlay(cfg, cfgRaw.rr_overlay, ['__study__']);
  const sub = cfg.sections.__study__.subsections.preregistration;
  eq(sub.builder.type, 'static_text');
  ok(sub.builder.text.includes('Stage 1 Registered Report'), 'mentions Stage 1 RR');
  ok(sub.builder.text.includes('will be preregistered'), 'is future tense');
});

test('rr overlay: data templates switch to future tense and drop URL', () => {
  const cfg = JSON.parse(JSON.stringify(cfgRaw));
  cfg.sections.__study__ = JSON.parse(JSON.stringify(cfgRaw.study_template));
  RTS.applyRROverlay(cfg, cfgRaw.rr_overlay, ['__study__']);

  const dataBuilder   = cfg.sections.__study__.subsections.data.builder;
  const dataQuestions = cfg.sections.__study__.subsections.data.questions;
  ok(!dataQuestions.d2, 'd2 (URL) removed');
  ok(!dataQuestions.d3, 'd3 (URL) removed');

  const out = applyBuilder(dataBuilder, { d1: 'all' }, dataQuestions);
  eq(out, 'All primary data will be made publicly available.');
});

// ---- Aspect labels (display-only) ----
test('aspect labels: shorter display labels do not change preview output', () => {
  const opts = stp.preregistration.questions.q3.options;
  // Display labels (what the user sees in the segmented control)
  eq(opts.find(o => o.value === 'preregistered').label, 'Fully');
  eq(opts.find(o => o.value === 'partly').label,        'Partly');
  eq(opts.find(o => o.value === 'not').label,           'Not at all');
  // The option `value` is what the preview builder branches on, and it
  // hasn't changed, so the preview sentences still use the long form.
  const r = RTS.buildPreregistration({
    q1: 'yes',
    q2: 'https://osf.io/x',
    q3: { aims: 'preregistered', methods: 'partly', analyses: 'not' },
    q4: 'before_collection',
    q5: 'no',
  }, stp.preregistration.questions);
  ok(/preregistered/.test(r.body),          'preview still uses "preregistered"');
  ok(/partly preregistered/.test(r.body),   'preview still uses "partly preregistered"');
  ok(/not preregistered/.test(r.body),      'preview still uses "not preregistered"');
});

// ---- "analyses" wording (replaces "analysis plan") ----
test('preregistration: aspect term is "analyses" (not "analysis plan")', () => {
  const r = RTS.buildPreregistration({
    q1: 'yes',
    q3: { aims: 'preregistered', methods: 'preregistered', analyses: 'preregistered' },
    q4: 'before_collection',
    q5: 'no',
  }, stp.preregistration.questions);
  ok(/analyses/.test(r.body),       'output mentions "analyses"');
  ok(!/analysis plan/.test(r.body), 'output no longer mentions "analysis plan"');
});

test('preregistration: single-aspect "not preregistered" uses plural verb for analyses', () => {
  const r = RTS.buildPreregistration({
    q1: 'yes',
    q3: { aims: 'preregistered', methods: 'preregistered', analyses: 'not' },
    q4: 'before_collection',
    q5: 'no',
  }, stp.preregistration.questions);
  // Only one aspect is "not preregistered" → the dedicated singular template fires.
  ok(/The analyses were not preregistered\./.test(r.body), `expected "The analyses were not preregistered." in: ${r.body}`);
});

// ---- placeholder_full override ----
test('placeholder_full: a4 uses the custom bracket text', () => {
  const a4 = stp.analysis_scripts.questions.a4;
  ok(a4.placeholder_full, 'a4 has placeholder_full');
  // When the user has chosen "some" but hasn't filled a4 yet, the
  // preview must contain the custom-worded placeholder.
  const out = applyBuilder(stp.analysis_scripts.builder, { a1: 'some', a3: 'https://osf.io/x' }, stp.analysis_scripts.questions);
  ok(out.includes('[authors to describe which scripts are restricted, the restrictions, and a justification]'),
     `output should contain the new placeholder, got: ${out}`);
  ok(!out.includes('to provide which scripts'), 'old "to provide" wording is gone');
});

test('placeholder_full: m4 uses "describe" instead of "provide"', () => {
  const out = applyBuilder(stp.materials.builder, { m1: 'some', m3: 'https://osf.io/x' }, stp.materials.questions);
  ok(out.includes('[authors to describe which materials are restricted'),
     `output should say "describe which materials...", got: ${out}`);
  ok(!out.includes('to provide which materials'), 'old "to provide" wording is gone');
});

test('placeholder_full: d4 uses "describe" instead of "provide"', () => {
  const out = applyBuilder(stp.data.builder, { d1: 'some', d3: 'https://osf.io/x' }, stp.data.questions);
  ok(out.includes('[authors to describe which data are restricted'),
     `output should say "describe which data...", got: ${out}`);
  ok(!out.includes('to provide which data'), 'old "to provide" wording is gone');
});

test('"authors to provide which" no longer appears anywhere in the config', () => {
  const text = JSON.stringify(cfgRaw);
  ok(!/authors? to provide which/i.test(text), '"to provide which" must not appear in any placeholder');
});

// ---- Funding-label / copy-output spacing ----
// Mirror of the builder's HTML output template, just for this test.
test('copy/html: space sits inside the <strong> tag so it survives paste', () => {
  // Mimic the relevant slice of buildHtmlStatement
  const label = 'Funding:';
  const text  = 'This research received no funding.';
  const escHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<strong>${escHtml(label)} </strong>${escHtml(text)}`;
  // Crucial property: the space follows the colon and precedes </strong>,
  // i.e. it's part of the bold content rather than a free text node.
  ok(/Funding: <\/strong>/.test(html), 'space is inside the bold tag');
});

test('copy/markdown: exactly one space between label and body even if body has leading whitespace', () => {
  // Simulate what buildMarkdownStatement does for a body that, for
  // whatever reason, has a leading space. Label is wrapped in
  // markdown bold but the single-space invariant still holds.
  const text   = '   This research received no funding.';
  const label  = 'Funding:';
  const joined = `**${label}** ${text.replace(/^\s+/, '')}`;
  eq(joined, '**Funding:** This research received no funding.');
});

// ---- Hyperlinking the copy-output ----
// Mirror of linkifyHtml() in rts-builder.html — kept here so the test
// suite can assert on URL detection without spinning up a browser.
function linkifyHtml(escapedText) {
  return escapedText.replace(/https?:\/\/[^\s)<]+/g, (url) => {
    const trailing = url.match(/[.,;:!?]+$/);
    let suffix = '';
    if (trailing) {
      suffix = trailing[0];
      url = url.slice(0, -suffix.length);
    }
    return `<a href="${url}">${url}</a>${suffix}`;
  });
}
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

test('linkify: bare URL becomes an <a>', () => {
  const out = linkifyHtml(escHtml('See https://example.com for details.'));
  eq(out, 'See <a href="https://example.com">https://example.com</a> for details.');
});
test('linkify: URL inside parens does not include the closing paren', () => {
  const out = linkifyHtml(escHtml('All materials are available (https://doi.org/10.17605/OSF.IO/AB2CD).'));
  // Closing paren and trailing period stay outside the <a>.
  eq(out, 'All materials are available (<a href="https://doi.org/10.17605/OSF.IO/AB2CD">https://doi.org/10.17605/OSF.IO/AB2CD</a>).');
});
test('linkify: trailing comma stays outside the <a>', () => {
  const out = linkifyHtml(escHtml('See https://example.com, then continue.'));
  eq(out, 'See <a href="https://example.com">https://example.com</a>, then continue.');
});
test('linkify: URL with query-string is escaped correctly in href', () => {
  const out = linkifyHtml(escHtml('Look at https://example.com?a=1&b=2 here.'));
  // After HTML escaping, '&' is '&amp;'; the href should use the same form.
  eq(out, 'Look at <a href="https://example.com?a=1&amp;b=2">https://example.com?a=1&amp;b=2</a> here.');
});
test('linkify: text without any URL is unchanged', () => {
  const out = linkifyHtml(escHtml('No URL here at all.'));
  eq(out, 'No URL here at all.');
});

// ---- Email links use the new shared address (1.6 follow-up) ----
// The apps live in builder/index.html and validator/index.html; the
// root rts-builder.html / rts-validator.html are now redirect stubs.
test('email: builder/index.html mentions psych.star.team@gmail.com only', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');
  ok(!/tom\.hardwicke@/.test(txt), 'no leftover tom.hardwicke@ links');
  ok(txt.includes('psych.star.team@gmail.com'), 'new address present');
});
test('email: validator/index.html mentions psych.star.team@gmail.com only', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'validator', 'index.html'), 'utf8');
  ok(!/tom\.hardwicke@/.test(txt), 'no leftover tom.hardwicke@ links');
  ok(txt.includes('psych.star.team@gmail.com'), 'new address present');
});

// ---- GitHub Pages repo structure ----
test('repo: builder/index.html references the shared files one level up', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');
  ok(txt.includes('src="../rts-config.js"'), 'builder loads ../rts-config.js');
  ok(txt.includes('src="../rts-utils.js"'),  'builder loads ../rts-utils.js');
  ok(!/src="rts-config\.js"/.test(txt),       'no leftover root-relative rts-config.js');
});
test('repo: validator/index.html references the shared files one level up', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'validator', 'index.html'), 'utf8');
  ok(txt.includes('src="../rts-config.js"'), 'validator loads ../rts-config.js');
  ok(txt.includes('src="../rts-utils.js"'),  'validator loads ../rts-utils.js');
  ok(!/src="rts-config\.js"/.test(txt),       'no leftover root-relative rts-config.js');
});
test('repo: GoatCounter is wired to the psci-star site code in both apps', () => {
  const b = fs.readFileSync(path.join(ROOT, 'builder', 'index.html'), 'utf8');
  const v = fs.readFileSync(path.join(ROOT, 'validator', 'index.html'), 'utf8');
  ok(b.includes('data-goatcounter="https://psci-star.goatcounter.com/count"'), 'builder wired to psci-star');
  ok(v.includes('data-goatcounter="https://psci-star.goatcounter.com/count"'), 'validator wired to psci-star');
  ok(!b.includes('YOURSITE') && !v.includes('YOURSITE'), 'no leftover YOURSITE placeholder');
});
test('repo: landing page links to both apps', () => {
  const land = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(land.includes('href="./builder/"'),   'landing page links to ./builder/');
  ok(land.includes('href="./validator/"'), 'landing page links to ./validator/');
});

// ---- Storage migration smoke test ----
test('schema fingerprint changes when section ids change', () => {
  // Build a minimal hash function inline (mirrors the builder's).
  function hash(cfg) {
    const ids = [];
    Object.entries(cfg.sections).forEach(([sectKey, sect]) => {
      ids.push('S:' + sectKey);
      if (sect.subsections) {
        Object.entries(sect.subsections).forEach(([subKey, sub]) => {
          ids.push('SS:' + subKey);
          Object.keys(sub.questions || {}).forEach(qid => ids.push('Q:' + qid));
        });
      }
      Object.keys(sect.questions || {}).forEach(qid => ids.push('Q:' + qid));
    });
    return ids.sort().join('|');
  }
  const a = hash(cfgRaw);
  const b = JSON.parse(JSON.stringify(cfgRaw));
  // Rename a question id and verify hash changes.
  b.sections.general_disclosures.subsections.funding.questions.fund2_renamed = b.sections.general_disclosures.subsections.funding.questions.fund2;
  delete b.sections.general_disclosures.subsections.funding.questions.fund2;
  ok(hash(b) !== a, 'schema hash should change when a question id changes');
});

// ---- Section-heading check (mirror of checkHeadings in the validator) ----
// Returns { general: 'ok'|'review'|'missing', studies: { N: status } }.
function checkHeadingsMirror(input, componentPositions, studyIndices) {
  const out = { general: null, studies: {} };

  const gdRe = /(?:^|\n)[ \t]*(?:#+[ \t]*)?General\s+Disclosures?[ \t]*:?[ \t]*(?:\n|$)/i;
  const gdMatch = gdRe.exec(input);
  const gdPos = gdMatch ? gdMatch.index : null;
  const genPositions = componentPositions.filter(c => c.sectionType === 'general_disclosures').map(c => c.position);
  const firstGenPos = genPositions.length ? Math.min(...genPositions) : null;
  if (gdPos === null) out.general = 'missing';
  else if (firstGenPos !== null && gdPos > firstGenPos) out.general = 'review';
  else out.general = 'ok';

  const studyRe = /(?:^|\n)[ \t]*(?:#+[ \t]*)?Study\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b[^\n]*/gi;
  const w2n = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10 };
  const headingPos = {};
  let h;
  while ((h = studyRe.exec(input)) !== null) {
    const idx = w2n[h[1].toLowerCase()] || parseInt(h[1], 10);
    if (idx && headingPos[idx] === undefined) headingPos[idx] = h.index;
  }
  studyIndices.forEach(idx => {
    const pos = headingPos[idx];
    const studyPositions = componentPositions.filter(c => c.sectionType === 'study' && c.studyIndex === idx).map(c => c.position);
    const firstStudyPos = studyPositions.length ? Math.min(...studyPositions) : null;
    if (pos === undefined) out.studies[idx] = 'missing';
    else if (firstStudyPos !== null && pos > firstStudyPos) out.studies[idx] = 'review';
    else out.studies[idx] = 'ok';
  });
  return out;
}

test('headings: well-formed RTS → all heading checks OK', () => {
  const input = 'General Disclosures\n\nConflicts of interest: x. Funding: y.\n\nStudy 1\n\nMaterials: z.';
  // component positions: general components precede "Study 1"; study components after.
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials') },
  ], [1]);
  eq(r.general, 'ok');
  eq(r.studies[1], 'ok');
});

test('headings: missing "General Disclosures" heading → missing', () => {
  const input = 'Conflicts of interest: x. Funding: y.\n\nStudy 1\n\nMaterials: z.';
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials') },
  ], [1]);
  eq(r.general, 'missing');
  eq(r.studies[1], 'ok');
});

test('headings: missing "Study 1" heading → missing', () => {
  const input = 'General Disclosures\n\nConflicts of interest: x.\n\nMaterials: z.';
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials') },
  ], [1]);
  eq(r.general, 'ok');
  eq(r.studies[1], 'missing');
});

test('headings: "General Disclosures" heading after its statements → review (misplaced)', () => {
  const input = 'Conflicts of interest: x. Funding: y.\nGeneral Disclosures\n\nStudy 1\n\nMaterials: z.';
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials') },
  ], [1]);
  eq(r.general, 'review');
});

test('headings: builder-style headings ("General disclosures", "Study 1 disclosures") are recognised', () => {
  const input = 'General disclosures\nConflicts of interest: x.\n\nStudy 1 disclosures\nMaterials: z.';
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials') },
  ], [1]);
  eq(r.general, 'ok');
  eq(r.studies[1], 'ok');
});

test('headings: word-form study heading ("Study One") is recognised', () => {
  const input = 'General Disclosures\nConflicts of interest: x.\n\nStudy One\nMaterials: z.';
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials') },
  ], [1]);
  eq(r.studies[1], 'ok');
});

test('headings: second study with no heading is flagged while first is OK', () => {
  const input = 'General Disclosures\nConflicts of interest: x.\n\nStudy 1\nMaterials: a.\n\nMaterials: b.';
  const r = checkHeadingsMirror(input, [
    { sectionType: 'general_disclosures', position: input.indexOf('Conflicts of interest') },
    { sectionType: 'study', studyIndex: 1, position: input.indexOf('Materials: a') },
    { sectionType: 'study', studyIndex: 2, position: input.indexOf('Materials: b') },
  ], [1, 2]);
  eq(r.studies[1], 'ok');
  eq(r.studies[2], 'missing');
});

// =============================================================
// Report
// =============================================================
console.log('\n');
if (_failed === 0) {
  console.log(`✓ All ${_passed} tests passed.`);
  process.exit(0);
} else {
  console.log(`${_failed} of ${_passed + _failed} tests FAILED:\n`);
  _failures.forEach(({ name, error }) => {
    console.log('  ✗ ' + name);
    console.log('    ' + (error.message || error).split('\n').join('\n    '));
    console.log('');
  });
  process.exit(1);
}
