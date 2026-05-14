# Research Transparency Statement tools

## What? 

This repository contains two companion web apps for the Research Transparency Statement (RTS) required in *Psychological Science* manuscripts:

- **RTS Builder** — for authors. Answers about the research are turned into a
  policy-aligned RTS to paste into a manuscript.
- **RTS Validator** — for the editorial team. A pasted RTS is checked, section by
  section, against the journal's policy and standard wording.

Both apps are static HTML — there is no server-side code or database.

## Who?

The apps were built by Tom Hardwicke (Senior Editor for Statistics, Transparency, and Rigour at Psychological Science) with considerable assistance from Claude Opus 4.7.

Questions/feedback can be sent to psych.star.team@gmail.com

## Live URLs

The apps are hosted on GitHub Pages under the `psci-star` organisation:

- Builder — <https://psci-star.github.io/builder/>
- Validator — <https://psci-star.github.io/validator/>
- Landing page — <https://psci-star.github.io/>

## Repository layout

```
psci-star.github.io/
├── index.html            Landing page linking to both apps
├── builder/
│   └── index.html        RTS Builder            → /builder/
├── validator/
│   └── index.html        RTS Validator          → /validator/
├── rts-config.js         Shared policy + wording (single source of truth)
├── rts-utils.js          Shared helpers (DOM, modals, sentence builders)
├── tests/
│   └── rts-tests.js      Test suite (node --test style, no dependencies)
├── .nojekyll             Tells GitHub Pages to serve files as-is
└── README.md
```

`rts-config.js` and `rts-utils.js` live at the repository root and are loaded by
both apps via `../rts-config.js` / `../rts-utils.js`.

## Local preview

The apps work when opened directly from disk (`file://`) — just open
`builder/index.html` or `validator/index.html` in a browser. They do depend on
two CDN scripts (the Inter font and `js-yaml`), so an internet connection is
needed on first load.

## Editing the wording

All user-facing policy text — questions, guidance, standard statement wording —
lives in **`rts-config.js`**, in the YAML block assigned to
`globalThis.RTS_CONFIG_YAML`. Editing rules are documented in the comment at the
top of that file. After any change, run the test suite.

## Running the tests

From the repository root:

```
node tests/rts-tests.js
```

The suite has no npm dependencies. It needs Node and `python3` with PyYAML
(used only to parse the YAML config — pre-installed on macOS and most Linux).
It checks the builder's generated wording against snapshots and round-trips
every builder output through the validator's policy checks, so the two apps
cannot silently diverge.

## Analytics (GoatCounter)

Both apps — and the landing page — include a [GoatCounter](https://www.goatcounter.com/)
snippet. GoatCounter is free for non-commercial use, GDPR-compliant (no cookies,
no PII, IP addresses hashed and discarded after 8 hours), and privacy-friendly.
