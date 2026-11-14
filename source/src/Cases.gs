/**
 * Cases.gs — the Cases tab: one row per case, LINE codes, case status and its history.
 *
 * Status:
 *  - The hourly run detects case steps from what appears in each Inquiry Copilot case folder
 *    (Core.STATUS_RULES) and puts the latest one in "detected", waiting for him.
 *  - He confirms it ("ยืนยัน" in the confirm column, or the button in the app) or drops it ("ไม่ใช้").
 *    A confirmed step keeps the date it was first detected (status_at) and the date he confirmed it (confirmed_at).
 *  - He can also type or pick a status himself; then both dates are the time he typed it.
 *  - The complainant sees only the current status. Every status ever set is logged (kind case_status, hash-chained),
 *    and Case report gives him the whole history to pass on.
 */
var CASE_HEADERS = ['case_folder', 'case_no', 'note', 'closed', 'line_code', 'status', 'status_at', 'confirmed_at',
  'detected', 'detected_at', 'confirm', 'skipped_at'];
var CC = { folder: 1, caseNo: 2, note: 3, closed: 4, code: 5, status: 6, statusAt: 7, confirmedAt: 8,
  detected: 9, detectedAt: 10, confirm: 11, skipped: 12 };
var CONFIRM_YES = 'ยืนยัน', CONFIRM_NO = 'ไม่ใช้';

function caseStatuses_() {
  return [Core.START_STATUS].concat(Core.STATUS_RULES.map(function (r) { return r.text; }),
    Core.MANUAL_STATUSES.filter(function (s) { return s !== Core.START_STATUS; }));
}

/** "2026-11-05_0939-…" -> "2026-11-05 09:39", the moment the case began (its starting status time). */
function caseStartStamp_(folder) {
  var i = Core.caseFolderInfo(folder);
  return i ? i.start + ' ' + i.time : '';
}

/** "2026-11-08T02:40:31+07:00" -> "2026-11-08 02:40" (Bangkok, the way the tab shows times). */
function stamp_(iso) { return iso ? String(iso).slice(0, 16).replace('T', ' ') : ''; }
function nowStamp_() { return stamp_(Core.toBkkIso(new Date())); }
/** "2026-11-08 02:40" or "2026-11-08" -> ISO, '' if not a date. */
function stampIso_(st) {
  var m = String(st || '').match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
  return m ? m[1] + 'T' + (m[2] || '00:00') + ':00+07:00' : '';
}

/** The Cases tab, with any missing columns, notes and drop-downs added (safe to call every time). */
function casesTab_() {
  var ss = ss_();
  var sh = ss.getSheetByName('Cases');
  if (!sh) sh = ensureTab_(ss, 'Cases', CASE_HEADERS);
  if (sh.getMaxColumns() < CASE_HEADERS.length) fitColumns_(sh, CASE_HEADERS.length);
  var head = sh.getRange(1, 1, 1, CASE_HEADERS.length).getValues()[0];
  if (CASE_HEADERS.some(function (h, i) { return String(head[i]) !== h; })) {
    sh.getRange(1, 1, 1, CASE_HEADERS.length).setValues([CASE_HEADERS]).setFontWeight('bold');
    var note = function (col, text) { sh.getRange(1, col).setNote(text); };
    note(1, 'One row per case folder, added automatically every hour.');
    note(CC.closed, 'closed = date the file went to the prosecutor or the case ended (2026-12-01). The last progress notice is due then.');
    note(CC.code, 'line_code = the code a complainant enters in the LINE page. Give it only to them. Clear it to make a new one (old followers lose access).');
    note(CC.status, 'status = what the complainant sees on the LINE page. Pick or type one, or confirm a detected one (columns I–K).');
    note(CC.statusAt, 'status_at = when that progress happened (the date it was first detected, or when you typed it).');
    note(CC.confirmedAt, 'confirmed_at = when you confirmed or typed the status.');
    note(CC.detected, 'detected = a step found in the case folder, waiting for you. The complainant doesn\'t see it until you confirm.');
    note(CC.confirm, 'Choose ยืนยัน to make the detected step the status (it keeps the detected date), or ไม่ใช้ to drop it.');
    note(CC.skipped, 'skipped_at = detections up to this time were dropped (ไม่ใช้). Filled automatically.');
    var rows = sh.getMaxRows() - 1;
    sh.getRange(2, CC.status, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(caseStatuses_(), true).setAllowInvalid(true).build());
    sh.getRange(2, CC.confirm, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList([CONFIRM_YES, CONFIRM_NO], true).setAllowInvalid(false).build());
    [CC.code, CC.statusAt, CC.confirmedAt, CC.detected, CC.detectedAt, CC.skipped].forEach(function (c) {
      sh.getRange(2, c, rows, 1).setNumberFormat('@');
    });
  }
  return sh;
}

