/**
 * The guest list and the log, as a Google Apps Script web app.
 *
 * This is not part of the build. It is pasted into a standalone Apps Script
 * project bound to one Google Sheet and deployed as a web app; the deployment
 * URL becomes `GATE_ENDPOINT` in the repository's variables. Setup, step by
 * step, is in `docs/AUTH.md`.
 *
 * It answers two kinds of POST from `src/gate/gate.ts`:
 *
 *   { kind: 'signin', credential: <Google ID token> }
 *       Verify the token with Google, check the address against the Allowlist
 *       tab, append a row to Signins, and answer {ok, sub, email, name}. This
 *       is the only call that decides anything.
 *
 *   { kind: 'session', sub, email, name }
 *       A returning friend opened the game. Appended to the month's session
 *       tab and nothing more. UNVERIFIED by design — see the note in gate.ts.
 *
 * WHY THE BODY ARRIVES AS text/plain: a JSON content-type would make the
 * browser send a CORS preflight, and an Apps Script web app has no way to
 * answer one. `e.postData.contents` is the JSON either way.
 */

/** The spreadsheet this writes to. Leave '' to use the bound sheet. */
var SHEET_ID = '';

/** Tab names. Sessions get one tab per month; see sessionTab_(). */
var ALLOWLIST_TAB = 'Allowlist';
var SIGNIN_TAB = 'Signins';
var SESSION_PREFIX = 'Sessions ';

/**
 * The OAuth client ID from the Google Cloud console — the SAME one the site is
 * built with. Checking it is what stops a token minted for some other site
 * being replayed at this endpoint.
 */
var CLIENT_ID = 'PASTE-YOUR-CLIENT-ID.apps.googleusercontent.com';

/** How long the allowlist is cached, in seconds. An invite takes this long to
 *  take effect; the alternative is re-reading the tab on every single boot. */
var ALLOWLIST_TTL = 300;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.kind === 'signin') return json_(handleSignin_(body));
    if (body.kind === 'session') { handleSession_(body); return json_({ ok: true }); }
    return json_({ ok: false, reason: 'unknown-kind' });
  } catch (err) {
    return json_({ ok: false, reason: 'error', detail: String(err) });
  }
}

/** A GET is only ever a human checking the deployment is alive. */
function doGet() {
  return json_({ ok: true, service: 'bounty-hunters-gate' });
}

function handleSignin_(body) {
  if (!body.credential) return { ok: false, reason: 'no-credential' };

  // Ask Google who this is. Never trust the token's own payload unverified —
  // anyone can write a JWT, only Google can make this endpoint agree.
  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.credential),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { ok: false, reason: 'bad-token' };
  var info = JSON.parse(res.getContentText());

  // The audience check is the other half of verification: a valid Google token
  // issued to a different application must not open this door.
  if (info.aud !== CLIENT_ID) return { ok: false, reason: 'wrong-audience' };
  if (info.email_verified !== 'true' && info.email_verified !== true) return { ok: false, reason: 'unverified-email' };

  var email = String(info.email || '').toLowerCase();
  if (!onList_(email)) {
    // Logged anyway, and on purpose: "who tried and was turned away" is the
    // most useful row in the book when a friend says the link doesn't work.
    append_(SIGNIN_TAB, ['when', 'email', 'name', 'sub', 'verdict'],
            [new Date(), email, info.name || '', info.sub || '', 'refused']);
    return { ok: false, reason: 'not-listed', email: email };
  }

  append_(SIGNIN_TAB, ['when', 'email', 'name', 'sub', 'verdict'],
          [new Date(), email, info.name || '', info.sub || '', 'admitted']);
  return { ok: true, sub: info.sub, email: email, name: info.name || email, picture: info.picture || '' };
}

function handleSession_(body) {
  append_(sessionTab_(), ['when', 'email', 'name', 'sub'],
          [new Date(), String(body.email || '').toLowerCase(), body.name || '', body.sub || '']);
}

/**
 * ROTATION. Sessions land in a tab named for the current month — "Sessions
 * 2026-09" — so the log rolls over on its own and no single tab grows without
 * bound.
 *
 * A Google spreadsheet is capped at 10 million cells across all its tabs. At
 * four columns that is ~2.5M session rows, which for a game played by friends
 * is a limit nobody will meet; the rotation is here so that the *tab* you open
 * to see what happened last week is small and quick, and so that trimming a
 * year of history one day means deleting a tab rather than a range. If the
 * spreadsheet itself ever did fill up, start a new one and point SHEET_ID at
 * it — the Signins tab is the part worth keeping.
 */
function sessionTab_() {
  return SESSION_PREFIX + Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM');
}

/**
 * The allowlist, cached. Reading a tab costs a spreadsheet round trip and the
 * list changes about as often as the owner makes a friend, so it is held for
 * ALLOWLIST_TTL seconds. Column A is the address; anything after it is yours
 * to use as a notes column, and is ignored here.
 */
