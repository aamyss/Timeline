/**
 * WebApp.gs — day view (doGet), the PC reporter and iPhone endpoints (doPost), and the LINE page routes (see Line.gs).
 * Deploy as web app: execute as Me, access Anyone. Both doors are locked by a secret:
 * the day view needs ?k=VIEW_KEY, the PC reporter sends PC_TOKEN.
 */
function keyOk_(k) {
  var key = props_().getProperty('VIEW_KEY');
  return !!key && k === key;
}

function checkKey_(k) {
  if (!keyOk_(k)) throw new Error('Not allowed');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function phoneOk_(t) {
  var tok = props_().getProperty('PHONE_TOKEN');
  return !!tok && t === tok;
}

function readPlaces_() {
  var sh = ss_().getSheetByName('Places');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().map(function (r) {
    return { name: String(r[0]).trim(), lat: Number(r[1]), lon: Number(r[2]), radius: Number(r[3]) || 200 };
  }).filter(function (p) { return p.name && isFinite(p.lat) && isFinite(p.lon); });
}

/** On duty right now, from the Roster tab. */
function dutyNow_() {
  var now = new Date();
  var today = Core.toBkkIso(now).slice(0, 10);
  var roster = readRoster_();
  var months = {};
  roster.forEach(function (r) { months[r.date.slice(0, 7)] = true; });
  var ivs = Core.shiftIntervals(roster.filter(function (r) { return r.date === today || r.date === Core.addDays(today, -1); }));
  var hit = ivs.filter(function (iv) { return now >= iv.start && now < iv.end; })[0];
  return { onDuty: !!hit, label: hit ? hit.label : '', known: !!months[today.slice(0, 7)] };
}

function doGet(e) {
  var k = e && e.parameter && e.parameter.k;
  if (e && e.parameter && e.parameter.api === 'duty') {
    // iPhone asks before an hourly check-in; off duty it sends nothing.
    if (!phoneOk_(e.parameter.t)) return json_({ ok: false, error: 'Not allowed' });
    var dn = dutyNow_();
    return json_({ ok: true, onDuty: dn.onDuty, duty: dn.onDuty ? 'yes' : 'no', label: dn.label });   // "duty" is easy to test in Shortcuts
  }
  if (e && e.parameter && (e.parameter.api === 'line_config' || e.parameter.api === 'stats')) {
    try { return json_(lineGet_(e.parameter.api)); } catch (err) { return json_({ ok: false, error: err.message }); }
  }
  if (e && e.parameter && e.parameter.api) {
    // JSON for the iPhone app (GitHub Pages).
    if (!keyOk_(k)) return json_({ ok: false, error: 'Not allowed' });
    try {
      if (e.parameter.api === 'day') return json_({ ok: true, day: getDay(e.parameter.date, k) });
      return json_({ ok: false, error: 'Unknown request' });
    } catch (err) {
      return json_({ ok: false, error: err.message });
    }
  }
  if (!keyOk_(k)) return HtmlService.createHtmlOutput('Not found');
  var t = HtmlService.createTemplateFromFile('Index');
  var d = e.parameter.date;
  t.initialDate = /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : Core.toBkkIso(new Date()).slice(0, 10);
  t.viewKey = k;
  return t.evaluate().setTitle('Work timeline')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** PC reporter sends batches of file changes here. Google's clock at arrival is the receipt time. */
function doPost(e) {
  var out = json_;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'status') {
      // Confirm or drop a detected case status from the iPhone app.
      checkKey_(body.k);
      decideStatusByFolder_(String(body.folder || ''), body.decision === 'yes' ? CONFIRM_YES : CONFIRM_NO);
      return out({ ok: true, day: dayData_(/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : Core.toBkkIso(new Date()).slice(0, 10)) });
    }
    if (body.action === 'note') {
      // Note from the iPhone app; addNote checks the view key.
      return out({ ok: true, day: addNote(body) });
    }
    if (/^line_/.test(body.action || '')) {
      try { return out(linePost_(body)); } catch (err) { return out({ ok: false, error: err.message }); }
    }
    if (body.action === 'checkin') {
      if (!phoneOk_(body.t)) return out({ ok: false, error: 'bad token' });
      var rcpt = Core.toBkkIso(new Date());
      if (body.kind === 'checkin' && !dutyNow_().onDuty) {
        return out({ ok: true, logged: false, reason: 'off duty' });   // hourly check-ins are only kept on duty
      }
      var row = Core.phoneRow(body, rcpt, readPlaces_());
      appendRows_([row]);
      setStatus_('iphone', true, row.kind.replace(/_/g, ' ') + ': ' + row.title);
      return out({ ok: true, logged: true, title: row.title });
    }
    var token = props_().getProperty('PC_TOKEN');
    if (!token || body.token !== token) return out({ ok: false, error: 'bad token' });
    var receipt = Core.toBkkIso(new Date());
    var c = cfg_();
    var seenPhotos = {};
    if ((body.events || []).some(function (ev) { return ev.kind === 'photo_taken'; })) {
      var y = parseInt(receipt.slice(0, 4), 10);
      readLog_([String(y - 1), String(y)]).forEach(function (r) {
        if (r.kind !== 'photo_taken') return;
        try { seenPhotos[JSON.parse(r.detail).path + '|' + r.event_time] = true; } catch (e) { /* skip */ }
      });
    }
    var rows = Core.pcRows(body, receipt, { markers: c.markers, exclude: c.exclude, backfillMs: c.backfillMs, seenPhotos: seenPhotos });
    var n = appendRows_(rows);
    var offset = body.deviceNow ? Math.round((new Date(receipt) - new Date(body.deviceNow)) / 1000) : null;
    var clockNote = offset !== null && Math.abs(offset) > 120 ? ' · PC clock off by ' + offset + ' s' : '';
    setStatus_('pc', !clockNote, n + ' new from ' + String(body.device || 'PC').slice(0, 40) + clockNote);
    return out({ ok: true, rows: n, receipt: receipt });
  } catch (err) {
    setStatus_('pc', false, err.message);
    return out({ ok: false, error: err.message });
  }
}

