/**
 * Line.gs — the LINE page (LIFF) for the work OA, and the Cases tab codes it uses.
 *
 * Public, no key:    GET ?api=line_config   LIFF ID, whether totals are public
 *                    GET ?api=stats         work totals only (off until PUBLIC_STATS = on)
 * Signed in to LINE: POST {action: line_cases | line_link | line_unlink, idToken, code?}
 *   The LINE ID token is checked with LINE's server; only a hash of the LINE user ID is stored.
 *   A complainant sees, for the cases they linked with a code: case number and type, complaint date,
 *   progress notices sent, the closed date and the status he typed in the Cases tab. Never file names, names of people,
 *   times of day, the list of work dates or the next due date (he gives those on request: menu Case report).
 */
var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O, 1/I/L
var LINK_HEADERS = ['user', 'case_folder', 'linked_at', 'code'];   // a link lasts only while the case keeps that code

function newCaseCode_() {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid(), Utilities.Charset.UTF_8);
  var s = '';
  for (var i = 0; i < 8; i++) s += CODE_CHARS.charAt((b[i] & 0xff) % CODE_CHARS.length);
  return s.slice(0, 4) + '-' + s.slice(4);
}

function normCode_(s) {
  var c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : '';
}

function lineCfg_() {
  var p = props_();
  return { liffId: p.getProperty('LINE_LIFF_ID') || '', channelId: p.getProperty('LINE_CHANNEL_ID') || '',
    publicStats: cfg_().PUBLIC_STATS === 'on' };
}

/* ---------- public ---------- */

function lineGet_(api) {
  var lc = lineCfg_();
  if (api === 'line_config') return { ok: true, liffId: lc.liffId, publicStats: lc.publicStats, casesOn: !!lc.channelId };
  if (api === 'stats') {
    if (!lc.publicStats) return { ok: true, off: true };
    var cache = CacheService.getScriptCache();
    var hit = cache.get('PUBLIC_STATS_V4');
    if (hit) return JSON.parse(hit);
    var out = publicStats_();
    cache.put('PUBLIC_STATS_V4', JSON.stringify(out), 3 * 3600);
    return out;
  }
  return { ok: false, error: 'Unknown request' };
}

/**
 * Totals for every month that has a roster (newest first) and for all of them together.
 * Hours come from the day summaries. Cases = Inquiry Copilot cases worked on in the period; documents = documents
 * that first appeared in those case folders in the period (Core.caseDocuments). Counts only, never names.
 */
function publicStats_(ctx) {
  ctx = ctx || dayCtx_();
  var today = Core.toBkkIso(new Date()).slice(0, 10);
  var months = Object.keys(ctx.months).filter(function (m) { return m <= today.slice(0, 7); }).sort();
  var blank = function () { return { onMin: 0, outMin: 0, cases: {}, docs: 0 }; };
  var per = {}, all = blank();
  months.forEach(function (m) {
    per[m] = blank();
    for (var d = m + '-01'; d.slice(0, 7) === m && d <= today; d = Core.addDays(d, 1)) {
      var s = dayData_(d, ctx, true).summary;
      [per[m], all].forEach(function (b) { b.onMin += s.elapsedMin; b.outMin += s.outsideMin; });
    }
  });
  Object.keys(ctx.cases).forEach(function (f) {
    if (ctx.cases[f].deleted) return;
    Object.keys(ctx.cases[f].workDates).forEach(function (d) {
      if (per[d.slice(0, 7)]) { per[d.slice(0, 7)].cases[f] = true; all.cases[f] = true; }
    });
  });
  var docs = Core.caseDocuments(ctx.allRows, ctx.c.markers, ctx.cases);
  Object.keys(docs).forEach(function (k) {
    var f = k.split('/')[0];
    if (ctx.cases[f] && ctx.cases[f].deleted) return;
    var m = docs[k].slice(0, 7);
    if (per[m] && docs[k].slice(0, 10) <= today) { per[m].docs++; all.docs++; }
  });
  var fmt = function (b, label) {
    return { label: label, onDutyHours: Math.round(b.onMin / 6) / 10, outsideHours: Math.round(b.outMin / 6) / 10,
      cases: Object.keys(b.cases).length, documents: b.docs };
  };
  return { ok: true, asOf: Core.toBkkIso(new Date()).slice(0, 16), current: today.slice(0, 7),
    months: months.slice().reverse().map(function (m) { return fmt(per[m], m); }),
    all: fmt(all, months[0] || today.slice(0, 7)) };
}

/* ---------- signed in with LINE ---------- */

/** LINE ID token -> hash of the LINE user ID (the raw ID is never stored). */
function lineUser_(idToken) {
  var lc = lineCfg_();
  if (!lc.channelId) throw new Error('ยังไม่ได้ตั้งค่า LINE');
  idToken = String(idToken || '');
  if (!idToken || idToken.length > 5000) throw new Error('กรุณาเปิดหน้านี้จากใน LINE');
  var cache = CacheService.getScriptCache();
  var ck = 'LID' + sha256Hex_(idToken).slice(0, 40);
  var hit = cache.get(ck);
  if (hit) return hit;
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', payload: { id_token: idToken, client_id: lc.channelId }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('การเข้าสู่ระบบ LINE หมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่');
  var j = JSON.parse(res.getContentText());
  if (!j.sub || String(j.aud) !== String(lc.channelId)) throw new Error('การเข้าสู่ระบบ LINE ไม่ถูกต้อง');
  var who = sha256Hex_('line-user:' + j.sub);
  cache.put(ck, who, 600);
  return who;
}

