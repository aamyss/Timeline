const path = require('path');
const vm = require('vm');
const http = require('http');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { makeEnv } = require('./fakes');

const W = makeEnv();
const run = (e) => vm.runInContext(e, W.env);
run('setup()');
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
W.env.__req = { postData: { contents: JSON.stringify({ token: W.props.PC_TOKEN, device: 'PC', deviceNow: new Date().toISOString().slice(0, 19) + 'Z', events: [
  { kind: 'folder_created', root: 'Inquiry Copilot', path: 'p/แฟ้มคดี/2026-11-05_0939-จราจร_Xpander', time: today + 'T02:39:00Z' },
  { kind: 'folder_created', root: 'Inquiry Copilot', path: 'p/แฟ้มคดี/2026-11-05_0939-จราจร_Xpander/ของกลาง', time: today + 'T02:39:00Z' },
  { kind: 'file_created', root: '#Police', path: 'a/<img src=x onerror=alert(1)>.docx', time: today + 'T03:00:00Z' }
] }) } };
console.log('post:', run('doPost(__req)').text);

const root = path.join(__dirname, '..', '..');   // repo root = the app
const srv = http.createServer((q, s) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0].replace(/^\/app\//, '/')) || 'index.html');
  const g = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
  const file = fs.existsSync(g) && fs.statSync(g).isFile() ? g : path.join(root, 'index.html');
  s.writeHead(200); s.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port + '/app/';
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request();
    let text;
    if (req.method() === 'GET') {
      const u = new URL(req.url()); const p = {}; u.searchParams.forEach((v, k) => { p[k] = v; });
      W.env.__e = { parameter: p }; text = run('doGet(__e)').text;
    } else {
      W.env.__e = { postData: { contents: req.postData() } }; text = run('doPost(__e)').text;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: text });
  });
  const u = 'https://script.google.com/macros/s/ABC/exec';
  const s = Buffer.from(JSON.stringify({ u, k: W.props.VIEW_KEY })).toString('base64url');
  let ok = 0, fail = 0; const check = (n, c) => { if (c) { ok++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL ' + n); } };

  await page.goto(base); await page.waitForTimeout(300);
  check('no key -> setup screen', await page.isVisible('#setup'));
  await page.goto(base + '#s=' + s); await page.waitForSelector('.row', { timeout: 5000 });
  const txt = await page.innerText('#list');
  check('entries render', /New folder/.test(txt) && /2026-11-05_0939/.test(txt));
  check('case sub-folder hidden', !/ของกลาง/.test(txt) && /1 automatic Inquiry Copilot item hidden/.test(await page.innerText('#counts')));
  check('html in names is escaped (no script ran)', dialogs.length === 0 && /<img src=x/.test(txt));
  check('install hint shown in browser', await page.isVisible('#installHint'));
  const sum = await page.innerText('#sum');
  check('v9 summary card on top (shift, cases, documents)', /Shift/.test(sum) && /Cases/.test(sum) && /Documents\s+1 created/.test(sum));
  check('hash kept for Add to Home Screen', page.url().includes('#s='));
  await page.fill('#nFrom', '09:00'); await page.fill('#nText', 'ออกตรวจที่เกิดเหตุ'); await page.click('#nSave');
  await page.waitForFunction(() => /ออกตรวจที่เกิดเหตุ/.test(document.getElementById('list').innerText), null, { timeout: 5000 });
  check('note saved via POST and shown', true);
  await page.click('#nSave'); check('empty note blocked', /Enter a start time/.test(await page.innerText('#nErr')));
  await page.goto(base); await page.waitForSelector('.row', { timeout: 5000 });
  check('key remembered on device', await page.isVisible('#main'));
  const p2 = await browser.newPage(); await p2.goto(base);
  await p2.fill('#pasteLink', 'https://evil.example/#s=abc'); await p2.click('#pasteSave');
  check('bad setup link rejected', /isn't a valid/.test(await p2.innerText('#setupErr')));
  await page.goto(base); await page.waitForSelector('.row'); await page.screenshot({ path: '/tmp/app-shot.png', fullPage: false });
  check('no page errors', errors.length === 0 || (console.log(errors), false));

  // v10: the LINE page (LIFF SDK stubbed; LINE's token check faked)
  run('collectAll()');
  run("saveLineSetup({liffId:'2001234567-AbCdEfGh', channelId:'2001234567', publicStats:true})");
  W.env.UrlFetchApp = { fetch: (url, o) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ sub: 'Utest', aud: o.payload.client_id }) }) };
  const code = run('readCases_()')[0].code;
  const lp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const lerr = []; lp.on('pageerror', e => lerr.push(e.message));
  await lp.route('https://static.line-scdn.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: 'window.liff={init:function(){return Promise.resolve()},isLoggedIn:function(){return true},getIDToken:function(){return "tok"},login:function(){}};' }));
  await lp.route('https://script.google.com/**', async (route) => {
    const req = route.request(); let text;
    if (/api=line_config/.test(req.url())) await new Promise(r => setTimeout(r, 800));   // slow config: the page must wait, not give up
    if (req.method() === 'GET') { const uu = new URL(req.url()); const p = {}; uu.searchParams.forEach((v, k) => { p[k] = v; }); W.env.__e = { parameter: p }; text = run('doGet(__e)').text; }
    else { W.env.__e = { postData: { contents: req.postData() } }; text = run('doPost(__e)').text; }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: text });
  });
  const lbase = 'http://localhost:' + srv.address().port + '/line/';
  await lp.goto(lbase); await lp.waitForTimeout(300);
  check('LINE page without ?u asks to open from LINE', /เปิดหน้านี้จากเมนูใน LINE/.test(await lp.innerText('#stats')));
  await lp.goto(lbase + '?u=AKfycbTESTdeployment0001'); await lp.waitForSelector('.num', { timeout: 5000 });
  const st = await lp.innerText('#stats');
  check('LINE งานที่ได้ทำไปแล้ว: this month + all time, totals only', /เดือนนี้/.test(st) && /ทั้งหมด/.test(st) && /ชั่วโมงปฏิบัติหน้าที่ตามเวร/.test(st) && !/Xpander|docx/.test(st));
  await lp.screenshot({ path: '/tmp/line-stats.png' });
  await lp.goto(lbase + '?u=AKfycbTESTdeployment0001&tab=cases'); await lp.waitForTimeout(100);
  check('track button usable before the config arrives', !(await lp.isDisabled('#link')));
  await lp.fill('#code', 'zzzz zzzz'); await lp.click('#link'); await lp.waitForFunction(() => document.getElementById('codeErr').textContent, null, { timeout: 5000 });
  check('LINE wrong code refused', /ไม่พบรหัส/.test(await lp.innerText('#codeErr')));
  await lp.fill('#code', code.toLowerCase()); await lp.click('#link');
  await lp.waitForSelector('#caseList h2', { timeout: 5000 });
  const ct = await lp.innerText('#caseList');
  check('LINE คดีของฉัน shows the linked case with dates, no names', /คดีจราจร/.test(ct) && /รับแจ้งความ\s+5 พ.ย. 2569/.test(ct) && !/ภายใน|วันที่ดำเนินการ|Xpander/.test(ct));
  await lp.screenshot({ path: '/tmp/line-cases.png', fullPage: true });
  check('LINE page: no errors', lerr.length === 0 || (console.log(lerr), false));
  await browser.close(); srv.close();
  console.log(ok + ' ok, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
