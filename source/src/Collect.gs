/**
 * Collect.gs — the hourly run (Google Calendar). File changes arrive from the PC reporter (doPost).
 * Order matters: rows first, then the index, then sync tokens. A crash in between can at
 * worst repeat a row, never lose one.
 */
function collectAll() {
  var deadline = Date.now() + 4.5 * 60 * 1000;
  var cache = CacheService.getScriptCache();
  if (cache.get('COLLECTING')) return 'Another collection is still running.';
  cache.put('COLLECTING', '1', 330);

  var report = [];
  try {
    collectEverything_(deadline, report);
  } finally {
    cache.remove('COLLECTING');
  }
  return report.join('\n');
}

function collectEverything_(deadline, report) {
  try {
    report.push(collectCalendars_());
    setStatus_('calendar', true, report[report.length - 1]);
  } catch (e) {
    setStatus_('calendar', false, e.message);
    report.push('Calendar error: ' + e.message);
  }
  try {
    var added = syncCasesTab_();
    if (added) report.push(added + ' case' + (added > 1 ? 's' : '') + ' added to the Cases tab');
  } catch (e) {
    report.push('Cases tab error: ' + e.message);
  }
}

function collectCalendars_() {
  var c = cfg_();
  var p = props_();
  var idx = loadIndex_();
  var opts = { backfillMs: c.backfillMs, nowIso: Core.toBkkIso(new Date()) };
  var rows = [];
  var newTokens = {};
  var missing = [];

  // A configured name matches that calendar exactly, or any calendar starting with it plus a space
  // ("Inquiry Copilot" matches "Inquiry Copilot นัดหมาย" and "Inquiry Copilot ผู้ต้องหาควบคุมตัว").
  var all = CalendarApp.getAllCalendars();
  var picked = [];
  c.CALENDARS.split(',').map(function (s) { return s.trim(); }).filter(String).forEach(function (want) {
    var hits = all.filter(function (cal) {
      var n = cal.getName();
      return n === want || n.indexOf(want + ' ') === 0;
    });
    if (!hits.length) missing.push(want);
    hits.forEach(function (cal) {
      if (!picked.some(function (p) { return p.getId() === cal.getId(); })) picked.push(cal);
    });
  });

  picked.forEach(function (cal) {
    var name = cal.getName();
    var calId = cal.getId();
    var tokKey = 'GCAL_SYNC_' + calId;
    var token = p.getProperty(tokKey);
    var pageToken = null;
    var items = [];
    var nextSync = null;
    while (true) {
      var params = { singleEvents: true, maxResults: 2500 };
      if (pageToken) params.pageToken = pageToken;
      if (token) params.syncToken = token;
      var resp;
      try {
        resp = Calendar.Events.list(calId, params);
      } catch (e) {
        if (token && /410|sync token|fullSyncRequired/i.test(e.message)) {
          token = null; pageToken = null; items = []; // full resync; the index prevents duplicates
          continue;
        }
        throw e;
      }
      items = items.concat(resp.items || []);
      pageToken = resp.nextPageToken || null;
      nextSync = resp.nextSyncToken || nextSync;
      if (!pageToken) break;
    }
    items.forEach(function (ev) {
      rows = rows.concat(Core.diffCalendarEvent(ev, name, calId, idx, opts));
    });
    if (nextSync) newTokens[tokKey] = nextSync;
  });

  var n = appendRows_(rows);
  saveIndex_(idx);
  if (Object.keys(newTokens).length) p.setProperties(newTokens);
  return n + ' new' + (missing.length ? ' · calendar not found: ' + missing.join(', ') : '');
}