function linksTab_() {
  return ensureTab_(ss_(), 'Links', LINK_HEADERS, 'LINE users who follow a case. user = a one-way hash of their LINE ID, not the ID itself.');
}

/** A case folder was renamed: its followers follow the new name (their code is unchanged). */
function renameLinks_(from, to) {
  var sh = linksTab_();
  if (sh.getLastRow() < 2) return;
  var col = sh.getRange(2, 2, sh.getLastRow() - 1, 1);
  var v = col.getValues();
  if (!v.some(function (r) { return String(r[0]) === from; })) return;
  col.setNumberFormat('@').setValues(v.map(function (r) { return [String(r[0]) === from ? cellSafe_(to) : r[0]]; }));
}

/** Cases this LINE user follows. Clearing a case's line_code (a new one is made hourly) drops its old followers. */
function linkedFolders_(who, ctx) {
  var sh = linksTab_();
  if (sh.getLastRow() < 2) return [];
  var out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    var f = String(r[1]), info = ctx.caseInfo[f];
    if (String(r[0]) === who && info && info.code && String(r[3]) === info.code && out.indexOf(f) < 0) out.push(f);
  });
  return out;
}

/** What a complainant may see about one case: no work dates, no next due date (he gives those on request), and the
 *  status he typed in the Cases tab instead of the last day worked. */
function publicCase_(ctx, folder) {
  var k = ctx.cases[folder] || { start: '', type: '', notices: [] };
  var info = ctx.caseInfo[folder] || {};
  return {
    code: info.code || '',
    caseNo: info.caseNo || '',
    type: k.type || (Core.caseFolderInfo(folder) || {}).type || '',
    reported: k.start,
    status: info.status || '',
    statusAt: info.status ? String(info.statusAt || '').slice(0, 10) : '',          // when the progress happened
    confirmedAt: info.status ? String(info.confirmedAt || '').slice(0, 10) : '',    // when he confirmed it (dates only)
    notices: (k.notices || []).slice(),
    closed: info.closed || ''
  };
}

function linePost_(body) {
  var who = lineUser_(body.idToken);
  var ctx = dayCtx_();
  var sh = linksTab_();
  if (body.action === 'line_link') {
    var cache = CacheService.getScriptCache();
    var fk = 'LFAIL' + who.slice(0, 32);
    var fails = parseInt(cache.get(fk) || '0', 10);
    if (fails >= 5) throw new Error('ใส่รหัสผิดหลายครั้ง กรุณาลองใหม่ในอีก 1 ชั่วโมง');
    var code = normCode_(body.code);
    var hit = code && ctx.caseList.filter(function (c) { return c.code === code; })[0];
    if (!hit) {
      cache.put(fk, String(fails + 1), 3600);
      throw new Error('ไม่พบรหัสนี้ กรุณาตรวจสอบรหัสจากพนักงานสอบสวน');
    }
    var mine = linkedFolders_(who, ctx);
    if (mine.length >= 20) throw new Error('ติดตามได้สูงสุด 20 คดี');
    if (mine.indexOf(hit.folder) < 0) sh.appendRow([who, cellSafe_(hit.folder), Core.toBkkIso(new Date()), hit.code]);
  } else if (body.action === 'line_unlink') {
    var drop = normCode_(body.code);
    var target = drop && ctx.caseList.filter(function (c) { return c.code === drop; })[0];
    if (target && sh.getLastRow() > 1) {
      var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      for (var i = vals.length - 1; i >= 0; i--) {
        if (String(vals[i][0]) === who && String(vals[i][1]) === target.folder) sh.deleteRow(i + 2);
      }
    }
  } else if (body.action !== 'line_cases') {
    throw new Error('Unknown request');
  }
  return { ok: true, cases: linkedFolders_(who, ctx).map(function (f) { return publicCase_(ctx, f); }) };
}

/* ---------- sheet menu: LINE setup ---------- */

function lineSetupInfo() {
  var p = props_();
  var url = p.getProperty('WEBAPP_URL') || '';
  var m = url.match(/\/macros\/s\/([A-Za-z0-9_-]+)\/exec/);
  var lc = lineCfg_();
  return { endpoint: m ? cfg_().APP_URL + 'line/?u=' + m[1] : '', liffId: lc.liffId, channelId: lc.channelId, publicStats: lc.publicStats };
}

function saveLineSetup(o) {
  o = o || {};
  var liff = String(o.liffId || '').trim(), ch = String(o.channelId || '').trim();
  if (liff && !/^\d{6,12}-[A-Za-z0-9]{6,12}$/.test(liff)) throw new Error('LIFF ID looks wrong. It looks like 2001234567-AbCdEfGh.');
  if (ch && !/^\d{6,12}$/.test(ch)) throw new Error('Channel ID is the number at the top of the LINE Login channel\'s Basic settings.');
  var p = props_();
  p.setProperty('LINE_LIFF_ID', liff);
  p.setProperty('LINE_CHANNEL_ID', ch);
  p.setProperty('PUBLIC_STATS', o.publicStats ? 'on' : 'off');
  CacheService.getScriptCache().remove('PUBLIC_STATS_V4');
  return lineSetupInfo();
}