function fmtCell_(v, pattern) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, pattern);
  return String(v || '').trim();
}

function readRoster_() {
  var sh = ss_().getSheetByName('Roster');
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().map(function (r) {
    var pad = function (s) { var m = String(s).match(/^(\d{1,2})[:.](\d{2})/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; };
    return { date: fmtCell_(r[0], 'yyyy-MM-dd'), start: pad(fmtCell_(r[1], 'HH:mm')), end: pad(fmtCell_(r[2], 'HH:mm')), label: String(r[3] || '') };
  }).filter(function (r) { return /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.start && r.end; });
}

/** Everything the day pages need, read once (one log read for any number of days). */
function dayCtx_() {
  var c = cfg_();
  var caseList = readCases_();
  var caseMap = readCaseMap_(caseList);
  var allRows = readLog_();
  var byDate = {}, takenByPath = {};
  allRows.forEach(function (r) {
    var k = r.event_time.slice(0, 10);
    (byDate[k] = byDate[k] || []).push(r);
    if (r.kind === 'photo_taken') {
      try { takenByPath[JSON.parse(r.detail).path] = r.event_time; } catch (e) { /* skip */ }
    }
  });
  var roster = readRoster_();
  var months = {};
  roster.forEach(function (r) { months[r.date.slice(0, 7)] = true; });
  var noToFolder = {};
  Object.keys(caseMap).forEach(function (f) { noToFolder[caseMap[f]] = f; });
  var cases = Core.collectCases(allRows, c.markers, c.noticeWords, noToFolder);
  var info = {};
  caseList.forEach(function (x) { info[x.folder] = x; });
  return { c: c, caseList: caseList, caseInfo: info, caseMap: caseMap, byDate: byDate, takenByPath: takenByPath,
    roster: roster, months: months, cases: cases, allRows: allRows };
}

/** Open cases with their progress-notice status on asOf, soonest first. */
function noticeList_(ctx, asOf) {
  var from = ctx.c.BACKFILL_FROM;
  var out = [];
  Object.keys(ctx.cases).forEach(function (f) {
    var k = ctx.cases[f];
    if (k.deleted || k.start < from || k.start > asOf) return;   // cases begun before tracking can't be judged
    var info = ctx.caseInfo[f] || {};
    var st = Core.noticeStatus(k.start, k.notices, asOf, info.closed);
    if (!st.next) return;
    out.push({ folder: f, label: info.caseNo || f, start: k.start, n: st.next.n, due: st.next.due, final: !!st.next.final,
      daysLeft: st.daysLeft, overdue: st.overdue, done: st.done });
  });
  return out.sort(function (a, b) { return (a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : 0; });
}

function noticeText_(n) {
  var what = 'notice ' + n.n + (n.final ? ' (final)' : '');
  if (!n.due) return what + ' when the file goes to the prosecutor';
  var when = n.daysLeft < 0 ? 'overdue by ' + (-n.daysLeft) + ' day' + (n.daysLeft < -1 ? 's' : '') :
    n.daysLeft === 0 ? 'due today' : 'due ' + Core.fmtDay(n.due) + ' (in ' + n.daysLeft + ' day' + (n.daysLeft > 1 ? 's' : '') + ')';
  return what + ' ' + when;
}

/** Everything the day view needs for one date. */
function getDay(dateStr, k) {
  checkKey_(k);
  return dayData_(dateStr);
}

/** Day data without the key check (used by getDay, the nightly email and the LINE totals). */
function dayData_(dateStr, ctx, light) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new Error('Bad date');
  ctx = ctx || dayCtx_();
  var c = ctx.c;
  var caseMap = ctx.caseMap;
  var takenByPath = ctx.takenByPath;
  var rows = ctx.byDate[dateStr] || [];

  var entries = rows.map(function (r) {
    var d = {};
    try { d = JSON.parse(r.detail || '{}'); } catch (e) { /* plain text detail */ }
    return {
      id: r.id, t: r.event_time, tEnd: r.event_end, kind: r.kind, source: r.source, title: r.title,
      caseNo: caseMap[r.case_no] || r.case_no, caseFolder: caseMap[r.case_no] ? r.case_no : '',
      strength: r.strength, proof: r.proof_url, path: d.path || '', entered: d.entered || '',
      from: d.from || '', was: d.was || null, allDay: !!d.all_day,
      taken: r.kind === 'file_created' && d.path ? (takenByPath[d.path] || '') : '',
      isPhoto: /\.(jpe?g|heic|heif)$/i.test(d.path || ''), written: r.kind === 'note' ? r.source_time : '', collected: r.collected_at
    };
  }).sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : (a.id < b.id ? -1 : 1); });

  var roster = ctx.roster;
  var months = ctx.months;
  var intervals = Core.shiftIntervals(roster.filter(function (r) {
    return r.date === dateStr || r.date === Core.addDays(dateStr, -1);
  }));
  var dayStart = Core.bkkDateTime(dateStr);
  var dayEnd = new Date(dayStart.getTime() + 86400000);
  intervals = intervals.filter(function (iv) { return iv.end > dayStart && iv.start < dayEnd; });

  // Shifts copied into the calendar (same start and end as a roster shift) and all-day events are plans,
  // not activity: they mustn't hide a gap. Roster-matching ones are also hidden (the shift chip shows them).
  var shiftKeys = {};
  intervals.forEach(function (iv) { shiftKeys[Core.toBkkIso(iv.start) + '|' + Core.toBkkIso(iv.end)] = true; });
  var isPlan = function (e) {
    if (!/^calendar_/.test(e.kind)) return false;
    return !!e.allDay || !!shiftKeys[e.t + '|' + e.tEnd];
  };
  entries.forEach(function (e) {
    e.duty = Core.dutyAt(new Date(e.t), intervals, months);
    e.plan = isPlan(e);
  });

  var cover = entries.filter(function (e) { return e.kind !== 'calendar_cancelled' && e.kind !== 'case_status' && !e.plan; }).map(function (e) {
    return { start: new Date(e.t), end: e.tEnd ? new Date(e.tEnd) : null };
  });
  var visits = Core.placeVisits(entries);
  visits.forEach(function (v) {   // time spent at a saved place counts as accounted for
    cover.push({ start: new Date(v.start), end: v.end ? new Date(v.end) : null });
  });
  var gaps = Core.findGaps(cover, intervals, dayStart, dayEnd, parseInt(c.GAP_MINUTES, 10) || 90, new Date())
    .map(function (g) { return { start: Core.toBkkIso(g.start), end: Core.toBkkIso(g.end) }; });
  var shifts = intervals.map(function (iv) {
    return { start: Core.toBkkIso(iv.start), end: Core.toBkkIso(iv.end), label: iv.label };
  });
  var rosterKnown = !!months[dateStr.slice(0, 7)];
  var summary = Core.daySummary({ date: dateStr, shifts: shifts, gaps: gaps, entries: entries, visits: visits,
    rosterKnown: rosterKnown, now: new Date() });
  if (light) return { date: dateStr, summary: summary, entries: entries };

  // Progress notices as they stood at the end of this day (or now, for today).
  var today = Core.toBkkIso(new Date()).slice(0, 10);
  var asOf = dateStr < today ? dateStr : today;
  var notices = noticeList_(ctx, asOf);
  var urgent = notices.filter(function (n) { return n.due && n.daysLeft <= 7; });
  urgent.forEach(function (n) { n.text = noticeText_(n); });
  notices.forEach(function (n) { if (!n.text) n.text = noticeText_(n); });
  summary.pending = ctx.caseList.filter(function (x) { return x.detected; }).map(function (x) {
    return { folder: x.folder, label: x.caseNo || x.folder, text: x.detected, at: x.detectedAt, current: x.status };
  });
  summary.notices = { open: notices.length, overdue: urgent.filter(function (n) { return n.overdue; }).length,
    soon: urgent.filter(function (n) { return !n.overdue; }).length, urgent: urgent, all: notices };

  var hidden = 0;
  var shown = entries.filter(function (e) {
    if (Core.isClutter(e.kind, e.path, c.markers)) { hidden++; return false; }
    return true;
  });
  var grouped = Core.groupEntries(shown).filter(function (e) {
    return !(e.kind !== 'calendar_cancelled' && shiftKeys[e.t + '|' + e.tEnd] && /^calendar_/.test(e.kind));
  });

  var counts = { strong: 0, medium: 0, self: 0 };
  entries.forEach(function (e) { if (counts[e.strength] !== undefined) counts[e.strength]++; });

  var out = {
    date: dateStr,
    shifts: shifts,
    rosterKnown: rosterKnown,
    entries: grouped,
    gaps: gaps,
    counts: counts,
    hiddenFolders: hidden,
    summary: summary,
    summaryLines: Core.summaryLines(summary, { shifts: shifts, rosterKnown: rosterKnown, notices: summary.notices, pending: summary.pending.length }),
    status: getStatus_()
  };
  out.strip = Core.dayStrip(out, 30);   // the 24-hour chart, same as the nightly email
  return out;
}

/** Self-reported note (gap fill or anything else). Stored as a new row; nothing is ever edited. */
function addNote(n) {
  n = n || {};
  checkKey_(n.k);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date || '')) throw new Error('Pick a date.');
  if (!/^\d{2}:\d{2}$/.test(n.from || '')) throw new Error('Enter a start time.');
  if (n.to && !/^\d{2}:\d{2}$/.test(n.to)) throw new Error('End time looks wrong.');
  var text = String(n.text || '').trim();
  if (!text) throw new Error('Write what you were doing.');
  var start = Core.bkkDateTime(n.date, n.from);
  var end = '';
  if (n.to) {
    var e = Core.bkkDateTime(n.date, n.to);
    if (e <= start) e = new Date(e.getTime() + 86400000);
    end = Core.toBkkIso(e);
  }
  var now = Core.toBkkIso(new Date());
  appendRows_([{
    source: 'Note', kind: 'note', title: text.slice(0, 1000), case_no: String(n.caseNo || '').trim().slice(0, 80),
    event_time: Core.toBkkIso(start), event_end: end, strength: 'self', proof_url: '', source_id: '',
    source_time: now, detail: JSON.stringify({ written: now, via: 'day view' })
  }]);
  return getDay(n.date, n.k);
}
