/* Offline tests: pure Core logic, plus the whole script run against in-memory fakes of
 * SpreadsheetApp, Calendar, Microsoft Graph, Gmail etc.  Run: node test/run-tests.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 9).join('\n       ')); }
}

const SRC = path.join(__dirname, '..', 'src');
const Core = require(path.join(SRC, 'Core.gs'));

/* ===================== Core ===================== */
console.log('Core');

test('toBkkIso converts UTC to Bangkok', () => {
  assert.strictEqual(Core.toBkkIso('2026-11-05T01:42:10Z'), '2026-11-05T08:42:10+07:00');
  assert.strictEqual(Core.toBkkIso('2026-11-05T20:00:00Z'), '2026-11-06T03:00:00+07:00');
  assert.strictEqual(Core.toBkkIso(''), '');
  assert.strictEqual(Core.toBkkIso('garbage'), '');
});

test('extractCaseNo finds case numbers, ignores dates and years', () => {
  assert.strictEqual(Core.extractCaseNo('คดีอาญาที่ 123/2569 ลักทรัพย์'), '123/2569');
  assert.strictEqual(Core.extractCaseNo('คดีที่ ๑๒๓/๒๕๖๙'), '123/2569');
  assert.strictEqual(Core.extractCaseNo('แฟ้ม 045-2569 ฉ้อโกง'), '45/2569');
  assert.strictEqual(Core.extractCaseNo('นัด 5/11/2569 ที่ศาล'), '');
  assert.strictEqual(Core.extractCaseNo('2026-07-10_2234-พนันออนไลน์'), '');
  assert.strictEqual(Core.extractCaseNo('report 2569'), '');
});

test('caseFromPath uses the case folder after a marker', () => {
  const p = 'Police/Inquiry Copilot App/Inquiry_Copilot_Storage/profiles/x/แฟ้มคดี/2026-07-10_2234-พนันออนไลน์_MR.HLA_TUN_/__res__/session.json';
  assert.strictEqual(Core.caseFromPath(p, ['แฟ้มคดี']), '2026-07-10_2234-พนันออนไลน์_MR.HLA_TUN_');
  assert.strictEqual(Core.caseFromPath('#Police/แฟ้มคดี/77-2569 ลักทรัพย์/a.docx', ['แฟ้มคดี']), '77/2569');
  assert.strictEqual(Core.caseFromPath('#Police/misc/88-2569.docx', ['แฟ้มคดี']), '88/2569');
});

test('isNoise skips Office temp files and TagSpaces sidecars', () => {
  assert.ok(Core.isNoise('#Police/~$คำให้การ.docx'));
  assert.ok(Core.isNoise('#Police/a/.ts/x.json'));
  assert.ok(Core.isNoise('#Police/desktop.ini'));
  assert.ok(!Core.isNoise('#Police/คำให้การ.docx'));
});

test('shiftIntervals handles overnight shifts; dutyAt on/off/unknown', () => {
  const iv = Core.shiftIntervals([{ date: '2026-11-05', start: '16:00', end: '08:00' }]);
  assert.strictEqual(Core.toBkkIso(iv[0].end), '2026-11-06T08:00:00+07:00');
  const months = { '2026-11': true };
  assert.strictEqual(Core.dutyAt(new Date('2026-11-06T02:00:00+07:00'), iv, months), 'on');
  assert.strictEqual(Core.dutyAt(new Date('2026-11-06T09:00:00+07:00'), iv, months), 'off');
  assert.strictEqual(Core.dutyAt(new Date('2026-12-01T09:00:00+07:00'), iv, months), 'unknown');
});