/** Cases tab rows as objects. */
function readCases_() {
  var sh = casesTab_();
  if (sh.getLastRow() < 2) return [];
  var t = function (v) { return fmtCell_(v, 'yyyy-MM-dd HH:mm'); };
  return sh.getRange(2, 1, sh.getLastRow() - 1, CASE_HEADERS.length).getValues().map(function (r, i) {
    return { row: i + 2, folder: String(r[0]).trim(), caseNo: String(r[1]).trim(), note: String(r[2]).trim(),
      closed: fmtCell_(r[3], 'yyyy-MM-dd').slice(0, 10), code: String(r[4]).trim().toUpperCase(),
      status: String(r[5]).trim().slice(0, 120), statusAt: t(r[6]), confirmedAt: t(r[7]),
      detected: String(r[8]).trim(), detectedAt: t(r[9]), confirm: String(r[10]).trim(), skipped: t(r[11]) };
  }).filter(function (c) { return c.folder; });
}

function readCaseMap_(list) {
  var map = {};
  (list || readCases_()).forEach(function (c) { if (c.caseNo) map[c.folder] = c.caseNo; });
  return map;
}

/** The case folder name and any older names it had (Inquiry Copilot renames folders when case details change). */
function caseNames_(ctx, folder) {
  return [folder].concat((ctx.cases[folder] && ctx.cases[folder].formerly) || []);
}

/** Status history of one case from the log (oldest first, old folder names included): [{at, text, confirmed, via}]. */
function statusHistory_(ctx, folder) {
  var names = caseNames_(ctx, folder);
  return ctx.allRows.filter(function (r) { return r.kind === 'case_status' && names.indexOf(r.case_no) >= 0; }).map(function (r) {
    var d = {};
    try { d = JSON.parse(r.detail || '{}'); } catch (e) { /* plain */ }
    return { at: r.event_time, text: r.title, confirmed: d.confirmed_at || r.source_time, via: d.via || '' };
  });
}

/**
 * Hourly (and from the menu): adds new case folders with a LINE code, fills missing codes, shows the latest
 * detected step that is newer than the current status, and logs any status not yet in the log.
 * Returns how many cases were added.
 */
