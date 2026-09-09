# The door: invite codes for friends

The published site can sit behind a one-time invite code, so that the game is
for people who were invited and the owner can see who is playing.

**It is a doorman, not a lock.** The site is a static build in a public
repository: everything shipped to the browser can be read, and anyone willing
to open devtools can set the pass by hand and walk in. It keeps the game off
the open web for passers-by and it tells you who is playing. It is not a
security boundary, and nothing behind it is a secret. If it ever needs to be
one, that is a hosting change rather than more code — see
[If it needs to be a real lock](#if-it-needs-to-be-a-real-lock) at the end.

**Unconfigured, it does not exist.** With no endpoint built in, the door never
appears: `npm run dev`, every browser suite in `tools/`, and any fork all behave
exactly as they did before it was written. Turning it on is setting one
repository variable; turning it off is deleting it.

**Why not "sign in with Google"?** This door was first built that way, and
Google sign-in is a fine door — it just costs the *owner* a Google Cloud
project, and Google now requires MFA on the account to open one. That is a
steep price for the front door of a fan game. Invite codes need no identity
provider, no OAuth client, no consent screen and no account of any kind, and
they are better for the visitor: a friend clicks their link and is playing, with
no account picker and no Google account required. What they give up is verified
identity — a code is a code, and a friend can pass theirs on. For "who is
playing", your own name for someone is worth as much as Google's.

---

## What a friend experiences

You send them a link:

```
https://games.hoai.net/mando/?invite=ANYA-7F2C9K
```

**`games.hoai.net` is the canonical domain.** A custom domain is set on the
account's Pages site, so every game moved with it and
`hoai2k.github.io/<game>/` answers a 301 to `games.hoai.net/<game>/` — query
string included, so an invite link on the old host still works. The Invites
menu mints links on the canonical host: one less hop, and one less chance of a
redirect quietly dropping something.

They click it. That is the entire experience — nothing to click on the page,
nothing to type, no account. The code is spent on arrival and then **wiped from
the address bar**, so it is not left sitting in a screenshot, a bookmark, or a
URL they paste into a group chat meaning to share the game.

After that, nothing. The pass is written to `localStorage` with **no expiry**,
so that browser goes straight to the title screen forever. Someone who arrives
without a link — a friend on a new phone, say — gets a box to paste their code
into, and codes are compared with case and punctuation thrown away, so
`anya 7f2c9k` works as well as `ANYA-7F2C9K`.

**One invite covers every game.** The pass is stored under a key that is not
namespaced to any one game, and every game shares the one origin
(`https://games.hoai.net/...` differ only by path). A friend admitted to one
game is silently already admitted to the rest.

The origin is also the limit of that. `localStorage` is keyed by it, so a pass
stored on `games.hoai.net` means nothing on `hoai2k.github.io` — harmless only
because the 301 means nobody stays on the old host long enough to store one.
Remove the custom domain, or publish a game somewhere else, and that game is
its own origin where every friend redeems once more. Their code still works;
they just spend it again.

**The game is downloading while they look at the door.** Somebody standing here
is somebody about to play, so the door starts the game's warming plan the
moment it appears: the title screen's art first, the screens after it next.
Roughly a megabyte comes down before they have done anything. A visitor who
turns out not to be on the list has it dropped the moment they are refused.

---

## Setting it up

### 1. The spreadsheet

Make a Google Sheet — call it whatever you like. It is private to your Google
account by default, and **leave it that way**: do not share it, and do not use
*File ▸ Share ▸ Publish to web*. That single fact is what keeps the log yours.

Add one tab named **`Codes`** with these headers in row 1:

| code | name | revoked | notes |
|---|---|---|---|

You do not have to fill it in by hand — the **Invites** menu in step 3 writes
rows for you. Anything at all in the `revoked` column turns that invite off
without deleting the row, so the history in `Signins` still means something.

The other tabs — `Signins`, `Sessions YYYY-MM`, `Who` — create themselves.

### 2. The endpoint

1. In the Sheet: **Extensions ▸ Apps Script**.
2. Delete the placeholder and paste all of [`tools/gate/Code.gs`](../tools/gate/Code.gs).
3. Leave `SHEET_ID` as `''` — the script is bound to this Sheet already.
4. Check `GAME_URLS` near the top. Add a line per game you publish; the key is
   the `game` string that game's `boot.ts` sends.
5. **Deploy ▸ New deployment ▸ Web app**, with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
6. Copy the deployment URL. It ends in `/exec`.

*Who has access: Anyone* sounds alarming and is correct. It means the URL can be
POSTed to without a Google login, which is exactly what a browser at the door
has to do; the script decides what to do with what arrives. It does not share
the spreadsheet with anyone.

**"Google hasn't verified this app"** — expected on the first deploy, click
through it: **Advanced**, then **Go to _&lt;your project&gt;_ (unsafe)**, then
**Allow**. You are the developer, the reviewer and the only person being asked,
and the script's only permission is your own spreadsheet. Your friends never
see this — they never talk to Apps Script as a signed-in Google user, or at
all. (An earlier version of the script verified Google sign-in tokens and so
also needed permission to fetch external URLs, which is what made this prompt
read alarmingly. It no longer does.)

### 3. Turn it on

The deployment URL lives in `.github/workflows/deploy.yml`, in the build step's
`VITE_GATE_ENDPOINT`. It is committed rather than kept in a repository variable
because **it is not a secret** — it is compiled into the published bundle, so
anyone who opens the site can read it either way. Committing it means the door
needs no settings step at all, and one fewer place to look when it misbehaves.

To point it at a different deployment, either edit that line, or set a
`GATE_ENDPOINT` repository variable (**Settings ▸ Secrets and variables ▸
Actions ▸ Variables**, on the *repository's* Settings tab, not your account's)
— a variable wins over the committed default when one is set, which is the way
to change deployments without a commit.

Emptying both takes the door away again: the site publishes open, exactly as it
did before any of this existed.

**Check the deployment answers anonymously before turning the door on.** Open
the `/exec` URL in a browser. It should print
`{"ok":true,"service":"invite-gate"}`. If it shows a Google sign-in page
instead, *Who has access* is not set to **Anyone** — and the door would then
shut the site for everyone, since the browser's POST is anonymous and a
redirect to Google fails CORS. Fix it with **Deploy ▸ Manage deployments ▸**
pencil ▸ *Who has access: Anyone* ▸ Deploy, which keeps the same URL. Note that
*Anyone with a Google account* is a different setting and fails the same way.

### 4. Invite yourself first

Reload the Sheet so the script's menu appears, then **Invites ▸ Invite a
friend…**, and put your own name in. It mints a code, writes the row, and shows
you the links. Open yours: you should land straight on the title screen, with a
row in `Signins` marked `admitted`.

Then invite everyone else the same way. **Invites ▸ Show a friend's link…**
brings a link back up later without minting a new one.

---

## Seeing who has played

Open the Sheet. **Invites ▸ Refresh the Who tab** builds the report:

| column | meaning |
|---|---|
| name | what you called them when you invited them |
| sessions | every time they have opened a game, ever |
| last 30 days | the same count, recently — who is actually playing now |
| games | which of your games they have opened |
| first seen, last seen | when they arrived, and the last time they turned up |

Under it are the raw tabs, if you want them:

- **`Codes`** — the guest list. Delete a row or put anything in its `revoked`
  column to turn an invite off; it stops working within five minutes.
- **`Signins`** — who was admitted, and when.
- **`Refused`** — its own tab, because refusals and admissions are read for
  different reasons: `Signins` answers "who got in", this answers "is anything
  odd happening", and a burst here should be visible at a glance rather than
  buried between a week of ordinary arrivals. **Invites ▸ Refused attempts**
  shows the last twenty without leaving the sheet.

  Each row has the time, the game, the code that was tried, and whether it was
  unknown or revoked — plus the visitor's timezone, language, screen size,
  browser and referrer. **Read those last five as "what the browser said about
  itself", never as fact.** Apps Script hands its `doPost` the body and nothing
  else — no client IP, no headers — so there is no server-side location to be
  had and everything resembling one is self-reported and trivially forged. The
  timezone is the useful field in practice: a coarse "roughly where", and not
  something a casual guesser thinks to change, so a run of attempts from an
  unexpected one is the shape worth noticing. The timestamp is the only field
  here that is genuinely ours.

  Past 100 refusals in one hour the rows stop and a single `FLOOD` line says
  so. Somebody guessing in a loop should not be able to fill the spreadsheet,
  and one line is a louder signal than a thousand rows would have been.
- **`Sessions YYYY-MM`** — one row per launch, in a **new tab each month**.

Nobody sees any of this but you. The endpoint only ever writes; it has no read
route, and the door's code never asks for one.

### If a code gets passed around

You would see it as one name with implausible session counts in the `Who` tab.
Put anything in that row's `revoked` column and mint them a fresh one. This is
the honest cost of not using an identity provider, and it is the reason the
`Signins` tab records every attempt rather than only the successful ones.

### On the log growing

Sessions roll into a fresh tab every month, so no single tab grows without
bound and the one you open to see last week stays small and fast. The endpoint
appends a single row per launch and never reads the log back, so a write costs
the same on day one and in year three.

The `Codes` tab *is* read at the door, so it is cached for five minutes — which
is also the only lag in the system: a friend you invite from the menu works
immediately (the menu clears the cache), but a row you type in by hand takes up
to five minutes.

The ceiling worth knowing: a Google spreadsheet holds 10 million cells across
all its tabs, which at four columns is about 2.5 million session rows. For games
played by friends that is not a number anyone reaches. If it ever came close,
delete or archive the oldest month tabs — which is the reason the rotation is
there — or start a new Sheet and point `SHEET_ID` at it.

---

## How it fails

Deliberate, and worth knowing:

- **The endpoint cannot be reached** — the door **stays shut**, with a *try
  again*. The endpoint is the guest list; admitting everyone whenever a request
  fails would make the list optional for anyone able to drop one. Friends who
  are already in hold a pass and never touch this path, so an outage strands
  only people arriving for the first time.
- **No endpoint is configured at all** — the door **does not exist**. That is
  the difference between "broken" and "switched off", and it is why a deploy
  that loses its variable publishes the open site rather than a locked one.

Session pings carry an id rather than a code and cannot let anybody in: the
browser never stores the invite, so a pass read out of `localStorage` is not a
reusable invite. Forging a ping adds a junk row to a session tab and nothing
else. The `Signins` rows are the ones that decided something.

---

## The arcade library

`games.hoai.net` lists every game. The ones behind the door are **hidden from a
browser holding no pass** — the shelf shows the public games and the count
follows — and appear as soon as there is one. The panel offers **Authenticate**
until then, and an *Authenticated* badge afterwards; neither says what it
unlocks, and the door it opens asks only for a code.

That page is public, so its door is **dismissible** — a *Back* button, since
unlike a game there is something behind it to return to. `openGate` therefore
resolves on *Back* **without** a pass, and the library re-checks `readPass()`
before acting.

The hidden-card list lives in `index.html` as `GATED`, and **has to be kept in
step with the games that actually carry the gate**: a slug listed but not gated
hides a game for no reason; a game gated but not listed shows a card that opens
onto a door. It is presentation, not protection — the list ships in the page
like everything else.

## Getting the door back (for testing)

Once a browser holds a pass it never sees the door again — which is the point,
and a nuisance the one time you want to check that an invite actually works.
Two ways to stop holding one:

| | |
|---|---|
| `?gatereset=1` on any game's URL | forgets this browser's pass and puts the door back |
| `gateReset()` in the browser console | the same thing, always defined |

Neither is a way *in*. Forgetting a pass can only ever cost you the door you
were already through, so there is nothing here worth protecting — which is why
it is a plain URL parameter rather than something hidden.

The parameter takes itself out of the address bar the moment it is spent. Left
in place it would fire on every reload, and testing an invite would mean being
thrown back to the door each time. An `?invite=` alongside it is left alone —
that one has not been spent yet — so
`?gatereset=1&invite=ANYA-7F2C9K` is a one-URL round trip: forget the pass, then
redeem the code as if for the first time. That is the quickest way to check an
invite really works.

A private window works too, and is the better check of the two, since it also
proves the code works for somebody who has never been to the site.

## Letting your own agents in

Three ways, in the order they are usually wanted:

**Running locally: there is nothing to do.** The no-build games' door is off on
`localhost`, `file://` and LAN addresses, and the Vite games' door is off
without `VITE_GATE_ENDPOINT`, which only the deploy job sets. So `npm run dev`,
`npm start`, the test tooling and any agent driving a local server never meet a
door at all. Append `?gatetest=1` on a local server if you ever want to *see*
the real door.

**Against the live site, in a browser the agent controls** — seed the pass
before the first navigation and it never sees the door:

```js
// Playwright / Puppeteer, before page.goto
await page.addInitScript(() => localStorage.setItem(
  'gate.pass', JSON.stringify({ id: 'agent', name: 'agent', since: 0 })));
```

Nothing is logged, because nothing is redeemed. That is the right choice for a
test run you do not want in the numbers, and the wrong one if you *do* want to
see agent traffic.

**Against the live site, and counted** — mint an invite the way you would for a
person, called something like `agent-ci`, and have the agent open
`?invite=THE-CODE` once. Its sessions then show up in the `Who` tab under that
name, which is how you tell agent traffic from friends rather than wondering
why "someone" played at 04:00.

## Porting it to another game

`src/gate/` imports nothing outside itself. It shows two strings and calls one
hook, and everything that knows about *this* game lives in `src/gate/boot.ts`.
To move it:

1. Copy `tools/gate/gate.js` (the portable copy — this repository's own
   `src/gate/gate.ts` is the same door for a TypeScript site).
2. Write that game's `boot.ts`: a `title`, a `blurb`, a `game` label, an
   optional `warm` hook, and whatever starts the app.
3. Point the page's `<script type="module">` at it, and give that repository the
   same `GATE_ENDPOINT` variable.
4. Add the game to `GAME_URLS` in the Apps Script.

```ts
void openGate({
  title: 'Some Other Game',
  blurb: 'This game is for friends of Hoai Nguyen. Use your invite link, or enter your code below.',
  game: 'some-other-game',
  warm: (signal) => startPullingThings(signal),   // optional
  // `endpoint` may also be passed here, for a host that sources its own
  // rather than taking the compiled-in value.
}).then(() => import('./main'));
```

**One endpoint, one Sheet, one guest list serves all of them**, and because the
pass is shared across the origin, a friend invited once is admitted to every
game you publish. The `game` label is what keeps their rows tellable apart.

### Secondary pages

Stats pages, workbenches and dev viewers are behind the same door, each with its
own label (`battlebotarena-stats`, `jjkbrawler-workbench`, and so on), so the
`Who` tab's **games** column tells you what someone actually opened.

They get the door as a **curtain** rather than the full deferral a game gets:
the veil goes up and the page loads behind it. Deferring their scripts properly
would mean rewriting each page's load order, and several mix classic and module
tags — a classic `<script>` cannot be held back past an `await`. For pages
nothing links to, quietly breaking a working tool is the worse trade. It is the
same doorman promise one notch weaker.

They are not listed in `GAME_URLS`: nobody needs an invite *link* to a
workbench, and listing them would make the Invites dialog a wall of URLs.

The `warm` hook is handed an `AbortSignal` that fires if the visitor is
refused; honour it, and treat everything it starts as a hint — the app has to
work whether or not any of it arrives.

**A note for future integrations:** a file the page fetches lazily — a CSS
background, an `Image()` built in a screen's constructor — is *not* "already on
its way" just because it happens early. Behind a door, nothing constructs that
screen until the visitor is through. Whatever the first screen is made of has
to be named to the warm hook explicitly. This game learned it the expensive
way: `logo.png` (1.2 MB) and `title_bg.jpg` (326 kB) sat untouched through the
whole sign-in and then started downloading at the moment they were wanted.

---

## If it needs to be a real lock

Put **Cloudflare Access** in front of the whole site. Its built-in **one-time
PIN** login needs no identity provider at all — a friend enters their email,
gets a six-digit code, and is in — with an email allowlist, sessions up to a
month, free to 50 users, and no change to the game code: this door would be
deleted rather than adapted.

The cost is hosting: Cloudflare Pages instead of GitHub Pages, and a custom
domain, because Access policies attach to a hostname on a Cloudflare zone
rather than to `*.pages.dev`. Worth doing if strangers ever actually turn up;
not worth doing in advance.