test('findGaps flags long empty stretches inside shifts only, not in the future', () => {
  const iv = Core.shiftIntervals([{ date: '2026-11-04', start: '08:00', end: '16:00' }]);
  const at = (h) => new Date('2026-11-04T' + h + ':00+07:00');
  const items = [{ start: at('08:30') }, { start: at('11:30'), end: at('12:30') }, { start: at('15:00') }];
  const gaps = Core.findGaps(items, iv, at('00:00'), new Date(at('00:00').getTime() + 864e5), 90, at('23:00'));
  assert.deepStrictEqual(gaps.map(g => [Core.toBkkIso(g.start).slice(11, 16), Core.toBkkIso(g.end).slice(11, 16)]),
    [['08:30', '11:30'], ['12:30', '15:00']]);
  const early = Core.findGaps(items, iv, at('00:00'), new Date(at('00:00').getTime() + 864e5), 90, at('09:30'));
  assert.strictEqual(early.length, 0, 'gap still in progress before 90 min must not show');
});

test('groupEntries merges repeated edits of one file within an hour', () => {
  const g = Core.groupEntries([
    { id: '1', kind: 'file_modified', path: 'a', t: '2026-11-04T09:00:00+07:00' },
    { id: '2', kind: 'file_modified', path: 'a', t: '2026-11-04T09:40:00+07:00' },
    { id: '3', kind: 'file_modified', path: 'b', t: '2026-11-04T09:45:00+07:00' },
    { id: '4', kind: 'file_modified', path: 'b', t: '2026-11-04T11:00:00+07:00' }
  ]);
  assert.deepStrictEqual(g.map(x => x.count), [2, 1, 1]);
});

test('isClutter hides auto-made subfolders inside a case, keeps the case folder', () => {
  const m = ['แฟ้มคดี'];
  assert.ok(!Core.isClutter('folder_created', 'IC/p/แฟ้มคดี/2026-11-05_0939-จราจร', m));
  assert.ok(Core.isClutter('folder_created', 'IC/p/แฟ้มคดี/2026-11-05_0939-จราจร/ของกลาง', m));
  assert.ok(Core.isClutter('folder_created', 'IC/p/แฟ้มคดี/x/__res__', m));
  assert.ok(!Core.isClutter('file_created', 'IC/p/แฟ้มคดี/x/ของกลาง/a.jpg', m));
});

test('dayStrip marks shift, file activity, calendar, notes and gaps in half-hour cells', () => {
  const st = Core.dayStrip({ date: '2026-11-04',
    shifts: [{ start: '2026-11-04T08:00:00+07:00', end: '2026-11-04T16:00:00+07:00' }],
    gaps: [{ start: '2026-11-04T13:00:00+07:00', end: '2026-11-04T15:30:00+07:00' }],
    entries: [
      { kind: 'file_modified', source: 'PC: #Police', t: '2026-11-04T09:10:00+07:00', tLast: '2026-11-04T09:50:00+07:00', count: 4 },
      { kind: 'calendar_event', source: 'Calendar: Work', t: '2026-11-04T11:30:00+07:00', tEnd: '2026-11-04T12:30:00+07:00' },
      { kind: 'calendar_event', source: 'Calendar: Work', t: '2026-11-04T00:00:00+07:00', tEnd: '2026-11-05T00:00:00+07:00', allDay: true },
      { kind: 'note', source: 'Note', t: '2026-11-04T21:00:00+07:00' }
    ] });
  const row = k => st.rows.find(r => r.key === k).cells;
  assert.strictEqual(st.slots, 48);
  assert.strictEqual(row('shift').filter(Boolean).length, 16);
  assert.deepStrictEqual([row('files')[18], row('files')[19]], [3, 3], '4 edits 09:10-09:50 = busiest level');
  assert.deepStrictEqual(row('calendar').map((v, i) => v ? i : -1).filter(i => i >= 0), [23, 24], 'all-day event not drawn');
  assert.strictEqual(row('notes')[42], 1);
  assert.strictEqual(row('gaps').filter(Boolean).length, 5);
});

const RCPT = '2026-11-05T15:06:00+07:00';
const PLACES = [{ name: 'สภ.บางใหญ่', lat: 13.878529, lon: 100.404415, radius: 200 },
  { name: 'ศาลนนทบุรี', lat: 13.86205, lon: 100.51762, radius: 250 }];

