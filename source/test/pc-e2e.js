/* End-to-end: runs pc/reporter.ps1 (PowerShell) against a local server that hosts the real
 * Apps Script code on fakes, including Apps Script's POST -> 302 -> GET response pattern.
 * Run: PWSH=/path/to/pwsh node test/pc-e2e.js */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { spawn } = require('child_process');
const { makeEnv } = require('./fakes');

const PWSH = process.env.PWSH || 'pwsh';
const W = makeEnv();
const run = (expr) => vm.runInContext(expr, W.env);
run('setup()');

const echoes = {};
let n = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const contents = Buffer.concat(chunks).toString('utf8');
      W.env.__req = { postData: { contents } };
      const out = run('doPost(__req)').text;
      const id = 'e' + (++n);
      echoes[id] = out;
      res.writeHead(302, { Location: '/echo?id=' + id });   // what Apps Script does
      res.end();
    });
  } else {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(echoes[id] || '{}');
  }
});

function pwsh(args) {
  return new Promise((resolve) => {
    const p = spawn(PWSH, ['-NoProfile', '-File', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', code => resolve({ code, out }));
  });
}

function write(file, text, ageMinutes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  if (ageMinutes) { const t = new Date(Date.now() - ageMinutes * 60000); fs.utimesSync(file, t, t); }
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const police = path.join(tmp, 'OneDrive', '#Police');
  const ic = path.join(tmp, 'D', 'Inquiry_Copilot_Storage', 'profiles');
  const cfgDir = path.join(tmp, 'cfg');
  fs.mkdirSync(cfgDir);

  const caseDir = path.join(police, 'แฟ้มคดี', '12-2569 ลักทรัพย์');
  write(path.join(caseDir, 'คำให้การ.docx'), 'statement v1');
  write(path.join(caseDir, 'บันทึก.docx'), 'note');
  write(path.join(caseDir, '~$คำให้การ.docx'), 'lock');
  write(path.join(police, 'Work Timeline', 'src', 'Core.gs'), 'code');
  write(path.join(police, 'old', 'ancient.pdf'), 'old');
  fs.utimesSync(path.join(police, 'old', 'ancient.pdf'), new Date('2025-01-01'), new Date('2025-01-01'));
  const icCase = path.join(ic, 'ร้อยตำรวจตรีสมชาย_ใจดี_X', 'แฟ้มคดี', '2026-11-05_1510-ลักสายไฟ_โรงงาน');
  write(path.join(icCase, '__res__', 'session.json'), '{"a":1}');
  write(path.join(ic, 'ร้อยตำรวจตรีสมชาย_ใจดี_X', '__temp__', 'junk.tmp2'), 'x');

  fs.writeFileSync(path.join(cfgDir, 'reporter.json'), JSON.stringify({
    endpoint: 'http://127.0.0.1:' + port + '/exec', token: W.props.PC_TOKEN, backfillFrom: '2026-10-01',
    roots: [
      { label: '#Police', path: police, exclude: ['Work Timeline', 'Inquiry Copilot Mirror'] },
      { label: 'Inquiry Copilot', path: ic, exclude: ['__temp__'] },
      { label: 'Missing drive', path: path.join(tmp, 'nope'), exclude: [] }
    ]
  }));
  const reporter = path.join(__dirname, '..', 'pc', 'reporter.ps1');
  const rows = () => JSON.parse(JSON.stringify(run('readLog_()'))).map(r => ({ kind: r.kind, path: JSON.parse(r.detail).path, d: JSON.parse(r.detail), r }));
  let fails = 0;
  const check = (name, fn) => { try { fn(); console.log('  ok  ' + name); } catch (e) { fails++; console.log('  FAIL ' + name + '\n       ' + e.message); } };

  console.log('PC reporter end-to-end');
  let res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  const log1 = fs.readFileSync(path.join(cfgDir, 'last-run.log'), 'utf8');
  check('first run succeeds', () => assert.strictEqual(res.code, 0, res.out + log1));
  let r1 = rows();
  check('first scan logs folders and files, skips excluded / noise / old', () => {
    const paths = r1.map(x => x.kind + ' ' + x.path).sort();
    assert.ok(paths.includes('file_created #Police/แฟ้มคดี/12-2569 ลักทรัพย์/คำให้การ.docx'), paths.join('\n'));
    assert.ok(paths.includes('folder_created #Police/แฟ้มคดี/12-2569 ลักทรัพย์'));
    assert.ok(paths.some(p => p.endsWith('__res__/session.json')));
    assert.ok(!paths.some(p => /Work Timeline|~\$|__temp__|ancient/.test(p)), paths.join('\n'));
  });
  check('files carry SHA-256 and case labels', () => {
    const f = r1.find(x => x.path.endsWith('คำให้การ.docx'));
    assert.strictEqual(f.d.sha256, require('crypto').createHash('sha256').update('statement v1').digest('hex'));
    assert.strictEqual(f.r.case_no, '12/2569');
    const s = r1.find(x => x.path.endsWith('session.json'));
    assert.strictEqual(s.r.case_no, '2026-11-05_1510-ลักสายไฟ_โรงงาน');
    assert.strictEqual(f.d.first_scan, true);
  });

  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  check('second run with no changes sends nothing', () => assert.strictEqual(rows().length, r1.length));

  // Changes: edit, rename, delete, new file.
  write(path.join(caseDir, 'คำให้การ.docx'), 'statement v2, longer');
  fs.renameSync(path.join(caseDir, 'บันทึก.docx'), path.join(caseDir, 'บันทึกการจับกุม.docx'));
  fs.rmSync(path.join(icCase, '__res__', 'session.json'));
  write(path.join(police, 'new.pdf'), 'new file');
  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  check('third run succeeds', () => assert.strictEqual(res.code, 0, res.out + fs.readFileSync(path.join(cfgDir, 'last-run.log'), 'utf8')));
  const r3 = rows().slice(r1.length);
  check('edit, rename, delete and new file are all logged once', () => {
    const k = r3.map(x => x.kind + ' ' + x.path.split('/').pop()).sort();
    assert.deepStrictEqual(k, ['file_created new.pdf', 'file_deleted session.json', 'file_modified คำให้การ.docx',
      'file_renamed บันทึกการจับกุม.docx'], k.join('\n'));
    const ren = r3.find(x => x.kind === 'file_renamed');
    assert.strictEqual(ren.d.from, 'แฟ้มคดี/12-2569 ลักทรัพย์/บันทึก.docx');
  });
  check('fresh edits rate strong; second scan is not marked first_scan', () => {
    const m = r3.find(x => x.kind === 'file_modified');
    assert.strictEqual(m.r.strength, 'strong');
    assert.strictEqual(m.d.first_scan, undefined);
  });
  check('missing root is skipped without losing anything', () =>
    assert.ok(/Not found, skipped/.test(fs.readFileSync(path.join(cfgDir, 'last-run.log'), 'utf8'))));

  // Bad token: nothing logged, state not advanced, so the change is sent later.
  const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'reporter.json'), 'utf8').replace(/^﻿/, ''));
  cfg.token = 'wrong';
  fs.writeFileSync(path.join(cfgDir, 'reporter.json'), JSON.stringify(cfg));
  write(path.join(police, 'later.pdf'), 'later');
  const before = rows().length;
  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  check('refused report exits with error and logs nothing', () => {
    assert.strictEqual(res.code, 1);
    assert.strictEqual(rows().length, before);
  });
  cfg.token = W.props.PC_TOKEN;
  fs.writeFileSync(path.join(cfgDir, 'reporter.json'), JSON.stringify(cfg));
  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  check('after fixing, the held-back change is sent', () => {
    const added = rows().slice(before).map(x => x.path.split('/').pop());
    assert.deepStrictEqual(added, ['later.pdf']);
  });
  // Photos: one arrived before photo reading existed (no reader available), then reading is switched on.
  write(path.join(caseDir, 'IMG_0001.HEIC'), 'heic-bytes');
  write(path.join(caseDir, 'IMG_0002.JPG'), 'jpg-bytes');
  write(path.join(police, 'holiday', 'IMG_0099.JPG'), 'old');
  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  const beforePhotos = rows().length;
  check('without a photo reader, photos are logged as files only', () =>
    assert.ok(!rows().some(x => x.kind === 'photo_taken')));
  fs.writeFileSync(path.join(tmp, 'exif.json'), JSON.stringify({
    'IMG_0001.HEIC': { taken: '2026:11:05 14:20:31', offset: '+07:00', lat: 13.789267, lon: 100.5 },
    'IMG_0002.JPG': { taken: '2026:11:05 15:01:00' },
    'IMG_0099.JPG': { taken: '2025:04:13 10:00:00' }
  }));
  process.env.WT_FAKE_EXIF = path.join(tmp, 'exif.json');
  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  const ph = rows().slice(beforePhotos).filter(x => x.kind === 'photo_taken');
  check('photos already logged get their time taken (and GPS) once', () => {
    assert.deepStrictEqual(ph.map(x => [x.path.split('/').pop(), x.r.event_time, x.r.strength]).sort(), [
      ['IMG_0001.HEIC', '2026-11-05T14:20:31+07:00', 'medium'], ['IMG_0002.JPG', '2026-11-05T15:01:00+07:00', 'medium']]);
    assert.strictEqual(ph.find(x => x.path.endsWith('HEIC')).r.proof_url, 'https://maps.google.com/?q=13.789267,100.5');
    assert.strictEqual(ph.find(x => x.path.endsWith('HEIC')).r.case_no, '12/2569');
  });
  const afterPhotos = rows().length;
  write(path.join(caseDir, 'IMG_0003.HEIC'), 'new');
  fs.writeFileSync(path.join(tmp, 'exif.json'), JSON.stringify({ 'IMG_0003.HEIC': { taken: '2026:11:06 09:10:00', lat: 13.8, lon: 100.4 } }));
  res = await pwsh([reporter, '-ConfigDir', cfgDir]);
  check('a new photo is logged as a file and as a photo; older photos are not repeated', () => {
    const k = rows().slice(afterPhotos).map(x => x.kind + ' ' + x.path.split('/').pop()).sort();
    assert.deepStrictEqual(k, ['file_created IMG_0003.HEIC', 'photo_taken IMG_0003.HEIC'], k.join('\n'));
  });
  delete process.env.WT_FAKE_EXIF;

  check('hash chain verifies', () => assert.ok(/Log OK/.test(run('verifyLog()'))));

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
