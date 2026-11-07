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


test('daySummary: coverage of the shift, work outside it, documents, photos, places', () => {
  const at = (h) => '2026-11-04T' + h + ':00+07:00';
  const s = Core.daySummary({
    date: '2026-11-04', rosterKnown: true, now: new Date(at('23:59')),
    shifts: [{ start: at('08:00'), end: at('16:00'), label: 'x' }],
    gaps: [{ start: at('09:00'), end: at('10:40') }],
    entries: [
      { kind: 'file_created', t: at('08:30'), path: 'P/แฟ้มคดี/2026-11-04_0830-ลักทรัพย์_ก/บันทึก.docx', caseNo: 'A' },
      { kind: 'file_modified', t: at('08:45'), path: 'P/แฟ้มคดี/2026-11-04_0830-ลักทรัพย์_ก/บันทึก.docx', caseNo: 'A' },
      { kind: 'file_modified', t: at('11:00'), path: 'P/แฟ้มคดี/2026-11-04_0830-ลักทรัพย์_ก/__res__/session.json', caseNo: 'A' },
      { kind: 'file_modified', t: at('19:00'), path: 'P/x/คำให้การ.docx', caseNo: 'B' },
      { kind: 'file_modified', t: at('19:10'), path: 'P/x/คำให้การ.docx', caseNo: 'B' },
      { kind: 'note', t: at('21:00'), tEnd: at('22:00'), caseNo: '' },
      { kind: 'photo_taken', t: at('12:00'), proof: 'https://maps.google.com/?q=1,2' },
      { kind: 'photo_taken', t: at('12:05'), proof: '' },
      { kind: 'calendar_event', t: at('13:00'), title: 'สอบปากคำ', caseNo: '' },
      { kind: 'calendar_event', t: at('00:00'), title: 'เวรฝากขัง', plan: true }
    ],
    visits: [{ place: 'ศาลนนทบุรี', start: at('14:00'), end: at('15:00') }]
  });
  assert.strictEqual(s.shiftMin, 480);
  assert.strictEqual(s.coveredMin, 380, '8h minus a 100-minute gap');
  assert.strictEqual(s.outsideMin, 25 + 60, '19:00–19:25 (two edits, 15 min each, joined) + the 1-hour note');
  assert.strictEqual(s.outsideSessions, 2);
  assert.deepStrictEqual([s.created, s.edited], [1, 1], 'new file not double-counted; Inquiry Copilot session file ignored');
  assert.deepStrictEqual([s.photosTaken, s.photosGps], [2, 1]);
  assert.deepStrictEqual(s.cases.sort(), ['A', 'B']);
  assert.deepStrictEqual(s.calendar, ['สอบปากคำ'], 'all-day plan left out');
  const lines = Core.summaryLines(s, { shifts: [{ start: at('08:00'), end: at('16:00'), label: '' }], rosterKnown: true, notices: { overdue: 1, soon: 0 } });
  const t = Object.fromEntries(lines.map(l => [l.key, l.text]));
  assert.strictEqual(t.onduty, '6h 20m of 8h · 1 gap (1h 40m)');
  assert.strictEqual(t.outside, 'about 1h 25m in 2 sessions');
  assert.ok(/1 overdue/.test(t.notices));
});

test('daySummary: shift still running shows "so far"; a night shift ends at 24:00', () => {
  const s = Core.daySummary({ date: '2026-11-04', rosterKnown: true, now: new Date('2026-11-04T18:00:00+07:00'),
    shifts: [{ start: '2026-11-04T16:00:00+07:00', end: '2026-11-05T00:00:00+07:00' }], gaps: [], entries: [], visits: [] });
  assert.deepStrictEqual([s.elapsedMin, s.shiftMin, s.shiftDone], [120, 480, false]);
  const l = Core.summaryLines(s, { shifts: [{ start: '2026-11-04T16:00:00+07:00', end: '2026-11-05T00:00:00+07:00', label: '' }], rosterKnown: true });
  assert.strictEqual(l[0].text, '16:00–24:00');
  assert.strictEqual(l[1].text, '2h of 2h so far (shift 8h) · no gaps');
});

