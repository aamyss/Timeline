const vm = require('vm');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { makeEnv } = require('./fakes');
const W = makeEnv(); const run = e => vm.runInContext(e, W.env);
run('setup()');
W.ss.getSheetByName('Roster').appendRow(['2026-11-05', '08:00', '16:00', 'เวรรับแจ้งความ']);
const ev = (kind, path, t) => ({ kind, root: path.startsWith('IC') ? 'Inquiry Copilot' : '#Police', path: path.replace(/^IC\//, ''), time: t });
W.env.__req = { postData: { contents: JSON.stringify({ token: W.props.PC_TOKEN, device: 'PC', deviceNow: '2026-11-05T09:00:00Z', events: [
  ev('folder_created', 'IC/p/แฟ้มคดี/2026-11-05_0939-จราจร_นายตัวอย่าง_Xpander', '2026-11-05T02:39:00Z'),
  ev('file_created', 'IC/p/แฟ้มคดี/2026-11-05_0939-จราจร_นายตัวอย่าง_Xpander/__res__/session.json', '2026-11-05T02:40:00Z'),
  ev('file_modified', 'IC/p/แฟ้มคดี/2026-11-05_0939-จราจร_นายตัวอย่าง_Xpander/__res__/session.json', '2026-11-05T02:55:00Z'),
  ev('file_modified', 'IC/p/แฟ้มคดี/2026-11-05_0939-จราจร_นายตัวอย่าง_Xpander/__res__/session.json', '2026-11-05T03:20:00Z'),
  ev('file_created', 'แฟ้มคดี/12-2569 ลักทรัพย์/คำให้การผู้เสียหาย.docx', '2026-11-05T04:10:00Z'),
  ev('folder_created', 'IC/p/แฟ้มคดี/2026-11-05_1510-ลักสายไฟ_โรงงาน_บริษัทตัวอย่าง', '2026-11-05T08:10:00Z'),
  ev('file_modified', 'IC/p/แฟ้มคดี/2026-11-05_1510-ลักสายไฟ_โรงงาน_บริษัทตัวอย่าง/__res__/session.json', '2026-11-05T08:31:00Z'),
  ev('file_modified', 'แฟ้มคดี/12-2569 ลักทรัพย์/คำให้การผู้เสียหาย.docx', '2026-11-05T14:40:00Z'),
] }) } };
run('doPost(__req)');
W.cal.Work.push({ id: 'c1', summary: 'สอบปากคำผู้เสียหาย 12/2569', created: '2026-11-04T01:00:00Z', start: { dateTime: '2026-11-05T13:00:00+07:00' }, end: { dateTime: '2026-11-05T14:00:00+07:00' } });
run('collectAll()');
run("addNote({k:'" + W.props.VIEW_KEY + "', date:'2026-11-05', from:'11:00', to:'12:30', text:'ออกตรวจที่เกิดเหตุ ลักสายไฟ'})");
const html = run("dayReportHtml_(dayData_('2026-11-05'), {rows: 12, first: 'WT0000001', last: 'WT0000012', hash: 'a3f9c2d17b0e4f6a8c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b'})");
require('fs').writeFileSync('/tmp/email.html', '<html><body style="margin:12px;background:#fff">' + html + '</body></html>');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const p = await b.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  await p.goto('file:///tmp/email.html'); await p.screenshot({ path: '/tmp/email-phone.png', fullPage: true });
  await b.close();
})();
