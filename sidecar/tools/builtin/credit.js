/* sidecar/tools/builtin/credit.js — credit-dispute tools for the Legal Assistant.
   credit.parse_report, credit.review_case, credit.draft_letters, credit.list_drafts.
   Every letter is stored as DRAFT or DRAFT_NEEDS_FIX. There is no send, mail, fax, post, or approve
   tool: approval is a human action outside v1. Tool results are redacted summaries (counts, flags,
   masked last-4s, furnisher names, file paths). The letter text stays on disk in the workspace. */
'use strict';
(function (root, factory) {
  const api = factory(
    require('../../credit/extract.js'),
    require('../../credit/parse-3b.js'),
    require('../../credit/review.js'),
    require('../../credit/case.js'),
    require('../../credit/letters.js'),
    require('../../credit/store.js')
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).credit = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (extractMod, parseMod, reviewMod, caseMod, lettersMod, storeMod) {
  'use strict';

  function makeCreditTools(deps) {
    deps = deps || {};
    const fs = deps.fs;
    const pathMod = deps.pathMod || require('path');
    const root = deps.root || '';
    const clock = deps.clock || { now: () => 0 };
    if (!fs) throw new Error('credit tools require { fs }');
    const store = deps.store || storeMod.makeStore({ fs: deps.storeFs || fs, path: pathMod, root: root, clock: clock });
    const extractor = extractMod.makeExtractor({ spawn: deps.spawn, fs: fs, timeoutMs: deps.timeoutMs || 20000 });

    function nowIso() {
      const n = Number(clock.now());
      if (!Number.isFinite(n)) return '1970-01-01T00:00:00.000Z';
      return new Date(n).toISOString();
    }

    function underRoot(p) {
      const base = pathMod.resolve(root || process.cwd());
      const abs = pathMod.resolve(base, String(p || ''));
      if (!root) return { abs: abs };
      if (abs !== base && abs.indexOf(base + pathMod.sep) !== 0) return { error: 'That path is outside the workspace.' };

      // A lexical path check alone can be bypassed by a symlink inside the workspace
      // that points to a report (or arbitrary file) outside it. Resolve both paths
      // before handing the path to the extractor.
      try {
        const realBase = fs.realpathSync(base);
        const realAbs = fs.realpathSync(abs);
        if (realAbs !== realBase && realAbs.indexOf(realBase + pathMod.sep) !== 0) {
          return { error: 'That path is outside the workspace.' };
        }
        return { abs: realAbs };
      } catch (_) {
        return { error: 'That path could not be resolved inside the workspace.' };
      }
    }

    async function loadReport(p) {
      const loc = underRoot(p);
      if (loc.error) return { ok: false, error: loc.error };
      const extracted = await extractor.extract(loc.abs);
      if (!extracted.ok) return extracted;
      return { ok: true, report: parseMod.parse3b(extracted.text) };
    }

    function readIntake(args) {
      if (args && args.intake && typeof args.intake === 'object') return { ok: true, intake: args.intake };
      if (args && args.intakePath) {
        const loc = underRoot(args.intakePath);
        if (loc.error) return { ok: false, error: loc.error };
        try { return { ok: true, intake: JSON.parse(fs.readFileSync(loc.abs, 'utf8')) }; }
        catch (e) { return { ok: false, error: 'Could not read the intake file.' }; }
      }
      return { ok: false, error: 'Pass intake or intakePath.' };
    }

    function flagLine(f) {
      return '- ' + f.severity + ' ' + f.code + (f.where ? ' @ ' + f.where : '') + (f.pattern ? ' pattern ' + f.pattern : '');
    }

    /* Drop identity strings if a summary ever interpolates them. Furnisher names and last-4s stay. */
    function redact(summary, intake) {
      let s = String(summary == null ? '' : summary);
      const c = intake && intake.consumer;
      if (c) {
        [c.fullName, c.addressLine1, c.cityStateZip, c.dob].forEach(v => {
          if (v) s = s.split(String(v)).join('[redacted]');
        });
      }
      return s;
    }

    function persist(intake, report, drafted) {
      const createdAt = nowIso();
      const letterIndex = [];
      const paths = [];
      (drafted.letters || []).forEach(letter => {
        letter.meta.createdAt = letter.meta.createdAt || createdAt;
        letter.meta.caseId = drafted.caseId;
        const saved = store.saveLetter(drafted.caseId, letter);
        paths.push(saved.md);
        letterIndex.push({
          bureau: letter.bureau,
          status: letter.meta.status,
          pattern: letter.meta.pattern,
          md: saved.md,
          accounts: (letter.meta.accounts || []).map(a => ({ furnisher: a.furnisher, last4: a.last4, pattern: a.pattern }))
        });
      });
      store.saveCase({
        schemaVersion: 1,
        caseId: drafted.caseId,
        status: drafted.letters && drafted.letters.length ? drafted.status : 'NEEDS_REVIEW',
        createdAt: createdAt,
        updatedAt: createdAt,
        missingFields: drafted.missingFields || [],
        flags: drafted.flags || [],
        letters: letterIndex,
        intake: intake || null,
        reportDate: report && report.source ? report.source.reportDate : null
      });
      return paths;
    }

    const parseTool = {
      name: 'credit.parse_report',
      capability: 'credit',
      scope: 'read',
      readOnly: true,
      impact: 'none',
      requiresConsent: false,
      timeoutMs: 30000,
      description: 'Parse an uploaded three-bureau credit report (.pdf via pdftotext -layout, or a pre-extracted .txt). Returns a redacted summary: counts, sections, review-flag codes, furnisher names, and masked last-4s. Does not return the consumer name, date of birth, address, or full account numbers. Does not draft or send anything.',
      schema: { type: 'object', required: ['path'], properties: { path: { type: 'string', description: 'Workspace path to the report PDF or text file.' } } },
      run: async (args) => {
        const loaded = await loadReport(args && args.path);
        if (!loaded.ok) throw new Error(loaded.error || 'parse failed');
        const flags = reviewMod.reviewReport(loaded.report);
        const content = redact([
          'Parsed ' + (loaded.report.source.format || 'unrecognized') + ' report dated ' + (loaded.report.source.reportDate || 'unknown') + ' (' + loaded.report.source.pages + ' pages).',
          'Tradelines: ' + loaded.report.tradelines.length + '. Inquiries: ' + loaded.report.inquiries.length + '. Collections: ' + loaded.report.collections.length + '.',
          'Sections found: ' + loaded.report.sectionsFound.length + '. Parse warnings: ' + loaded.report.parseWarnings.length + '. Flags: ' + flags.length + '.',
          'Furnishers: ' + loaded.report.tradelines.map(t => t.id + ' ' + t.furnisher).join('; '),
          flags.map(flagLine).join('\n')
        ].join('\n'), null);
        return { content: content, summary: loaded.report.tradelines.length + ' tradelines, ' + flags.length + ' flags' };
      }
    };

    const reviewTool = {
      name: 'credit.review_case',
      capability: 'credit',
      scope: 'read',
      readOnly: true,
      impact: 'none',
      requiresConsent: false,
      timeoutMs: 30000,
      description: 'Compare an intake with a parsed credit report and list BLOCK, REVIEW, and INFO flags. Incomplete or unmatched intake is flagged for a person; this tool does not draft a letter and does not send anything. The result is a redacted summary.',
      schema: { type: 'object', properties: {
        reportPath: { type: 'string' },
        intakePath: { type: 'string' },
        intake: { type: 'object' }
      } },
      run: async (args) => {
        args = args || {};
        let report = null;
        if (args.reportPath) {
          const loaded = await loadReport(args.reportPath);
          if (!loaded.ok) throw new Error(loaded.error || 'review failed');
          report = loaded.report;
        }
        const intakeRes = (args.intake || args.intakePath) ? readIntake(args) : { ok: true, intake: null };
        if (!intakeRes.ok) throw new Error(intakeRes.error || 'review failed');
        const evaluation = intakeRes.intake ? caseMod.evaluate(intakeRes.intake, report) : { caseId: null, status: 'NEEDS_REVIEW', missingFields: [], flags: report ? reviewMod.reviewReport(report) : [] };
        if (intakeRes.intake) persist(intakeRes.intake, report, { caseId: evaluation.caseId, status: evaluation.status, missingFields: evaluation.missingFields, flags: evaluation.flags, letters: [] });
        const lines = ['Case ' + (evaluation.caseId || '(no intake)') + ' status ' + evaluation.status + '.'];
        if (evaluation.missingFields && evaluation.missingFields.length) lines.push('MISSING FIELDS: ' + evaluation.missingFields.join(', '));
        lines.push('Flags: ' + evaluation.flags.length + '.');
        evaluation.flags.forEach(f => lines.push(flagLine(f)));
        lines.push('No letter was drafted.');
        return { content: redact(lines.join('\n'), intakeRes.intake), summary: evaluation.status };
      }
    };

    const draftTool = {
      name: 'credit.draft_letters',
      capability: 'credit',
      scope: 'write',
      readOnly: false,
      impact: 'none',
      requiresConsent: false,
      timeoutMs: 30000,
      description: 'Draft a round-1 bureau dispute letter and save it as DRAFT (or DRAFT_NEEDS_FIX if the validator fails). Returns a redacted summary and the file path. Does not return the letter text. Does not send, mail, fax, or approve. Other letter types are reported as NOT_IMPLEMENTED. Missing or unmatched intake is flagged for a person and no letter is written.',
      schema: { type: 'object', properties: {
        reportPath: { type: 'string' },
        intakePath: { type: 'string' },
        intake: { type: 'object' }
      } },
      run: async (args) => {
        args = args || {};
        const intakeRes = readIntake(args);
        if (!intakeRes.ok) throw new Error(intakeRes.error || 'draft failed');
        let report = null;
        if (args.reportPath) {
          const loaded = await loadReport(args.reportPath);
          if (!loaded.ok) throw new Error(loaded.error || 'draft failed');
          report = loaded.report;
        }
        const drafted = lettersMod.draftRound1(intakeRes.intake, report, { createdAt: nowIso() });
        const paths = persist(intakeRes.intake, report, drafted);
        const lines = [];
        if (drafted.missingFields && drafted.missingFields.length) {
          lines.push('MISSING FIELDS: ' + drafted.missingFields.join(', '));
          lines.push('No letter was drafted. Case ' + drafted.caseId + ' status NEEDS_REVIEW.');
        } else if (!drafted.letters.length) {
          lines.push('No letter was drafted. Case ' + drafted.caseId + ' status ' + drafted.status + '.');
          drafted.flags.forEach(f => lines.push(flagLine(f)));
        } else {
          const letter = drafted.letters[0];
          lines.push('Saved 1 letter. Status ' + letter.meta.status + '. Case ' + drafted.caseId + '. Bureau ' + letter.bureau + '. Pattern ' + (letter.meta.pattern || '') + '.');
          lines.push('Disputed items: ' + letter.meta.accounts.map(a => a.furnisher + ' last4 ' + (a.last4 || 'none')).join('; ') + '.');
          lines.push('File: ' + (paths[0] || ''));
          lines.push(letter.meta.wordSpacingNote);
          if (drafted.flags.length) lines.push('Flags: ' + drafted.flags.length + '.');
        }
        return { content: redact(lines.join('\n'), intakeRes.intake), summary: drafted.status };
      }
    };

    const listTool = {
      name: 'credit.list_drafts',
      capability: 'credit',
      scope: 'read',
      readOnly: true,
      impact: 'none',
      requiresConsent: false,
      timeoutMs: 5000,
      description: 'List saved credit-dispute drafts. Returns case ids, letter status (DRAFT or DRAFT_NEEDS_FIX), bureau, furnisher names, masked last-4s, and file paths. Does not return letter text, the consumer name, date of birth, or address. Does not send or approve anything.',
      schema: { type: 'object', properties: { caseId: { type: 'string' } } },
      run: async (args) => {
        const wanted = args && args.caseId;
        const ids = wanted ? [wanted] : store.listCases();
        if (!ids.length) return { content: 'No credit-dispute drafts.', summary: '0 drafts' };
        const lines = [ids.length + ' case(s).'];
        ids.forEach(id => {
          const rec = store.readCase(id);
          if (!rec) { lines.push('Case ' + id + ' was not found.'); return; }
          const letters = store.listLetters(id);
          lines.push('Case ' + id + ' status ' + rec.status + '.');
          if (rec.missingFields && rec.missingFields.length) lines.push('MISSING FIELDS: ' + rec.missingFields.join(', '));
          if (!letters.length) lines.push('No letter file.');
          letters.forEach(l => {
            const accounts = (l.meta.accounts || []).map(a => a.furnisher + ' last4 ' + (a.last4 || 'none')).join('; ');
            lines.push(l.meta.bureau + ' ' + l.meta.status + ' pattern ' + (l.meta.pattern || '') + ' ' + accounts + ' file ' + l.mdPath);
          });
        });
        return { content: lines.join('\n'), summary: ids.length + ' case(s)' };
      }
    };

    const tools = [parseTool, reviewTool, draftTool, listTool];
    return {
      tools: tools,
      parseTool: parseTool,
      reviewTool: reviewTool,
      draftTool: draftTool,
      listTool: listTool,
      register(reg) { tools.forEach(t => reg.register(t)); return reg; }
    };
  }

  return { makeCreditTools };
});