test('phoneRow: check-in names the place you are at, or how far you are from the nearest', () => {
  const at = Core.phoneRow({ kind: 'checkin', lat: 13.8787, lon: 100.4046 }, RCPT, PLACES);
  assert.strictEqual(at.kind, 'location_checkin');
  assert.strictEqual(at.title, 'สภ.บางใหญ่');
  assert.strictEqual(at.event_time, RCPT);
  assert.strictEqual(at.strength, 'medium');
  assert.ok(/maps\.google\.com\/\?q=13\.8787/.test(at.proof_url));
  const away = Core.phoneRow({ kind: 'checkin', lat: 13.9, lon: 100.45 }, RCPT, PLACES);
  assert.ok(/km from สภ.บางใหญ่/.test(away.title), away.title);
  const none = Core.phoneRow({ kind: 'checkin' }, RCPT, PLACES);
  assert.strictEqual(none.title, 'Location unavailable');
  assert.strictEqual(none.proof_url, '');
});

test('phoneRow: arrived/left keep the place name and record the distance to it', () => {
  const a = Core.phoneRow({ kind: 'arrive', place: 'ศาลนนทบุรี', lat: 13.8622, lon: 100.5171 }, RCPT, PLACES);
  assert.strictEqual(a.kind, 'place_arrived');
  assert.strictEqual(a.title, 'ศาลนนทบุรี');
  assert.ok(JSON.parse(a.detail).dist_to_place_m < 100);
  assert.throws(() => Core.phoneRow({ kind: 'teleport' }, RCPT, PLACES), /Unknown/);
});

test('placeVisits pairs arrived with left; dayStrip draws the stay on the Location row', () => {
  const entries = [
    { kind: 'place_arrived', title: 'ศาลนนทบุรี', t: '2026-11-04T09:00:00+07:00' },
    { kind: 'place_left', title: 'ศาลนนทบุรี', t: '2026-11-04T11:00:00+07:00' },
    { kind: 'location_checkin', title: 'สภ.บางใหญ่', t: '2026-11-04T14:05:00+07:00' }];
  const v = Core.placeVisits(entries);
  assert.deepStrictEqual(v.map(x => [x.place, x.start.slice(11, 16), x.end.slice(11, 16)]), [['ศาลนนทบุรี', '09:00', '11:00']]);
  const st = Core.dayStrip({ date: '2026-11-04', shifts: [], gaps: [], entries });
  const loc = st.rows.find(r => r.key === 'place').cells;
  assert.deepStrictEqual(loc.map((c, i) => c ? i : -1).filter(i => i >= 0), [18, 19, 20, 21, 22, 28]);
});

test('canonical text changes when any column changes', () => {
  const r = { id: 'WT1', title: 'a' };
  assert.notStrictEqual(Core.canonical(r, 'X'), Core.canonical(Object.assign({}, r, { title: 'b' }), 'X'));
  assert.notStrictEqual(Core.canonical(r, 'X'), Core.canonical(r, 'Y'));
});

/* ---- PC reporter batches ---- */
const backfillMs = new Date('2026-10-01T00:00:00+07:00').getTime();
const pcOpts = { markers: ['แฟ้มคดี'], exclude: ['#Police/Work Timeline'], backfillMs };
const RECEIPT = '2026-11-05T15:06:00+07:00';
function batch(events, extra) {
  return Object.assign({ token: 't', device: 'PC1', deviceNow: '2026-11-05T08:05:30Z', events }, extra || {});
}

test('pcRows: device time close to Google receipt = strong; case from Inquiry Copilot folder', () => {
  const rows = Core.pcRows(batch([{ kind: 'file_modified', root: 'Inquiry Copilot',
    path: 'ร้อยตำรวจตรีสมชาย_ใจดี_ABCDEFGHIJ/แฟ้มคดี/2026-11-05_1510-ลักสายไฟ_โรงงาน_บริษัทตัวอย่าง/__res__/session.json',
    time: '2026-11-05T08:02:00Z', size: 812, sha256: 'ab12' }]), RECEIPT, pcOpts);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event_time, '2026-11-05T15:02:00+07:00');
  assert.strictEqual(rows[0].source_time, RECEIPT);
  assert.strictEqual(rows[0].strength, 'strong');
  assert.strictEqual(rows[0].case_no, '2026-11-05_1510-ลักสายไฟ_โรงงาน_บริษัทตัวอย่าง');
  assert.strictEqual(rows[0].source, 'PC: Inquiry Copilot');
  const d = JSON.parse(rows[0].detail);
  assert.strictEqual(d.sha256, 'ab12');
  assert.strictEqual(d.pc_clock_offset_s, 30);
});

