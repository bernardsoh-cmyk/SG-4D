/*
 * SG 4D — results data layer.
 *
 * Three sources, tried in this order, all merged into one history:
 *
 *   1. The bundled seed (data/history.json)
 *      Ships inside the APK. A first launch with no network still opens to
 *      hundreds of real draws instead of a spinner, and the statistics have
 *      something to chew on immediately.
 *
 *   2. The hosted feed (FEED_URL)
 *      A GitHub Actions cron runs tools/scrape.py after each draw and commits
 *      the JSON. One request per launch, cached in localStorage. This is the
 *      normal path once the feed is published.
 *
 *   3. The native bridge (AndroidNet), only inside the app
 *      Singapore Pools sends no Access-Control-Allow-Origin header, so the
 *      WebView can never fetch them from JavaScript — the request is blocked
 *      before it leaves. Java is not bound by CORS, so AndroidNet will fetch a
 *      page and hand back the markup, and we parse it here with the same
 *      anchors the Python scraper uses. This is a fallback, not the plan: it
 *      exists so the app is correct on day one before the feed is live, and so
 *      a stale feed does not leave a user staring at last week's draw. It only
 *      ever pulls the handful of draws we are actually missing.
 *
 * Everything merges by draw number, newest wins, and the result is cached. A
 * draw we already hold is never re-fetched. When every source fails we serve
 * the cache and say so — state.stale is set, and app.js labels it. A result
 * that might not be the latest is labelled as such; it is never passed off as
 * current.
 */
