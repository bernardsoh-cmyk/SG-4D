# SG 4D — Results & Checker

Singapore 4D results, a prize checker built on the published game rules, and
draw statistics. An independent results viewer — it does not take bets and
handles no money.

Web app in the project root, Android WebView wrapper in `android/` — the same
layout as the other apps in Own Apps.

```bash
start-web.cmd
```

Serves the app at <http://127.0.0.1:8134>.

---

## What it does

| Tab | What's in it |
| --- | --- |
| **Results** | The latest draw — 1st, 2nd and 3rd prize, ten starters, ten consolations. Any stored draw is reachable from the picker, and the twenty most recent are listed below it. |
| **Check** | Runs a bet against the last 30 draws: Ordinary, iBet, System or 4D Roll, Big or Small, at $1–$10 per number. |
| **Stats** | Digit frequency per position against the expected count, and the most frequent numbers — over the last 30, 100, or all stored draws. |
| **Saved** | Numbers you keep, re-checked against every stored draw at $1 Ordinary/Big. |
| **About** | Disclaimers, data provenance, and the problem-gambling helpline. |

---

## Where the results come from

Singapore Pools publishes no API, so `tools/scrape.py` reads their own pages.

**The draw index** is a bare `<select>` served as a static file:

```
/DataFileArchive/Lottery/Output/fourd_result_draw_list_en.html
```

One `<option>` per draw back to 2023, carrying the draw number, the date, an
`isCancelled` flag, and a `queryString` of `sppl=<base64>` — where the base64
decodes to the literal text `DrawNumber=5530`.

**A single draw** is then:

```
/en/product/Pages/4d_results.aspx?sppl=...
```

It parses off stable class anchors: `.drawDate`, `.drawNumber`,
`.tdFirstPrize`, `.tdSecondPrize`, `.tdThirdPrize`, `.tbodyStarterPrizes`,
`.tbodyConsolationPrizes`.

### The two things that will break this

1. **The results path moves.** It used to be `/en/product/sr/Pages/` and that
   now 404s. Worse, the site answers a dead URL with a *200* on its
   page-not-found page, so a naive scraper records success and writes nothing.
   `assert_looks_like_results()` catches exactly this, and the Actions workflow
   fails the run rather than publishing an empty file.
2. **CORS.** Those URLs send no `Access-Control-Allow-Origin`, so the web app
   can never fetch them directly — the browser blocks the request before it
   leaves. Hence the feed below.

---

## The data pipeline

```
GitHub Actions cron (Wed/Sat/Sun, after the draw)
  └─ tools/scrape.py --limit 5      stdlib only, no pip step
       └─ commits data/history.json
            └─ served over HTTPS; the app reads it as FEED_URL
```

`data/history.json` also ships **inside the APK** as a seed, so a first launch
with no network opens to a real history rather than a spinner. It currently
holds **267 draws**, back to 5 Jan 2025, at 66 KB.

### Cold start

```bash
python tools/scrape.py --backfill 250 --out data/history.json
```

Takes a few minutes — it sleeps 0.4s between requests, deliberately.

### The published feed

- **Repo**: <https://github.com/bernardsoh-cmyk/SG-4D> (public — GitHub
  Pages needs it to be, and the app has to be able to read the feed anonymously)
- **Feed**: <https://bernardsoh-cmyk.github.io/SG-4D/data/history.json>
- **Web version of the app**: <https://bernardsoh-cmyk.github.io/SG-4D/>

Pages serves the repo root, so the same deploy publishes both the JSON the app
reads and a working browser version of the app. `FEED_URL` at the top of
`data.js` points at the first of those.

GitHub Pages sends `Access-Control-Allow-Origin: *`, which is the entire reason
this indirection exists — Singapore Pools does not, so the WebView cannot read
them directly.

Two things deliberately kept out of the public repo (see `.gitignore`):
`PLAY_STORE_LISTING.md`, which is internal ASO strategy and a candid
Play-policy risk assessment of this app, and `store-assets/`, which goes to
Play Console rather than a public URL.

### The native fallback

Inside the APK, `NetBridge.java` exposes an `AndroidNet` bridge, because Java is
not bound by CORS. When the feed is missing or behind, `data.js` fetches the
handful of draws it is actually missing straight from the site and parses them
with the same anchors the Python uses.

It is deliberately narrow: HTTPS only, `www.singaporepools.com.sg` only, GET
only, 512 KB cap, no credentials, and it re-checks the host after redirects. It
is also asynchronous — a `@JavascriptInterface` method blocks the calling
JavaScript until it returns, so a synchronous fetch there would freeze the page
for the length of every request.

---

## About the prize figures

Every amount is transcribed from Singapore Pools' published 4D Game Rules
(cl. 4.5), not from memory and not inferred from results pages. 4D pays fixed
amounts per $1 stake, so a win is computed exactly rather than estimated:

| | 1st | 2nd | 3rd | Starter | Consolation |
| --- | --- | --- | --- | --- | --- |
| Big | $2,000 | $1,000 | $490 | $250 | $60 |
| Small | $3,000 | $2,000 | $800 | — | — |

**iBet is not the fixed prize divided by the permutation count.** It is its own
matrix, varying by digit pattern — four different digits, one repeated digit,
two pairs, or three of a kind. Both iBet tables (Big and Small) are in
`checker.js`, transcribed from the same clause.

Rule 4.6 also matters: a number matching more than one prize category collects
all of them, so the checker adds rather than replaces.

---

## Before this goes to Play

- [ ] **Own icon.** `icons/` is currently FX Pulse's placeholder art.
- [ ] **Publish the feed** and set `FEED_URL` (see above).
- [ ] **AdMob ids.** `android/app/src/release/res/values/ads.xml` still holds
      Google's test ids. Check AdMob's content policy for gambling-adjacent
      apps before switching them live.
- [ ] **Store listing** must carry the non-affiliation line. Do not use
      Singapore Pools' name or logo as the app icon or title.
- [ ] **Content rating.** The IARC questionnaire will place this in a higher age
      band for gambling references. Answer it truthfully.
- [ ] **On-device check** that the service worker registers — the preview
      browser used during development disables service workers entirely, so
      that path is untested (registration already fails soft if it does not).

---

## Not affiliated

This app is not operated by, endorsed by, or connected to Singapore Pools or the
Singapore Totalisator Board. Official results are whatever Singapore Pools
publishes; where this app and their site disagree, their site is right.

If gambling stops being fun, the National Problem Gambling Helpline is
**1800-6-668-668**.