test('pcRows: late report or wrong PC clock = medium; deletes use receipt time', () => {
  let rows = Core.pcRows(batch([{ kind: 'file_created', root: '#Police', path: 'a.docx', time: '2026-11-05T06:00:00Z' }]), RECEIPT, pcOpts);
  assert.strictEqual(rows[0].strength, 'medium', '2 hours before receipt');
  rows = Core.pcRows(batch([{ kind: 'file_created', root: '#Police', path: 'a.docx', time: '2026-11-05T08:04:00Z' }],
    { deviceNow: '2026-11-05T07:00:00Z' }), RECEIPT, pcOpts);
  assert.strictEqual(rows[0].strength, 'medium', 'PC clock an hour off');
  rows = Core.pcRows(batch([{ kind: 'file_deleted', root: '#Police', path: 'x/b.pdf', time: '2026-11-05T08:05:00Z' },
    { kind: 'file_renamed', root: '#Police', path: 'x/c.pdf', from: 'x/b2.pdf', time: '2026-11-05T08:05:00Z' }]), RECEIPT, pcOpts);
  assert.deepStrictEqual(rows.map(r => [r.kind, r.event_time, r.strength]),
    [['file_deleted', RECEIPT, 'medium'], ['file_renamed', RECEIPT, 'medium']]);
  assert.strictEqual(JSON.parse(rows[1].detail).from, 'x/b2.pdf');
});

test('pcRows: unknown change types are refused (so the PC resends after the script is updated)', () => {
  assert.throws(() => Core.pcRows(batch([{ kind: 'format_disk', root: '#Police', path: 'a', time: '2026-11-05T08:00:00Z' }]), RECEIPT, pcOpts), /update the Google script/);
});

test('pcRows: a photo already logged is not logged twice', () => {
  const ev = { kind: 'photo_taken', root: '#Police', path: 'a/IMG_1.HEIC', time: '2026-11-05T07:20:31Z' };
  const seen = { '#Police/a/IMG_1.HEIC|2026-11-05T14:20:31+07:00': true };
  assert.strictEqual(Core.pcRows(batch([ev]), RECEIPT, Object.assign({}, pcOpts, { seenPhotos: seen })).length, 0);
  assert.strictEqual(Core.pcRows(batch([ev]), RECEIPT, pcOpts).length, 1);
});

test('isClutter hides Inquiry Copilot "ห้ามลบ" marker files', () => {
  assert.ok(Core.isClutter('file_created', 'IC/p/แฟ้มคดี/x/ของกลาง/ห้ามลบ', ['แฟ้มคดี']));
  assert.ok(!Core.isClutter('file_created', 'IC/p/แฟ้มคดี/x/คำให้การ.docx', ['แฟ้มคดี']));
});

test('pcRows: photo time and GPS from the photo itself are medium, with a map link', () => {
  const rows = Core.pcRows(batch([{ kind: 'photo_taken', root: '#Police', path: 'แฟ้มคดี/12-2569 ลักทรัพย์/IMG_0001.HEIC',
    time: '2026-11-05T07:20:31Z', lat: 13.789267, lon: 100.5, sha256: 'cc' }]), RECEIPT, pcOpts);
  assert.strictEqual(rows[0].kind, 'photo_taken');
  assert.strictEqual(rows[0].event_time, '2026-11-05T14:20:31+07:00');
  assert.strictEqual(rows[0].strength, 'medium');
  assert.strictEqual(rows[0].proof_url, 'https://maps.google.com/?q=13.789267,100.5');
  assert.strictEqual(rows[0].case_no, '12/2569');
  const noGps = Core.pcRows(batch([{ kind: 'photo_taken', root: '#Police', path: 'a.jpg', time: '2026-11-05T07:20:31Z', lat: null, lon: null }]), RECEIPT, pcOpts);
  assert.strictEqual(noGps[0].proof_url, '');
  assert.strictEqual(JSON.parse(noGps[0].detail).lat, undefined);
});

