/* node test/provider-accounts.test.js - extra sign-in accounts per subscription provider (subscription stacking). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeProviderAccounts, MAX_ACCOUNTS } = require('../sidecar/provider-accounts.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-accounts-'));
try {
  let n = 0;
  const accts = makeProviderAccounts({ root, randomId: () => ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee', 'ffffffff', 'abababab', 'cdcdcdcd', 'efefefef'][n++] });

  A.eq(accts.list('claude-cli'), [], 'no extra accounts until one is added');
  const a = accts.add('claude-cli');
  const b = accts.add('claude-cli');
  A.eq([a.id, a.seq, b.id, b.seq], ['aaaaaaaa', 1, 'bbbbbbbb', 2], 'ids + creation order');
  A.eq(accts.list('claude-cli').map(x => x.id), ['aaaaaaaa', 'bbbbbbbb'], 'listed oldest first');
  A.ok(fs.statSync(accts.dir('claude-cli', 'aaaaaaaa')).isDirectory(), 'each account is a real folder (the CLI config dir)');
  A.eq(JSON.parse(fs.readFileSync(path.join(a.dir, 'account.json'), 'utf8')), { id: 'aaaaaaaa', seq: 1 }, 'account.json holds no email or token');
  A.eq(accts.list('codex'), [], 'accounts are provider-scoped');

  // a folder the store did not write (or a torn account.json) is not an account
  fs.mkdirSync(path.join(root, 'claude-cli', '12345678'));
  fs.mkdirSync(path.join(root, 'claude-cli', 'not-an-id'));
  A.eq(accts.list('claude-cli').length, 2, 'foreign folders are ignored');

  // hostile input never escapes the root
  A.eq(accts.dir('claude-cli', '../../etc'), null, 'a traversal id resolves to nothing');
  A.eq(accts.dir('openrouter', 'aaaaaaaa'), null, 'an API-key provider takes no sign-in accounts');
  A.eq(accts.remove('claude-cli', '..'), false, 'remove refuses a malformed id');
  let threw = false; try { accts.add('openrouter'); } catch (_) { threw = true; }
  A.ok(threw, 'add refuses a non-subscription provider');

  A.eq(accts.remove('claude-cli', 'aaaaaaaa'), true, 'remove deletes the folder');
  A.eq(accts.list('claude-cli').map(x => x.id), ['bbbbbbbb'], 'the rest keep their order');
  A.eq(accts.remove('claude-cli', 'aaaaaaaa'), false, 'removing twice is a no-op');
  A.eq(accts.add('claude-cli').seq, 3, 'a new account sorts after every existing one');

  // the cap: primary + MAX_ACCOUNTS extras = the credential pool's 8
  while (accts.list('claude-cli').length < MAX_ACCOUNTS) accts.add('claude-cli');
  threw = false; try { accts.add('claude-cli'); } catch (_) { threw = true; }
  A.ok(threw && MAX_ACCOUNTS + 1 === 8, 'at most 8 sign-ins per provider');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
A.report('provider-accounts.test');