test('progress notices: 30 days, then 2 months after the first, final when the file goes to the prosecutor', () => {
  assert.deepStrictEqual(Core.caseFolderInfo('2026-11-05_0939-จราจร_นายตัวอย่าง'), { start: '2026-11-05', type: 'จราจร' });
  assert.strictEqual(Core.caseFolderInfo('77-2569 ลักทรัพย์'), null);
  let st = Core.noticeStatus('2026-11-05', [], '2026-11-30');
  assert.deepStrictEqual([st.next.n, st.next.due, st.daysLeft, st.overdue], [1, '2026-12-05', 5, false]);
  st = Core.noticeStatus('2026-11-05', [], '2026-12-07');
  assert.ok(st.overdue);
  st = Core.noticeStatus('2026-11-05', ['2026-12-03'], '2026-12-07');
  assert.deepStrictEqual([st.next.n, st.next.due], [2, '2027-02-03']);
  st = Core.noticeStatus('2026-11-05', ['2026-12-03', '2027-02-01'], '2027-02-07');
  assert.deepStrictEqual([st.next.n, st.next.due, st.daysLeft], [3, '', null]);
  st = Core.noticeStatus('2026-11-05', ['2026-12-03'], '2027-01-10', '2027-01-08');
  assert.deepStrictEqual([st.next.n, st.next.due, st.next.final, st.overdue], [2, '2027-01-08', true, true]);
  st = Core.noticeStatus('2026-11-05', ['2026-12-03', '2027-01-09'], '2027-01-10', '2027-01-08');
  assert.strictEqual(st.next, null, 'final notice sent');
});

test('collectCases: work dates, notice letters by file name, deleted folders', () => {
  const F = 'แฟ้มคดี';
  const row = (kind, t, path, extra) => Object.assign({ kind, event_time: t, case_no: '', detail: JSON.stringify({ path }) }, extra || {});
  const c = Core.collectCases([
    row('folder_created', '2026-11-05T09:39:00+07:00', 'IC/p/' + F + '/2026-11-05_0939-จราจร_ก'),
    row('file_modified', '2026-11-06T10:00:00+07:00', 'IC/p/' + F + '/2026-11-05_0939-จราจร_ก/__res__/session.json'),
    row('file_created', '2026-12-03T10:00:00+07:00', 'IC/p/' + F + '/2026-11-05_0939-จราจร_ก/หนังสือแจ้งความคืบหน้า ครั้งที่ 1.docx'),
    row('file_modified', '2026-12-04T10:00:00+07:00', 'IC/p/' + F + '/2026-11-05_0939-จราจร_ก/หนังสือแจ้งความคืบหน้า ครั้งที่ 1.docx'),
    { kind: 'note', event_time: '2026-12-10T09:00:00+07:00', case_no: '12/2569', detail: '{}' },
    { kind: 'calendar_event', event_time: '2026-12-20T09:00:00+07:00', case_no: '12/2569', detail: '{}' },
    row('folder_created', '2026-11-06T09:00:00+07:00', 'IC/p/' + F + '/2026-11-06_0900-ฉ้อโกง_ข'),
    row('folder_deleted', '2026-11-06T09:30:00+07:00', 'IC/p/' + F + '/2026-11-06_0900-ฉ้อโกง_ข')
  ], [F], ['แจ้งความคืบหน้า'], { '12/2569': '2026-11-05_0939-จราจร_ก' });
  const a = c['2026-11-05_0939-จราจร_ก'];
  assert.deepStrictEqual(Object.keys(a.workDates), ['2026-11-05', '2026-11-06', '2026-12-03', '2026-12-04', '2026-12-10'], 'note counts, calendar plan does not');
  assert.deepStrictEqual(a.notices, ['2026-12-03'], 'one letter, edits not counted again');
  assert.ok(c['2026-11-06_0900-ฉ้อโกง_ข'].deleted);
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


test('v9: Cases tab fills itself with Inquiry Copilot cases and LINE codes', () => {
  const post = (obj) => JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(obj) } }) + ')').text);
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  const base = 'p/แฟ้มคดี/2026-10-20_1015-ลักทรัพย์_นายตัวอย่าง';
  post({ token: W.props.PC_TOKEN, device: 'PC', deviceNow: now, events: [
    { kind: 'folder_created', root: 'Inquiry Copilot', path: base, time: '2026-10-20T03:15:00Z' },
    { kind: 'file_created', root: 'Inquiry Copilot', path: base + '/บันทึกคำให้การ.docx', time: '2026-11-04T03:00:00Z', sha256: 'c1' },
    { kind: 'file_created', root: 'Inquiry Copilot', path: base + '/แจ้งความคืบหน้า ครั้งที่ 1.docx', time: '2026-11-04T04:00:00Z', sha256: 'c2' }] });
  const out = run('collectAll()');
  assert.ok(/1 case added/.test(out), out);
  const cases = run('readCases_()');
  const c = cases.find(x => x.folder === '2026-10-20_1015-ลักทรัพย์_นายตัวอย่าง');
  assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c.code), c.code);
  assert.ok(!/[01OIL]/.test(c.code));
  assert.ok(!/case added/.test(run('collectAll()')), 'not added twice');
  W.ss.getSheetByName('Cases').getRange(c.row, 2).setValue('345/2569');
});

