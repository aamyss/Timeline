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
    .addToUi();
}

function alert_(msg) { SpreadsheetApp.getUi().alert(msg); }

function menuSetup() { alert_(setup()); }

function menuCollect() { alert_(collectAll() || 'Done.'); }

function menuSeal() { alert_(sealYesterday()); }

function menuVerify() { alert_(verifyLog()); }

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
