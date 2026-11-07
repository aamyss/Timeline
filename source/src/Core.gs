/**
 * Core.gs — pure logic, no Apps Script services.
 * Everything here is also run by the offline Node tests (test/run-tests.js).
 */
var Core = (function () {
  var BKK_MS = 7 * 3600 * 1000;
  var MIN = 60000;
  var DAY = 86400000;

  // Columns of every Log tab, in order. row_hash is appended after these.
  var LOG_COLS = ['id', 'event_time', 'event_end', 'source', 'kind', 'title', 'case_no',
    'strength', 'proof_url', 'source_id', 'source_time', 'detail', 'collected_at'];

  /* ---------- time ---------- */

  /** Any date-like value -> "2026-11-05T09:30:00+07:00" (Bangkok, no DST). */
  function toBkkIso(d) {
    if (d === null || d === undefined || d === '') return '';
    var t = (d instanceof Date) ? d.getTime() : new Date(d).getTime();
    if (isNaN(t)) return '';
    return new Date(t + BKK_MS).toISOString().slice(0, 19) + '+07:00';
  }

  /** "2026-11-05" + "08:00" -> Date at that Bangkok time. */
  function bkkDateTime(dateStr, hhmm) {
    return new Date(dateStr + 'T' + (hhmm || '00:00') + ':00+07:00');
  }

  function addDays(dateStr, n) {
    return toBkkIso(new Date(bkkDateTime(dateStr).getTime() + n * DAY)).slice(0, 10);
  }

  /** Calendar start/end object -> Bangkok ISO. All-day dates become midnight. */
  function calTime(obj) {
    if (!obj) return '';
    if (obj.dateTime) return toBkkIso(obj.dateTime);
    if (obj.date) return obj.date + 'T00:00:00+07:00';
    return '';
  }

  /* ---------- case numbers ---------- */

  var THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
  function thaiToArabic(s) {
    return String(s || '').replace(/[๐-๙]/g, function (c) { return String(THAI_DIGITS.indexOf(c)); });
  }

  /** Finds a case number like 123/2569, 123-2569, ๑๒๓/๒๕๖๙. Ignores dates like 5/11/2569. */
  function extractCaseNo(text) {
    var s = thaiToArabic(text);
    var re = /(?<!\d)(?<!\d[\/\-_. ])(\d{1,5})\s?[\/\-_.]\s?(25\d{2})(?!\d)/;
    var m = s.match(re);
    return m ? (parseInt(m[1], 10) + '/' + m[2]) : '';
  }

  /**
   * Case label for a file path. If a segment matches a case-folder marker (e.g. แฟ้มคดี),
   * the next segment is the case folder: its number if it has one, otherwise its name.
   */
  function caseFromPath(path, markers) {
    var parts = String(path || '').split('/');
    for (var i = 0; i < parts.length - 1; i++) {
      if ((markers || []).indexOf(parts[i]) >= 0) {
        var folder = parts[i + 1];
        return extractCaseNo(folder) || folder;
      }
    }
    return extractCaseNo(path);
  }

  /* ---------- files ---------- */

  function isNoise(path) {
    var parts = String(path || '').split('/');
    var name = parts[parts.length - 1];
    if (/^~\$|^\.~lock|^~WRL|\.tmp$|^desktop\.ini$|^thumbs\.db$|^\.ds_store$/i.test(name)) return true;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '.ts' || parts[i] === '.tagspaces') return true;
    }
    return false;
  }

  function under(path, prefix) {
    return !prefix || path === prefix || path.indexOf(prefix + '/') === 0;
  }

  /** Device time vs Google's receipt time: within 15 minutes = strong, otherwise medium. */
  function fileStrength(localIso, serverIso) {
    if (!localIso || !serverIso) return 'strong';
    return Math.abs(new Date(localIso) - new Date(serverIso)) <= 15 * MIN ? 'strong' : 'medium';
  }

  var PC_KINDS = ['file_created', 'file_modified', 'file_renamed', 'file_deleted', 'folder_created', 'folder_deleted', 'photo_taken'];

  /**
   * One batch from the PC reporter -> log rows.
   * receiptIso: Google's time when the batch arrived (the independent timestamp).
   * opts: {markers, exclude, backfillMs}
   */
  function pcRows(batch, receiptIso, opts) {
    var receiptMs = new Date(receiptIso).getTime();
    var offsetS = batch.deviceNow ? Math.round((receiptMs - new Date(batch.deviceNow).getTime()) / 1000) : null;
    // PC clock more than 2 minutes off Google's: its times can't be rated strong.
    var clockOk = offsetS !== null && !isNaN(offsetS) && Math.abs(offsetS) <= 120;
    var rows = [];
    var unknown = (batch.events || []).filter(function (ev) { return PC_KINDS.indexOf(ev.kind) < 0; });
    if (unknown.length) throw new Error('Unknown change type "' + unknown[0].kind + '": update the Google script, then this report is sent again');
    (batch.events || []).forEach(function (ev) {
      var rel = String(ev.path || '').replace(/\\/g, '/');
      var path = String(ev.root || 'PC') + '/' + rel;
      if (isNoise(path)) return;
      if ((opts.exclude || []).some(function (x) { return under(path, x); })) return;
      var detected = /_deleted$|_renamed$/.test(ev.kind);
      var t = detected ? receiptIso : toBkkIso(ev.time);
      if (!t) return;
      if (!detected && batch.initial && new Date(t).getTime() < opts.backfillMs) return;
      var photo = ev.kind === 'photo_taken';
      if (photo && opts.seenPhotos && opts.seenPhotos[path + '|' + t]) return;   // already logged
      var hasGps = photo && isFinite(ev.lat) && isFinite(ev.lon) && ev.lat !== null && ev.lon !== null;
      // A photo's own "taken" time comes from the phone and can be edited, so it's never rated strong.
      var strength = detected || photo ? 'medium' : (clockOk ? fileStrength(t, receiptIso) : 'medium');
      var d = { path: path, size: ev.size, sha256: ev.sha256 || undefined, from: ev.from || undefined,
        device: batch.device || undefined, pc_clock_offset_s: offsetS,
        first_scan: batch.initial ? true : undefined, cloud_only: ev.cloud ? true : undefined,
        note: detected ? 'time = when Google received the report' : (photo ? 'time and place read from the photo itself' : undefined),
        lat: hasGps ? Number(ev.lat) : undefined, lon: hasGps ? Number(ev.lon) : undefined };
      rows.push({
        source: 'PC: ' + (ev.root || ''), kind: ev.kind, title: rel.split('/').pop(),
        case_no: caseFromPath(path, opts.markers),
        proof_url: hasGps ? 'https://maps.google.com/?q=' + Number(ev.lat) + ',' + Number(ev.lon) : '',
        source_id: ev.sha256 || '',
        event_time: t, event_end: '', source_time: receiptIso, strength: strength,
        detail: JSON.stringify(d)
      });
    });
    return rows;
  }

  /**
   * Folders Inquiry Copilot creates automatically inside every case (ของกลาง, __res__, …).
   * Still logged; just hidden from the day view so the case folder itself stands out.
   */
  function isClutter(kind, path, markers) {
    if (/^file_/.test(kind) && String(path || '').split('/').pop() === 'ห้ามลบ') return true;   // Inquiry Copilot marker file
    if (!/^folder_/.test(kind)) return false;
    var parts = String(path || '').split('/');
    if (parts.indexOf('__res__') >= 0 || parts.indexOf('__temp__') >= 0) return true;
    for (var i = 0; i < parts.length - 1; i++) {
      if ((markers || []).indexOf(parts[i]) >= 0) return parts.length > i + 2;
    }
    return false;
  }

  /* ---------- iPhone check-ins ---------- */

  function distanceM(lat1, lon1, lat2, lon2) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }

  /** Nearest saved place: {name, dist, inside}. places: [{name, lat, lon, radius}] */
  function nearestPlace(lat, lon, places) {
    var best = null;
    (places || []).forEach(function (p) {
      var d = distanceM(lat, lon, p.lat, p.lon);
      if (!best || d < best.dist) best = { name: p.name, dist: d, inside: d <= (p.radius || 200) };
    });
    return best;
  }

  var PHONE_KINDS = { checkin: 'location_checkin', arrive: 'place_arrived', leave: 'place_left' };

  /**
   * One iPhone check-in -> one log row. Time = when Google received it; position from the phone (medium).
   * body: {kind: 'checkin'|'arrive'|'leave', place?, lat?, lon?, deviceNow?}
   */
  function phoneRow(body, receiptIso, places) {
    var kind = PHONE_KINDS[body.kind];
    if (!kind) throw new Error('Unknown check-in type');
    var lat = Number(body.lat), lon = Number(body.lon);
    var hasGps = body.lat !== undefined && body.lat !== null && body.lat !== '' && isFinite(lat) && isFinite(lon) &&
      Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
    var near = hasGps ? nearestPlace(lat, lon, places) : null;
    var place = String(body.place || '').trim().slice(0, 80);
    var named = place ? (places || []).filter(function (p) { return p.name === place; })[0] : null;
    var title;
    if (kind === 'location_checkin') {
      title = near ? (near.inside ? near.name : near.dist >= 1000 ? (near.dist / 1000).toFixed(1) + ' km from ' + near.name : near.dist + ' m from ' + near.name)
        : 'Location unavailable';
    } else {
      title = place || (near && near.inside ? near.name : 'Unknown place');
    }
    var offsetS = body.deviceNow ? Math.round((new Date(receiptIso) - new Date(body.deviceNow)) / 1000) : undefined;
    return {
      source: 'iPhone', kind: kind, title: title, case_no: '',
      event_time: receiptIso, event_end: '', strength: 'medium',
      proof_url: hasGps ? 'https://maps.google.com/?q=' + lat.toFixed(6) + ',' + lon.toFixed(6) : '',
      source_id: '', source_time: receiptIso,
      detail: JSON.stringify({
        lat: hasGps ? Number(lat.toFixed(6)) : undefined, lon: hasGps ? Number(lon.toFixed(6)) : undefined,
        place: place || undefined,
        dist_to_place_m: named && hasGps ? distanceM(lat, lon, named.lat, named.lon) : undefined,
        nearest: near ? near.name + ' (' + near.dist + ' m)' : undefined,
        phone_clock_offset_s: isFinite(offsetS) ? offsetS : undefined,
        note: 'time = when Google received the check-in; position from the phone'
      })
    };
  }

  /** Pairs "arrived" with the next "left" at the same place: [{place, start, end|null}] (ISO strings). */
  function placeVisits(entries) {
    var open = {}, out = [];
    entries.slice().sort(function (a, b) { return a.t < b.t ? -1 : 1; }).forEach(function (e) {
      if (e.kind === 'place_arrived') {
        if (open[e.title]) out.push(open[e.title]);
        open[e.title] = { place: e.title, start: e.t, end: null };
      } else if (e.kind === 'place_left') {
        if (open[e.title]) { open[e.title].end = e.t; out.push(open[e.title]); delete open[e.title]; }
      }
    });
    Object.keys(open).forEach(function (k) { out.push(open[k]); });
    return out;
  }

  /* ---------- Google Calendar ---------- */

  /**
   * One Calendar API event -> 0 or 1 log rows. idx key "gcal:<calId>:<eventId>".
   * opts: {backfillMs, nowIso}
   */
  function diffCalendarEvent(ev, calName, calId, idx, opts) {
    var k = 'gcal:' + calId + ':' + ev.id;
    var old = idx[k] || null;
    var rows = [];
    var base = {
      source: 'Calendar: ' + calName,
      proof_url: ev.htmlLink || '',
      source_id: ev.id
    };

    if (ev.status === 'cancelled') {
      if (old && !old.x) {
        rows.push(Object.assign({}, base, {
          kind: 'calendar_cancelled', event_time: old.s, event_end: old.e, title: old.t,
          case_no: extractCaseNo(old.t), strength: 'self',
          source_time: toBkkIso(ev.updated) || opts.nowIso,
          detail: JSON.stringify({ calendar: calName })
        }));
        old.x = 1;
      }
      return rows;
    }

    var s = calTime(ev.start);
    var e = calTime(ev.end);
    var t = ev.summary || '(no title)';
    if (!s) return rows;
    var detail = JSON.stringify({
      calendar: calName,
      location: ev.location || undefined,
      entered: toBkkIso(ev.created),
      all_day: ev.start && ev.start.date ? true : undefined
    });
    var caseNo = extractCaseNo([t, ev.description || '', ev.location || ''].join(' '));

    if (!old) {
      idx[k] = { s: s, e: e, t: t };
      if (new Date(s).getTime() < opts.backfillMs) return rows;
      rows.push(Object.assign({}, base, {
        kind: 'calendar_event', event_time: s, event_end: e, title: t, case_no: caseNo,
        strength: 'self', source_time: toBkkIso(ev.created), detail: detail
      }));
      return rows;
    }
    if (old.s !== s || old.e !== e || old.t !== t || old.x) {
      var was = { s: old.s, e: old.e, t: old.t };
      idx[k] = { s: s, e: e, t: t };
      if (new Date(s).getTime() < opts.backfillMs) return rows;
      rows.push(Object.assign({}, base, {
        kind: 'calendar_changed', event_time: s, event_end: e, title: t, case_no: caseNo,
        strength: 'self', source_time: toBkkIso(ev.updated),
        detail: JSON.stringify({ calendar: calName, was: was })
      }));
    }
    return rows;
  }

  /* ---------- roster, duty, gaps ---------- */

  /** roster rows {date:'2026-11-05', start:'08:00', end:'16:00', label} -> intervals. End <= start means overnight. */
  function shiftIntervals(roster) {
    return roster.filter(function (r) { return r.date && r.start && r.end; }).map(function (r) {
      var s = bkkDateTime(r.date, r.start);
      var e = bkkDateTime(r.date, r.end);
      if (e <= s) e = new Date(e.getTime() + DAY);
      return { start: s, end: e, label: r.label || '' };
    });
  }

  /** 'on' inside a shift, 'off' outside, 'unknown' if that month's roster isn't entered. */
  function dutyAt(t, intervals, rosterMonths) {
    var ms = t.getTime();
    for (var i = 0; i < intervals.length; i++) {
      if (ms >= intervals[i].start.getTime() && ms < intervals[i].end.getTime()) return 'on';
    }
    return rosterMonths[toBkkIso(t).slice(0, 7)] ? 'off' : 'unknown';
  }

  /** Stretches of on-duty time with no record for at least gapMin minutes (only up to "now"). */
  function findGaps(items, intervals, dayStart, dayEnd, gapMin, now) {
    var gapMs = gapMin * MIN;
    var gaps = [];
    var spans = items.map(function (it) {
      var a = it.start.getTime();
      var b = it.end ? Math.max(it.end.getTime(), a) : a;
      return [a, b];
    }).sort(function (x, y) { return x[0] - y[0]; });
    intervals.forEach(function (iv) {
      var s = Math.max(iv.start.getTime(), dayStart.getTime());
      var e = Math.min(iv.end.getTime(), dayEnd.getTime(), now.getTime());
      if (e <= s) return;
      var cursor = s;
      spans.forEach(function (sp) {
        if (sp[1] < s || sp[0] > e) return;
        if (sp[0] - cursor >= gapMs) gaps.push({ start: new Date(cursor), end: new Date(sp[0]) });
        if (sp[1] > cursor) cursor = sp[1];
      });
      if (e - cursor >= gapMs) gaps.push({ start: new Date(cursor), end: new Date(e) });
    });
    return gaps;
  }

  /** Collapses repeated edits of the same file within an hour into one display entry. */
  function groupEntries(entries) {
    var out = [];
    entries.forEach(function (e) {
      var last = out[out.length - 1];
      if (last && e.kind === 'file_modified' && last.kind === 'file_modified' && last.path === e.path &&
          new Date(e.t) - new Date(last.tLast) <= 60 * MIN) {
        last.tLast = e.t;
        last.count++;
        last.ids.push(e.id);
      } else {
        out.push(Object.assign({}, e, { tLast: e.t, count: 1, ids: [e.id] }));
      }
    });
    return out;
  }

  /* ---------- 24-hour strip for the email ---------- */

  /**
   * Turns one day's data (from dayData_) into rows of half-hour cells for a graphical timeline.
   * Cell values: 0 = nothing; for files 1-3 = how busy (1, 2-3, 4+ changes).
   */
  function dayStrip(day, slotMin) {
    slotMin = slotMin || 30;
    var n = Math.round(1440 / slotMin);
    var dayStart = bkkDateTime(day.date).getTime();
    var dayEnd = dayStart + DAY;
    var slotOf = function (ms) { return Math.floor((ms - dayStart) / (slotMin * MIN)); };
    var mark = function (cells, a, b, val, add) {
      var s0 = Math.max(0, slotOf(Math.max(a, dayStart)));
      var s1 = Math.min(n - 1, slotOf(Math.min(Math.max(b, a), dayEnd) - 1));
      if (b <= a) s1 = s0;
      for (var i = s0; i <= s1 && i < n; i++) cells[i] = add ? cells[i] + val : Math.max(cells[i], val);
    };
    var blank = function () { var c = []; for (var i = 0; i < n; i++) c.push(0); return c; };
    var shift = blank(), place = blank(), files = blank(), photos = blank(), cal = blank(), notes = blank(), gaps = blank();
    placeVisits(day.entries || []).forEach(function (v) {
      var a = new Date(v.start).getTime();
      var b = v.end ? new Date(v.end).getTime() : a;
      mark(place, a, b, 2);
    });
    (day.shifts || []).forEach(function (s) { mark(shift, new Date(s.start).getTime(), new Date(s.end).getTime(), 1); });
    (day.gaps || []).forEach(function (g) { mark(gaps, new Date(g.start).getTime(), new Date(g.end).getTime(), 1); });
    (day.entries || []).forEach(function (e) {
      var a = new Date(e.t).getTime();
      if (e.kind === 'location_checkin' || e.kind === 'place_arrived' || e.kind === 'place_left') {
        mark(place, a, a, 1);
      } else if (e.kind === 'photo_taken') {
        mark(photos, a, a, 1);
      } else if (/^PC:|^OneDrive/.test(e.source || '')) {
        var last = new Date(e.tLast || e.t).getTime();
        mark(files, a, last, e.count || 1, true);
      } else if (/^calendar_/.test(e.kind)) {
        if (e.allDay || e.kind === 'calendar_cancelled') return;
        mark(cal, a, e.tEnd ? new Date(e.tEnd).getTime() : a, 1);
      } else if (e.kind === 'note') {
        mark(notes, a, e.tEnd ? new Date(e.tEnd).getTime() : a, 1);
      }
    });
    files = files.map(function (v) { return v === 0 ? 0 : v === 1 ? 1 : v <= 3 ? 2 : 3; });
    return { slots: n, slotMin: slotMin, rows: [
      { key: 'shift', label: 'Shift', cells: shift },
      { key: 'place', label: 'Location', cells: place },
      { key: 'files', label: 'Files', cells: files },
      { key: 'photos', label: 'Photos', cells: photos },
      { key: 'calendar', label: 'Calendar', cells: cal },
      { key: 'notes', label: 'Notes', cells: notes },
      { key: 'gaps', label: 'Gaps', cells: gaps }
    ] };
  }

  /* ---------- day summary (v9) ---------- */

  var POINT_MIN = 15;   // a single record (one edit, one photo) counts as this many minutes of work

  function mergeSpans(spans) {
    var out = [];
    spans.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (s) {
      var last = out[out.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else out.push([s[0], s[1]]);
    });
    return out;
  }

  /** spans minus cuts (both [startMs, endMs] lists). */
  function subtractSpans(spans, cuts) {
    var out = [];
    spans.forEach(function (s) {
      var pieces = [[s[0], s[1]]];
      cuts.forEach(function (c) {
        var next = [];
        pieces.forEach(function (p) {
          if (c[1] <= p[0] || c[0] >= p[1]) { next.push(p); return; }
          if (c[0] > p[0]) next.push([p[0], c[0]]);
          if (c[1] < p[1]) next.push([c[1], p[1]]);
        });
        pieces = next;
      });
      out = out.concat(pieces);
    });
    return out.filter(function (p) { return p[1] > p[0]; });
  }

  /** A document he worked on (not Inquiry Copilot's automatic files, not a photo). */
  function isDocPath(path) {
    var parts = String(path || '').split('/');
    if (parts.indexOf('__res__') >= 0 || parts.indexOf('__temp__') >= 0) return false;
    var name = parts[parts.length - 1];
    return !!name && name !== 'ห้ามลบ' && !/\.(jpe?g|heic|heif|png|mov|mp4)$/i.test(name);
  }

  function fmtDur(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(dateStr) { return parseInt(dateStr.slice(8, 10), 10) + ' ' + MON[parseInt(dateStr.slice(5, 7), 10) - 1]; }

  /**
   * Numbers for the summary card. d: {date, shifts, gaps, rosterKnown, entries (raw, each with duty),
   * visits, now (Date)}. Times in entries/shifts/gaps are Bangkok ISO strings.
   */
  function daySummary(d) {
    var dayStart = bkkDateTime(d.date).getTime();
    var dayEnd = dayStart + DAY;
    var nowMs = Math.min((d.now || new Date()).getTime(), dayEnd);
    var ms = function (iso) { return new Date(iso).getTime(); };

    // On duty: shift time so far minus gaps.
    var shiftMin = 0, elapsedMin = 0, gapMin = 0;
    var shiftSpans = (d.shifts || []).map(function (s) {
      var a = Math.max(ms(s.start), dayStart), b = Math.min(ms(s.end), dayEnd);
      shiftMin += Math.max(0, b - a) / MIN;
      elapsedMin += Math.max(0, Math.min(b, nowMs) - a) / MIN;
      return [a, b];
    });
    (d.gaps || []).forEach(function (g) { gapMin += (ms(g.end) - ms(g.start)) / MIN; });

    // Work outside shifts: each record covers POINT_MIN minutes; ranged notes and place visits their span.
    var spans = [];
    (d.entries || []).forEach(function (e) {
      if (/^calendar_|^location_checkin$|^place_/.test(e.kind)) return;   // plans; visits are added below
      var a = ms(e.t);
      var b = e.kind === 'note' && e.tEnd ? ms(e.tEnd) : a + POINT_MIN * MIN;
      spans.push([a, Math.max(b, a + POINT_MIN * MIN)]);
    });
    (d.visits || []).forEach(function (v) { if (v.end) spans.push([ms(v.start), ms(v.end)]); });
    var outside = subtractSpans(mergeSpans(spans).map(function (s) {
      return [Math.max(s[0], dayStart), Math.min(s[1], dayEnd, Math.max(nowMs, s[0]))];
    }), shiftSpans);
    var outsideMin = 0;
    outside.forEach(function (s) { outsideMin += (s[1] - s[0]) / MIN; });
    var sessions = mergeSpans(outside.map(function (s) { return [s[0], s[1] + MIN]; })).length;   // touching pieces are one session

    // Cases, files, photos, calendar.
    var cases = {}, created = {}, edited = {}, deleted = {}, renamed = 0, taken = 0, gps = 0, added = 0, cal = [];
    (d.entries || []).forEach(function (e) {
      if (e.caseNo && !/^calendar_/.test(e.kind)) cases[e.caseNo] = true;
      var doc = isDocPath(e.path);
      if (e.kind === 'file_created') { if (e.isPhoto) added++; else if (doc) created[e.path] = true; }
      else if (e.kind === 'file_modified' && doc) edited[e.path] = true;
      else if (e.kind === 'file_deleted' && doc) deleted[e.path] = true;
      else if (e.kind === 'file_renamed' && doc) renamed++;
      else if (e.kind === 'photo_taken') { taken++; if (/maps\.google\.com/.test(e.proof || '')) gps++; }
      else if ((e.kind === 'calendar_event' || e.kind === 'calendar_changed') && !e.plan) cal.push(e.title);
    });
    Object.keys(created).forEach(function (p) { delete edited[p]; });   // a new file's later edits aren't counted twice

    return {
      shiftMin: Math.round(shiftMin), elapsedMin: Math.round(elapsedMin), gapCount: (d.gaps || []).length, gapMin: Math.round(gapMin),
      coveredMin: Math.round(Math.max(0, elapsedMin - gapMin)), shiftDone: nowMs >= Math.max.apply(null, shiftSpans.map(function (s) { return s[1]; }).concat([0])),
      outsideMin: Math.round(outsideMin), outsideSessions: sessions,
      cases: Object.keys(cases), created: Object.keys(created).length, edited: Object.keys(edited).length,
      deleted: Object.keys(deleted).length, renamed: renamed, photosTaken: taken, photosGps: gps, photosAdded: added,
      visits: (d.visits || []).map(function (v) { return { place: v.place, start: v.start, end: v.end }; }),
      calendar: cal
    };
  }

  /** Card lines, shared by the iPhone app and the nightly email: [{key, label, text, warn}]. */
  function summaryLines(s, ctx) {
    var L = [];
    var shiftTxt = ctx.shifts.length
      ? ctx.shifts.map(function (x) { return x.start.slice(11, 16) + '–' + x.end.slice(11, 16).replace('00:00', '24:00') + (x.label ? ' ' + x.label : ''); }).join(', ')
      : (ctx.rosterKnown ? 'Off duty' : 'No roster entered');
    L.push({ key: 'shift', label: 'Shift', text: shiftTxt });
    if (s.shiftMin) {
      var cov = fmtDur(s.coveredMin) + ' of ' + fmtDur(s.shiftDone ? s.shiftMin : s.elapsedMin) +
        (s.shiftDone ? '' : ' so far (shift ' + fmtDur(s.shiftMin) + ')');
      cov += s.gapCount ? ' · ' + s.gapCount + ' gap' + (s.gapCount > 1 ? 's' : '') + ' (' + fmtDur(s.gapMin) + ')' : ' · no gaps';
      L.push({ key: 'onduty', label: 'On duty', text: cov, warn: s.gapCount > 0 });
    }
    if (s.outsideMin) L.push({ key: 'outside', label: ctx.rosterKnown ? 'Off duty work' : 'Work (no roster)',
      text: 'about ' + fmtDur(s.outsideMin) + ' in ' + s.outsideSessions + ' session' + (s.outsideSessions > 1 ? 's' : '') });
    if (s.cases.length) L.push({ key: 'cases', label: 'Cases', text: s.cases.length + ' — ' + s.cases.slice(0, 4).join(' · ') + (s.cases.length > 4 ? ' · +' + (s.cases.length - 4) : '') });
    var f = [];
    if (s.created) f.push(s.created + ' created');
    if (s.edited) f.push(s.edited + ' edited');
    if (s.renamed) f.push(s.renamed + ' renamed');
    if (s.deleted) f.push(s.deleted + ' deleted');
    if (f.length) L.push({ key: 'files', label: 'Documents', text: f.join(' · ') });
    var p = [];
    if (s.photosTaken) p.push(s.photosTaken + ' taken (' + s.photosGps + ' with location)');
    if (s.photosAdded) p.push(s.photosAdded + ' added');
    if (p.length) L.push({ key: 'photos', label: 'Photos', text: p.join(' · ') });
    if (s.visits.length) L.push({ key: 'places', label: 'Places', text: s.visits.map(function (v) {
      return v.place + ' ' + v.start.slice(11, 16) + '–' + (v.end ? (v.end.slice(0, 10) === v.start.slice(0, 10) ? v.end.slice(11, 16) : 'next day') : '?');
    }).join(' · ') });
    if (s.calendar.length) L.push({ key: 'calendar', label: 'Calendar', text: s.calendar.length + ' — ' + s.calendar.slice(0, 3).join(' · ') + (s.calendar.length > 3 ? ' · +' + (s.calendar.length - 3) : '') });
    var n = ctx.notices;
    if (n && (n.overdue || n.soon)) {
      L.push({ key: 'notices', label: 'Progress notices', warn: !!n.overdue,
        text: [n.overdue ? n.overdue + ' overdue' : '', n.soon ? n.soon + ' due within 7 days' : ''].filter(String).join(' · ') });
    }
    return L;
  }

  /* ---------- cases and progress notices (แจ้งความคืบหน้า) ---------- */

  /** Inquiry Copilot case folder "2026-11-05_0939-จราจร_ชื่อ" -> {start, type}; anything else -> null. */
  function caseFolderInfo(folder) {
    var m = String(folder || '').match(/^(\d{4}-\d{2}-\d{2})_(\d{4})-([^_]*)/);
    return m ? { start: m[1], type: m[3] } : null;
  }

  function addMonths(dateStr, n) {
    var y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7) - 1 + n, d = +dateStr.slice(8, 10);
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
  }

  function daysBetween(a, b) { return Math.round((bkkDateTime(b) - bkkDateTime(a)) / DAY); }

  /** Path of a row -> the case folder it sits in (the segment after a marker), or ''. */
  function caseFolderOf(path, markers) {
    var parts = String(path || '').split('/');
    for (var i = 0; i < parts.length - 1; i++) {
      if ((markers || []).indexOf(parts[i]) >= 0) return parts[i + 1];
    }
    return '';
  }

  /**
   * Every Inquiry Copilot case seen in the log: {folder: {folder, start, type, deleted, workDates{}, last, notices[]}}.
   * rows: log rows (objects). noticeWords: file-name words that mark a progress-notice letter.
   * caseNoToFolder: {'12/2569': folder} from the Cases tab, so notes and calendar items typed with the number count.
   */
  function collectCases(rows, markers, noticeWords, caseNoToFolder) {
    var cases = {};
    var get = function (folder) {
      var info = caseFolderInfo(folder);
      if (!info) return null;
      if (!cases[folder]) cases[folder] = { folder: folder, start: info.start, type: info.type, deleted: false, workDates: {}, last: '', notices: [], seen: {} };
      return cases[folder];
    };
    rows.slice().sort(function (a, b) { return a.event_time < b.event_time ? -1 : a.event_time > b.event_time ? 1 : 0; }).forEach(function (r) {
      var d = {};
      try { d = JSON.parse(r.detail || '{}'); } catch (e) { /* plain */ }
      var folder = d.path ? caseFolderOf(d.path, markers) : '';
      if (!folder && r.case_no && caseNoToFolder && caseNoToFolder[r.case_no]) folder = caseNoToFolder[r.case_no];
      var c = folder && get(folder);
      if (!c) return;
      var date = r.event_time.slice(0, 10);
      if (d.path && /^folder_/.test(r.kind) && d.path.split('/').pop() === folder) {
        c.deleted = r.kind === 'folder_deleted';
        if (c.deleted) return;
      }
      if (/^calendar_/.test(r.kind)) return;   // plans, not work
      c.workDates[date] = true;
      if (r.event_time > c.last) c.last = r.event_time;
      var name = d.path ? d.path.split('/').pop() : '';
      if (name && /^file_(created|modified)$/.test(r.kind) && !c.seen[d.path] &&
          (noticeWords || []).some(function (w) { return w && name.indexOf(w) >= 0; })) {
        c.seen[d.path] = true;
        c.notices.push(date);
      }
    });
    Object.keys(cases).forEach(function (k) { cases[k].notices.sort(); delete cases[k].seen; });
    return cases;
  }

  /**
   * Progress-notice status of one case on asOf (YYYY-MM-DD).
   * คำสั่ง ตร.ที่ 419/2556 บทที่ 2 ข้อ 1.2: in writing for every case. 1st at 30 days from the complaint;
   * 2nd about 2 months after the 1st; 3rd when the file goes to the prosecutor or there is a result
   * (closed = that date, from the Cases tab); extra ones on a warrant or arrest (not tracked).
   */
  function noticeStatus(start, notices, asOf, closed) {
    var done = (notices || []).filter(function (x) { return x <= asOf; });
    var next = null;
    if (closed && closed <= asOf) {
      if (!done.some(function (x) { return x >= closed; })) next = { n: done.length + 1, due: closed, final: true };
    } else if (!done.length) {
      next = { n: 1, due: addDays(start, 30) };
    } else if (done.length === 1) {
      next = { n: 2, due: addMonths(done[0], 2) };
    } else {
      next = { n: done.length + 1, due: '', final: true };   // when the file goes to the prosecutor
    }
    var left = next && next.due ? daysBetween(asOf, next.due) : null;
    return { start: start, done: done, next: next, daysLeft: left, overdue: left !== null && left < 0 };
  }

  /* ---------- hash chain ---------- */

  /** The exact text that is hashed for a row: previous hash + every column, unit-separated. */
  function canonical(row, prevHash) {
    return prevHash + '\n' + LOG_COLS.map(function (c) {
      return row[c] === null || row[c] === undefined ? '' : String(row[c]);
    }).join('\u001f');
  }

  function csvLine(values) {
    return values.map(function (v) {
      var s = String(v === null || v === undefined ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }

  return {
    LOG_COLS: LOG_COLS, toBkkIso: toBkkIso, bkkDateTime: bkkDateTime, addDays: addDays, calTime: calTime,
    thaiToArabic: thaiToArabic, extractCaseNo: extractCaseNo, caseFromPath: caseFromPath,
    isNoise: isNoise, isClutter: isClutter, under: under, distanceM: distanceM, nearestPlace: nearestPlace,
    phoneRow: phoneRow, placeVisits: placeVisits, fileStrength: fileStrength, pcRows: pcRows,
    diffCalendarEvent: diffCalendarEvent, shiftIntervals: shiftIntervals, dutyAt: dutyAt,
    findGaps: findGaps, groupEntries: groupEntries, dayStrip: dayStrip, canonical: canonical, csvLine: csvLine,
    mergeSpans: mergeSpans, subtractSpans: subtractSpans, isDocPath: isDocPath, fmtDur: fmtDur, fmtDay: fmtDay,
    daySummary: daySummary, summaryLines: summaryLines, caseFolderInfo: caseFolderInfo, caseFolderOf: caseFolderOf,
    addMonths: addMonths, daysBetween: daysBetween, collectCases: collectCases, noticeStatus: noticeStatus
  };
})();

if (typeof module !== 'undefined') module.exports = Core;