test('v9: day data carries the summary card and progress notices', () => {
  const d = run("getDay('2026-11-04', '" + W.props.VIEW_KEY + "')");
  assert.ok(d.summary && d.summaryLines.length >= 3);
  assert.strictEqual(d.summaryLines[0].key, 'shift');
  assert.ok(d.summaryLines.some(l => l.key === 'onduty'));
  const all = d.summary.notices.all;
  const n = all.find(x => x.label === '345/2569');
  assert.ok(n, 'case labelled by its number from the Cases tab');
  assert.deepStrictEqual([n.n, n.due], [2, '2027-01-04'], 'first notice found by file name on 4 Nov; second due 2 months later');
  const d2 = run("dayData_('2026-11-03')");
  const n2 = d2.summary.notices.all.find(x => x.label === '345/2569');
  assert.deepStrictEqual([n2.n, n2.due, n2.daysLeft], [1, '2026-11-19', 16], 'as of 3 Nov the first notice was still pending');
});

test('seal emails the day CSV with the chain hash, once per day', () => {
  const today = run('Core.toBkkIso(new Date()).slice(0,10)');
  const subj = run("sealDay('" + today + "')");
  assert.ok(/Seal .* rows · [0-9a-f]{12}/.test(subj), subj);
  assert.strictEqual(W.sent.length, 1);
  assert.strictEqual(W.sent[0].to, 'me@example.com', 'defaults to your own address');
  assert.ok(W.sent[0].opts.attachments[0].data.indexOf('row_hash') > 0);
  assert.ok(/Work timeline ·/.test(W.sent[0].opts.htmlBody) && /<table/.test(W.sent[0].opts.htmlBody), 'graphical timeline in the email');
  assert.ok(/>Shift</.test(W.sent[0].opts.htmlBody), 'summary card in the email');
  assert.ok(W.sent[0].opts.htmlBody.indexOf(W.props.VIEW_KEY) < 0, 'no key in the email');
  assert.ok(/Already sealed/.test(run("sealDay('" + today + "')")));
  assert.strictEqual(W.sent.length, 1);
});


