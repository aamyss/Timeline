/**
 * Report.gs — the graphical day timeline inside the nightly seal email.
 * Plain HTML tables with inline styles, so it renders in Gmail (phone and web) without images.
 */
var REPORT_COLORS = {
  shift: ['#ffffff', '#cfe3f7'],
  place: ['#ffffff', '#9fe1cb', '#5dcaa5'],
  files: ['#ffffff', '#cdebd9', '#7cc49a', '#1d7a4f'],
  photos: ['#ffffff', '#f3b9a3'],
  calendar: ['#ffffff', '#ddd8f7'],
  notes: ['#ffffff', '#e4e3de'],
  gaps: ['#ffffff', '#f6c56b']
};
var REPORT_KIND = {
  file_created: 'Created', file_modified: 'Edited', file_renamed: 'Renamed', file_deleted: 'Deleted',
  photo_taken: 'Photo taken', location_checkin: 'Location', place_arrived: 'Arrived', place_left: 'Left',
  folder_created: 'New folder', folder_deleted: 'Folder deleted', calendar_event: 'Calendar',
  calendar_changed: 'Calendar changed', calendar_cancelled: 'Calendar cancelled', note: 'Note'
};

function esc_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/** HTML for one day. seal: {rows, first, last, hash} for the footer. */
function dayReportHtml_(day, seal) {
  var strip = Core.dayStrip(day, 30);
  var n = strip.slots;
  var cellW = (100 / n).toFixed(3) + '%';
  var font = 'font-family:-apple-system,Segoe UI,Roboto,Noto Sans Thai,Tahoma,sans-serif;';
  var h = [];
  var d = new Date(day.date + 'T12:00:00+07:00');
  var title = Utilities.formatDate(d, TZ, 'EEEE d MMMM yyyy');

  h.push('<div style="' + font + 'color:#1f1f1f;max-width:680px">');
  h.push('<div style="font-size:18px;font-weight:bold;margin:0 0 4px">Work timeline · ' + esc_(title) + '</div>');
  var shiftTxt = day.shifts.length
    ? day.shifts.map(function (s) { return s.start.slice(11, 16) + '–' + s.end.slice(11, 16) + (s.label ? ' ' + s.label : ''); }).join(', ')
    : (day.rosterKnown ? 'Off duty' : 'No roster entered');
  h.push('<div style="font-size:13px;color:#555;margin:0 0 12px">Shift: ' + esc_(shiftTxt) +
    ' · ' + day.counts.strong + ' strong · ' + day.counts.medium + ' medium · ' + day.counts.self + ' self-reported' +
    (day.gaps.length ? ' · <span style="color:#8a5300">' + day.gaps.length + ' gap' + (day.gaps.length > 1 ? 's' : '') + '</span>' : '') + '</div>');

  // Hour scale + strips.
  h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed">');
  h.push('<tr><td style="width:64px"></td>');
  for (var hr = 0; hr < 24; hr += 3) {
    h.push('<td colspan="' + (n / 8) + '" style="font-size:10px;color:#888;padding:0 0 2px;border-left:1px solid #ddd">&nbsp;' +
      (hr < 10 ? '0' : '') + hr + '</td>');
  }
  h.push('</tr>');
  strip.rows.forEach(function (row) {
    var pal = REPORT_COLORS[row.key];
    h.push('<tr><td style="font-size:11px;color:#555;padding:2px 6px 2px 0;white-space:nowrap">' + row.label + '</td>');
    row.cells.forEach(function (v, i) {
      var border = i % 6 === 0 ? 'border-left:1px solid #ddd;' : '';
      h.push('<td style="width:' + cellW + ';height:16px;background:' + pal[Math.min(v, pal.length - 1)] + ';' + border +
        'border-bottom:2px solid #fff;font-size:1px;line-height:1px">&nbsp;</td>');
    });
    h.push('</tr>');
  });
  h.push('</table>');
  h.push('<div style="font-size:11px;color:#888;margin:4px 0 14px">Each block is 30 minutes. Files: darker = more changes. ' +
    'Shift and all-day events are plans and don\'t fill gaps.</div>');

  // Entry list.
  var list = [];
  day.entries.forEach(function (e) { list.push({ t: e.t, e: e }); });
  day.gaps.forEach(function (g) { list.push({ t: g.start, g: g }); });
  list.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
  var MAX = 60;
  h.push('<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px">');
  list.slice(0, MAX).forEach(function (it) {
    if (it.g) {
      h.push('<tr><td style="padding:5px 8px 5px 0;color:#8a5300;white-space:nowrap;vertical-align:top;background:#fdf0d8">' +
        it.g.start.slice(11, 16) + '</td><td style="padding:5px 0;color:#8a5300;background:#fdf0d8">No record until ' + it.g.end.slice(11, 16) + '</td></tr>');
      return;
    }
    var e = it.e;
    var time = e.t.slice(11, 16) + (e.count > 1 ? '–' + e.tLast.slice(11, 16) : (e.tEnd && e.tEnd.slice(0, 10) === e.t.slice(0, 10) && e.tEnd !== e.t ? '–' + e.tEnd.slice(11, 16) : ''));
    var badge = { strong: ['#e3f3ea', '#1d7a4f', 'Strong'], medium: ['#e6f0fb', '#1d5fa5', 'Medium'], self: ['#eeeeec', '#555', 'Self'] }[e.strength] || ['#eee', '#555', e.strength];
    h.push('<tr><td style="padding:5px 8px 5px 0;color:#666;white-space:nowrap;vertical-align:top;border-top:1px solid #eee">' + esc_(time) + '</td>' +
      '<td style="padding:5px 0;border-top:1px solid #eee"><b>' + esc_((e.kind === 'file_created' && e.isPhoto ? 'Photo added' : (REPORT_KIND[e.kind] || e.kind)) + (e.count > 1 ? ' ×' + e.count : '')) + '</b> ' + esc_(e.title) +
      (e.taken ? ' <span style="font-size:11px;color:#777">(taken ' + esc_(e.taken.slice(0, 16).replace('T', ' ')) + ')</span>' : '') +
      '<br><span style="font-size:11px;color:#777">' + (e.caseNo && e.caseNo !== e.title ? esc_(e.caseNo) + ' · ' : '') + esc_(e.source) + ' · </span>' +
      '<span style="font-size:11px;background:' + badge[0] + ';color:' + badge[1] + ';padding:0 5px;border-radius:4px">' + badge[2] + '</span>' +
      (e.duty === 'off' ? ' <span style="font-size:11px;background:#eeecfd;color:#5a47b5;padding:0 5px;border-radius:4px">Off duty</span>' : '') +
      '</td></tr>');
  });
  h.push('</table>');
  if (list.length > MAX) h.push('<div style="font-size:12px;color:#888;margin-top:6px">+ ' + (list.length - MAX) + ' more in the app.</div>');
  if (!list.length) h.push('<div style="font-size:13px;color:#888">Nothing recorded on this day.</div>');

  var app = cfg_().APP_URL;
  h.push('<div style="margin:16px 0 0;font-size:13px"><a href="' + esc_(app) + '" style="color:#1d5fa5">Open the Timeline app</a></div>');
  h.push('<div style="margin:16px 0 0;padding:10px;background:#f6f6f4;border-radius:8px;font-size:11px;color:#666">' +
    '<b>Seal</b> · rows collected this day: ' + seal.rows + (seal.rows ? ' (' + esc_(seal.first) + ' to ' + esc_(seal.last) + ')' : '') +
    '<br>Chain hash: <span style="font-family:monospace;word-break:break-all">' + esc_(seal.hash) + '</span>' +
    '<br>The attached CSV is an exact copy of the rows collected. Keep this email.</div>');
  h.push('</div>');
  return h.join('');
}
