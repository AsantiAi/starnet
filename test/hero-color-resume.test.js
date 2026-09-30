/* node test/hero-color-resume.test.js — the hero's saved suit colour follows the crew's hex rule.

   Crew tints are hex-normalized on restore (app.js rehydrateRoster); the hero gets the same rule. Two locks:
     1. resumeInto normalizes a non-hex hero colour to the Orchestrator's gold (same hex rule as the crew);
     2. agGrowth only ever paints a hex colour, whatever object it is handed. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');
const Xp = require('../frontend/app/xp.js');
const resume = require('./_rating-resume.js');

const EVIL = 'red;"><img src=x onerror=alert(1)>';

/* ---- 1. resume normalizes a tampered hero tint ---- */
const baseSave = { v: 2, agent: { id: 'agent', name: 'NOVA', role: 'orchestrator', model: 'test/model', onboarded: true }, agents: [] };
{
  const saved = JSON.parse(JSON.stringify(baseSave));
  saved.agent.color = EVIL;
  const { hero } = resume(saved);
  A.ok(/^#[0-9a-f]{3,8}$/i.test(String(hero.color)), 'a non-hex saved hero colour is replaced on resume: ' + hero.color);
  A.ok(String(hero.color).indexOf('<') < 0, 'no markup survives in the resumed hero colour');
}
{
  const saved = JSON.parse(JSON.stringify(baseSave));
  saved.agent.color = '#7bc88a';
  A.eq(resume(saved).hero.color, '#7bc88a', 'a valid hex hero colour is kept exactly');
}
{
  const saved = JSON.parse(JSON.stringify(baseSave));
  saved.agent.color = 'red; background-image:url(http://x.invalid/beacon)';
  A.ok(/^#[0-9a-f]{3,8}$/i.test(String(resume(saved).hero.color)), 'a CSS-injection hero colour is replaced on resume');
}

/* ---- 2. the GROWTH dossier never paints a non-hex colour (render-site whitelist) ---- */
const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');
const start = source.indexOf('  function agGrowth(a) {');
const end = source.indexOf('\n  function agSkills(agentId) {', start);
A.ok(start >= 0 && end > start, 'the growth dossier renderer can be isolated from stationui.js');
// a calibrated satisfaction gauge is the branch that paints the suit colour — force it so the lock is exercised
const XpKnown = Object.assign({}, Xp, { compute: st => Object.assign({}, Xp.compute(st), { known: true, confidence: 80, band: 'reliable' }) });
const render = vm.runInNewContext(source.slice(start, end) + '\n  agGrowth;', {
  Xp: XpKnown, XpStore: { stationStats: () => null }, present: [{ id: 'agent' }], esc: value => String(value)
});
const stats = Xp.fresh();
const evilHtml = render({ id: 'a', name: 'NOVA', role: 'orchestrator', color: EVIL, stats });
A.ok(evilHtml.indexOf('onerror') < 0 && evilHtml.indexOf('<img') < 0, 'a tampered colour never reaches the GROWTH markup');
const okHtml = render({ id: 'a', name: 'NOVA', role: 'orchestrator', color: '#cf7d96', stats });
const markRe = /class="gx-mark" style="left:\d+%;background:([^;"]+);"/;
const okMark = markRe.exec(okHtml);
A.ok(okMark, 'the calibrated gauge renders its suit-colour mark');
A.eq(okMark[1], '#cf7d96', 'a hex suit colour still marks the satisfaction gauge');
const evilMark = markRe.exec(evilHtml);
A.ok(evilMark, 'the tampered render still draws a well-formed gauge mark');
A.eq(evilMark[1], 'var(--ph-bright)', 'a non-hex colour falls back to the phosphor mark');

A.report('hero-color-resume.test');
