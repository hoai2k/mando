/**
 * The guest list and the log, as a Google Apps Script web app.
 *
 * This is not part of the build. It is pasted into the Apps Script project
 * bound to one Google Sheet and deployed as a web app; the deployment URL
 * becomes the GATE_ENDPOINT repository variable. Setup is in `docs/AUTH.md`.
 *
 * It answers two kinds of POST from `src/gate/gate.ts`:
 *
 *   { kind: 'invite', game, code }
 *       Look the code up in the Codes tab, log the attempt, and answer
 *       {ok, id, name}. This is the only call that decides anything.
 *
 *   { kind: 'session', game, id, name }
 *       A friend who already holds a pass opened a game. Appended to the
 *       month's session tab and nothing more.
 *
 * NOTE ON PERMISSIONS: this script touches your spreadsheet and nothing else.
 * An earlier version verified Google sign-in tokens and so needed
 * UrlFetchApp — the permission that makes the authorisation prompt read
 * alarmingly. Invite codes need no outside call at all, so that scope is gone.
 *
 * WHY THE BODY ARRIVES AS text/plain: a JSON content-type would make the
 * browser send a CORS preflight, and an Apps Script web app has no way to
 * answer one. `e.postData.contents` is the JSON either way.
 */

/** The spreadsheet this writes to. Leave '' to use the bound sheet. */
var SHEET_ID = '';

/** Tab names. Sessions get one tab per month; see sessionTab_(). */
var CODES_TAB = 'Codes';
var SIGNIN_TAB = 'Signins';
var REFUSED_TAB = 'Refused';
var SESSION_PREFIX = 'Sessions ';

/**
 * How many refusals to write in one hour before the tab stops growing.
 *
 * Refusals are rare in normal life — a friend fumbling a code, once. A burst of
 * them is the only warning you would get that somebody is guessing, and it is
 * worth seeing; but somebody guessing in a loop should not be able to fill your
 * spreadsheet. Past this many in an hour the rows stop and one line says so,
 * which is a louder signal than the thousand rows would have been anyway.
 */
var REFUSAL_CAP_PER_HOUR = 100;

/**
 * Where each game lives, for the invite links the Invite menu builds.
 * Add a line per game; the key is the `game` string that game's boot.ts sends.
 */
/**
 * THE CANONICAL DOMAIN IS games.hoai.net, not hoai2k.github.io.
 *
 * A custom domain is set on the account's Pages site, so every project site
 * moved with it: `hoai2k.github.io/<game>/` answers 301 to
 * `games.hoai.net/<game>/`, query string and all, and an invite link on the
 * old host still works. Links are minted on the canonical host anyway — one
 * less hop, and one less chance of a redirect quietly dropping something.
 *
 * IT ALSO DECIDES WHERE A PASS LIVES. localStorage is keyed by origin, so a
 * friend admitted on games.hoai.net is admitted to every game there and to
 * none on github.io. That is only harmless because the 301 means nobody stays
 * on github.io long enough to store a pass. If the custom domain is ever
 * removed, or a game is published somewhere else, that game becomes its own
 * origin and every friend redeems once more there.
 */
var GAME_URLS = {
  'bounty-hunters': 'https://games.hoai.net/mando/',
  'jjkbrawler': 'https://games.hoai.net/jjkbrawler/',
  'battlebotarena': 'https://games.hoai.net/battlebotarena/',
  'rounders': 'https://games.hoai.net/rounders/',
  'jujutsubattlegrounds': 'https://games.hoai.net/jujutsubattlegrounds/',
  'supergoatman': 'https://games.hoai.net/supergoatman/',
  'tennis': 'https://games.hoai.net/tennis/',
};

/**
 * Only the games are listed above, deliberately. Every stats page, workbench
 * and dev viewer is behind the same door and reports its own label — the
 * `Who` tab's `games` column shows `battlebotarena-stats` and the rest — but
 * nobody needs an invite *link* to a workbench, so listing them here would
 * make the Invites dialog a wall of URLs for no gain.
 */