test('pcRows: drops excluded folders, noise, unknown kinds, and old items on first scan', () => {
  const rows = Core.pcRows(batch([
    { kind: 'file_created', root: '#Police', path: 'Work Timeline/src/Core.gs', time: '2026-11-05T08:00:00Z' },
    { kind: 'file_created', root: '#Police', path: 'a/~$tmp.docx', time: '2026-11-05T08:00:00Z' },
    { kind: 'file_created', root: '#Police', path: 'old.pdf', time: '2025-01-01T00:00:00Z' },
    { kind: 'file_created', root: '#Police', path: 'win\\style\\path.docx', time: '2026-11-05T08:00:00Z' }
  ], { initial: true }), RECEIPT, pcOpts);
  assert.deepStrictEqual(rows.map(r => JSON.parse(r.detail).path), ['#Police/win/style/path.docx']);
  assert.strictEqual(JSON.parse(rows[0].detail).first_scan, true);
});

/* ---- calendar diff ---- */
test('calendar: new, unchanged, changed, cancelled, before backfill', () => {
  const idx = {};
  const o = { backfillMs, nowIso: '2026-11-05T19:00:00+07:00' };
  const ev = { id: 'e1', summary: 'สอบปากคำ 12/2569', htmlLink: 'https://cal/e1', created: '2026-11-03T01:00:00Z', updated: '2026-11-03T01:00:00Z',
    start: { dateTime: '2026-11-04T11:30:00+07:00' }, end: { dateTime: '2026-11-04T12:30:00+07:00' } };
  let r = Core.diffCalendarEvent(ev, 'Work', 'c', idx, o);
  assert.strictEqual(r[0].kind, 'calendar_event');
  assert.strictEqual(r[0].case_no, '12/2569');
  assert.strictEqual(JSON.parse(r[0].detail).entered, '2026-11-03T08:00:00+07:00');
  assert.strictEqual(Core.diffCalendarEvent(ev, 'Work', 'c', idx, o).length, 0);
  r = Core.diffCalendarEvent(Object.assign({}, ev, { start: { dateTime: '2026-11-04T13:00:00+07:00' }, updated: '2026-11-04T00:00:00Z' }), 'Work', 'c', idx, o);
  assert.strictEqual(r[0].kind, 'calendar_changed');
  assert.strictEqual(JSON.parse(r[0].detail).was.s, '2026-11-04T11:30:00+07:00');
  r = Core.diffCalendarEvent({ id: 'e1', status: 'cancelled' }, 'Work', 'c', idx, o);
  assert.strictEqual(r[0].kind, 'calendar_cancelled');
  assert.strictEqual(Core.diffCalendarEvent({ id: 'e1', status: 'cancelled' }, 'Work', 'c', idx, o).length, 0);
  const old = Object.assign({}, ev, { id: 'e0', start: { date: '2026-09-01' }, end: { date: '2026-09-02' } });
  assert.strictEqual(Core.diffCalendarEvent(old, 'Work', 'c', idx, o).length, 0);
});

/* ===================== Whole script on fakes ===================== */
console.log('Script (fakes)');

const { makeEnv } = require('./fakes');
const W = makeEnv();
const run = (expr) => vm.runInContext(expr, W.env);

test('setup creates tabs and default settings', () => {
  run('setup()');
  const names = W.ss.sheets.map(s => s.name);
  ['Roster', 'Cases', 'Seals', 'Index'].forEach(n => assert.ok(names.includes(n), n));
  assert.ok(names.some(n => /^Log \d{4}$/.test(n)));
  assert.strictEqual(W.props.CALENDARS, 'Work,Inquiry Copilot');
});