function syncCasesTab_(ctx) {
  ctx = ctx || dayCtx_();
  var sh = casesTab_();
  var have = {};
  renameCaseRows_(ctx, sh);
  var detectionOf = function (folder, c) {
    var det = ctx.cases[folder] && ctx.cases[folder].detected;
    if (!det) return null;
    var floor = [c ? c.statusAt : '', c ? c.skipped : ''].sort().pop();
    if (stamp_(det.at) <= floor || (c && det.text === c.status)) return null;
    return { text: det.text, at: stamp_(det.at) };
  };
  ctx.caseList.forEach(function (c) {
    have[c.folder] = true;
    if (!c.code && Core.caseFolderInfo(c.folder)) sh.getRange(c.row, CC.code).setNumberFormat('@').setValue(newCaseCode_());
    var start = caseStartStamp_(c.folder);
    if (!c.status && start) {   // every case starts as รับคำร้องทุกข์แล้ว, dated when the case began
      sh.getRange(c.row, CC.status, 1, 3).setNumberFormat('@').setValues([[Core.START_STATUS, start, start]]);
      c.status = Core.START_STATUS; c.statusAt = start; c.confirmedAt = start;
    }
    var det = detectionOf(c.folder, c);
    var want = det ? [det.text, det.at] : ['', ''];
    if (want[0] !== c.detected || want[1] !== c.detectedAt) {
      sh.getRange(c.row, CC.detected, 1, 2).setNumberFormat('@').setValues([want]);
      c.detected = want[0]; c.detectedAt = want[1];
    }
  });
  var add = Object.keys(ctx.cases).sort().filter(function (f) { return !have[f] && !ctx.cases[f].deleted; }).map(function (f) {
    var start = caseStartStamp_(f);
    var det = detectionOf(f, start ? { statusAt: start, skipped: '', status: Core.START_STATUS } : null);
    return [f, '', '', '', newCaseCode_(), start ? Core.START_STATUS : '', start, start, det ? det.text : '', det ? det.at : '', '', ''];
  });
  if (add.length) {
    var first = sh.getLastRow() + 1;
    sh.getRange(first, 1, add.length, CASE_HEADERS.length).setNumberFormat('@')
      .setValues(add.map(function (r) { return r.map(cellSafe_); }));
    add.forEach(function (r, i) {   // so the starting status is logged in this same run
      ctx.caseList.push({ row: first + i, folder: r[0], caseNo: '', code: r[4], status: r[5], statusAt: r[6], confirmedAt: r[7], detected: r[8], detectedAt: r[9] });
    });
  }
  logStatusChanges_(ctx);
  return add.length;
}

/**
 * A row whose case folder was renamed in Inquiry Copilot follows the new name, keeping its LINE code, status,
 * case number and followers. Only when the new name has no row of its own; otherwise the old row is reported
 * in Update Cases tab for him to delete. ctx.renamed = [[old, new]] done this run.
 */
function renameCaseRows_(ctx, sh) {
  ctx.renamed = [];
  var rowOf = {};
  ctx.caseList.forEach(function (c) { rowOf[c.folder] = c; });
  ctx.caseList.forEach(function (c) {
    var k = ctx.cases[c.folder], to = k && k.renamedTo;
    if (!to || rowOf[to]) return;
    sh.getRange(c.row, CC.folder).setNumberFormat('@').setValue(cellSafe_(to));
    renameLinks_(c.folder, to);
    ctx.renamed.push([c.folder, to]);
    delete rowOf[c.folder]; rowOf[to] = c;
    delete ctx.caseInfo[c.folder]; ctx.caseInfo[to] = c;
    c.folder = to;
  });
}

/** Logs every current status that differs from the last one logged for that case (the status history). */
function logStatusChanges_(ctx) {
  var last = {};
  ctx.allRows.forEach(function (r) { if (r.kind === 'case_status') last[r.case_no] = r; });
  var latest = function (folder) {   // the newest logged status under this name or an older name of the case
    var out = null;
    caseNames_(ctx, folder).forEach(function (n) { var r = last[n]; if (r && (!out || ctx.allRows.indexOf(r) > ctx.allRows.indexOf(out))) out = r; });
    return out;
  };
  var now = Core.toBkkIso(new Date());
  var rows = [];
  ctx.caseList.forEach(function (c) {
    if (!c.status) return;
    var at = stampIso_(c.statusAt) || now;
    var prev = latest(c.folder);
    if (prev && prev.title === c.status && prev.event_time === at) return;
    var confirmed = stampIso_(c.confirmedAt) || now;
    rows.push({
      source: 'Cases tab', kind: 'case_status', title: c.status, case_no: c.folder,
      event_time: at, event_end: '', strength: 'self', proof_url: '', source_id: '', source_time: confirmed,
      detail: JSON.stringify({ folder: c.folder, progress_at: at, confirmed_at: confirmed,
        via: c.status === Core.START_STATUS && c.statusAt === caseStartStamp_(c.folder) ? 'starting status' :
          c.statusAt && c.statusAt !== c.confirmedAt ? 'detected from case files, confirmed' : 'typed' })
    });
  });
  if (rows.length) {
    appendRows_(rows);
    rows.forEach(function (r) { ctx.allRows.push(r); });
  }
  return rows.length;
}