/** How long the code list is cached, in seconds. A new invite takes this long
 *  to start working; the alternative is re-reading the tab on every arrival. */
var CODES_TTL = 300;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.kind === 'invite') return json_(handleInvite_(body));
    if (body.kind === 'session') { handleSession_(body); return json_({ ok: true }); }
    return json_({ ok: false, reason: 'unknown-kind' });
  } catch (err) {
    return json_({ ok: false, reason: 'error', detail: String(err) });
  }
}

/** A GET is only ever a human checking the deployment is alive. */
function doGet() {
  return json_({ ok: true, service: 'invite-gate' });
}

/**
 * Codes are compared with punctuation and case thrown away, because a friend
 * retyping one off a phone screen will get those wrong and should not be
 * turned away for it. "anya 7f2c9k" and "ANYA-7F2C9K" are the same code.
 */
function normalize_(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function handleInvite_(body) {
  var code = normalize_(body.code);
  var game = String(body.game || '');
  if (!code) return { ok: false, reason: 'no-code' };

  var found = lookup_(code);
  if (!found) {
    refuse_(game, '', code, 'unknown', body.client);
    return { ok: false, reason: 'unknown' };
  }
  if (found.revoked) {
    refuse_(game, found.name, code, 'revoked', body.client);
    return { ok: false, reason: 'revoked' };
  }

  append_(SIGNIN_TAB, ['when', 'game', 'name', 'code', 'verdict'],
          [new Date(), game, found.name, code, 'admitted']);
  // The id, not the code, is what the browser keeps — so a stored pass carries
  // no secret that could be read out of localStorage and passed on.
  return { ok: true, id: found.id, name: found.name };
}

/**
 * Record a turned-away attempt, in its own tab.
 *
 * Separate from Signins on purpose: the two are read for different reasons and
 * at different rates. Signins answers "who got in"; this answers "is anything
 * odd happening", and a burst of rows here should be visible at a glance rather
 * than buried between a week of ordinary arrivals.
 *
 * WHAT CAN AND CANNOT BE RECORDED. Apps Script hands `doPost` the body and
 * nothing else — no client IP, no headers, no user agent. So there is no
 * server-side location, and anything resembling one has to be reported by the
 * browser itself. `client` is that: the visitor's own timezone, language,
 * screen size, user agent and referrer, which are a decent coarse hint about
 * who and where, and are ALSO SELF-REPORTED AND TRIVIALLY FORGED. Read them as
 * "what the browser said about itself", never as fact. The timestamp is the one
 * field here that is genuinely ours.
 */
function refuse_(game, name, code, verdict, client) {
  var c = client || {};
  var header = ['when', 'game', 'name', 'code tried', 'verdict',
                'timezone (self-reported)', 'language', 'screen', 'user agent', 'came from'];
  var cache = CacheService.getScriptCache();
  var hourKey = 'refusals-' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHH');
  var n = Number(cache.get(hourKey) || 0) + 1;
  cache.put(hourKey, String(n), 3600);

  if (n > REFUSAL_CAP_PER_HOUR) {
    // One line, once, rather than a spreadsheet full of somebody's loop.
    if (n === REFUSAL_CAP_PER_HOUR + 1) {
      append_(REFUSED_TAB, header,
              [new Date(), game, '', '', 'FLOOD — over ' + REFUSAL_CAP_PER_HOUR +
               ' refusals this hour; further rows suppressed until the hour turns',
               '', '', '', '', '']);
    }
    return;
  }

  append_(REFUSED_TAB, header, [
    new Date(), game, name, code, verdict,
    c.tz || '', c.lang || '', c.screen || '', c.ua || '', c.ref || '',
  ]);
}

function handleSession_(body) {
  append_(sessionTab_(), ['when', 'game', 'name', 'id'],
          [new Date(), String(body.game || ''), body.name || '', body.id || '']);
}

/**
 * ROTATION. Sessions land in a tab named for the current month — "Sessions
 * 2026-09" — so the log rolls over on its own and no single tab grows without
 * bound.
 *
 * A Google spreadsheet is capped at 10 million cells across all its tabs. At
 * four columns that is ~2.5M session rows, which for games played by friends
 * is a limit nobody will meet; the rotation is here so that the *tab* you open
 * to see what happened last week is small and quick, and so that trimming a
 * year of history one day means deleting a tab rather than a range.
 */
function sessionTab_() {
  return SESSION_PREFIX + Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM');
}

/**
 * The code list, cached. Reading a tab costs a spreadsheet round trip and the
 * list changes about as often as the owner makes a friend.
 *
 * Codes tab columns: code | name | revoked? | notes
 * Anything in the third column (an x, a yes, a date) turns that invite off
 * without deleting the row, so the history in Signins still means something.
 */
function lookup_(code) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('codes');
  var list;
  if (hit) {
    list = JSON.parse(hit);
  } else {
    var tab = book_().getSheetByName(CODES_TAB);
    if (!tab) return null;   // no list means nobody is on it — fail closed
    var last = tab.getLastRow();
    var rows = last < 1 ? [] : tab.getRange(1, 1, last, 3).getValues();
    list = [];
    for (var i = 0; i < rows.length; i++) {
      var c = normalize_(rows[i][0]);
      var name = String(rows[i][1] || '').trim();
      // Skip the header and any blank line, so the tab can have either.
      if (!c || c === 'CODE') continue;
      list.push({ code: c, id: name || c, name: name || c, revoked: String(rows[i][2] || '').trim() !== '' });
    }
    cache.put('codes', JSON.stringify(list), CODES_TTL);
  }
  for (var j = 0; j < list.length; j++) if (list[j].code === code) return list[j];
  return null;
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
// The owner's side: making invites, and reading the log
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Invites')
    .addItem('Invite a friend…', 'inviteFriend')
    .addItem('Show a friend’s link…', 'showLink')
    .addSeparator()
    .addItem('Refresh the Who tab', 'refreshSummary')
    .addItem('Refused attempts (last 20)', 'showRefusals')
    .addToUi();
}

