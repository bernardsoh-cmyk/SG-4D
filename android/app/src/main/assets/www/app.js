/*
 * SG 4D — UI.
 *
 * Renders four things over SGData: the published results, a checker that runs a
 * bet against a window of past draws, digit statistics, and a saved-numbers
 * list that re-checks itself whenever new results arrive.
 *
 * One rule runs through all of it: anything that might not be current is
 * labelled as such, and never presented as the latest draw.
 */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var SAVED_KEY = 'sg4d.saved.v1';
  var SEEN_KEY = 'sg4d.disclaimer.v1';

  var ui = {
    statsWindow: 100,
    fourdType: 'ordinary',
    fourdSize: 'big',
    selectedDraw: null
  };

  /* ---------------- small helpers ---------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function money(v) {
    return '$' + v.toLocaleString('en-SG', { maximumFractionDigits: 2 });
  }

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function prettyDate(iso) {
    var p = iso.split('-');
    // Constructed as UTC so the label never shifts by a day on a device that is
    // not in SGT — the date string is the authority here, not the local clock.
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return DAY_NAMES[d.getUTCDay()] + ', ' + (+p[2]) + ' ' + MONTH_NAMES[+p[1] - 1] + ' ' + p[0];
  }

  function windowed(list) {
    return ui.statsWindow ? list.slice(0, ui.statsWindow) : list;
  }

  /* ---------------- header / status ---------------- */

  function renderStatus() {
    var s = SGData.state;
    var line = $('#status-line');
    line.classList.remove('stale', 'live');

    if (s.stale) {
      line.textContent = 'Showing last known result — a newer draw may be out';
      line.classList.add('stale');
    } else if (s.source === 'live' || s.source === 'feed') {
      line.textContent = 'Results up to date';
      line.classList.add('live');
    } else {
      line.textContent = SGData.draws.length + ' draws stored';
    }

    var feed = $('#about-feed');
    if (feed) {
      var bits = [SGData.draws.length + ' draws stored.'];
      bits.push(SGData.feedConfigured
        ? 'Update feed configured.'
        : 'No update feed configured yet — running on the bundled history.');
      if (SGData.hasNative) bits.push('Live lookup available.');
      if (s.error) bits.push('Last update problem: ' + s.error);
      feed.textContent = bits.join(' ');
    }
  }

  function renderNextDraw() {
    var next = SGData.nextDraw();
    var box = $('#next-draw');
    if (!next) { box.textContent = ''; return; }
    box.innerHTML = '';
    box.appendChild(document.createTextNode('Next draw '));
    box.appendChild(el('b', null, DAY_NAMES[next.getDay()] + ' ' + next.getDate() + ' ' +
                                 MONTH_NAMES[next.getMonth()] + ', 6.30pm'));
  }

  /* ---------------- results ---------------- */

  function renderDrawPicker() {
    var sel = $('#draw-select');
    sel.innerHTML = '';
    SGData.draws.forEach(function (d) {
      var o = el('option', null, prettyDate(d.date) + '  ·  Draw ' + d.draw);
      o.value = String(d.draw);
      sel.appendChild(o);
    });
    if (ui.selectedDraw && SGData.draws.some(function (d) { return d.draw === ui.selectedDraw; })) {
      sel.value = String(ui.selectedDraw);
    } else if (SGData.draws.length) {
      ui.selectedDraw = SGData.draws[0].draw;
      sel.value = String(ui.selectedDraw);
    }
  }

  function currentDraw() {
    for (var i = 0; i < SGData.draws.length; i++) {
      if (SGData.draws[i].draw === ui.selectedDraw) return SGData.draws[i];
    }
    return SGData.draws[0] || null;
  }

  function numberBlock(label, numbers) {
    var wrap = el('div', 'numblock');
    wrap.appendChild(el('div', 'label', label));
    var grid = el('div', 'numgrid');
    numbers.forEach(function (n) { grid.appendChild(el('span', null, n)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function renderResults() {
    renderNextDraw();
    var host = $('#result-card');
    host.innerHTML = '';
    var d = currentDraw();

    if (!d) {
      host.appendChild(el('p', 'empty', 'No results stored yet.'));
    } else {
      var card = el('div', 'result');
      var head = el('div', 'result-head');
      head.appendChild(el('div', 'result-date', prettyDate(d.date)));
      head.appendChild(el('div', 'result-draw', 'Draw ' + d.draw));
      card.appendChild(head);

      var top = el('div', 'top3');
      [['1st Prize', d.first, ''], ['2nd Prize', d.second, 'second'], ['3rd Prize', d.third, 'third']]
        .forEach(function (p) {
          var box = el('div', 'prize ' + p[2]);
          box.appendChild(el('div', 'label', p[0]));
          box.appendChild(el('div', 'num', p[1] || '—'));
          top.appendChild(box);
        });
      card.appendChild(top);

      if ((d.starter || []).length) card.appendChild(numberBlock('Starter Prizes', d.starter));
      if ((d.consolation || []).length) card.appendChild(numberBlock('Consolation Prizes', d.consolation));
      host.appendChild(card);
    }

    renderRecent();

    var oldest = SGData.draws.slice(-1)[0];
    $('#source-note').textContent = oldest
      ? 'Results published by Singapore Pools. History held in this app goes back to ' +
        prettyDate(oldest.date) + '. Official results are whatever Singapore Pools publishes.'
      : '';
  }

  function renderRecent() {
    var host = $('#recent-list');
    host.innerHTML = '';
    SGData.draws.slice(0, 20).forEach(function (d) {
      var row = el('div', 'recent');
      row.appendChild(el('div', 'when', prettyDate(d.date)));
      row.appendChild(el('div', 'what', d.first));
      row.addEventListener('click', function () {
        ui.selectedDraw = d.draw;
        $('#draw-select').value = String(d.draw);
        renderResults();
        $('#views').scrollTop = 0;
      });
      host.appendChild(row);
    });
    $('#recent-sub').textContent = SGData.draws.length + ' stored';
  }

  /* ---------------- check ---------------- */

  function describeFourDEntry() {
    var raw = $('#fourd-entry').value.trim().toUpperCase();
    var note = $('#fourd-entry-note');
    var stake = parseFloat($('#fourd-stake').value);
    note.textContent = '';
    if (!raw) return;

    if (ui.fourdType === 'roll') {
      var nums = SGCheck.rollNumbers(raw);
      if (!nums) { note.textContent = 'A 4D Roll needs one rolling digit, e.g. 58R2.'; return; }
      note.textContent = 'Covers 10 numbers (' + nums[0] + '–' + nums[9] + '). ' +
        'Costs ' + money(10 * stake) + ' at ' + money(stake) + ' each.';
      return;
    }
    if (!/^\d{4}$/.test(raw)) { note.textContent = 'Enter a 4-digit number from 0000 to 9999.'; return; }

    var pattern = SGCheck.digitPattern(raw);
    var perms = SGCheck.permutationCount(raw);
    var patternLabel = {
      allDifferent: 'four different digits', onePair: 'one repeated digit',
      twoPairs: 'two pairs', threeSame: 'three of a kind', allSame: 'four identical digits'
    }[pattern];

    if (ui.fourdType === 'system') {
      if (pattern === 'allSame') {
        note.textContent = 'A number with four identical digits has only one permutation, so it cannot be a System Entry.';
        return;
      }
      note.textContent = 'Covers all ' + perms + ' permutations (' + patternLabel + '). ' +
        'Costs ' + money(perms * stake) + ' at ' + money(stake) + ' each, and each one pays the full fixed prize.';
    } else if (ui.fourdType === 'ibet') {
      if (pattern === 'allSame') {
        note.textContent = 'A number with four identical digits has only one permutation, so it cannot be an iBet.';
        return;
      }
      note.textContent = 'Covers all ' + perms + ' permutations (' + patternLabel + ') for one ' +
        money(stake) + ' stake. Prizes are correspondingly smaller — that is the trade.';
    } else {
      note.textContent = 'One number, exact order. ' + patternLabel.charAt(0).toUpperCase() +
        patternLabel.slice(1) + '.';
    }
  }

  function runFourDCheck() {
    var raw = $('#fourd-entry').value.trim().toUpperCase();
    var stake = parseFloat($('#fourd-stake').value);
    var out = $('#fourd-check-out');
    out.innerHTML = '';
    if (!raw) return;

    var draws = SGData.draws.slice(0, 30);
    var hits = [];
    var total = 0;
    var error = null;

    draws.forEach(function (d) {
      var r = SGCheck.checkFourD(raw, ui.fourdType, ui.fourdSize, stake, d);
      if (r.error) { error = r.error; return; }
      if (r.total > 0) { hits.push({ draw: d, result: r }); total += r.total; }
    });

    if (error) {
      var bad = el('div', 'win-summary');
      bad.appendChild(el('div', 'headline', 'Check that entry'));
      bad.appendChild(el('div', 'sub', error));
      out.appendChild(bad);
      return;
    }

    var summary = el('div', 'win-summary' + (hits.length ? ' won' : ''));
    summary.appendChild(el('div', 'headline',
      hits.length ? money(total) + ' across ' + hits.length + (hits.length === 1 ? ' draw' : ' draws')
                  : 'No wins in the last ' + draws.length + ' draws'));
    summary.appendChild(el('div', 'sub',
      raw + ' · ' + ui.fourdType + ' · ' + ui.fourdSize + ' · ' + money(stake) + ' per number, ' +
      'checked against the last ' + draws.length + ' draws held in this app.'));
    out.appendChild(summary);

    hits.forEach(function (h) {
      var row = el('div', 'hitrow');
      var top = el('div', 'top');
      top.appendChild(el('div', 'date', prettyDate(h.draw.date) + ' · Draw ' + h.draw.draw));
      top.appendChild(el('div', 'amt', money(h.result.total)));
      row.appendChild(top);
      row.appendChild(el('div', 'detail', h.result.lines.map(function (l) {
        return l.category + (l.count > 1 ? ' ×' + l.count : '') + ' — ' + money(l.amount);
      }).join(' · ')));
      out.appendChild(row);
    });
  }

  /* ---------------- stats ---------------- */

  function renderStats() {
    var host = $('#stats-body');
    host.innerHTML = '';

    var draws = windowed(SGData.draws);
    if (!draws.length) { host.appendChild(el('p', 'empty', 'No draws stored.')); return; }

    var freq = SGStats.digitFrequency(draws, 'all');

    host.appendChild(el('h3', null, 'Digit frequency by position'));
    host.appendChild(el('p', 'muted-sm',
      'Across all 23 numbers drawn each time (3 prizes, 10 starters, 10 consolations) over ' +
      draws.length + ' draws. Expected per cell: ' + freq.expectedPerPosition.toFixed(0) + '.'));

    ['1st digit', '2nd digit', '3rd digit', '4th digit'].forEach(function (label, p) {
      var block = el('div');
      block.style.marginTop = '10px';
      block.appendChild(el('div', 'muted-sm', label));
      var grid = el('div', 'posgrid');
      var counts = freq.positions[p];
      var max = Math.max.apply(null, counts);
      for (var d = 0; d <= 9; d++) {
        var cell = el('div', 'poscell');
        cell.appendChild(el('div', 'd', String(d)));
        cell.appendChild(el('div', 'v', String(counts[d])));
        // A class, not an inline background: the gold tint also needs a darker
        // label on top of it to stay readable, and that belongs in the stylesheet.
        if (counts[d] === max) cell.classList.add('top');
        grid.appendChild(cell);
      }
      block.appendChild(grid);
      host.appendChild(block);
    });

    var tally = SGStats.numberTally(draws, 'all');
    var top = tally.slice().sort(function (a, b) {
      return b.count - a.count || a.lastIndex - b.lastIndex;
    }).slice(0, 21);

    host.appendChild(el('h3', null, 'Most frequent numbers'));
    host.appendChild(el('p', 'muted-sm',
      'Out of 10,000 possible numbers, ' + tally.length + ' have appeared at least once in this window.'));
    var grid = el('div', 'statgrid');
    top.forEach(function (t) {
      var cell = el('div', 'statcell hot');
      cell.appendChild(el('div', 'n', t.number));
      cell.appendChild(el('div', 'c', t.count + '×'));
      grid.appendChild(cell);
    });
    host.appendChild(grid);

    host.appendChild(el('h3', null, 'Top prizes only'));
    var topTally = SGStats.numberTally(draws, 'top')
      .sort(function (a, b) { return b.count - a.count; })
      .filter(function (t) { return t.count > 1; })
      .slice(0, 14);
    if (!topTally.length) {
      host.appendChild(el('p', 'muted-sm',
        'No number has taken a 1st, 2nd or 3rd prize more than once in this window.'));
    } else {
      var g2 = el('div', 'statgrid');
      topTally.forEach(function (t) {
        var cell = el('div', 'statcell hot');
        cell.appendChild(el('div', 'n', t.number));
        cell.appendChild(el('div', 'c', t.count + '×'));
        g2.appendChild(cell);
      });
      host.appendChild(g2);
    }
  }

  /* ---------------- saved ---------------- */

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
    catch (e) { return []; }
  }

  function writeSaved(list) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function renderSaved() {
    var host = $('#saved-list');
    host.innerHTML = '';
    var list = readSaved();
    if (!list.length) {
      host.appendChild(el('p', 'empty', 'Nothing saved yet.'));
      return;
    }

    list.forEach(function (item, index) {
      var card = el('div', 'saved');
      var top = el('div', 'top');
      top.appendChild(el('div', 'nums', item.number));
      var del = el('button', 'del', '✕');
      del.addEventListener('click', function () {
        var current = readSaved();
        current.splice(index, 1);
        writeSaved(current);
        renderSaved();
      });
      top.appendChild(del);
      card.appendChild(top);

      // Checked at $1 Ordinary/Big, which is the plain reading of a saved
      // number. The Check tab is where entry types live.
      var draws = SGData.draws.slice(0, 60);
      var wins = 0, total = 0, latest = null;
      draws.forEach(function (d) {
        var r = SGCheck.checkFourD(item.number, 'ordinary', 'big', 1, d);
        if (!r.error && r.total > 0) {
          wins++; total += r.total;
          if (!latest) latest = { d: d, r: r };
        }
      });

      var status = el('div', 'status');
      if (wins) {
        status.className = 'status hit';
        status.textContent = wins + (wins === 1 ? ' win' : ' wins') + ' in the last ' +
          draws.length + ' draws — ' + money(total) + ' at $1 Big, most recently ' +
          prettyDate(latest.d.date) + ' (' + latest.r.lines[0].category + ').';
      } else {
        status.textContent = 'No win in the last ' + draws.length + ' draws.';
      }
      card.appendChild(status);
      host.appendChild(card);
    });
  }

  /* ---------------- wiring ---------------- */

  function selectChip(row, attr, value) {
    $$(row + ' .chip[' + attr + ']').forEach(function (c) {
      c.classList.toggle('selected', c.getAttribute(attr) === value);
    });
  }

  function wire() {
    $$('#tabbar .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var name = tab.getAttribute('data-view');
        $$('#tabbar .tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
        $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
        $('#views').scrollTop = 0;
        if (name === 'stats') renderStats();
        if (name === 'saved') renderSaved();
        Ads.interstitial();
      });
    });

    $('#draw-select').addEventListener('change', function (e) {
      ui.selectedDraw = parseInt(e.target.value, 10);
      renderResults();
    });

    $$('#fourd-type .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.fourdType = c.getAttribute('data-type');
        selectChip('#fourd-type', 'data-type', ui.fourdType);
        $('#fourd-entry-hint').classList.toggle('hidden', ui.fourdType !== 'roll');
        describeFourDEntry();
      });
    });
    $$('#fourd-size .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.fourdSize = c.getAttribute('data-size');
        selectChip('#fourd-size', 'data-size', ui.fourdSize);
        describeFourDEntry();
      });
    });

    $('#fourd-entry').addEventListener('input', describeFourDEntry);
    $('#fourd-stake').addEventListener('change', describeFourDEntry);
    $('#fourd-check-btn').addEventListener('click', runFourDCheck);

    $$('#stats-window .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.statsWindow = parseInt(c.getAttribute('data-window'), 10);
        selectChip('#stats-window', 'data-window', c.getAttribute('data-window'));
        renderStats();
      });
    });

    $('#save-fourd-btn').addEventListener('click', function () {
      var v = $('#save-fourd').value.trim();
      if (!/^\d{4}$/.test(v)) return;
      var list = readSaved();
      list.push({ number: v });
      writeSaved(list);
      $('#save-fourd').value = '';
      renderSaved();
    });

    var refresh = function () {
      var btn = $('#refresh-btn');
      btn.classList.add('spin');
      SGData.refresh().then(function () {
        btn.classList.remove('spin');
        renderStatus();
        renderDrawPicker();
        renderResults();
      });
    };
    $('#refresh-btn').addEventListener('click', refresh);
    $('#about-refresh').addEventListener('click', refresh);

    $('#disclaimer-ok').addEventListener('click', function () {
      $('#disclaimer').classList.add('hidden');
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    wire();

    var seen = false;
    try { seen = !!localStorage.getItem(SEEN_KEY); } catch (e) { /* ignore */ }
    if (!seen) $('#disclaimer').classList.remove('hidden');

    $('#build-note').textContent = 'Results by Singapore Pools · independent app';

    // Inside the app, data.js watches for tonight's draw and calls this the
    // moment it lands. Only move the user to the new draw if they are still
    // sitting on the latest one — if they have gone back to look at an older
    // draw, pulling the view out from under them would be worse than waiting.
    SGData.onLiveResult = function () {
      var previousNewest = SGData.draws[1] && SGData.draws[1].draw;
      var wasOnLatest = !ui.selectedDraw || ui.selectedDraw === previousNewest;
      renderStatus();
      if (wasOnLatest) ui.selectedDraw = SGData.draws[0].draw;
      renderDrawPicker();
      renderResults();
    };

    SGData.load().then(function () {
      renderStatus();
      renderDrawPicker();
      renderResults();
    }).catch(function (e) {
      $('#status-line').textContent = 'Could not load results';
      $('#status-line').classList.add('stale');
      if (window.console) console.error(e);
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* fine without it */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
