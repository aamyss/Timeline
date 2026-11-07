/**
 * Menu.gs — the "Work timeline" menu in the Google Sheet.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Work timeline')
    .addItem('Set up (run once)', 'menuSetup')
    .addItem('Links and PC setup code', 'menuLinks')
    .addItem('Change web app URL', 'menuSetUrl')
    .addSeparator()
    .addItem('Collect calendars now', 'menuCollect')
    .addItem('Seal yesterday now', 'menuSeal')
    .addItem('Verify log', 'menuVerify')
    .addSeparator()
    .addItem('Update Cases tab', 'menuCases')
    .addItem('LINE page setup', 'menuLine')
    .addToUi();
}

function alert_(msg) { SpreadsheetApp.getUi().alert(msg); }

function menuSetup() { alert_(setup()); }

function menuCollect() { alert_(collectAll() || 'Done.'); }

function menuSeal() { alert_(sealYesterday()); }

function menuVerify() { alert_(verifyLog()); }

function menuCases() {
  var n = syncCasesTab_();
  alert_(n ? n + ' case' + (n > 1 ? 's' : '') + ' added to the Cases tab, each with a LINE code.' : 'The Cases tab is up to date.');
}

/** LIFF ID, LINE Login channel ID and the public-totals switch. None of these is a secret. */
function menuLine() {
  if (!props_().getProperty('WEBAPP_URL') && !menuSetUrl()) return;
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px;line-height:1.45">' +
    '<p><b>1. Endpoint URL</b> for the LIFF app in the LINE Developers console:</p>' +
    '<textarea id="ep" readonly rows="2" onclick="this.select()" style="width:100%;font-size:12px;font-family:monospace"></textarea>' +
    '<p><b>2.</b> After adding the LIFF app, copy these here:</p>' +
    '<label>LIFF ID<br><input id="liff" style="width:100%;font-size:14px" placeholder="2001234567-AbCdEfGh"></label><br><br>' +
    '<label>LINE Login channel ID<br><input id="ch" style="width:100%;font-size:14px" placeholder="2001234567"></label><br><br>' +
    '<label><input type="checkbox" id="pub"> Show work totals publicly (only after your ผกก. agrees)</label>' +
    '<p><button id="save" style="font-size:14px;padding:6px 14px">Save</button> <span id="msg" style="color:#1d7a4f"></span></p>' +
    '<div id="links" style="display:none"><p><b>3. Rich menu links</b> in LINE Official Account Manager:</p>' +
    '<div style="font-size:12px;color:#555">ผลงาน</div><textarea id="l1" readonly rows="1" onclick="this.select()" style="width:100%;font-size:12px;font-family:monospace"></textarea>' +
    '<div style="font-size:12px;color:#555">คดีของฉัน</div><textarea id="l2" readonly rows="1" onclick="this.select()" style="width:100%;font-size:12px;font-family:monospace"></textarea></div>' +
    '</div><script>' +
    'function show(i){document.getElementById("ep").value=i.endpoint||"Set the web app URL first";document.getElementById("liff").value=i.liffId;' +
    'document.getElementById("ch").value=i.channelId;document.getElementById("pub").checked=i.publicStats;' +
    'if(i.liffId){document.getElementById("links").style.display="";document.getElementById("l1").value="https://liff.line.me/"+i.liffId+"?tab=stats";' +
    'document.getElementById("l2").value="https://liff.line.me/"+i.liffId+"?tab=cases";}}' +
    'google.script.run.withSuccessHandler(show).lineSetupInfo();' +
    'document.getElementById("save").onclick=function(){var m=document.getElementById("msg");m.style.color="#555";m.textContent="Saving…";' +
    'google.script.run.withSuccessHandler(function(i){show(i);m.style.color="#1d7a4f";m.textContent="Saved.";})' +
    '.withFailureHandler(function(e){m.style.color="#a32d2d";m.textContent=e.message;})' +
    '.saveLineSetup({liffId:document.getElementById("liff").value,channelId:document.getElementById("ch").value,publicStats:document.getElementById("pub").checked});};' +
    '</script>').setWidth(520).setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, 'LINE page setup');
}

/** Asks for the /exec URL from Deploy > Manage deployments (Apps Script can't reliably find it itself). */
function menuSetUrl() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Web app URL',
    'Paste the web app URL from Deploy > Manage deployments (it ends in /exec):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return false;
  var url = r.getResponseText().trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    ui.alert('That doesn\'t look like a web app URL. It should start with https://script.google.com/ and end with /exec.');
    return false;
  }
  props_().setProperty('WEBAPP_URL', url);
  return true;
}

function menuLinks() {
  var p = props_();
  if (!p.getProperty('PC_TOKEN') || !p.getProperty('VIEW_KEY')) { alert_('Run Set up first.'); return; }
  if (!p.getProperty('WEBAPP_URL') && !menuSetUrl()) return;
  var url = p.getProperty('WEBAPP_URL');
  var app = cfg_().APP_URL + '#s=' +
    Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, k: p.getProperty('VIEW_KEY') })).replace(/=+$/, '');
  var code = Utilities.base64Encode(JSON.stringify({ u: url, t: p.getProperty('PC_TOKEN') }));
  if (!p.getProperty('PHONE_TOKEN')) p.setProperty('PHONE_TOKEN', newSecret_());
  var box = function (v, rows) {
    return '<textarea readonly rows="' + rows + '" onclick="this.select()" style="width:100%;font-size:12px;font-family:monospace">' +
      v + '</textarea>';
  };
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px;line-height:1.45">' +
    '<p><b>iPhone app</b>: scan this with the iPhone Camera, open it in Safari, then Share → Add to Home Screen. ' +
    'The key stays on your phone. Don\'t share this code or link.</p>' +
    '<div id="qr" style="display:flex;justify-content:center;margin:8px 0"></div>' +
    '<details><summary style="cursor:pointer;color:#555">Show the link instead</summary>' + box(app, 3) + '</details>' +
    '<p><b>PC setup code</b>: the PC installer asks for this. Paste it there only.</p>' +
    box(code, 3) +
    '<p><b>iPhone Shortcuts</b>: the two values the Shortcuts guide asks for.</p>' +
    '<div style="font-size:12px;color:#555">Web app URL</div>' + box(url, 2) +
    '<div style="font-size:12px;color:#555">Phone key</div>' + box(p.getProperty('PHONE_TOKEN'), 2) +
    '</div>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
    '<script>new QRCode(document.getElementById("qr"), { text: ' + JSON.stringify(app) +
    ', width: 240, height: 240, correctLevel: QRCode.CorrectLevel.L });</script>'
  ).setWidth(560).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Links and PC setup code');
}