test('collectAll logs calendar events; second run adds nothing', () => {
  W.cal.Work.push({ id: 'e1', summary: 'สอบปากคำผู้เสียหาย 12/2569', htmlLink: 'https://cal/e1',
    created: '2026-11-03T01:00:00Z', updated: '2026-11-03T01:00:00Z',
    start: { dateTime: '2026-11-04T11:30:00+07:00' }, end: { dateTime: '2026-11-04T12:30:00+07:00' } });
  W.cal['Inquiry Copilot นัดหมาย'].push({ id: 'e2', summary: '=SUM(A1) formula-looking title', htmlLink: 'https://cal/e2',
    created: '2026-11-03T01:00:00Z', start: { dateTime: '2026-11-04T14:00:00+07:00' }, end: { dateTime: '2026-11-04T15:00:00+07:00' } });
  W.cal.Family.push({ id: 'f1', summary: 'personal', created: '2026-11-03T01:00:00Z',
    start: { dateTime: '2026-11-04T19:00:00+07:00' }, end: { dateTime: '2026-11-04T20:00:00+07:00' } });
  const out = run('collectAll()');
  assert.ok(/2 new/.test(out) && !/not found/.test(out), out + ' (Inquiry Copilot prefix matches, Family ignored)');
  assert.strictEqual(run('readLog_().length'), 2);
  run('collectAll()');
  assert.strictEqual(run('readLog_().length'), 2);
});

test('formula-looking text is stored as plain text and still verifies', () => {
  const titles = run('readLog_().map(function(r){return r.title})');
  assert.ok(titles.includes('=SUM(A1) formula-looking title'));
  assert.ok(/Log OK/.test(run('verifyLog()')));
});

test('PC reporter endpoint: rejects bad token, logs a batch, verifies', () => {
  const post = (obj) => JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(obj) } }) + ')').text);
  assert.strictEqual(post({ token: 'wrong', events: [] }).ok, false);
  const token = W.props.PC_TOKEN;
  assert.ok(token && token.length >= 64, 'setup made a long secret');
  const r = post({ token, device: 'PC1', deviceNow: new Date().toISOString().slice(0, 19) + 'Z', events: [
    { kind: 'folder_created', root: '#Police', path: 'แฟ้มคดี/12-2569 ลักทรัพย์', time: '2026-11-04T01:00:00Z' },
    { kind: 'file_created', root: '#Police', path: 'แฟ้มคดี/12-2569 ลักทรัพย์/คำให้การ.docx', time: '2026-11-04T01:58:00Z', size: 1000, sha256: 'aa' },
    { kind: 'file_modified', root: '#Police', path: 'แฟ้มคดี/12-2569 ลักทรัพย์/คำให้การ.docx', time: '2026-11-04T08:59:00Z', size: 1200, sha256: 'bb' }
  ] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.rows, 3);
  assert.ok(/Log OK/.test(run('verifyLog()')));
});

test('photo upload entry points to when the photo was taken', () => {
  const post = (obj) => JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(obj) } }) + ')').text);
  post({ token: W.props.PC_TOKEN, device: 'PC', deviceNow: new Date().toISOString().slice(0, 19) + 'Z', events: [
    { kind: 'file_created', root: '#Police', path: 'p/IMG_7.HEIC', time: '2026-11-06T03:10:00Z', sha256: 'z' },
    { kind: 'photo_taken', root: '#Police', path: 'p/IMG_7.HEIC', time: '2026-11-05T10:04:00Z', sha256: 'z' }] });
  const d = run("getDay('2026-11-06', '" + W.props.VIEW_KEY + "')");
  const up = d.entries.find(e => e.title === 'IMG_7.HEIC');
  assert.strictEqual(up.isPhoto, true);
  assert.strictEqual(up.taken, '2026-11-05T17:04:00+07:00');
  const d5 = run("getDay('2026-11-05', '" + W.props.VIEW_KEY + "')");
  assert.ok(d5.entries.some(e => e.kind === 'photo_taken' && e.title === 'IMG_7.HEIC'));
});