/**
 * The character set codes are drawn from.
 *
 * No O/0 and no I/1/L: a code is going to be read off a screen and typed by
 * somebody else, and those are the pairs that get confused. Dropping them
 * costs a little entropy and saves the "it says my code is wrong" message.
 */
var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function mintCode_(name) {
  var stem = normalize_(name).slice(0, 6) || 'FRIEND';
  var tail = '';
  for (var i = 0; i < 6; i++) tail += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  return stem + '-' + tail;
}

/** Prompt for a name, mint a code, write the row, and show the links. */
function inviteFriend() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Invite a friend', 'Their name (yours to choose — it is what the log will call them):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = res.getResponseText().trim();
  if (!name) return;

  var code = mintCode_(name);
  append_(CODES_TAB, ['code', 'name', 'revoked', 'notes'], [code, name, '', '']);
  CacheService.getScriptCache().remove('codes');   // so it works immediately
  ui.alert('Invite for ' + name, linksFor_(code), ui.ButtonSet.OK);
}

/** Look a friend up by name and show their links again. */
function showLink() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Show a link', 'Which friend?', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var want = res.getResponseText().trim().toLowerCase();
  if (!want) return;

  var tab = book_().getSheetByName(CODES_TAB);
  var last = tab ? tab.getLastRow() : 0;
  var rows = last > 1 ? tab.getRange(2, 1, last - 1, 2).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === want) {
      ui.alert('Invite for ' + rows[i][1], linksFor_(rows[i][0]), ui.ButtonSet.OK);
      return;
    }
  }
  ui.alert('No friend called "' + res.getResponseText().trim() + '" in the Codes tab.');
}

