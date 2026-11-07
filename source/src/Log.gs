/**
 * Log.gs — the append-only log, its hash chain, daily seals and verification.
 *
 * Every row carries row_hash = SHA-256(previous row_hash + this row's columns).
 * Editing, inserting or deleting any earlier row breaks every hash after it.
 * Each night the day's rows and the latest hash are emailed (sealYesterday), so an
 * outside copy with Gmail's own timestamp exists for comparison.
 */
var GENESIS = 'GENESIS';
var LOG_HEADERS = Core.LOG_COLS.concat(['row_hash']);

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function logTab_(year) {
  var ss = ss_();
  var name = 'Log ' + year;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, 0);
    sh.getRange(1, 1, sh.getMaxRows(), LOG_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.protect().setDescription('Work timeline log: add rows only through the script')
      .setWarningOnly(true);
  }
  return sh;
}

/** Log tabs, oldest year first. */
function logTabs_() {
  return ss_().getSheets()
    .filter(function (s) { return /^Log \d{4}$/.test(s.getName()); })
    .sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
}

/** Last id number and hash, read from the sheet itself (the sheet is the source of truth). */
function chainHead_() {
  var tabs = logTabs_();
  for (var i = tabs.length - 1; i >= 0; i--) {
    var sh = tabs[i];
    var last = sh.getLastRow();
    if (last > 1) {
      var v = sh.getRange(last, 1, 1, LOG_HEADERS.length).getValues()[0];
      return { seq: parseInt(String(v[0]).replace(/\D/g, ''), 10) || 0, hash: String(v[LOG_HEADERS.length - 1]) };
    }
  }
  return { seq: 0, hash: GENESIS };
}

/** Sheets would turn "=…" or "+…" into formulas; a leading apostrophe keeps them as text. */
function cellSafe_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

/** Appends rows (objects with Core.LOG_COLS fields). Returns how many were written. */
function appendRows_(rows) {
  if (!rows || !rows.length) return 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    var head = chainHead_();
    var prev = head.hash;
    var seq = head.seq;
    var now = Core.toBkkIso(new Date());
    var out = rows.map(function (r) {
      seq++;
      r.id = 'WT' + ('000000' + seq).slice(-7);
      r.collected_at = now;
      var vals = Core.LOG_COLS.map(function (c) { return r[c] === null || r[c] === undefined ? '' : String(r[c]); });
      var h = sha256Hex_(Core.canonical(r, prev));
      prev = h;
      return vals.map(cellSafe_).concat([h]);
    });
    var sh = logTab_(now.slice(0, 4));
    sh.getRange(sh.getLastRow() + 1, 1, out.length, LOG_HEADERS.length).setNumberFormat('@').setValues(out);
    SpreadsheetApp.flush();
    return out.length;
  } finally {
    lock.releaseLock();
  }
}

/** Rows as objects. years: list of 'YYYY' to read, or all tabs when omitted. */
function readLog_(years) {
  var rows = [];
  logTabs_().forEach(function (sh) {
    if (years && years.indexOf(sh.getName().slice(4)) < 0) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    sh.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues().forEach(function (v) {
      var o = {};
      LOG_HEADERS.forEach(function (h, i) { o[h] = String(v[i]); });
      rows.push(o);
    });
  });
  return rows;
}

/* ---------- index of what has been seen (hidden tab) ---------- */

function loadIndex_() {
  var sh = ss_().getSheetByName('Index');
  var map = {};
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
      if (r[0]) { try { map[r[0]] = JSON.parse(r[1]); } catch (e) { /* skip bad row */ } }
    });
  }
  return map;
}

function saveIndex_(map) {
  var sh = ss_().getSheetByName('Index');
  var keys = Object.keys(map);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 2).clearContent();
  if (!keys.length) return;
  var vals = keys.map(function (k) { return [k, JSON.stringify(map[k])]; });
  sh.getRange(2, 1, vals.length, 2).setNumberFormat('@').setValues(vals);
}

/* ---------- seals ---------- */

