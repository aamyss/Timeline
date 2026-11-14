/**
 * Config.gs — settings live in Project Settings > Script properties.
 * setup() fills in these defaults; change them there afterwards.
 */
var CFG_DEFAULTS = {
  CALENDARS: 'Work,Inquiry Copilot',          // Google calendar names to read
  BACKFILL_FROM: '2026-10-01',                // ignore anything older on first sync
  GAP_MINUTES: '90',                          // on-duty stretch with no record that counts as a gap
  SEAL_RECIPIENTS: '',                        // daily seal email; empty = your own Gmail. Add police mail with a comma
  APP_URL: 'https://aamyss.github.io/Timeline/', // the iPhone app page (GitHub Pages)
  CASE_FOLDER_MARKERS: 'แฟ้มคดี,Cases',         // folder names whose sub-folders are cases
  NOTICE_WORDS: 'แจ้งความคืบหน้า,คืบหน้า',       // a file in a case folder whose name has one of these = a progress notice sent
  PUBLIC_STATS: 'off',                        // 'on' shows work totals on the LINE page (ask your ผกก. first)
  EXCLUDE_PATHS: '#Police/Work Timeline,#Police/Inquiry Copilot Mirror' // never logged (comma-separated)
};

var TZ = 'Asia/Bangkok';

// name, lat, lon, radius (m). The three Nonthaburi courts sit side by side, so one zone covers them.
var DEFAULT_PLACES = [
  ['สภ.บางใหญ่', '13.878529', '100.404415', '200'],
  ['ศาลนนทบุรี', '13.862050', '100.517620', '250'],
  ['พิสูจน์หลักฐาน', '13.843557', '100.492270', '200']
];

function props_() { return PropertiesService.getScriptProperties(); }

function cfg_() {
  var p = props_().getProperties();
  var out = {};
  Object.keys(CFG_DEFAULTS).forEach(function (k) { out[k] = p[k] !== undefined && p[k] !== '' ? p[k] : CFG_DEFAULTS[k]; });
  out.backfillMs = Core.bkkDateTime(out.BACKFILL_FROM).getTime();
  out.exclude = out.EXCLUDE_PATHS.split(',').map(function (s) { return s.trim(); }).filter(String);
  out.markers = out.CASE_FOLDER_MARKERS.split(',').map(function (s) { return s.trim(); }).filter(String);
  out.noticeWords = out.NOTICE_WORDS.split(',').map(function (s) { return s.trim(); }).filter(String);
  return out;
}

function ss_() {
  var id = props_().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Small status record per collector, shown on the day view. */
function setStatus_(name, ok, msg) {
  var all = JSON.parse(props_().getProperty('STATUS') || '{}');
  all[name] = { ok: ok, msg: String(msg || '').slice(0, 300), at: Core.toBkkIso(new Date()) };
  props_().setProperty('STATUS', JSON.stringify(all));
}

function getStatus_() { return JSON.parse(props_().getProperty('STATUS') || '{}'); }

/** First-time setup: tabs, defaults, triggers. Safe to run again. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var p = props_();
  p.setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(CFG_DEFAULTS).forEach(function (k) { if (!p.getProperty(k)) p.setProperty(k, CFG_DEFAULTS[k]); });
  // Secrets: PC_TOKEN lets your PC send reports; VIEW_KEY opens the day view. Never shared in chat.
  if (!p.getProperty('PC_TOKEN')) p.setProperty('PC_TOKEN', newSecret_());
  if (!p.getProperty('VIEW_KEY')) p.setProperty('VIEW_KEY', newSecret_());
  if (!p.getProperty('PHONE_TOKEN')) p.setProperty('PHONE_TOKEN', newSecret_());
  ss.setSpreadsheetTimeZone(TZ);

  ensureTab_(ss, 'Roster', ['date', 'start', 'end', 'label'],
    'One row per shift. date = 2026-11-05, start/end = 08:00 / 16:00. End earlier than start = overnight.');
  ensureTab_(ss, 'Cases', CASE_HEADERS,
    'One row per case folder (added automatically). Fill case_no with the real case number; closed when the file goes to the prosecutor.');
  ensureTab_(ss, 'Seals', ['date', 'rows', 'first_id', 'last_id', 'chain_hash', 'sent_at', 'sent_to']);
  var places = ensureTab_(ss, 'Places', ['name', 'lat', 'lon', 'radius_m'],
    'Places for iPhone arrived/left and for naming check-ins. name must match the name in the iPhone automation.');
  if (places.getLastRow() < 2) {
    places.getRange(2, 1, DEFAULT_PLACES.length, 4).setValues(DEFAULT_PLACES);
  }
  var idx = ensureTab_(ss, 'Index', ['key', 'json']);
  idx.hideSheet();
  logTab_(Core.toBkkIso(new Date()).slice(0, 4));

  var blank = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);

  installTriggers();
  return 'Setup done. Next: deploy the web app (README step 2), then Work timeline > Links and PC setup code.';
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function ensureTab_(ss, name, headers, note) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    if (note) sh.getRange(1, 1).setNote(note);
    fitColumns_(sh, headers.length);
  }
  return sh;
}

/**
 * Keeps a tab exactly n columns wide. A spreadsheet holds at most 10 million cells, empty ones
 * included, and a new tab starts with 26 columns (A–Z), so a 14-column log row would use 26.
 * Missing columns are added; extra ones are removed only when nothing is in them (anything typed
 * there is kept and reported). New log fields go into the detail JSON, so the width rarely changes;
 * when a version adds a column, this adds it back. Returns 'added', 'trimmed', 'kept' or ''.
 */
function fitColumns_(sh, n) {
  var max = sh.getMaxColumns();
  if (max < n) { sh.insertColumnsAfter(max, n - max); return 'added'; }
  if (max === n) return '';
  if (sh.getLastColumn() > n) return 'kept';
  sh.deleteColumns(n + 1, max - n);
  return 'trimmed';
}

/** Hourly: every known tab at its exact width (cheap once done: one size check per tab). */
function fitTabs_() {
  var ss = ss_();
  var widths = { Cases: CASE_HEADERS.length, Links: LINK_HEADERS.length, Seals: 7, Roster: 4, Places: 4, Index: 2 };
  var done = [], kept = [];
  logTabs_().concat(Object.keys(widths).map(function (k) { return ss.getSheetByName(k); }))
    .forEach(function (sh) {
      if (!sh) return;
      var name = sh.getName();
      var r = fitColumns_(sh, /^Log \d{4}$/.test(name) ? LOG_HEADERS.length : widths[name]);
      if (r === 'trimmed' || r === 'added') done.push(name);
      if (r === 'kept') kept.push(name);
    });
  if (kept.length) setStatus_('columns', false, 'Extra columns kept (something is typed there): ' + kept.join(', '));
  else if (done.length) setStatus_('columns', true, 'Column count fixed: ' + done.join(', '));
  return done.length ? 'Columns fitted: ' + done.join(', ') : '';
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['collectAll', 'sealYesterday'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('collectAll').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sealYesterday').timeBased().everyDays(1).atHour(0).nearMinute(20).inTimezone(TZ).create();
}