test('v10 LINE: config and totals are public but totals stay off until switched on', () => {
  const get = (q) => JSON.parse(run('doGet(' + JSON.stringify({ parameter: q }) + ')').text);
  assert.deepStrictEqual(get({ api: 'line_config' }), { ok: true, liffId: '', publicStats: false, casesOn: false });
  assert.deepStrictEqual(get({ api: 'stats' }), { ok: true, off: true });
  run("saveLineSetup({liffId:'2001234567-AbCdEfGh', channelId:'2001234567', publicStats:true})");
  assert.throws(() => run("saveLineSetup({liffId:'nope'})"), /LIFF ID/);
  const st = get({ api: 'stats' });
  assert.strictEqual(st.ok, true);
  const all = st.periods.find(p => p.key === 'all');
  assert.ok(all.onDutyHours > 0 && all.documents >= 1 && all.cases >= 1, JSON.stringify(all));
  assert.ok(!/ลักทรัพย์|นายตัวอย่าง|docx|345/.test(JSON.stringify(st)), 'totals only: no names, files or case numbers');
});

test('v10 LINE: complainant links a case with its code and sees dates only', () => {
  const post = (o) => JSON.parse(run('doPost(' + JSON.stringify({ postData: { contents: JSON.stringify(o) } }) + ')').text);
  let calls = 0;
  W.env.UrlFetchApp = { fetch: (url, opt) => {
    calls++;
    assert.strictEqual(url, 'https://api.line.me/oauth2/v2.1/verify');
    const ok = opt.payload.id_token.startsWith('good');
    return { getResponseCode: () => ok ? 200 : 400,
      getContentText: () => JSON.stringify({ sub: 'U' + opt.payload.id_token, aud: opt.payload.client_id }) };
  } };
  assert.strictEqual(post({ action: 'line_cases', idToken: 'bad1' }).ok, false);
  let r = post({ action: 'line_cases', idToken: 'good-A' });
  assert.deepStrictEqual(r, { ok: true, cases: [] });
  const code = run('readCases_()').find(x => x.caseNo === '345/2569').code;
  r = post({ action: 'line_link', idToken: 'good-A', code: 'ZZZZ-ZZZZ' });
  assert.ok(!r.ok && /ไม่พบรหัส/.test(r.error));
  r = post({ action: 'line_link', idToken: 'good-A', code: code.toLowerCase().replace('-', ' ') });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.cases.length, 1);
  const c = r.cases[0];
  assert.deepStrictEqual([c.caseNo, c.type, c.reported, c.notices, c.next.n], ['345/2569', 'ลักทรัพย์', '2026-10-20', ['2026-11-04'], 2]);
  assert.ok(c.workDates.includes('2026-11-04'));
  assert.ok(!/นายตัวอย่าง|docx|T\d\d:/.test(JSON.stringify(r)), 'no names, file names or times of day');
  const links = W.ss.getSheetByName('Links');
  assert.ok(!JSON.stringify(links.data).includes('Ugood-A'), 'raw LINE user ID never stored');
  assert.strictEqual(post({ action: 'line_link', idToken: 'good-A', code }).cases.length, 1, 'linking twice keeps one');
  assert.strictEqual(post({ action: 'line_cases', idToken: 'good-B' }).cases.length, 0, 'another LINE user sees nothing');
  const before = calls;
  post({ action: 'line_cases', idToken: 'good-A' });
  assert.strictEqual(calls, before, 'verified token cached for a few minutes');
  assert.strictEqual(post({ action: 'line_unlink', idToken: 'good-A', code }).cases.length, 0);
  for (let i = 0; i < 5; i++) post({ action: 'line_link', idToken: 'good-C', code: 'AAAA-AAA' + i });
  r = post({ action: 'line_link', idToken: 'good-C', code });
  assert.ok(!r.ok && /1 ชั่วโมง/.test(r.error), 'locked out after 5 wrong codes');
  W.env.UrlFetchApp = { fetch: () => { throw new Error('no network in tests'); } };
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
