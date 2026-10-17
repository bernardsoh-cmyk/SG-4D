/*
 * SG Lottery — results data layer for 4D, TOTO and Singapore Sweep.
 *
 * Three sources, tried in this order, merged per game:
 *
 *   1. The bundled seed (data/history.json)
 *      Ships inside the APK. A first launch with no network still opens to
 *      real history instead of a spinner.
 *
 *   2. The hosted feed (FEED_URL)
 *      A GitHub Actions cron runs tools/scrape.py after each draw and commits
 *      the JSON. One request per launch, cached in localStorage.
 *
 *   3. The native bridge (AndroidNet), only inside the app
 *      Singapore Pools sends no Access-Control-Allow-Origin header, so the
 *      WebView can never fetch them from JavaScript. Java is not bound by
 *      CORS, so AndroidNet fetches the page and we parse it here with the same
 *      anchors tools/scrape.py uses. It exists because the feed is only as
 *      prompt as its cron, and GitHub's scheduler runs hours late.
 *
 * Everything merges by draw number within a game, newest wins, and the result
 * is cached. Staleness is per game, because the three draw on entirely
 * different rhythms: 4D on Wed/Sat/Sun, TOTO on Mon/Thu, Sweep on the first
 * Wednesday of the month. A result that might not be the latest is labelled
 * as such; it is never passed off as current.
 */
