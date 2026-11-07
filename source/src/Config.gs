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
  ensureTab_(ss, 'Cases', ['case_folder', 'case_no', 'note'],
    'Attach a real case number to a case folder name (e.g. an Inquiry Copilot folder).');
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
  }
  return sh;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['collectAll', 'sealYesterday'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('collectAll').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sealYesterday').timeBased().everyDays(1).atHour(0).nearMinute(20).inTimezone(TZ).create();
}
