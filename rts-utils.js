/* =============================================================
 * RTS shared utilities — helpers used by both the Builder and
 * the Validator.
 *
 * Loaded via <script src="rts-utils.js"></script> from each page.
 * The file is also required from the test suite, so all exports
 * live on globalThis.RTS so they survive both load paths.
 *
 * Contents
 *   $                   — short alias for getElementById.
 *   safeStorage         — localStorage that never throws.
 *   esc                 — HTML-escape any string.
 *   isValidUrl          — quick http(s) protocol check.
 *   normalizeWhitespace — collapse runs of whitespace.
 *   renderPolicy        — apply the RR overlay onto cfg, in place.
 *                         Both apps call this so the policy
 *                         transformation lives in one place.
 *   buildPreregistration — single canonical preregistration
 *                         renderer. The Builder uses it for the
 *                         live preview; the test suite uses it
 *                         to drive validator round-trips.
 *   confirmAsync        — promise-returning replacement for
 *                         window.confirm. Renders inside a
 *                         <dialog> styled like the help modal.
 *   alertAsync          — same idea for window.alert.
 *   placeholderText     — friendly fill-in placeholder for an
 *                         unanswered question, drawn from the
 *                         YAML's `friendly_placeholder` field.
 * ============================================================= */

(function () {

  // ---------------------------------------------------------
  // Tiny generic helpers
  // ---------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  const safeStorage = {
    get(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, val) {
      try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
    available() {
      try {
        const k = '__rts_probe__';
        localStorage.setItem(k, '1');
        localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    },
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isValidUrl(s) {
    if (!s) return false;
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  }

  function normalizeWhitespace(s) { return s.replace(/\s+/g, ' ').trim(); }

  // Friendly fill-in label for an unanswered question. Reads, in order:
  //   1. `placeholder_full` — fully-formed bracket content. Used when
  //      "[authors to provide ...]" doesn't fit (e.g. for placeholders
  //      that need a different verb or article).
  //   2. `friendly_placeholder` — wrapped as "[authors to provide ...]".
  //   3. Type-based generic.
  function placeholderText(question) {
    if (!question) return '[authors to provide info]';
    if (question.placeholder_full) {
      return '[' + question.placeholder_full + ']';
    }
    if (question.friendly_placeholder) {
      return '[authors to provide ' + question.friendly_placeholder + ']';
    }
    if (question.type === 'url')      return '[authors to provide link]';
    if (question.type === 'textarea') return '[authors to provide details]';
    if (question.type === 'text')     return '[authors to provide info]';
    return '[authors to provide info]';
  }

  // ---------------------------------------------------------
  // RR overlay — applied in-place to a parsed cfg object.
  //
  // The overlay is data, not code, so the same transformation
  // can be applied by the Builder (live form) and the Validator
  // (template-matching). Both apps call renderPolicy(cfg, isRR).
  // ---------------------------------------------------------
  function applyRROverlay(cfg, overlay, studyKeys) {
    // 1) General disclosures
    const gd = cfg.sections?.general_disclosures;
    if (gd && overlay.general_disclosures) {
      Object.entries(overlay.general_disclosures).forEach(([subKey, subOverlay]) => {
        const sub = gd.subsections?.[subKey];
        if (!sub) return;
        if (subOverlay.questions) {
          Object.entries(subOverlay.questions).forEach(([qid, qOverlay]) => {
            sub.questions[qid] = Object.assign({}, sub.questions[qid] || {}, qOverlay);
          });
        }
        if (subOverlay.builder) {
          sub.builder = JSON.parse(JSON.stringify(subOverlay.builder));
        }
      });
    }
    // 2) Per-study transforms
    if (overlay.study) {
      studyKeys.forEach(studyKey => {
        const sect = cfg.sections[studyKey];
        if (!sect) return;
        Object.entries(overlay.study).forEach(([subKey, subOverlay]) => {
          const sub = sect.subsections?.[subKey];
          if (!sub) return;
          // 2a) Static-text replacement (used for preregistration)
          if (subOverlay.static_text) {
            sub.questions = {};
            sub.rr_static_note = subOverlay.note;
            sub.builder = { type: 'static_text', text: subOverlay.static_text };
            return;
          }
          // 2b) Question text/option overrides
          if (subOverlay.questions) {
            Object.entries(subOverlay.questions).forEach(([qid, qOverlay]) => {
              if (!sub.questions[qid]) return;
              sub.questions[qid] = Object.assign({}, sub.questions[qid], qOverlay);
            });
          }
          // 2c) Question removals (no link in RR mode)
          if (subOverlay.remove_questions) {
            subOverlay.remove_questions.forEach(qid => { delete sub.questions[qid]; });
          }
          // 2d) Builder-template overrides
          if (subOverlay.builder_templates && sub.builder) {
            sub.builder = JSON.parse(JSON.stringify(sub.builder));
            sub.builder.templates = subOverlay.builder_templates;
          }
        });
      });
    }
    return cfg;
  }

  // Apply the RR overlay if isRR; otherwise return cfg unchanged.
  // cfg should be a deep clone the caller is happy to see mutated.
  function renderPolicy(cfg, overlay, isRR, studyKeys) {
    if (!isRR || !overlay) return cfg;
    return applyRROverlay(cfg, overlay, studyKeys || []);
  }

  // ---------------------------------------------------------
  // Custom confirm / alert
  // Reuses the .modal styling already defined on each page so
  // the dialogs look native to the app. Returns a Promise.
  // ---------------------------------------------------------
  function ensureModalDialog() {
    let dlg = document.getElementById('rts-async-modal');
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.id = 'rts-async-modal';
    dlg.className = 'modal';
    dlg.setAttribute('aria-labelledby', 'rts-async-modal-title');
    dlg.innerHTML = `
      <div class="modal-inner">
        <div class="modal-head">
          <h2 class="modal-title" id="rts-async-modal-title"></h2>
        </div>
        <div class="modal-body">
          <p id="rts-async-modal-message"></p>
        </div>
        <div class="modal-foot">
          <span></span>
          <div style="display:flex;gap:.6rem">
            <button class="modal-close" id="rts-async-modal-cancel" type="button"
              style="background:var(--white);color:var(--g4);border:1px solid var(--g2)"></button>
            <button class="modal-close" id="rts-async-modal-ok" type="button"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    return dlg;
  }

  function asyncDialog({ title, message, okLabel, cancelLabel, danger }) {
    return new Promise(resolve => {
      const dlg = ensureModalDialog();
      dlg.querySelector('#rts-async-modal-title').textContent = title;
      dlg.querySelector('#rts-async-modal-message').textContent = message;
      const okBtn = dlg.querySelector('#rts-async-modal-ok');
      const cancelBtn = dlg.querySelector('#rts-async-modal-cancel');
      okBtn.textContent = okLabel || 'OK';
      okBtn.style.background = danger ? 'var(--red, #b04030)' : '';
      if (cancelLabel === null) {
        cancelBtn.style.display = 'none';
      } else {
        cancelBtn.style.display = '';
        cancelBtn.textContent = cancelLabel || 'Cancel';
      }
      const cleanup = (result) => {
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        dlg.removeEventListener('cancel', onCancel);
        if (dlg.open) dlg.close();
        resolve(result);
      };
      function onCancel(e) { e.preventDefault(); cleanup(false); }
      okBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      dlg.addEventListener('cancel', onCancel);
      dlg.showModal();
      // Move focus to the safe (cancel) button by default for destructive dialogs;
      // OK button otherwise.
      requestAnimationFrame(() => {
        if (danger && cancelBtn.style.display !== 'none') cancelBtn.focus();
        else okBtn.focus();
      });
    });
  }

  function confirmAsync(message, opts = {}) {
    return asyncDialog({
      title: opts.title || 'Please confirm',
      message,
      okLabel: opts.okLabel || 'OK',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: !!opts.danger,
    });
  }

  function alertAsync(message, opts = {}) {
    return asyncDialog({
      title: opts.title || 'Heads up',
      message,
      okLabel: opts.okLabel || 'OK',
      cancelLabel: null,
      danger: false,
    });
  }

  // ---------------------------------------------------------
  // Canonical preregistration renderer (Builder uses it for
  // preview, test suite uses it to drive round-trips).
  // ---------------------------------------------------------
  function joinList(items) {
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + ' and ' + items[1];
    return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
  }

  function buildDeviationLocations(q7) {
    const out = [];
    if (q7?.main_text?.checked) out.push('the main text');
    if (q7?.table?.checked) {
      out.push((q7.table.location || '').trim() || '[author to say where deviations can be found]');
    }
    if (q7?.other?.checked) {
      out.push((q7.other.location || '').trim() || '[author to say where deviations can be found]');
    }
    if (!out.length) return null;
    if (out.length === 1) return out[0];
    return out.slice(0, -1).join(', ') + ' and ' + out[out.length - 1];
  }

  function buildPreregistration(state, questions) {
    state = state || {};
    questions = questions || {};
    if (!state.q1) return null;
    if (state.q1 === 'no') return { label: 'Preregistration:', body: 'No aspects of this study were preregistered.' };
    if (state.q1 !== 'yes') return null;

    const aspects = questions.q3?.aspects || [];
    const answers = state.q3 || {};
    const link = state.q2 || null;
    const fullyPrereg  = aspects.filter(a => answers[a.id] === 'preregistered');
    const partlyPrereg = aspects.filter(a => answers[a.id] === 'partly');
    const notPrereg    = aspects.filter(a => answers[a.id] === 'not');

    const timingOption = (questions.q4?.options || []).find(o => o.value === state.q4);
    const timingPhrase = timingOption?.phrase || null;

    let prereggedSentence = '';
    if (fullyPrereg.length || partlyPrereg.length) {
      const linkSuffix = link ? ` (${link})` : '';
      const parts = [];
      const fullTerms  = fullyPrereg.map(a => a.term);
      const partTerms  = partlyPrereg.map(a => a.term);
      if (fullyPrereg.length) parts.push(`The ${joinList(fullTerms)} were preregistered`);
      if (partlyPrereg.length) {
        const c = `the ${joinList(partTerms)} were partly preregistered`;
        parts.push(fullyPrereg.length ? 'and ' + c : 'The ' + c.slice(4));
      }
      prereggedSentence = parts.join(' ') + linkSuffix;
      if (timingPhrase) prereggedSentence += ' ' + timingPhrase;
      prereggedSentence = prereggedSentence[0].toUpperCase() + prereggedSentence.slice(1) + '.';
    }

    let notPrereggedSentence = '';
    if (notPrereg.length && (fullyPrereg.length || partlyPrereg.length)) {
      const notTerms = notPrereg.map(a => a.term);
      notPrereggedSentence = notPrereg.length === 1
        ? `The ${notPrereg[0].term} ${notPrereg[0].verb} not preregistered.`
        : `The ${joinList(notTerms)} were not preregistered.`;
    }

    let deviationsSentence = '';
    if (state.q5 === 'no') {
      deviationsSentence = 'There were no deviations from the preregistration.';
    } else if (state.q5 === 'yes') {
      const devOption = (questions.q6?.options || []).find(o => o.value === state.q6);
      const devPhrase = devOption?.phrase || null;
      const devLocs = state.q7 ? buildDeviationLocations(state.q7) : null;
      if (devPhrase) {
        const loc = devLocs || '[author to say where deviations can be found]';
        deviationsSentence = `There were ${devPhrase} deviations from the preregistration (for details see ${loc}).`;
      }
    }

    const body = [prereggedSentence, notPrereggedSentence, deviationsSentence].filter(Boolean).join(' ');
    return body ? { label: 'Preregistration:', body } : null;
  }

  // ---------------------------------------------------------
  // Public surface
  // ---------------------------------------------------------
  const RTS = {
    $, safeStorage, esc, isValidUrl, normalizeWhitespace,
    placeholderText, renderPolicy, applyRROverlay,
    buildPreregistration, joinList, buildDeviationLocations,
    confirmAsync, alertAsync,
  };

  globalThis.RTS = RTS;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RTS;
  }
})();