function onList_(email) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('allowlist');
  var list;
  if (hit) {
    list = JSON.parse(hit);
  } else {
    var tab = book_().getSheetByName(ALLOWLIST_TAB);
    if (!tab) return false;  // no list means nobody is on it — fail closed
    var last = tab.getLastRow();
    var rows = last < 1 ? [] : tab.getRange(1, 1, last, 1).getValues();
    list = [];
    for (var i = 0; i < rows.length; i++) {
      var v = String(rows[i][0] || '').trim().toLowerCase();
      // Skip a header cell and any blank line, so the tab can have either.
      if (v && v.indexOf('@') > 0) list.push(v);
    }
    cache.put('allowlist', JSON.stringify(list), ALLOWLIST_TTL);
  }
  return list.indexOf(email) !== -1;
}

function book_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/** Append one row, creating the tab and its header the first time it is used. */
function append_(tabName, header, row) {
  var book = book_();
  var tab = book.getSheetByName(tabName);
  if (!tab) {
    tab = book.insertSheet(tabName);
    tab.appendRow(header);
    tab.setFrozenRows(1);
  }
  tab.appendRow(row);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Reading the log
// ---------------------------------------------------------------------------

/**
 * Adds a "Bounty Hunters" menu to the spreadsheet when the owner opens it.
 *
 * Apps Script runs this automatically on open, so the report below is two
 * clicks away and there is nothing to remember. It exists because the raw
 * tabs answer "what happened" and the question actually being asked is "who
 * plays this, and how much" — which is a different shape and wants collapsing.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bounty Hunters')
    .addItem('Refresh the Who tab', 'refreshSummary')
    .addToUi();
}

/**
 * Rebuild the "Who" tab: one row per person, newest players first.
 *
 * Reads every `Sessions YYYY-MM` tab plus `Signins`, and writes name, address,
 * total sessions, sessions in the last 30 days, and the first and last time
 * they showed up. Rebuilt from scratch each run rather than kept incrementally,
 * because a report you can always regenerate from the rows beneath it can
 * never drift away from them.
 *
 * Cost is one pass over the log. At friends scale that is milliseconds; if the
 * history ever got genuinely long, narrow it by deleting or archiving the
 * oldest month tabs — the rotation in sessionTab_() is what makes that a
 * one-click operation.
 */
function refreshSummary() {
  var book = book_();
  var tabs = book.getSheets();
  var now = Date.now();
  var MONTH = 30 * 24 * 60 * 60 * 1000;
  var people = {};   // email -> row being accumulated

  function seen(email, name, when) {
    if (!email) return;
    var p = people[email];
    if (!p) { p = people[email] = { email: email, name: name || '', total: 0, recent: 0, first: null, last: null }; }
    if (name && !p.name) p.name = name;
    p.total++;
    if (when && (now - when.getTime()) <= MONTH) p.recent++;
    if (when) {
      if (!p.first || when < p.first) p.first = when;
      if (!p.last || when > p.last) p.last = when;
    }
  }

  for (var t = 0; t < tabs.length; t++) {
    var name = tabs[t].getName();
    if (name.indexOf(SESSION_PREFIX) !== 0) continue;
    var last = tabs[t].getLastRow();
    if (last < 2) continue;
    // columns: when, email, name, sub — skip the frozen header
    var rows = tabs[t].getRange(2, 1, last - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      var when = rows[i][0] instanceof Date ? rows[i][0] : null;
      seen(String(rows[i][1] || '').toLowerCase(), rows[i][2], when);
    }
  }

  // Anyone admitted who has not opened the game since is still worth a row,
  // otherwise "invited but never played" looks identical to "never invited".
  var signins = book.getSheetByName(SIGNIN_TAB);
  if (signins && signins.getLastRow() > 1) {
    var srows = signins.getRange(2, 1, signins.getLastRow() - 1, 5).getValues();
    for (var j = 0; j < srows.length; j++) {
      if (srows[j][4] !== 'admitted') continue;
      var em = String(srows[j][1] || '').toLowerCase();
      if (em && !people[em]) { people[em] = { email: em, name: srows[j][2] || '', total: 0, recent: 0, first: srows[j][0], last: srows[j][0] }; }
    }
  }

  var out = [];
  for (var k in people) {
    if (!Object.prototype.hasOwnProperty.call(people, k)) continue;
    var p = people[k];
    out.push([p.name, p.email, p.total, p.recent, p.first, p.last]);
  }
  // Most recently seen first: the useful ordering when you open this to find
  // out who has been playing lately.
  out.sort(function (a, b) {
    var x = a[5] ? a[5].getTime() : 0, y = b[5] ? b[5].getTime() : 0;
    return y - x;
  });

  var tab = book.getSheetByName('Who');
  if (!tab) tab = book.insertSheet('Who');
  tab.clear();
  tab.appendRow(['name', 'email', 'sessions', 'last 30 days', 'first seen', 'last seen']);
  tab.setFrozenRows(1);
  if (out.length) tab.getRange(2, 1, out.length, 6).setValues(out);
  tab.autoResizeColumns(1, 6);
  SpreadsheetApp.getUi().alert('Who: ' + out.length + ' player(s).');
}
