/* In-memory fakes of the Apps Script services, shared by the tests and the PC end-to-end check. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const SRC = path.join(__dirname, '..', 'src');

function makeEnv() {
  const sent = [];
  const props = {};
  const cache = {};
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.data[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]);
        out.push(o);
      }
      return out;
    }
    setValues(v) {
      assert.strictEqual(v.length, this.nr, 'setValues row count');
      v.forEach((row, i) => {
        assert.strictEqual(row.length, this.nc, 'setValues col count');
        const target = this.sh.data[this.r - 1 + i] = this.sh.data[this.r - 1 + i] || [];
        row.forEach((x, j) => {
          if (typeof x === 'string' && /^[=+]/.test(x)) throw new Error('would become a formula: ' + x);
          target[this.c - 1 + j] = typeof x === 'string' && x[0] === "'" ? x.slice(1) : x;
        });
      });
      return this;
    }
    setValue(x) { return this.setValues([[x]]); }
    clearContent() { for (let i = 0; i < this.nr; i++) { const row = this.sh.data[this.r - 1 + i]; if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = ''; } return this; }
    setNumberFormat() { return this; } setFontWeight() { return this; } setNote() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; }
    getName() { return this.name; }
    getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(x => x !== '' && x !== undefined)) return i + 1; return 0; }
    getMaxRows() { return 1000; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    appendRow(a) { this.data[this.getLastRow()] = a.slice(); }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    setFrozenRows() {} hideSheet() {}
    protect() { const p = { setDescription: () => p, setWarningOnly: () => p }; return p; }
  }
  const ss = {
    sheets: [],
    getId: () => 'SSID',
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
    getSheets() { return this.sheets.slice(); },
    insertSheet(n, i) { const s = new Sheet(n); if (i === 0) this.sheets.unshift(s); else this.sheets.push(s); return s; },
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); },
    setSpreadsheetTimeZone() {}
  };

  // Fake Google Calendar
  const cal = { Work: [], 'Inquiry Copilot นัดหมาย': [], 'Family': [] };
  const calChanges = { Work: [], 'Inquiry Copilot นัดหมาย': [], 'Family': [] };

  const env = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() {}, getUi: () => ({}) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      setProperties: o => Object.keys(o).forEach(k => { props[k] = String(o[k]); }),
      deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock: () => true }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, t) => Array.from(crypto.createHash('sha256').update(t, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, p) => { const s = new Date(d.getTime() + 7 * 3600e3).toISOString(); return p === 'HH:mm' ? s.slice(11, 16) : p === 'yyyy-MM-dd' ? s.slice(0, 10) : s.slice(0, 10) + ' (long)'; },
      newBlob: (data, type, name) => ({ data, type, name }),
      getUuid: () => crypto.randomUUID(),
      base64Encode: t => Buffer.from(t, 'utf8').toString('base64')
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
    GmailApp: { sendEmail: (to, subject, body, opts) => sent.push({ to, subject, body, opts }) },
    CalendarApp: { getAllCalendars: () => Object.keys(cal).map(n => ({ getName: () => n, getId: () => 'cal:' + n })) },
    Calendar: { Events: { list: (calId, params) => {
      const n = calId.slice(4);
      if (params.syncToken) { const items = calChanges[n]; calChanges[n] = []; return { items, nextSyncToken: 'tok2' }; }
      return { items: cal[n], nextSyncToken: 'tok1' };
    } } },
    UrlFetchApp: { fetch: () => { throw new Error('no network in tests'); } },
    ScriptApp: { getScriptId: () => 'SCRIPTID', getProjectTriggers: () => [], deleteTrigger() {},
      newTrigger: () => { const t = { timeBased: () => t, everyHours: () => t, everyDays: () => t, atHour: () => t, nearMinute: () => t, inTimezone: () => t, create: () => t }; return t; },
      newStateToken: () => { const t = { withMethod: () => t, withArgument: () => t, withTimeout: () => t, createToken: () => 'STATE' }; return t; } },
    HtmlService: { createHtmlOutput: h => ({ html: h }),
      createTemplateFromFile: () => ({ evaluate() { return { tpl: this, setTitle() { return this; }, addMetaTag() { return this; } }; } }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) }
  };
  vm.createContext(env);
  const code = ['Core.gs', 'Config.gs', 'Log.gs', 'Collect.gs', 'WebApp.gs', 'Menu.gs', 'Report.gs', 'Line.gs']
    .map(f => fs.readFileSync(path.join(SRC, f), 'utf8').replace("if (typeof module !== 'undefined') module.exports = Core;", '')).join('\n');
  vm.runInContext(code, env, { filename: 'project.gs' });
  return { env, ss, props, sent, cal, calChanges };
}

module.exports = { makeEnv };
