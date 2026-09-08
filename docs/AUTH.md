# The door: Google sign-in for friends

The published site can sit behind a one-time Google sign-in, so that the game
is for people who were invited and the owner can see who is playing.

**It is a doorman, not a lock.** The site is a static build in a public
repository: everything shipped to the browser can be read, and anyone willing
to open devtools can set the pass by hand and walk in. It keeps the game off
the open web for passers-by and it tells you who is playing. It is not a
security boundary, and nothing behind it is a secret. If it ever needs to be
one, that is a hosting change rather than more code — see
[If it needs to be a real lock](#if-it-needs-to-be-a-real-lock) at the end.

**Unconfigured, it does not exist.** With no client ID and no endpoint built
in, the door never appears: `npm run dev`, every browser suite in `tools/`, and
any fork all behave exactly as they did before it was written. Turning it on is
setting two repository variables; turning it off is deleting them.

---

## What a friend experiences

The first time, on each browser: a short screen with a **Continue with Google**
button, or Google's own one-tap card if they are already signed in. One click,
no password, no form.

After that, nothing. The pass is written to `localStorage` with **no expiry**,
so that browser goes straight to the title screen forever.

If the pass is ever lost — a new device, cleared site data, or Safari's
tracking prevention, which drops script-written storage after seven days
without a visit — Google's One Tap is asked to put it back with `auto_select`.
For anyone still signed into Google in that browser this is **silent and
click-free**: the door flashes and the game loads. The one case that costs a
click is a browser with no Google session at all, and even then it is *pick
your account*, not *log in*.

---

## Setting it up

### 1. The spreadsheet

Make a Google Sheet — call it whatever you like. It is private to your Google
account by default, and **leave it that way**: do not share it, and do not use
*File ▸ Share ▸ Publish to web*. That single fact is what keeps the log yours.

Add one tab named **`Allowlist`**. Put one email address per row in column A —
your friends' Google addresses, the ones they would sign in with. A header row
is fine (anything without an `@` is skipped) and column B onwards is yours for
notes; nothing reads it.

The other tabs — `Signins`, `Sessions YYYY-MM`, `Who` — create themselves.

### 2. The endpoint

1. In the Sheet: **Extensions ▸ Apps Script**.
2. Delete the placeholder and paste all of [`tools/gate/Code.gs`](../tools/gate/Code.gs).
3. Leave `SHEET_ID` as `''` — the script is bound to this Sheet already.
4. **Deploy ▸ New deployment ▸ Web app**, with:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Copy the deployment URL. It ends in `/exec`.

*Who has access: Anyone* sounds alarming and is correct. It means the URL can
be POSTed to without a Google login, which is exactly what a browser at the
door has to do; the script decides what to do with what arrives. It does not
share the spreadsheet with anyone.

### 3. The Google client ID

1. [Google Cloud console](https://console.cloud.google.com/) → a new project.
2. **APIs & Services ▸ OAuth consent screen**. External; fill in the name and
   your email. **Do not add any scopes** — the defaults (`openid`, `email`,
   `profile`) are non-sensitive, which means no verification, no review, and no
   user cap. Adding a scope beyond them changes all three.
3. **Credentials ▸ Create credentials ▸ OAuth client ID ▸ Web application**.
   - *Authorised JavaScript origins*: `https://hoai2k.github.io`
   - Leave the redirect URIs empty — this flow does not use them.
4. Copy the client ID. It ends in `.apps.googleusercontent.com`.

Paste that same client ID into `CLIENT_ID` at the top of the Apps Script and
re-deploy. The script checks that every token it is handed was issued **for
this site**; without that a valid Google token minted for any other app would
open the door.

The client ID is public — it is compiled into the bundle, by design. The origin
restriction above is what makes it useless anywhere else.

### 4. Turn it on

In the repository: **Settings ▸ Secrets and variables ▸ Actions ▸ Variables**,
and add two:

| Name | Value |
|---|---|
| `GATE_CLIENT_ID` | the `...apps.googleusercontent.com` id |
| `GATE_ENDPOINT` | the `.../exec` deployment URL |

They are *variables*, not secrets: both end up in the published bundle anyway,
and a secret would only be hidden from you. The next push to `main` deploys the
gated site. Deleting them and pushing takes the door away again.

Sign in as yourself first, before telling anyone — it is the quickest way to
confirm the whole chain works, and your row will be the first one in `Signins`.

---

## Seeing who has played

Open the Sheet. **Bounty Hunters ▸ Refresh the Who tab** builds the report:

| column | meaning |
|---|---|
| name, email | as Google gave it |
| sessions | every time they have opened the game, ever |
| last 30 days | the same count, recently — who is actually playing now |
| first seen, last seen | when they arrived, and the last time they turned up |

Under it are the raw tabs, if you want them:

- **`Signins`** — every attempt to come through the door, `admitted` or
  `refused`. Refusals are logged deliberately: when a friend says "it doesn't
  work", this tab usually says why in one line, and it is where an address
  typo'd on the allowlist shows up.
- **`Sessions YYYY-MM`** — one row per launch, in a **new tab each month**.

Nobody sees any of this but you. The endpoint only ever writes; it has no read
route, and the door's own code never asks for one.

### On the log growing

Sessions roll into a fresh tab every month, so no single tab grows without
bound and the one you open to see last week stays small and fast. The endpoint
appends a single row per launch and never reads the log back, so a write costs
the same on day one and in year three.

The allowlist *is* read on every sign-in, so it is cached for five minutes —
which is also the only lag in the system: a friend you add takes up to five
minutes to be able to get in.

The ceiling worth knowing: a Google spreadsheet holds 10 million cells across
all its tabs, which at four columns is about 2.5 million session rows. For a
game played by friends that is not a number anyone reaches. If it ever came
close, delete or archive the oldest month tabs — which is the reason the
rotation is there — or start a new Sheet and point `SHEET_ID` at it. `Signins`
is the tab worth carrying over.

---

## How it fails

Deliberate, and worth knowing, because the two directions are opposite:

- **Google's script will not load** (an ad blocker, a network that cannot reach
  Google) — **the door opens.** Turning a friend away because our own machinery
  broke is the wrong trade for a doorman, and the stranger it would have
  stopped could have edited `localStorage` anyway.
- **The endpoint cannot be reached** — **the door stays shut**, with a *try
  again*. The endpoint is the guest list; admitting everyone whenever a request
  fails would make the list optional for anyone able to drop one. Friends who
  are already in hold a pass and never touch this path.

Session pings are unverified and cannot let anybody in: there is no fresh
Google token on a returning visit, so a ping is the stored profile taken at its
word. Forging one adds a junk row to a session tab and nothing else. The
`Signins` rows are the verified ones, and those are the guest list.

---

## If it needs to be a real lock

Put **Cloudflare Access** in front of the whole site. It does Google login with
an email allowlist natively, sessions can be set to a month, it is free up to
50 users, and the game code does not change at all — this door would be deleted
rather than adapted.

The cost is hosting: Cloudflare Pages instead of GitHub Pages, and a custom
domain, because Access policies attach to a hostname on a Cloudflare zone
rather than to `*.pages.dev`. Worth doing if strangers ever actually turn up;
not worth doing in advance.