test('day view is locked without the key', () => {
  assert.strictEqual(run("doGet({parameter:{}})").html, 'Not found');
  assert.strictEqual(run("doGet({parameter:{k:'nope'}})").html, 'Not found');
  assert.ok(run("doGet({parameter:{k:'" + W.props.VIEW_KEY + "'}})").tpl, 'page served with key');
  assert.throws(() => run("getDay('2026-11-04', 'nope')"), /Not allowed/);
  assert.throws(() => run("addNote({k:'nope', date:'2026-11-04', from:'08:00', text:'x'})"), /Not allowed/);
});

test('day view: entries, duty from roster, gaps, case mapping', () => {
  const roster = W.ss.getSheetByName('Roster');
  roster.appendRow(['2026-11-04', '08:00', '16:00', 'เวรสอบสวน']);
  const cases = W.ss.getSheetByName('Cases');
  cases.appendRow(['12/2569', '12/2569 ลักทรัพย์', '']);
  const d = run("getDay('2026-11-04', '" + W.props.VIEW_KEY + "')");
  assert.strictEqual(d.shifts.length, 1);
  assert.ok(d.entries.length >= 3, 'calendar + file entries');
  const edited = d.entries.find(e => e.kind === 'file_modified');
  assert.strictEqual(edited.duty, 'on', 'edit at 15:59 is inside the 08:00-16:00 shift');
  assert.strictEqual(edited.caseNo, '12/2569 ลักทรัพย์', 'Cases tab mapping applied');
  assert.ok(d.gaps.length >= 1, 'morning gap flagged');
});

test('day view: shift copied into the calendar and all-day events do not hide gaps', () => {
  W.calChanges.Work.push({ id: 's1', summary: 'เวรรับแจ้งความ 08.00–16.00', created: '2026-11-03T01:00:00Z', updated: '2026-11-03T01:00:00Z',
    start: { dateTime: '2026-11-04T08:00:00+07:00' }, end: { dateTime: '2026-11-04T16:00:00+07:00' } });
  W.calChanges.Work.push({ id: 's2', summary: 'เวรฝากขัง', created: '2026-11-03T01:00:00Z', updated: '2026-11-03T01:00:00Z',
    start: { date: '2026-11-04' }, end: { date: '2026-11-05' } });
  run('collectAll()');
  const d = run("getDay('2026-11-04', '" + W.props.VIEW_KEY + "')");
  assert.ok(!d.entries.some(e => e.title === 'เวรรับแจ้งความ 08.00–16.00'), 'roster-matching event hidden');
  assert.ok(d.entries.some(e => e.title === 'เวรฝากขัง'), 'all-day event still listed');
  assert.ok(d.gaps.length >= 1, 'gaps still flagged');
});

test('notes: validation and append-only', () => {
  const K = W.props.VIEW_KEY;
  assert.throws(() => run("addNote({k:'" + K + "', date:'2026-11-04', from:'', text:'x'})"), /start time/);
  assert.throws(() => run("addNote({k:'" + K + "', date:'2026-11-04', from:'13:00', text:'  '})"), /Write what/);
  const before = run('readLog_().length');
  const d = run("addNote({k:'" + K + "', date:'2026-11-04', from:'08:00', to:'11:00', caseNo:'12/2569', text:'ยื่นฝากขังที่ศาล'})");
  assert.strictEqual(run('readLog_().length'), before + 1);
  const n = d.entries.find(e => e.kind === 'note');
  assert.strictEqual(n.strength, 'self');
  assert.ok(n.written);
  assert.ok(!d.gaps.some(g => g.start < '2026-11-04T11:00'), 'note covers the morning gap');
});

test('app API: JSON day needs the key; notes can be posted from the app', () => {
  const K = W.props.VIEW_KEY;
  const bad = JSON.parse(run("doGet({parameter:{api:'day', date:'2026-11-04', k:'nope'}})").text);
  assert.strictEqual(bad.ok, false);
  const good = JSON.parse(run("doGet({parameter:{api:'day', date:'2026-11-04', k:'" + K + "'}})").text);
  assert.strictEqual(good.ok, true);
  assert.ok(good.day.entries.length > 0);
  const before = run('readLog_().length');
  const body = JSON.stringify({ action: 'note', k: K, date: '2026-11-04', from: '17:00', text: 'จากแอป' });
  const res = JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: body } }) + ')').text);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(run('readLog_().length'), before + 1);
  const res2 = JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: body.replace(K, 'nope') } }) + ')').text);
  assert.strictEqual(res2.ok, false);
});