window.SGData = (function () {
  'use strict';

  /* Published by .github/workflows/scrape.yml after each draw and served from
   * GitHub Pages, which sends Access-Control-Allow-Origin: * — the whole reason
   * this indirection exists, since singaporepools.com.sg sends no such header.
   *
   * If it 404s or goes away, nothing breaks loudly: the fetch below is caught,
   * the app keeps serving the bundled seed, and the native fallback fills the
   * gap inside the APK. */
  var FEED_URL = 'https://wrsoh2502-cell.github.io/SG-4D/data/history.json';

  var SEED_URL = './data/history.json';
  var CACHE_KEY = 'sg4d.history.v1';
  var FRESH_MS = 30 * 60 * 1000;     // don't re-hit the feed more than twice an hour

  /* 4D draws Wednesday, Saturday and Sunday at 6.30pm SGT. Used only to decide
   * whether we are *expecting* something newer than what we hold — never to
   * invent a result. */
  var DRAW_DAYS = [0, 3, 6];         // 0 = Sunday
  var DRAW_HOUR = 18.5;
  /* Measured, not guessed: on 11 Oct the 18:30 draw's file carried a
   * Last-Modified of 18:52 SGT. 20 minutes is the point from which it is
   * worth looking; before that the app is not yet entitled to call itself
   * behind. */
  var RESULTS_LAG_MS = 20 * 60 * 1000;

  var state = {
    draws: [],
    generated: null,
    stale: false,
    source: 'seed',
    error: null
  };

  /* ---------------- time ---------------- */

  // SGT is UTC+8 year-round — no DST, so the offset is a constant and this is
  // exact rather than approximate.
  function sgNow() {
    return new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoOf(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** The most recent date on which a draw should already be published. */
  function lastExpectedDraw() {
    var d = sgNow();
    for (var back = 0; back < 10; back++) {
      var probe = new Date(d.getTime() - back * 86400000);
      if (DRAW_DAYS.indexOf(probe.getDay()) === -1) continue;
      var drawAt = new Date(probe);
      drawAt.setHours(Math.floor(DRAW_HOUR), (DRAW_HOUR % 1) * 60, 0, 0);
      if (d.getTime() >= drawAt.getTime() + RESULTS_LAG_MS) return isoOf(probe);
    }
    return null;
  }

  /** Next draw date/time, as a Date in SGT terms. */
  function nextDraw() {
    var d = sgNow();
    for (var fwd = 0; fwd < 10; fwd++) {
      var probe = new Date(d.getTime() + fwd * 86400000);
      if (DRAW_DAYS.indexOf(probe.getDay()) === -1) continue;
      var drawAt = new Date(probe);
      drawAt.setHours(Math.floor(DRAW_HOUR), (DRAW_HOUR % 1) * 60, 0, 0);
      if (drawAt.getTime() > d.getTime()) return drawAt;
    }
    return null;
  }

  /* ---------------- merging ---------------- */

  function mergeInto(target, incoming) {
    if (!incoming || !incoming.length) return target;
    var byDraw = {};
    var i;
    for (i = 0; i < target.length; i++) byDraw[target[i].draw] = target[i];
    for (i = 0; i < incoming.length; i++) {
      if (incoming[i] && incoming[i].draw) byDraw[incoming[i].draw] = incoming[i];
    }
    var out = [];
    for (var k in byDraw) if (byDraw.hasOwnProperty(k)) out.push(byDraw[k]);
    out.sort(function (a, b) { return b.draw - a.draw; });
    return out;
  }

  /* Least to most authoritative. state.source reports the best source we
   * actually managed to read, which is not the same as the one that happened
   * to add a row. */
  var SOURCE_RANK = { cache: 0, seed: 1, feed: 2, live: 3 };

  function absorb(payload, source) {
    if (!payload) return false;
    var before = state.draws.length;
    state.draws = mergeInto(state.draws, payload.fourd);
    if (payload.generated && (!state.generated || payload.generated > state.generated)) {
      state.generated = payload.generated;
    }
    // Recorded on a successful read, NOT on whether it grew the history. The
    // steady state for a healthy feed is that it adds nothing — every draw it
    // carries is already in the bundled seed — and reporting "seed" then would
    // tell the user we had failed to reach the network when we had not.
    if (SOURCE_RANK[source] >= SOURCE_RANK[state.source]) state.source = source;
    return state.draws.length > before;
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        generated: state.generated,
        fetchedAt: Date.now(),
        fourd: state.draws
      }));
    } catch (e) { /* quota or private mode — the seed still carries the app */ }
  }

  function recomputeStale() {
    var newest = state.draws[0];
    var expected = lastExpectedDraw();
    state.stale = !!(expected && (!newest || newest.date < expected));
  }

  /* ---------------- HTML parsing (native fallback only) ----------------
   *
   * Deliberately the same anchors as tools/scrape.py. If the site changes its
   * markup, both break together and both fail loudly rather than one of them
   * quietly producing wrong numbers. */

  function textOf(s) {
    var el = document.createElement('div');
    el.innerHTML = String(s).replace(/<[^>]+>/g, ' ');
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function grab(re, body) {
    var m = re.exec(body);
    return m ? m[1] : null;
  }

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function isoDate(label) {
    var m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(label || '');
    if (!m) return null;
    var mon = MONTHS.indexOf(m[2].toLowerCase());
    if (mon < 0) return null;
    return m[3] + '-' + pad(mon + 1) + '-' + pad(parseInt(m[1], 10));
  }

  function parseFourD(body) {
    var date = isoDate(textOf(grab(/<th[^>]*class='drawDate'[^>]*>([\s\S]*?)<\/th>/, body)));
    var numText = textOf(grab(/<th[^>]*class='drawNumber'[^>]*>([\s\S]*?)<\/th>/, body));
    var draw = numText ? parseInt(numText.replace(/\D/g, ''), 10) : NaN;
    if (!date || !draw) return null;

    function prize(cls) {
      return textOf(grab(new RegExp("<td[^>]*class='" + cls + "'[^>]*>([\\s\\S]*?)</td>"), body));
    }
    function block(cls) {
      var chunk = grab(new RegExp("<tbody[^>]*class='" + cls + "'[^>]*>([\\s\\S]*?)</tbody>"), body);
      if (!chunk) return [];
      var out = [], re = /<td[^>]*>([\s\S]*?)<\/td>/g, m;
      while ((m = re.exec(chunk))) {
        var v = textOf(m[1]);
        if (/^\d{4}$/.test(v)) out.push(v);
      }
      return out;
    }

    var first = prize('tdFirstPrize');
    if (!first) return null;
    return {
      draw: draw, date: date,
      first: first, second: prize('tdSecondPrize'), third: prize('tdThirdPrize'),
      starter: block('tbodyStarterPrizes'),
      consolation: block('tbodyConsolationPrizes')
    };
  }

  /* ---------------- fetching ---------------- */

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.json();
    });
  }

  var nativeNet = (function () {
    try {
      if (window.AndroidNet && window.AndroidNet.available()) return window.AndroidNet;
    } catch (e) { /* not in the app */ }
    return null;
  })();

  var HOST = 'https://www.singaporepools.com.sg';

  /* The six most recent draws, complete, in one 18 KB static file — 1st/2nd/3rd,
   * all ten starters and all ten consolations, behind the same class anchors as
   * the full results page. It replaces what used to be an index fetch plus one
   * 95 KB page per missing draw.
   *
   * It also answers a conditional request with 304 and no body, which is what
   * makes polling for a fresh result affordable: when nothing has been
   * published, a check costs nothing. */
  var TOP_DRAWS_URL = HOST + '/DataFileArchive/Lottery/Output/fourd_result_top_draws_en.html';

  /* The bridge is asynchronous — see NetBridge.java. It calls back into
   * __netCallback rather than returning, because a @JavascriptInterface method
   * blocks the calling JavaScript until it returns, and freezing the page for
   * the length of a network request is not an acceptable way to refresh. */
  var pending = {};
  var nextRequestId = 0;

  window.__netCallback = function (id, ok, payload, status, lastModified) {
    var slot = pending[id];
    if (!slot) return;
    delete pending[id];
    clearTimeout(slot.timer);
    if (ok) slot.resolve({ body: payload, status: status || 200, lastModified: lastModified || null });
    else slot.reject(new Error(payload));
  };

  /** Resolves { body, status }. status 304 means "unchanged", with no body. */
  function nativeGet(url, ifModifiedSince) {
    return new Promise(function (resolve, reject) {
      var id = 'r' + (++nextRequestId);
      pending[id] = {
        resolve: function (res) {
          if (res.status === 304) return resolve(res);
          if (!res.body) return reject(new Error('empty response: ' + url));
          if (res.body.indexOf('PageNotFoundError') !== -1) {
            return reject(new Error('results URL has moved: ' + url));
          }
          resolve(res);
        },
        reject: reject,
        // If the bridge never calls back the promise would hang forever and
        // take the refresh spinner with it.
        timer: setTimeout(function () {
          delete pending[id];
          reject(new Error('timed out: ' + url));
        }, 30000)
      };
      try {
        nativeNet.request(url, id, ifModifiedSince || '');
      } catch (e) {
        clearTimeout(pending[id].timer);
        delete pending[id];
        reject(e);
      }
    });
  }

  /* Last-Modified of the top-draws file as we last saw it, so the next check
   * can be conditional. Held in memory only: a stale value costs one 18 KB
   * response, never a wrong result. */
  var topDrawsSeenAt = null;

  /** Split the top-draws file into its six draws and parse each one. */
  function parseTopDraws(body) {
    var out = [];
    // One <li> per draw, each a self-contained copy of the same markup the
    // single-draw page uses, so parseFourD works on a chunk unchanged.
    body.split('<li>').forEach(function (chunk) {
      if (chunk.indexOf('drawNumber') === -1) return;
      var rec = parseFourD(chunk);
      if (rec) out.push(rec);
    });
    return out;
  }

  /**
   * Read the newest draws straight from Singapore Pools.
   *
   * Resolves the draws found, or [] when the file has not changed since we
   * last looked (HTTP 304). Rejects only on a real failure.
   */
  function nativeLatest(conditional) {
    return nativeGet(TOP_DRAWS_URL, conditional ? topDrawsSeenAt : null)
      .then(function (res) {
        if (res.status === 304) return [];
        topDrawsSeenAt = res.lastModified || topDrawsSeenAt;
        return parseTopDraws(res.body);
      });
  }

  /* ---------------- public ---------------- */

  function load(opts) {
    opts = opts || {};
    state.error = null;
    // Reset so source describes THIS load. Without it a refresh that failed to
    // reach the feed would keep reporting the source of an earlier successful
    // one, and the header would claim "up to date" off the back of it.
    state.source = 'cache';

    var cached = readCache();
    if (cached) absorb(cached, 'cache');

    var seedStep = getJSON(SEED_URL)
      .then(function (p) { absorb(p, 'seed'); })
      .catch(function () { /* seed is optional once a cache exists */ });

    return seedStep.then(function () {
      var fresh = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < FRESH_MS;
      if (!FEED_URL) return null;
      if (fresh && !opts.force) return null;
      return getJSON(FEED_URL)
        .then(function (p) { absorb(p, 'feed'); })
        .catch(function (e) { state.error = e.message; });
    }).then(function () {
      recomputeStale();
      // Only reach for the site itself when the feed did not get us current.
      if (!state.stale || !nativeNet) return null;
      return nativeLatest(false).then(function (r) {
        absorb({ fourd: r }, 'live');
        state.generated = new Date().toISOString();
        state.error = null;
      }).catch(function (e) { state.error = e.message; });
    }).then(function () {
      recomputeStale();
      writeCache();
      schedulePoll();
      return state;
    });
  }

  /* ---------------- waiting for tonight's draw ----------------
   *
   * The hosted feed is only as prompt as its cron, and GitHub's scheduler has
   * been hours late in practice. Inside the app we can do better: once a draw
   * is due and we still do not have it, check the top-draws file every minute.
   *
   * This is affordable only because the check is conditional — an unchanged
   * file answers 304 with no body — so the common case of "not published yet"
   * transfers nothing. Polling stops the moment the draw lands, never runs
   * while the app is in the background, and never runs without the bridge. */

  var POLL_MS = 60 * 1000;
  var pollTimer = null;
  var onPollResult = null;        // app.js attaches a re-render here

  function stopPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function schedulePoll() {
    stopPoll();
    if (!nativeNet || !state.stale) return;        // nothing to wait for
    if (typeof document !== 'undefined' && document.hidden) return;
    pollTimer = setTimeout(poll, POLL_MS);
  }

  function poll() {
    pollTimer = null;
    if (!nativeNet || !state.stale) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    nativeLatest(true).then(function (draws) {
      var grew = draws.length && absorb({ fourd: draws }, 'live');
      if (grew) {
        state.generated = new Date().toISOString();
        state.error = null;
        recomputeStale();
        writeCache();
        if (onPollResult) onPollResult(state);
      }
      schedulePoll();                               // stops itself once current
    }).catch(function () {
      schedulePoll();                               // transient failure; try again
    });
  }

  if (typeof document !== 'undefined') {
    // Resume promptly when the user comes back, rather than at the next tick.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPoll(); else if (state.stale) poll();
    });
  }

  return {
    load: load,
    refresh: function () { return load({ force: true }); },
    get state() { return state; },
    get draws() { return state.draws; },
    nextDraw: nextDraw,
    lastExpectedDraw: lastExpectedDraw,
    get hasNative() { return !!nativeNet; },
    /** app.js sets this to re-render when a polled draw arrives. */
    set onLiveResult(fn) { onPollResult = fn; },
    get feedConfigured() { return !!FEED_URL; },

    // exported so the parser can be exercised directly
    _parseFourD: parseFourD,
    _isoDate: isoDate
  };
})();