/** ยืนยัน / ไม่ใช้ for one row. sh is passed in (onEdit can't use script properties). */
function decideStatus_(sh, row, decision) {
  var v = sh.getRange(row, 1, 1, CASE_HEADERS.length).getValues()[0];
  var detected = String(v[CC.detected - 1]).trim();
  var detectedAt = fmtCell_(v[CC.detectedAt - 1], 'yyyy-MM-dd HH:mm');
  var now = stamp_(Core.toBkkIso(new Date()));
  var out = v.slice(CC.status - 1);   // status … skipped_at
  if (detected && decision === CONFIRM_YES) {
    out = [detected, detectedAt || now, now, '', '', '', String(v[CC.skipped - 1] || '')];
  } else if (detected && decision === CONFIRM_NO) {
    out = [v[CC.status - 1], v[CC.statusAt - 1], v[CC.confirmedAt - 1], '', '', '', detectedAt || now];
  } else {
    out[CC.confirm - CC.status] = '';
  }
  sh.getRange(row, CC.status, 1, out.length).setValues([out.map(function (x) { return x instanceof Date ? fmtCell_(x, 'yyyy-MM-dd HH:mm') : x; })]);
  return !!detected;
}

/** From the app: confirm or drop a detected status by case folder. */
function decideStatusByFolder_(folder, decision) {
  var sh = casesTab_();
  var hit = readCases_().filter(function (c) { return c.folder === folder; })[0];
  if (!hit) throw new Error('Case not found.');
  if (!decideStatus_(sh, hit.row, decision)) throw new Error('Nothing waiting for this case any more.');
}

/** Simple trigger. Typing a status stamps both dates; the confirm column applies ยืนยัน / ไม่ใช้. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Cases') return;
  var c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1;
  var r0 = Math.max(2, e.range.getRow()), r1 = e.range.getRow() + e.range.getNumRows() - 1;
  if (r1 < r0) return;
  var now = stamp_(Core.toBkkIso(new Date()));
  for (var r = r0; r <= r1; r++) {
    if (c0 <= CC.status && c1 >= CC.status) {
      var st = String(sh.getRange(r, CC.status).getValue()).trim();
      sh.getRange(r, CC.statusAt, 1, 4).setNumberFormat('@').setValues([st ? [now, now, '', ''] : ['', '', '', '']]);
    }
    if (c0 <= CC.confirm && c1 >= CC.confirm) {
      var d = String(sh.getRange(r, CC.confirm).getValue()).trim();
      if (d) decideStatus_(sh, r, d);
    }
  }
}

/** For him (menu Case report): work dates, notices, next due date and the full status history of one case. */
function caseReport_(query, ctx) {
  ctx = ctx || dayCtx_();
  var q = String(query || '').trim();
  var code = normCode_(q);
  var hit = ctx.caseList.filter(function (c) {
    return (code && c.code === code) || (q && (c.caseNo === q || c.folder === q));
  })[0];
  var folder = hit ? hit.folder : (ctx.cases[q] ? q : '');
  if (!folder) return null;
  var k = ctx.cases[folder] || { start: '', type: '', workDates: {}, last: '', notices: [] };
  var info = ctx.caseInfo[folder] || {};
  var today = Core.toBkkIso(new Date()).slice(0, 10);
  var st = k.start ? Core.noticeStatus(k.start, k.notices, today, info.closed) : { next: null };
  var history = statusHistory_(ctx, folder);
  var lastH = history[history.length - 1];
  if (info.status && (!lastH || lastH.text !== info.status)) {   // set within the last hour, not logged yet
    history.push({ at: stampIso_(info.statusAt), text: info.status, confirmed: stampIso_(info.confirmedAt), via: '' });
  }
  return { folder: folder, caseNo: info.caseNo || '', code: info.code || '', start: k.start, type: k.type,
    workDates: Object.keys(k.workDates || {}).sort(), notices: k.notices || [], closed: info.closed || '',
    next: st.next, lastWorked: k.last ? k.last.slice(0, 10) : '', status: info.status || '',
    statusAt: info.statusAt || '', history: history,
    pending: info.detected ? { text: info.detected, at: info.detectedAt } : null };
}