test('iPhone: duty check and check-ins (hourly kept only on duty; arrived/left always)', () => {
  const T = W.props.PHONE_TOKEN;
  assert.ok(T && T.length >= 64);
  assert.ok(W.ss.getSheetByName('Places').getLastRow() >= 4, 'default places created');
  const get = (q) => JSON.parse(run('doGet(' + JSON.stringify({ parameter: q }) + ')').text);
  const post = (o) => JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(o) } }) + ')').text);
  assert.strictEqual(get({ api: 'duty', t: 'nope' }).ok, false);
  const now = run('Core.toBkkIso(new Date())');
  const roster = W.ss.getSheetByName('Roster');
  const before = run('readLog_().length');
  // off duty now: hourly check-in is dropped
  assert.strictEqual(get({ api: 'duty', t: T }).onDuty, false);
  let r = post({ action: 'checkin', t: T, kind: 'checkin', lat: 13.8787, lon: 100.4046 });
  assert.deepStrictEqual([r.ok, r.logged], [true, false]);
  // arrived is kept even off duty
  r = post({ action: 'checkin', t: T, kind: 'arrive', place: 'สภ.บางใหญ่', lat: 13.8787, lon: 100.4046 });
  assert.deepStrictEqual([r.ok, r.logged, r.title], [true, true, 'สภ.บางใหญ่']);
  // put a shift around now: hourly check-in is kept
  const h = Number(now.slice(11, 13));
  roster.appendRow([now.slice(0, 10), String((h + 23) % 24).padStart(2, '0') + ':00', String((h + 1) % 24).padStart(2, '0') + ':59', 'test']);
  assert.strictEqual(get({ api: 'duty', t: T }).onDuty, true);
  assert.strictEqual(get({ api: 'duty', t: T }).duty, 'yes');
  r = post({ action: 'checkin', t: T, kind: 'checkin', lat: 13.8787, lon: 100.4046 });
  assert.strictEqual(r.logged, true);
  assert.strictEqual(post({ action: 'checkin', t: 'bad', kind: 'arrive' }).ok, false);
  assert.strictEqual(run('readLog_().length'), before + 2);
  assert.ok(/Log OK/.test(run('verifyLog()')));
});

test('seal emails the day CSV with the chain hash, once per day', () => {
  const today = run('Core.toBkkIso(new Date()).slice(0,10)');
  const subj = run("sealDay('" + today + "')");
  assert.ok(/Seal .* rows · [0-9a-f]{12}/.test(subj), subj);
  assert.strictEqual(W.sent.length, 1);
  assert.strictEqual(W.sent[0].to, 'me@example.com', 'defaults to your own address');
  assert.ok(W.sent[0].opts.attachments[0].data.indexOf('row_hash') > 0);
  assert.ok(/Work timeline ·/.test(W.sent[0].opts.htmlBody) && /<table/.test(W.sent[0].opts.htmlBody), 'graphical timeline in the email');
  assert.ok(W.sent[0].opts.htmlBody.indexOf(W.props.VIEW_KEY) < 0, 'no key in the email');
  assert.ok(/Already sealed/.test(run("sealDay('" + today + "')")));
  assert.strictEqual(W.sent.length, 1);
});

test('verify catches an edited row and an edited seal', () => {
  assert.ok(/Log OK/.test(run('verifyLog()')));
  const log = W.ss.sheets.find(s => /^Log /.test(s.name));
  const keep = log.data[2][5];
  log.data[2][5] = 'tampered title';
  assert.ok(/WT0000002 does not match/.test(run('verifyLog()')));
  log.data[2][5] = keep;
  assert.ok(/Log OK/.test(run('verifyLog()')));
  log.data.splice(2, 1);
  assert.ok(/does not match/.test(run('verifyLog()')), 'deleted row detected');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
