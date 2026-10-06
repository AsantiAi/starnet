/* sidecar/credit/parse-3b.js — layout-aware parser for a "Three Bureau Credit Report powered by Equifax".
   Input is pdftotext -layout text (or the synthetic fixture). Page footers and form feeds are removed
   before tables are read, because a footer can split a Payment Summary or a Collections block.
   Column starts come from the Equifax / Experian / TransUnion header. Cells may contain single spaces
   and may be separated by only two spaces; a value that overflows its column is split on that gap.
   Money and dates are normalized. Anything unrecognized is left null and recorded as a parse warning.
   Parsing never calls a model and never needs poppler. */
'use strict';
(function (root, factory) {
  const norm = (typeof require === 'function') ? require('./normalize.js') : (root.SK && root.SK.credit && root.SK.credit.normalize);
  const api = factory(norm);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).parse3b = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (norm) {
  'use strict';

  const SECTIONS = [
    ['1', 'Report Summary'],
    ['2', 'Revolving Accounts'],
    ['3', 'Mortgage Accounts'],
    ['4', 'Installment Accounts'],
    ['5', 'Other Accounts'],
    ['6', 'Consumer Statements'],
    ['7', 'Personal Information'],
    ['8', 'Inquiries'],
    ['9', 'Public Records'],
    ['10', 'Collections'],
    ['11', 'Dispute File Information']
  ];
  const SECTION_BY_NUM = {};
  SECTIONS.forEach(pair => { SECTION_BY_NUM[pair[0]] = pair[1]; });
  const CATEGORY = { '2': 'revolving', '3': 'mortgage', '4': 'installment', '5': 'other' };
  const BUREAUS = ['equifax', 'experian', 'transunion'];
  const BUREAU_LABEL = { Equifax: 'equifax', Experian: 'experian', TransUnion: 'transunion' };

  const SUMMARY_FIELDS = [
    ['30 Days Past Due', 'late30'],
    ['60 Days Past Due', 'late60'],
    ['90 Days Past Due', 'late90'],
    ['120 Days Past Due', 'late120'],
    ['Collection Account', 'collection'],
    ['Charge Off', 'chargeOff'],
    ['Included in Bankruptcy', 'bankruptcy'],
    ['Repossession', 'repossession'],
    ['Too New to Rate', 'tooNew'],
    ['No Data Available', 'noData']
  ];
  const DETAIL_FIELDS = [
    ['Account Type', 'accountType', 'text'],
    ['Loan Type', 'loanType', 'text'],
    ['Creditor Classification', 'creditorClassification', 'text'],
    ['Status', 'status', 'text'],
    ['Activity Designator', 'activityDesignator', 'text'],
    ['Date Opened', 'dateOpened', 'date'],
    ['Date Closed', 'dateClosed', 'date'],
    ['Date Reported', 'dateReported', 'date'],
    ['Date Of Last Activity', 'dateLastActivity', 'date'],
    ['Date Of First Delinquency', 'dofd', 'date'],
    ['Deferred Payment Start Date', 'deferredPaymentStartDate', 'date'],
    ['Balloon Payment Date', 'balloonPaymentDate', 'date'],
    ['Term Duration', 'termDuration', 'count'],
    ['Term Frequency', 'termFrequency', 'text'],
    ['Month Reviewed', 'monthsReviewed', 'count'],
    ['Balance', 'balance', 'money'],
    ['Credit Limit', 'creditLimit', 'money'],
    ['High Credit', 'highCredit', 'money'],
    ['Monthly Payment Amount', 'monthlyPayment', 'money'],
    ['Actual Payment Amount', 'actualPayment', 'money'],
    ['Amount Past Due', 'amountPastDue', 'money'],
    ['Balloon Payment Amount', 'balloonPaymentAmount', 'money'],
    ['Charge Off Amount', 'chargeOffAmount', 'money']
  ];
  const COLLECTION_FIELDS = {
    'Date Assigned': ['dateAssigned', 'date'],
    'Original Amount Owed': ['originalAmountOwed', 'money'],
    'Amount': ['amount', 'money'],
    'Status Date': ['statusDate', 'date'],
    'Balance Date': ['balanceDate', 'date'],
    'Purge Date': ['purgeDate', 'date'],
    'Account Designator Code': ['accountDesignatorCode', 'text'],
    'Account Number': ['accountNumberMasked', 'text']
  };

  function isFooter(line) {
    return /^[A-Z][a-z]{2} \d{2}, \d{4} Three Bureau Credit Report powered by Equifax\s+Page \d+ of \d+\s*$/.test(line);
  }

  function prepare(text) {
    const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
    let pages = 0;
    const lines = [];
    for (const original of raw) {
      const chunks = original.split('\f');
      if (original.indexOf('\f') >= 0) pages += (original.match(/\f/g) || []).length ? 0 : 0;
      for (const chunk of chunks) {
        if (isFooter(chunk)) { pages++; continue; }
        if (chunk.indexOf('\f') >= 0) continue;
        lines.push(chunk);
      }
      if (original.indexOf('\f') >= 0 && !isFooter(original.replace(/\f/g, ''))) {
        /* form feed sat on the footer line; already counted when the footer chunk matched */
      }
    }
    // A form feed inside the footer is one page. Count footer matches, not raw form feeds,
    // so a trailing form feed on the footer line is not a second page.
    if (!pages) pages = (String(text || '').match(/Page \d+ of \d+/g) || []).length;
    return { lines: lines, pages: pages || 1 };
  }

  function sectionAt(line) {
    const m = /^(\d+)\. ([A-Za-z].+)$/.exec(line);
    if (!m) return null;
    if (/\s{2,}\d+\s*$/.test(line)) return null;
    if (SECTION_BY_NUM[m[1]] !== m[2]) return null;
    return { num: m[1], title: m[2], heading: m[1] + '. ' + m[2] };
  }

  function accountAt(line) {
    if (!line || /^\s/.test(line) || /\s{2,}\d+\s*$/.test(line)) return null;
    const m = /^(\d+\.\d+) (.+)$/.exec(line.trim());
    if (!m) return null;
    const closedFlag = /\(CLOSED\)\s*$/.test(m[2]);
    return { id: m[1], furnisher: m[2].replace(/\s*\(CLOSED\)\s*$/, '').trim(), closedFlag: closedFlag };
  }

  function headerCols(line) {
    const eq = line.indexOf('Equifax');
    const ex = line.indexOf('Experian');
    const tu = line.indexOf('TransUnion');
    if (eq < 0 || ex < 0 || tu < 0 || !(eq < ex && ex < tu)) return null;
    const rest = line.replace(/Equifax/g, '').replace(/Experian/g, '').replace(/TransUnion/g, '').trim();
    if (rest) return null;
    return [eq, ex, tu];
  }

  function isAligned(line, cols) {
    for (const c of cols) {
      if (c <= 0) return false;
      if (c > line.length) continue;
      if (line.charAt(c - 1) !== ' ') return false;
    }
    return true;
  }

  function splitRow(line, cols) {
    if (isAligned(line, cols)) {
      const values = [];
      for (let i = 0; i < cols.length; i++) {
        const end = i + 1 < cols.length ? cols[i + 1] : line.length;
        values.push(line.slice(cols[i], Math.max(cols[i], end)).trim());
      }
      return { label: line.slice(0, cols[0]).trim(), values: values };
    }
    const parts = line.split(/ {2,}/);
    if (!parts[0].trim()) return { label: '', values: parts.slice(1).map(s => s.trim()).concat(['', '', '']).slice(0, 3) };
    return { label: parts[0].trim(), values: parts.slice(1).map(s => s.trim()).concat(['', '', '']).slice(0, 3) };
  }

  function readTable(lines, start, end) {
    let cols = null;
    const rows = [];
    for (let i = start; i < end; i++) {
      const line = lines[i];
      if (!String(line).trim()) continue;
      const header = headerCols(line);
      if (header) { cols = header; continue; }
      if (!cols) continue;
      const rec = splitRow(line, cols);
      if (!rec.label && rows.length) {
        rec.values.forEach((v, k) => { if (v) rows[rows.length - 1].cells[k].push(v); });
      } else if (rec.label || rec.values.some(Boolean)) {
        rows.push({ label: rec.label, cells: rec.values.map(v => (v ? [v] : [])) });
      }
    }
    return rows;
  }

  function rowByLabel(rows, label) {
    const want = label.toLowerCase();
    for (const row of rows) if (row.label.toLowerCase() === want) return row;
    return null;
  }

  function cellLines(row, idx) { return row && row.cells[idx] ? row.cells[idx] : []; }
  function cellText(row, idx) { return norm.clean(cellLines(row, idx).join(' ')); }

  function applyKind(kind, raw) {
    if (kind === 'money') return { value: norm.parseMoney(raw), raw: norm.textOrNull(raw) };
    if (kind === 'date') return { value: norm.parseDate(raw), raw: norm.textOrNull(raw) };
    if (kind === 'count') return { value: norm.parseCount(raw), raw: norm.textOrNull(raw) };
    return { value: norm.textOrNull(raw), raw: norm.textOrNull(raw) };
  }

  function emptySummary() {
    const o = {};
    SUMMARY_FIELDS.forEach(pair => { o[pair[1]] = null; });
    return o;
  }

  function parsePaymentSummary(lines) {
    if (lines.some(l => /no Payment Summary/i.test(l))) return [null, null, null];
    const rows = readTable(lines, 0, lines.length);
    if (!rows.length) return [null, null, null];
    return [0, 1, 2].map(b => {
      const o = emptySummary();
      SUMMARY_FIELDS.forEach(pair => {
        const row = rowByLabel(rows, pair[0]);
        o[pair[1]] = row ? norm.parseCount(cellText(row, b)) : null;
      });
      return o;
    });
  }

  function parseDetails(lines) {
    if (lines.some(l => /no Account Details/i.test(l))) return [null, null, null];
    const rows = readTable(lines, 0, lines.length);
    if (!rows.length) return [null, null, null];
    return [0, 1, 2].map(b => {
      const details = {};
      const raw = {};
      let any = false;
      DETAIL_FIELDS.forEach(field => {
        const row = rowByLabel(rows, field[0]);
        const got = applyKind(field[2], row ? cellText(row, b) : '');
        details[field[1]] = got.value;
        raw[field[1]] = got.raw;
        if (got.value != null || got.raw) any = true;
      });
      if (!any) return null;
      details.raw = raw;
      return details;
    });
  }

  function parseGrid(lines) {
    if (lines.some(l => /no Payment History/i.test(l))) return { available: false, bureausShown: [] };
    const shown = [];
    for (const line of lines) {
      const id = BUREAU_LABEL[line.trim()];
      if (id && shown.indexOf(id) < 0) shown.push(id);
    }
    return { available: false, bureausShown: shown };
  }

  function parseComments(lines) {
    let col = -1;
    const comments = [];
    const contact = [];
    for (const line of lines) {
      if (col < 0) {
        if (line.indexOf('Comments') >= 0 && line.indexOf('Contact') > line.indexOf('Comments')) col = line.indexOf('Contact');
        continue;
      }
      const left = line.slice(0, col).trim();
      const right = line.slice(col).trim();
      if (left) comments.push(left);
      if (right) contact.push(right);
    }
    const delinquencies = [];
    const re = /(\d{2}\/\d{4})=([A-Za-z0-9]+)/g;
    for (const c of comments) {
      let m;
      while ((m = re.exec(c))) delinquencies.push({ month: m[1], code: m[2] });
    }
    return { comments: comments, contact: { lines: contact }, lastReportedDelinquencies: delinquencies };
  }

  function findAnchor(lines, pred) {
    for (let i = 0; i < lines.length; i++) if (pred(lines[i])) return i;
    return -1;
  }

  function parseAccount(acc) {
    const body = acc.body;
    const ph = findAnchor(body, l => l.trim() === 'Payment History');
    const ps = findAnchor(body, l => l.trim() === 'Payment Summary');
    const ad = findAnchor(body, l => l.trim() === 'Account Details');
    const cm = findAnchor(body, l => l.indexOf('Comments') >= 0 && l.indexOf('Contact') > l.indexOf('Comments'));
    const topEnd = ph >= 0 ? ph : body.length;
    const topRows = readTable(body, 0, topEnd);
    const summaries = parsePaymentSummary(ps >= 0 ? body.slice(ps + 1, ad >= 0 ? ad : body.length) : []);
    const details = parseDetails(ad >= 0 ? body.slice(ad + 1, cm >= 0 ? cm : body.length) : []);
    const grid = parseGrid(ph >= 0 ? body.slice(ph + 1, ps >= 0 ? ps : body.length) : []);
    const notes = parseComments(cm >= 0 ? body.slice(cm) : []);
    const bureaus = {};
    BUREAUS.forEach((id, idx) => {
      const reportedRow = rowByLabel(topRows, 'Reported');
      const reportedText = reportedRow ? cellText(reportedRow, idx) : '';
      const reported = norm.yesNo(reportedText) === true;
      const numberRaw = rowByLabel(topRows, 'Account Number') ? cellText(rowByLabel(topRows, 'Account Number'), idx) : '';
      const statusRaw = rowByLabel(topRows, 'Account Status') ? cellText(rowByLabel(topRows, 'Account Status'), idx) : '';
      const limitRaw = rowByLabel(topRows, 'Credit Limit') ? cellText(rowByLabel(topRows, 'Credit Limit'), idx) : '';
      const balanceRaw = rowByLabel(topRows, 'Reported Balance') ? cellText(rowByLabel(topRows, 'Reported Balance'), idx) : '';
      bureaus[id] = {
        reported: reported,
        accountNumberMasked: norm.textOrNull(numberRaw),
        last4: norm.last4of(numberRaw),
        accountStatus: norm.textOrNull(statusRaw),
        creditLimit: norm.parseMoney(limitRaw),
        reportedBalance: norm.parseMoney(balanceRaw),
        raw: {
          accountNumber: norm.textOrNull(numberRaw),
          accountStatus: norm.textOrNull(statusRaw),
          creditLimit: norm.textOrNull(limitRaw),
          reportedBalance: norm.textOrNull(balanceRaw)
        },
        details: details[idx],
        paymentSummary: summaries[idx]
      };
    });
    return {
      id: acc.id,
      category: acc.category,
      furnisher: acc.furnisher,
      closedFlag: acc.closedFlag,
      contact: notes.contact,
      comments: notes.comments,
      lastReportedDelinquencies: notes.lastReportedDelinquencies,
      paymentGrid: grid,
      bureaus: bureaus
    };
  }

  function sectionLines(lines) {
    const marks = [];
    lines.forEach((line, i) => { const s = sectionAt(line); if (s) marks.push({ i: i, section: s }); });
    return marks.map((m, idx) => {
      const end = idx + 1 < marks.length ? marks[idx + 1].i : lines.length;
      return { section: m.section, lines: lines.slice(m.i + 1, end) };
    });
  }

  function accountsFrom(block, category) {
    const marks = [];
    block.forEach((line, i) => { const a = accountAt(line); if (a) marks.push({ i: i, account: a }); });
    return marks.map((m, idx) => {
      const end = idx + 1 < marks.length ? marks[idx + 1].i : block.length;
      return parseAccount({
        id: m.account.id, furnisher: m.account.furnisher, closedFlag: m.account.closedFlag,
        category: category, body: block.slice(m.i + 1, end)
      });
    });
  }

  function parseOtherItems(lines) {
    const start = lines.findIndex(l => l.trim() === 'Other Credit Items');
    const out = {};
    if (start < 0) return out;
    const key = {
      'consumer statements': 'consumerStatements',
      'personal information': 'personalInformation',
      'inquiries': 'inquiries',
      'public records': 'publicRecords',
      'collections': 'collections'
    };
    for (let i = start; i < lines.length; i++) {
      if (sectionAt(lines[i])) break;
      const parts = lines[i].split(/ {2,}/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 4 && key[parts[0].toLowerCase()]) {
        out[key[parts[0].toLowerCase()]] = parts.slice(1, 4).map(n => (/^\d+$/.test(n) ? parseInt(n, 10) : null));
      }
    }
    return out;
  }

  function parseReportDate(lines) {
    const rows = readTable(lines, 0, lines.length);
    const row = rowByLabel(rows, 'Report Date');
    if (!row) return { iso: null, text: null };
    const text = cellText(row, 0) || cellText(row, 1) || cellText(row, 2);
    return { iso: norm.parseDate(text), text: norm.textOrNull(text) };
  }

  function tocAccountCount(lines) {
    let n = 0;
    for (const line of lines) {
      if (sectionAt(line)) break;
      if (/^\s+\d+\.\d+\s+\S/.test(line) && /\s{2,}\d+\s*$/.test(line)) n++;
    }
    return n;
  }

  function parsePersonal(lines) {
    const idAt = lines.findIndex(l => l.trim() === 'Identification');
    const contactAt = lines.findIndex(l => l.trim() === 'Contact Information');
    const empAt = lines.findIndex(l => l.trim() === 'Employment History');
    const idRows = readTable(lines, idAt >= 0 ? idAt : 0, contactAt >= 0 ? contactAt : lines.length);
    const byBureau = {};
    BUREAUS.forEach((id, idx) => {
      const name = rowByLabel(idRows, 'Name');
      const aka = rowByLabel(idRows, 'Formerly Known As');
      const ssn = rowByLabel(idRows, 'Social Security Number');
      const dob = rowByLabel(idRows, 'Date Of Birth');
      byBureau[id] = {
        name: name ? norm.textOrNull(cellText(name, idx)) : null,
        formerlyKnownAs: norm.akaEntries(cellLines(aka, idx)),
        ssnLast4: ssn ? norm.last4of(cellText(ssn, idx)) : null,
        dob: dob ? norm.parseDate(cellText(dob, idx)) : null
      };
    });
    const contactRows = readTable(lines, contactAt >= 0 ? contactAt : lines.length, empAt >= 0 ? empAt : lines.length);
    const addresses = [];
    let block = null;
    const pushBlock = () => { if (block) addresses.push.apply(addresses, block); block = null; };
    for (const row of contactRows) {
      if (row.label.toLowerCase() === 'information reported') {
        pushBlock();
        block = BUREAUS.map((id, idx) => ({
          bureau: id,
          reported: norm.yesNo(cellText(row, idx)) === true,
          line1: null, cityStateZip: null, status: null, dateReported: null,
          _addr: []
        }));
        continue;
      }
      if (!block) continue;
      if (row.label.toLowerCase() === 'address' || row.label === '') {
        BUREAUS.forEach((id, idx) => {
          cellLines(row, idx).forEach(v => { if (norm.textOrNull(v)) block[idx]._addr.push(norm.clean(v)); });
        });
      } else if (row.label.toLowerCase() === 'status') {
        BUREAUS.forEach((id, idx) => {
          const t = norm.textOrNull(cellText(row, idx));
          block[idx].status = t ? t.toLowerCase() : null;
        });
      } else if (row.label.toLowerCase() === 'date reported') {
        BUREAUS.forEach((id, idx) => { block[idx].dateReported = norm.parseDate(cellText(row, idx)); });
      }
    }
    pushBlock();
    addresses.forEach(a => {
      const linesOf = a._addr.filter(v => v && v !== 'N/A');
      a.line1 = linesOf[0] || null;
      a.cityStateZip = linesOf.length > 1 ? linesOf.slice(1).join(' ') : null;
      delete a._addr;
    });
    const employment = parseEmployment(empAt >= 0 ? lines.slice(empAt + 1) : []);
    return { byBureau: byBureau, addresses: addresses, employment: employment };
  }

  function parseEmployment(lines) {
    const rows = [];
    let bureau = null;
    let cols = null;
    for (const line of lines) {
      const t = line.trim();
      if (BUREAU_LABEL[t]) { bureau = BUREAU_LABEL[t]; cols = null; continue; }
      if (/^Company\s+Occupation\s+Start Date/.test(line)) {
        cols = {
          company: line.indexOf('Company'),
          occupation: line.indexOf('Occupation'),
          start: line.indexOf('Start Date'),
          end: line.indexOf('End Date'),
          status: line.indexOf('Status'),
          address: line.indexOf('Address')
        };
        continue;
      }
      if (!bureau || !cols || !t) continue;
      const status = line.slice(cols.status, cols.address).trim();
      if (status !== 'Current' && status !== 'Former') {
        if (rows.length && rows[rows.length - 1].bureau === bureau) {
          rows[rows.length - 1].company = norm.clean(rows[rows.length - 1].company + ' ' + t);
        }
        continue;
      }
      const slice = (a, b) => line.slice(a, b).trim();
      rows.push({
        bureau: bureau,
        company: norm.textOrNull(slice(cols.company, cols.occupation)),
        occupation: norm.textOrNull(slice(cols.occupation, cols.start)),
        start: norm.parseDate(slice(cols.start, cols.end)),
        end: norm.parseDate(slice(cols.end, cols.status)),
        status: status.toLowerCase()
      });
    }
    return rows;
  }

  function parseInquiries(lines) {
    const out = [];
    let mode = null;
    let bureau = null;
    let cols = null;
    for (const line of lines) {
      const t = line.trim();
      if (t === 'Hard Inquiries') { mode = 'hard'; bureau = null; cols = null; continue; }
      if (t === 'Soft Inquiries') { mode = 'soft'; bureau = null; cols = null; continue; }
      if (!mode) continue;
      if (BUREAU_LABEL[t]) { bureau = BUREAU_LABEL[t]; cols = null; continue; }
      if (line.indexOf('Date') >= 0 && line.indexOf('Company') > line.indexOf('Date') && line.indexOf('Address') > line.indexOf('Company')) {
        cols = { date: line.indexOf('Date'), company: line.indexOf('Company'), address: line.indexOf('Address') };
        continue;
      }
      if (!bureau || !cols || !t) continue;
      if (/^You currently have no /i.test(t)) continue;
      const date = line.slice(cols.date, cols.company).trim();
      const company = line.slice(cols.company, cols.address).trim();
      const address = line.slice(cols.address).trim().replace(/[ \t]{2,}/g, ' ');
      if (!date && !company && address && out.length) {
        out[out.length - 1].address.push(address);
        continue;
      }
      if (!date || !company) continue;
      out.push({
        bureau: bureau, type: mode, date: norm.parseDate(date), dateText: date,
        company: company, address: address ? [address] : []
      });
    }
    return out;
  }

  function parsePublicRecords(lines) {
    const buckets = { Bankruptcies: [], Judgments: [], Liens: [] };
    const raw = [];
    let kind = null;
    let buf = [];
    const flush = () => {
      if (!kind) { buf = []; return; }
      const text = buf.join('\n');
      const empty = new RegExp('You currently have no ' + kind + ' on your credit file\\.', 'i').test(text);
      const dataish = buf.some(l => /\$\d|\b\d{2}\/\d{2}\/\d{4}\b|Case No|Docket|Court name/i.test(l));
      if (!empty || dataish) raw.push({ kind: kind.toLowerCase(), text: text.trim() });
      kind = null;
      buf = [];
    };
    for (const line of lines) {
      const t = line.trim();
      if (buckets[t]) { flush(); kind = t; continue; }
      if (kind) buf.push(line);
    }
    flush();
    return { bankruptcies: [], judgments: [], liens: [], raw: raw };
  }

  function parseCollections(lines) {
    const out = [];
    let cur = null;
    const start = () => {
      cur = {
        bureau: null, dateReported: null, agencyClient: null, dateAssigned: null,
        originalAmountOwed: null, amount: null, statusDate: null, balanceDate: null,
        purgeDate: null, accountDesignatorCode: null, accountNumberMasked: null, last4: null,
        raw: {}
      };
      out.push(cur);
    };
    for (const line of lines) {
      const t = line.trim();
      if (BUREAU_LABEL[t]) { start(); cur.bureau = BUREAU_LABEL[t]; continue; }
      if (!cur || !t) continue;
      let m = /^Date Reported:\s*(.+)$/.exec(t);
      if (m) { cur.raw.dateReported = norm.clean(m[1]); cur.dateReported = norm.parseDate(m[1]); continue; }
      m = /^Agency Client:\s*(.+)$/.exec(t);
      if (m) { cur.agencyClient = norm.clean(m[1]); cur.raw.agencyClient = cur.agencyClient; continue; }
      m = /^([A-Za-z][A-Za-z ]+?)\s{2,}(\S.*)$/.exec(t);
      if (!m) continue;
      const spec = COLLECTION_FIELDS[m[1].trim()];
      if (!spec) continue;
      const raw = norm.clean(m[2]);
      cur.raw[spec[0]] = raw;
      if (spec[0] === 'accountNumberMasked') {
        cur.accountNumberMasked = norm.textOrNull(raw);
        cur.last4 = norm.last4of(raw);
      } else if (spec[1] === 'money') cur[spec[0]] = norm.parseMoney(raw);
      else if (spec[1] === 'date') cur[spec[0]] = norm.parseDate(raw);
      else cur[spec[0]] = norm.textOrNull(raw);
    }
    return out.filter(c => c.bureau);
  }

  function emptyReport(warnings, pages) {
    return {
      schemaVersion: 1,
      source: { format: null, reportDate: null, reportDateText: null, pages: pages || 0 },
      sectionsFound: [],
      reconciliation: { otherItems: {}, tocAccountCount: 0 },
      personal: { byBureau: { equifax: {}, experian: {}, transunion: {} }, addresses: [], employment: [] },
      tradelines: [],
      inquiries: [],
      publicRecords: { bankruptcies: [], judgments: [], liens: [], raw: [] },
      collections: [],
      parseWarnings: warnings
    };
  }

  function parse3b(text) {
    const prep = prepare(text);
    const lines = prep.lines;
    const blob = lines.join('\n');
    const recognized = /Three Bureau Credit Report/.test(blob) && /powered by/.test(blob);
    if (!recognized) {
      return emptyReport([{ code: 'UNRECOGNIZED_FORMAT', where: 'report', detail: 'text is not a Three Bureau Credit Report powered by Equifax' }], prep.pages);
    }
    const spans = sectionLines(lines);
    const found = spans.map(s => s.section.heading);
    const warnings = [];
    SECTIONS.forEach(pair => {
      const heading = pair[0] + '. ' + pair[1];
      if (found.indexOf(heading) < 0) warnings.push({ code: 'SECTION_MISSING', where: heading, detail: 'section not found' });
    });
    const byHeading = {};
    spans.forEach(s => { byHeading[s.section.heading] = s.lines; });
    const summary = byHeading['1. Report Summary'] || [];
    const date = parseReportDate(summary);
    const tradelines = []
      .concat(accountsFrom(byHeading['2. Revolving Accounts'] || [], 'revolving'))
      .concat(accountsFrom(byHeading['3. Mortgage Accounts'] || [], 'mortgage'))
      .concat(accountsFrom(byHeading['4. Installment Accounts'] || [], 'installment'))
      .concat(accountsFrom(byHeading['5. Other Accounts'] || [], 'other'));
    return {
      schemaVersion: 1,
      source: { format: 'three-bureau-equifax-powered', reportDate: date.iso, reportDateText: date.text, pages: prep.pages },
      sectionsFound: found,
      reconciliation: { otherItems: parseOtherItems(summary), tocAccountCount: tocAccountCount(lines) },
      personal: parsePersonal(byHeading['7. Personal Information'] || []),
      tradelines: tradelines,
      inquiries: parseInquiries(byHeading['8. Inquiries'] || []),
      publicRecords: parsePublicRecords(byHeading['9. Public Records'] || []),
      collections: parseCollections(byHeading['10. Collections'] || []),
      parseWarnings: warnings
    };
  }

  return { parse3b, prepare, _internals: { headerCols, splitRow, readTable } };
});
