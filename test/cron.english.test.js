/* node test/cron.english.test.js — plain-English schedules (routine reliability, 2026-10-01).
   A live run's routine.create was refused three times for "every day at 7am" / "every Monday at 9am" /
   "every 1st day of the month at 8am" before the model retried in cron. These shapes now parse to the SAME
   stored forms (cron / interval / once); anything ambiguous is still refused, never guessed. */
'use strict';
const A = require('./_assert.js');
const cron = require('../sidecar/cron.js');

const TZ = 'America/New_York';
// Wed 2026-09-30 13:00 New York (17:00Z)
const NOW = Date.parse('2026-09-30T17:00:00Z');
const expr = s => { const r = cron.parseSchedule(s, NOW, { defaultTz: TZ }); return r && r.kind === 'cron' ? r.expr : r ? r.kind : null; };

const CRON_CASES = [
  ['every day at 7am', '0 7 * * *'],
  ['daily at 7:30 pm', '30 19 * * *'],
  ['every morning at 7', '0 7 * * *'],
  ['every evening at 7', '0 19 * * *'],
  ['every morning', '0 9 * * *'],
  ['each day at noon', '0 12 * * *'],
  ['every day at midnight', '0 0 * * *'],
  ['at 9am and 5pm every day', '0 9,17 * * *'],
  ['every weekday at 9am', '0 9 * * 1,2,3,4,5'],
  ['weekdays at 8:30am', '30 8 * * 1,2,3,4,5'],
  ['every weekend at 10am', '0 10 * * 0,6'],
  ['every Monday at 9am', '0 9 * * 1'],
  ['mondays and thursdays at 8pm', '0 20 * * 1,4'],
  ['every mon, wed and fri at 6pm', '0 18 * * 1,3,5'],
  ['every friday', '0 9 * * 5'],
  ['weekly', '0 9 * * 1'],
  ['every 1st day of the month at 8am', '0 8 1 * *'],
  ['on the 15th of every month at noon', '0 12 15 * *'],
  ['first of the month', '0 9 1 * *'],
  ['monthly on the 3rd at 6:45am', '45 6 3 * *'],
  ['monthly', '0 9 1 * *'],
  ['every 2 hours between 9am and 5pm on weekdays', '0 9-17/2 * * 1-5'],
  ['every 2 hours between 9 and 5', '0 9-17/2 * * *'],
  ['every 30 minutes from 9am to 5pm', '*/30 9-16 * * *']
];
for (const [input, want] of CRON_CASES) A.eq(expr(input), want, '"' + input + '" -> ' + want);

// existing grammar is untouched
A.eq(cron.parseSchedule('every day', NOW).kind, 'interval', '"every day" stays the 24h interval it always was');
A.eq(cron.parseSchedule('every 30m', NOW).minutes, 30, 'intervals unchanged');
A.eq(cron.parseSchedule('0 9 * * *', NOW).expr, '0 9 * * *', 'raw cron unchanged');
A.eq(cron.parseSchedule('hourly', NOW).minutes, 60, '"hourly" -> every hour');

// one-shots read on the host's wall clock
const once = s => { const r = cron.parseSchedule(s, NOW, { defaultTz: TZ }); return r && r.kind === 'once' ? new Date(r.runAt).toISOString() : null; };
A.eq(once('tomorrow at 9am'), '2026-10-01T13:00:00.000Z', 'tomorrow at 9am New York');
A.eq(once('today at 5pm'), '2026-09-30T21:00:00.000Z', 'today at 5pm');
A.eq(once('today at 9am'), null, 'today at a time already past is refused, never moved');
A.eq(once('at 9am'), '2026-10-01T13:00:00.000Z', 'a bare "at 9am" after 9am means the next 9am');
A.eq(once('next friday at 3pm'), '2026-10-02T19:00:00.000Z', 'next friday');
A.eq(once('on wednesday at 3pm'), '2026-10-07T19:00:00.000Z', '"on wednesday" said on a Wednesday is next week');
A.eq(once('tonight at 9'), '2026-10-01T01:00:00.000Z', 'tonight at 9 -> 21:00 local');
A.eq(cron.parseSchedule('tomorrow at 9am', NOW, { tz: 'Europe/London' }).runAt, Date.parse('2026-10-01T08:00:00Z'), 'an explicit tz wins');

// a tz rides a cron produced from English
A.eq(cron.parseSchedule('every day at 7am', NOW, { tz: TZ }).tz, TZ, 'tz attached to English cron');

// refusals stay refusals
for (const bad of ['whenever i feel like it', 'last day of every month', 'every day at 25:00', 'at 9:15 and 5:40 every day', 'sometime next week', '']) {
  A.eq(cron.parseSchedule(bad, NOW, { defaultTz: TZ }), null, 'refused: "' + bad + '"');
}

A.report('cron.english');