window.SGData = (function () {
  'use strict';

  var FEED_URL = 'https://wrsoh2502-cell.github.io/SG-4D/data/history.json';
  var SEED_URL = './data/history.json';
  var CACHE_KEY = 'sg4d.history.v2';        // v2: multi-game shape
  var FRESH_MS = 30 * 60 * 1000;

  /* How long after a draw its result actually appears. Measured from the
   * Last-Modified of each game's own file, not assumed:
   *
   *   4D     draw 18:30 -> published 18:54   (24 min)
   *   TOTO   draw 18:30 -> published 19:12   (42 min)
   *   Sweep  draw 18:00 -> published 19:54   (114 min)
   *
   * This started as one global 20 minutes taken from the 4D figure, which made
   * the app declare TOTO behind 22 minutes early and Sweep an hour and a half
   * early — showing a "may be out" warning while Singapore Pools had simply
   * not published yet. The value is per game, with a little headroom so a
   * slightly slow night is not reported as a fault. Being a few minutes early
   * costs nothing, because the poll that follows is conditional. */
  var RESULTS_LAG_MS = { fourd: 30 * 60 * 1000, toto: 50 * 60 * 1000, sweep: 125 * 60 * 1000 };

  var ARCHIVE = 'https://www.singaporepools.com.sg/DataFileArchive/Lottery/Output/';

  var state = {
    games: { fourd: [], toto: [], sweep: [] },
    stale: { fourd: false, toto: false, sweep: false },
    generated: null,
    source: 'seed',
    error: null
  };

  /* ---------------- time ---------------- */

  // SGT is UTC+8 year-round — no DST, so the offset is a constant.
  function sgNow() {
    return new Date(Date.now() + (8 * 60 + new Date().getTimezoneOffset()) * 60000);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** Is `d` a draw day for this game? */
  function isDrawDay(cfg, d) {
    if (cfg.monthly) {
      // Singapore Sweep draws on the first Wednesday of the month.
      return d.getDay() === 3 && d.getDate() <= 7;
    }
    return cfg.days.indexOf(d.getDay()) !== -1;
  }

  function drawTimeOn(cfg, day) {
    var t = new Date(day);
    t.setHours(Math.floor(cfg.hour), (cfg.hour % 1) * 60, 0, 0);
    return t;
  }

  /** Most recent date on which a draw of this game should already be published. */
  function lastExpectedDraw(game) {
    var cfg = GAMES[game], d = sgNow();
    for (var back = 0; back < 40; back++) {
      var probe = new Date(d.getTime() - back * 86400000);
      if (!isDrawDay(cfg, probe)) continue;
      if (d.getTime() >= drawTimeOn(cfg, probe).getTime() + RESULTS_LAG_MS[game]) return isoOf(probe);
    }
    return null;
  }

  /** Next draw date/time for this game. */
  function nextDraw(game) {
    var cfg = GAMES[game], d = sgNow();
    for (var fwd = 0; fwd < 40; fwd++) {
      var probe = new Date(d.getTime() + fwd * 86400000);
      if (!isDrawDay(cfg, probe)) continue;
      var at = drawTimeOn(cfg, probe);
      if (at.getTime() > d.getTime()) return at;
    }
    return null;
  }

  /* ---------------- parsing (native fallback only) ----------------
   *
   * Deliberately the same anchors as tools/scrape.py. If the site changes its
   * markup, both break together and both fail loudly rather than one of them
   * quietly producing wrong numbers. */

  function textOf(s) {
    var el = document.createElement('div');
    el.innerHTML = String(s).replace(/<[^>]+>/g, ' ');
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function grab(re, body) { var m = re.exec(body); return m ? m[1] : null; }

  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function isoDate(label) {
    var m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/.exec(label || '');
    if (!m) return null;
    var mon = MONTHS.indexOf(m[2].toLowerCase());
    if (mon < 0) return null;
    return m[3] + '-' + pad(mon + 1) + '-' + pad(parseInt(m[1], 10));
  }

  function headerOf(body) {
    var date = isoDate(textOf(grab(/<th[^>]*class='drawDate'[^>]*>([\s\S]*?)<\/th>/, body)));
    var numText = textOf(grab(/<th[^>]*class='drawNumber'[^>]*>([\s\S]*?)<\/th>/, body));
    var draw = numText ? parseInt(numText.replace(/\D/g, ''), 10) : NaN;
    return (date && draw) ? { date: date, draw: draw } : null;
  }

  function moneyOf(s) {
    s = (s || '').trim();
    if (!s || s === '-' || s === '--' || s === '–') return null;
    var c = s.replace(/[^\d.]/g, '');
    return c ? parseFloat(c) : null;
  }

  function parseFourD(body) {
    var h = headerOf(body);
    if (!h) return null;
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
      draw: h.draw, date: h.date, first: first,
      second: prize('tdSecondPrize'), third: prize('tdThirdPrize'),
      starter: block('tbodyStarterPrizes'), consolation: block('tbodyConsolationPrizes')
    };
  }

  function parseToto(body) {
    var h = headerOf(body);
    if (!h) return null;
    var numbers = [];
    for (var i = 1; i <= 6; i++) {
      var v = textOf(grab(new RegExp("<td[^>]*class='win" + i + "'[^>]*>([\\s\\S]*?)</td>"), body));
      if (!v) return null;
      numbers.push(parseInt(v, 10));
    }
    var add = textOf(grab(/<td[^>]*class='additional'[^>]*>([\s\S]*?)<\/td>/, body));
    if (!add) return null;

    var groups = [];
    var tables = body.match(/<table[^>]*>[\s\S]*?<\/table>/g) || [];
    for (var t = 0; t < tables.length; t++) {
      var rows = tables[t].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
      var parsed = [];
      for (var r = 0; r < rows.length; r++) {
        var cells = [], cre = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g, cm;
        while ((cm = cre.exec(rows[r]))) cells.push(textOf(cm[1]));
        if (cells.length >= 3 && /^Group\s*[1-7]$/.test(cells[0])) {
          var sh = moneyOf(cells[2]);
          parsed.push({
            group: parseInt(cells[0].replace(/\D/g, ''), 10),
            prize: moneyOf(cells[1]),
            shares: sh === null ? 0 : sh
          });
        }
      }
      if (parsed.length >= 5) { groups = parsed; break; }
    }

    return {
      draw: h.draw, date: h.date,
      numbers: numbers.slice().sort(function (a, b) { return a - b; }),
      additional: parseInt(add, 10),
      jackpot: moneyOf(textOf(grab(/<td[^>]*class='jackpotPrize'[^>]*>([\s\S]*?)<\/td>/, body))),
      groups: groups
    };
  }

  var SWEEP_HEADING = /^([\d,]+)\s+(.*?)\s+Prizes?\s*@\s*\$?([\d,]+)/i;

  function parseSweep(body) {
    var h = headerOf(body);
    if (!h) return null;
    function top(cls) {
      var v = textOf(grab(new RegExp("class='" + cls + "'[^>]*>([\\s\\S]*?)</"), body));
      return v ? v.replace(/\D/g, '') : null;
    }
    var groups = [], seen = {};
    var re = /class='prizeGroupHeading'[^>]*>([\s\S]*?)<\/[^>]+>([\s\S]*?)(?=class='prizeGroupHeading'|$)/g;
    var m;
    while ((m = re.exec(body))) {
      var heading = textOf(m[1]);
      if (!heading || seen[heading]) continue;
      var hm = SWEEP_HEADING.exec(heading);
      if (!hm) continue;
      seen[heading] = true;
      var label = hm[2].trim();
      // From the <li>/<td> elements, not the flattened text: a neighbouring
      // draw date otherwise contributes a phantom two-digit "winner".
      var cells = [], cre = /<(?:li|td)[^>]*>([\s\S]*?)<\/(?:li|td)>/g, cm;
      while ((cm = cre.exec(m[2]))) cells.push(textOf(cm[1]));
      var nums = [];
      cells.forEach(function (c) {
        if (label.indexOf('2D') !== -1) { if (/^\d{2}$/.test(c)) nums.push(c); }
        else if (/^\d{3}\s?\d{4}$/.test(c)) nums.push(c.replace(/\D/g, ''));
      });
      groups.push({
        label: label,
        count: parseInt(hm[1].replace(/,/g, ''), 10),
        amount: parseFloat(hm[3].replace(/,/g, '')),
        numbers: nums
      });
    }
    if (!groups.length) return null;
    return {
      draw: h.draw, date: h.date,
      first: top('valueFirstPrize'), second: top('valueSecondPrize'),
      third: top('valueThirdPrize'), groups: groups
    };
  }

  function splitLi(body) {
    return body.split('<li>').filter(function (c) { return c.indexOf('drawNumber') !== -1; });
  }

  /* Sweep renders every draw twice. The mobile block labels the date with
   * <span class='drawDate'>, the desktop one with <th>, so matching the <th>
   * form picks exactly one complete chunk per draw. */
  function splitSweep(body) {
    var desktop = /<th[^>]*class='drawDate'/;
    var out = body.split(/(?=<div class='tables-wrap)/).filter(function (c) {
      return desktop.test(c);
    });
    return out.length ? out : (desktop.test(body) ? [body] : []);
  }

  var GAMES = {
    fourd: {
      label: '4D', days: [0, 3, 6], hour: 18.5,
      top: ARCHIVE + 'fourd_result_top_draws_en.html', split: splitLi, parse: parseFourD
    },
    toto: {
      label: 'TOTO', days: [1, 4], hour: 18.5,
      top: ARCHIVE + 'toto_result_top_draws_en.html', split: splitLi, parse: parseToto
    },
    sweep: {
      label: 'Sweep', monthly: true, hour: 18,
      top: ARCHIVE + 'sweep_result_top_draws_en.html', split: splitSweep, parse: parseSweep
    }
  };
  var GAME_KEYS = ['fourd', 'toto', 'sweep'];

  /* ---------------- merging ---------------- */

  function mergeInto(target, incoming) {
    if (!incoming || !incoming.length) return target;
    var byDraw = {}, i;
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
   * actually managed to read, not the one that happened to add a row. */
  var SOURCE_RANK = { cache: 0, seed: 1, feed: 2, live: 3 };

  function absorb(payload, source) {
    if (!payload) return false;
    var grew = false;
    GAME_KEYS.forEach(function (g) {
      if (!payload[g]) return;
      var before = state.games[g].length;
      state.games[g] = mergeInto(state.games[g], payload[g]);
      if (state.games[g].length > before) grew = true;
    });
    if (payload.generated && (!state.generated || payload.generated > state.generated)) {
      state.generated = payload.generated;
    }
    // Recorded on a successful read, NOT on whether it grew the history: the
    // steady state of a healthy feed is that it adds nothing.
    if (SOURCE_RANK[source] >= SOURCE_RANK[state.source]) state.source = source;
    return grew;
  }

  function readCache() {
    try { var raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }

  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        generated: state.generated, fetchedAt: Date.now(),
        fourd: state.games.fourd, toto: state.games.toto, sweep: state.games.sweep
      }));
    } catch (e) { /* quota or private mode — the seed still carries the app */ }
  }

  function recomputeStale() {
    GAME_KEYS.forEach(function (g) {
      var newest = state.games[g][0];
      var expected = lastExpectedDraw(g);
      state.stale[g] = !!(expected && (!newest || newest.date < expected));
    });
  }

  function anyStale() {
    return GAME_KEYS.some(function (g) { return state.stale[g]; });
  }

  /* ---------------- fetching ---------------- */

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.json();
    });
  }

  var nativeNet = (function () {
    try { if (window.AndroidNet && window.AndroidNet.available()) return window.AndroidNet; }
    catch (e) { /* not in the app */ }
    return null;
  })();

  /* The bridge is asynchronous — see NetBridge.java. A @JavascriptInterface
   * method blocks the calling JavaScript until it returns, so a synchronous
   * fetch would freeze the page for the length of every request. */
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
        timer: setTimeout(function () {
          delete pending[id];
          reject(new Error('timed out: ' + url));
        }, 30000)
      };
      try { nativeNet.request(url, id, ifModifiedSince || ''); }
      catch (e) {
        clearTimeout(pending[id].timer);
        delete pending[id];
        reject(e);
      }
    });
  }

  /* Last-Modified per game, so each check can be conditional. In memory only:
   * a stale value costs one small response, never a wrong result. */
  var seenAt = {};

  /** Read one game's newest draws straight from Singapore Pools. */
  function nativeLatest(game, conditional) {
    var cfg = GAMES[game];
    return nativeGet(cfg.top, conditional ? seenAt[game] : null).then(function (res) {
      if (res.status === 304) return [];
      seenAt[game] = res.lastModified || seenAt[game];
      var out = [];
      cfg.split(res.body).forEach(function (chunk) {
        var rec = cfg.parse(chunk);
        if (rec) out.push(rec);
      });
      return out;
    });
  }

  /** Pull every game that is currently behind, in parallel. */
  function catchUpStale(conditional) {
    var behind = GAME_KEYS.filter(function (g) { return state.stale[g]; });
    if (!behind.length) return Promise.resolve(false);
    return Promise.all(behind.map(function (g) {
      return nativeLatest(g, conditional).then(function (rows) {
        var p = {}; p[g] = rows;
        return rows.length ? absorb(p, 'live') : false;
        // one game failing must not sink the others
      }).catch(function (e) { state.error = e.message; return false; });
    })).then(function (results) {
      return results.some(Boolean);
    });
  }

  /* ---------------- public ---------------- */

  function load(opts) {
    opts = opts || {};
    state.error = null;
    // Reset so source describes THIS load.
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
      if (!nativeNet || !anyStale()) return null;
      return catchUpStale(false).then(function (grew) {
        if (grew) { state.generated = new Date().toISOString(); state.error = null; }
      });
    }).then(function () {
      recomputeStale();
      writeCache();
      schedulePoll();
      return state;
    });
  }

  /* ---------------- waiting for a draw ----------------
   *
   * The hosted feed is only as prompt as its cron, and GitHub's scheduler runs
   * hours late. Inside the app we do better: while any game is due and still
   * missing, check its top-draws file every minute.
   *
   * Affordable only because the check is conditional — an unchanged file
   * answers 304 with no body — so "not published yet" transfers nothing.
   * Polling stops once every game is current, never runs in the background,
   * and never runs without the bridge. */

  var POLL_MS = 60 * 1000;
  var pollTimer = null;
  var onPollResult = null;

  function hidden() { return typeof document !== 'undefined' && document.hidden; }
  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

  function schedulePoll() {
    stopPoll();
    if (!nativeNet || !anyStale() || hidden()) return;
    pollTimer = setTimeout(poll, POLL_MS);
  }

  function poll() {
    pollTimer = null;
    if (!nativeNet || !anyStale() || hidden()) return;
    catchUpStale(true).then(function (grew) {
      if (grew) {
        state.generated = new Date().toISOString();
        state.error = null;
        recomputeStale();
        writeCache();
        if (onPollResult) onPollResult(state);
      }
      schedulePoll();
    }).catch(function () { schedulePoll(); });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopPoll(); else if (anyStale()) poll();
    });
  }

  return {
    load: load,
    refresh: function () { return load({ force: true }); },
    get state() { return state; },
    games: GAME_KEYS,
    label: function (g) { return GAMES[g].label; },
    draws: function (g) { return state.games[g] || []; },
    isStale: function (g) { return !!state.stale[g]; },
    anyStale: anyStale,
    nextDraw: nextDraw,
    lastExpectedDraw: lastExpectedDraw,
    get hasNative() { return !!nativeNet; },
    get feedConfigured() { return !!FEED_URL; },
    set onLiveResult(fn) { onPollResult = fn; },

    // exported so the parsers can be exercised directly
    _parse: { fourd: parseFourD, toto: parseToto, sweep: parseSweep },
    _split: { fourd: splitLi, toto: splitLi, sweep: splitSweep },
    _isoDate: isoDate
  };
})();