/** One line per game, since a code admits its holder to all of them. */
function linksFor_(code) {
  var out = ['Code: ' + code, '', 'Send them one of these:'];
  for (var key in GAME_URLS) {
    if (!Object.prototype.hasOwnProperty.call(GAME_URLS, key)) continue;
    var base = GAME_URLS[key];
    out.push('', key + ':', base + (base.indexOf('?') === -1 ? '?' : '&') + 'invite=' + encodeURIComponent(code));
  }
  return out.join('\n');
}

/** A quick look at the turned-away attempts without leaving the sheet. */
function showRefusals() {
  var ui = SpreadsheetApp.getUi();
  var tab = book_().getSheetByName(REFUSED_TAB);
  if (!tab || tab.getLastRow() < 2) { ui.alert('Nothing refused yet.'); return; }
  var last = tab.getLastRow();
  var from = Math.max(2, last - 19);
  var rows = tab.getRange(from, 1, last - from + 1, 6).getValues();
  var out = [];
  for (var i = rows.length - 1; i >= 0; i--) {
    out.push(Utilities.formatDate(rows[i][0], 'UTC', 'MMM d HH:mm') + '  ' +
             (rows[i][4] || '') + '  "' + (rows[i][3] || '') + '"  ' +
             (rows[i][1] || '') + '  ' + (rows[i][5] || ''));
  }
  ui.alert('Refused — most recent first\n(time UTC · verdict · code tried · game · timezone)\n\n' + out.join('\n'));
}

/**
 * Rebuild the "Who" tab: one row per person, newest first.
 *
 * Reads every `Sessions YYYY-MM` tab plus `Signins`. Rebuilt from scratch each
 * run rather than kept incrementally, because a report you can always
 * regenerate from the rows beneath it can never drift away from them.
 */
function refreshSummary() {
  var book = book_();
  var tabs = book.getSheets();
  var now = Date.now();
  var MONTH = 30 * 24 * 60 * 60 * 1000;
  var people = {};

  function seen(name, game, when) {
    if (!name) return;
    var p = people[name];
    if (!p) p = people[name] = { name: name, total: 0, recent: 0, games: {}, first: null, last: null };
    p.total++;
    if (game) p.games[game] = true;
    if (when && (now - when.getTime()) <= MONTH) p.recent++;
    if (when) {
      if (!p.first || when < p.first) p.first = when;
      if (!p.last || when > p.last) p.last = when;
    }
  }

  for (var t = 0; t < tabs.length; t++) {
    var tname = tabs[t].getName();
    if (tname.indexOf(SESSION_PREFIX) !== 0) continue;
    var last = tabs[t].getLastRow();
    if (last < 2) continue;
    // columns: when, game, name, id — skip the frozen header
    var rows = tabs[t].getRange(2, 1, last - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      seen(String(rows[i][2] || '').trim(), String(rows[i][1] || ''),
           rows[i][0] instanceof Date ? rows[i][0] : null);
    }
  }

  // Anyone invited who has not played is still worth a row, otherwise
  // "invited but never turned up" looks identical to "never invited".
  var codes = book.getSheetByName(CODES_TAB);
  if (codes && codes.getLastRow() > 1) {
    var crows = codes.getRange(2, 1, codes.getLastRow() - 1, 2).getValues();
    for (var k = 0; k < crows.length; k++) {
      var cname = String(crows[k][1] || '').trim();
      if (cname && !people[cname]) people[cname] = { name: cname, total: 0, recent: 0, games: {}, first: null, last: null };
    }
  }

  var out = [];
  for (var key in people) {
    if (!Object.prototype.hasOwnProperty.call(people, key)) continue;
    var p = people[key];
    out.push([p.name, p.total, p.recent, Object.keys(p.games).sort().join(', '), p.first, p.last]);
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
  tab.appendRow(['name', 'sessions', 'last 30 days', 'games', 'first seen', 'last seen']);
  tab.setFrozenRows(1);
  if (out.length) tab.getRange(2, 1, out.length, 6).setValues(out);
  tab.autoResizeColumns(1, 6);
  SpreadsheetApp.getUi().alert('Who: ' + out.length + ' friend(s).');
}
