/* sidecar/tools/builtin/browserchallenge.js ? one truthful definition of a browser challenge.

   A verification interstitial is not page content. Both the automatic web reader and the
   interactive browser use this pure classifier so they cannot disagree about whether a page was
   actually reached. Keep this deliberately conservative: false positives hide legitimate content,
   so body-text matching is limited to the short, terse pages real challenge systems return. */
'use strict';

const CHALLENGE_TITLES = [
  'access denied', 'access to this page has been denied', 'blocked', 'bot detected',
  'verification required', 'please verify', 'are you a robot', 'captcha', 'cloudflare',
  'ddos protection', 'checking your browser', 'just a moment', 'attention required'
];

const CHALLENGE_TEXT = /you.?ve been blocked|access( to this site)? (is |has been )?denied|verify (that )?you.?re? (a )?human|complete the (following |security )?(challenge|check)|unusual traffic|confirm .{0,30}(human|not a robot)|enable javascript and cookies to continue|network security/i;

function looksChallenged(title) {
  const low = String(title || '').toLowerCase();
  return CHALLENGE_TITLES.some(pattern => low.indexOf(pattern) >= 0);
}

function looksBlockedText(text) {
  const value = String(text || '').trim();
  return value.length > 0 && value.length < 1200 && CHALLENGE_TEXT.test(value.slice(0, 600));
}

function detectChallenge(page) {
  page = page || {};
  if (looksChallenged(page.title)) return { challenged: true, signal: 'title' };
  if (looksBlockedText(page.text)) return { challenged: true, signal: 'text' };
  return { challenged: false, signal: null };
}

/* STEP-IN (2026-09-29): a sign-in or one-time-code field is NOT a challenge — the page is real content and plenty
   of public pages carry a login box in the header. It is only a HINT: the tool tells the agent the page wants a
   human and names browser.need_human, and the agent decides whether the task needs that account. Inputs are the
   page probe's booleans (visible password field / visible one-time-code field), never field values. */
function detectAuthWall(page) {
  page = page || {};
  if (page.otp === true) return { wall: '2fa', signal: 'a one-time-code field' };
  if (page.password === true) return { wall: 'login', signal: 'a password field' };
  return { wall: null, signal: null };
}

module.exports = { CHALLENGE_TITLES, CHALLENGE_TEXT, looksChallenged, looksBlockedText, detectChallenge, detectAuthWall };