function sealYesterday() {
  return sealDay(Core.addDays(Core.toBkkIso(new Date()).slice(0, 10), -1));
}

/** Emails the rows collected on dateStr (Bangkok) plus the chain hash, and records it in Seals. */
function sealDay(dateStr) {
  var seals = ss_().getSheetByName('Seals');
  var existing = seals.getLastRow() > 1 ? seals.getRange(2, 1, seals.getLastRow() - 1, 1).getValues() : [];
  if (existing.some(function (r) { return String(r[0]) === dateStr; })) return 'Already sealed: ' + dateStr;

  var y = parseInt(dateStr.slice(0, 4), 10);
  var all = readLog_([String(y - 1), String(y)]);
  var upTo = all.filter(function (r) { return r.collected_at.slice(0, 10) <= dateStr; });
  var day = upTo.filter(function (r) { return r.collected_at.slice(0, 10) === dateStr; });
  var hash = upTo.length ? upTo[upTo.length - 1].row_hash : GENESIS;
  var first = day.length ? day[0].id : '';
  var lastId = day.length ? day[day.length - 1].id : '';

  var csv = [Core.csvLine(LOG_HEADERS)].concat(day.map(function (r) {
    return Core.csvLine(LOG_HEADERS.map(function (h) { return r[h]; }));
  })).join('\r\n');

  var to = cfg_().SEAL_RECIPIENTS || Session.getEffectiveUser().getEmail();
  var subject = '[Work timeline] Seal ' + dateStr + ' · ' + day.length + ' rows · ' + hash.slice(0, 12);
  var body = [
    'Daily seal of the work timeline log.',
    '',
    'Date (collected): ' + dateStr,
    'Rows: ' + day.length + (day.length ? ' (' + first + ' to ' + lastId + ')' : ''),
    'Chain hash after this day: ' + hash,
    '',
    'The attached CSV is an exact copy of the rows as collected.',
    'Keep this email. If the log is ever questioned, run "Verify log" and compare this hash.'
  ].join('\n');
  var blob = Utilities.newBlob('﻿' + csv, 'text/csv', 'timeline-' + dateStr + '.csv');
  var opts = { attachments: [blob], name: 'Work timeline' };
  try {
    opts.htmlBody = dayReportHtml_(dayData_(dateStr), { rows: day.length, first: first, last: lastId, hash: hash });
  } catch (e) {
    body += '\n\n(The graphical timeline could not be built: ' + e.message + ')';   // never block the seal
  }
  GmailApp.sendEmail(to, subject, body, opts);

  seals.appendRow([dateStr, String(day.length), first, lastId, hash, Core.toBkkIso(new Date()), to]);
  setStatus_('seal', true, 'Sealed ' + dateStr + ' (' + day.length + ' rows)');
  return subject;
}

/* ---------- verification ---------- */

/** Recomputes every hash and checks it against the stored hashes and the Seals tab. */
function verifyLog() {
  var rows = readLog_();
  var prev = GENESIS;
  var computedById = {};
  var problems = [];
  rows.forEach(function (r) {
    var h = sha256Hex_(Core.canonical(r, prev));
    computedById[r.id] = h;
    if (h !== r.row_hash && problems.length < 20) problems.push('Row ' + r.id + ' does not match its hash (edited, inserted or deleted near here).');
    prev = r.row_hash; // keep checking each row against its own stored predecessor
  });
  var seals = ss_().getSheetByName('Seals');
  if (seals.getLastRow() > 1) {
    seals.getRange(2, 1, seals.getLastRow() - 1, 5).getValues().forEach(function (s) {
      var lastId = String(s[3]);
      if (lastId && computedById[lastId] && computedById[lastId] !== String(s[4])) {
        problems.push('Seal ' + s[0] + ' does not match the log at ' + lastId + '.');
      }
    });
  }
  var msg = problems.length
    ? 'Problems found:\n' + problems.join('\n')
    : 'Log OK: ' + rows.length + ' rows, every hash matches, all seals match.';
  setStatus_('verify', !problems.length, msg.split('\n')[0]);
  return msg;
}
