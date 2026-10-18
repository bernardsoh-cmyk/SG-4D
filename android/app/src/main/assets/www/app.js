/*
 * SG Lottery — UI for 4D, TOTO and Singapore Sweep.
 *
 * Five tabs over SGData: published results, a checker, statistics, saved
 * numbers, and the disclaimers. Each of the first three carries its own game
 * selector, kept independent on purpose — looking at TOTO results while
 * checking a 4D number is a normal thing to want.
 *
 * One rule runs through all of it: anything that might not be current is
 * labelled as such, and no money figure is shown that the rules do not fix.
 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var SAVED_KEY = 'sg4d.saved.v2';          // v2: items carry a game
  var SEEN_KEY = 'sg4d.disclaimer.v1';

  var ui = {
    game: 'fourd',
    checkGame: 'fourd',
    statsGame: 'fourd',
    statsWindow: 100,
    fourdType: 'ordinary',
    totoPicks: [],
    selected: {}                             // per game, so switching keeps place
  };

  /* ---------------- helpers ---------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function money(v) {
    return '$' + Number(v).toLocaleString('en-SG', { maximumFractionDigits: 2 });
  }

  /* Bet amounts always carry cents. money() suits prizes, where "$2,000" reads
   * better than "$2,000.00", but a stake of 1.5 rendering as "$1.5" does not
   * look like money at all. */
  function betMoney(v) {
    return '$' + Number(v).toLocaleString('en-SG',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function prettyDate(iso) {
    var p = iso.split('-');
    // Built as UTC so the label never shifts a day on a device outside SGT:
    // the date string is the authority here, not the local clock.
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return DAYS[d.getUTCDay()] + ', ' + (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
  }

  /** '2589838' -> '258 9838', the way it is printed on the ticket. */
  function sweepPretty(t) {
    t = String(t || '');
    return t.length === 7 ? t.slice(0, 3) + ' ' + t.slice(3) : t;
  }

  function draws(game) { return SGData.draws(game); }

  /* ---------------- header ---------------- */

  function renderStatus() {
    var s = SGData.state;
    var line = $('#status-line');
    line.classList.remove('stale', 'live');

    var behind = SGData.games.filter(function (g) { return SGData.isStale(g); });
    if (behind.length) {
      line.textContent = behind.map(SGData.label).join(' and ') +
        (behind.length > 1 ? ' results may be out' : ' result may be out');
      line.classList.add('stale');
    } else if (s.source === 'live' || s.source === 'feed') {
      line.textContent = 'All results up to date';
      line.classList.add('live');
    } else {
      line.textContent = SGData.games.map(function (g) {
        return draws(g).length + ' ' + SGData.label(g);
      }).join(' · ');
    }

    var feed = $('#about-feed');
    if (feed) {
      var bits = [SGData.games.map(function (g) {
        return draws(g).length + ' ' + SGData.label(g);
      }).join(', ') + ' draws stored.'];
      bits.push(SGData.feedConfigured ? 'Update feed configured.' : 'No update feed configured.');
      if (SGData.hasNative) bits.push('Live lookup available.');
      if (s.error) bits.push('Last update problem: ' + s.error);
      feed.textContent = bits.join(' ');
    }
  }

  function renderNextDraw() {
    var next = SGData.nextDraw(ui.game);
    var box = $('#next-draw');
    box.innerHTML = '';
    if (!next) return;
    box.appendChild(document.createTextNode('Next ' + SGData.label(ui.game) + ' draw '));
    var when = DAYS[next.getDay()] + ' ' + next.getDate() + ' ' + MONTHS[next.getMonth()] +
               ', ' + (next.getHours() % 12 || 12) + '.' + (next.getMinutes() < 10 ? '0' : '') +
               next.getMinutes() + 'pm';
    box.appendChild(el('b', null, when));
  }

  /* ---------------- results ---------------- */

  function selectedDraw(game) {
    var list = draws(game);
    var want = ui.selected[game];
    for (var i = 0; i < list.length; i++) if (list[i].draw === want) return list[i];
    return list[0] || null;
  }

  function renderDrawPicker() {
    var sel = $('#draw-select');
    var list = draws(ui.game);
    sel.innerHTML = '';
    list.forEach(function (d) {
      var o = el('option', null, prettyDate(d.date) + '  ·  Draw ' + d.draw);
      o.value = String(d.draw);
      sel.appendChild(o);
    });
    var cur = selectedDraw(ui.game);
    if (cur) { ui.selected[ui.game] = cur.draw; sel.value = String(cur.draw); }
  }

  function numberBlock(label, numbers, cls) {
    var wrap = el('div', 'numblock');
    wrap.appendChild(el('div', 'label', label));
    var grid = el('div', cls || 'numgrid');
    numbers.forEach(function (n) { grid.appendChild(el('span', null, n)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function resultHead(card, d) {
    var head = el('div', 'result-head');
    head.appendChild(el('div', 'result-date', prettyDate(d.date)));
    head.appendChild(el('div', 'result-draw', 'Draw ' + d.draw));
    card.appendChild(head);
  }

  function renderFourD(d, card) {
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
  }

  function renderToto(d, card) {
    var wrap = el('div', 'numblock');
    wrap.appendChild(el('div', 'label', 'Winning Numbers'));
    var balls = el('div', 'balls');
    d.numbers.forEach(function (n) { balls.appendChild(el('div', 'ball', String(n))); });
    balls.appendChild(el('div', 'ball-plus', '+'));
    balls.appendChild(el('div', 'ball add', String(d.additional)));
    wrap.appendChild(balls);
    card.appendChild(wrap);

    if (d.jackpot) {
      var jp = el('div', 'muted-sm jackpot-note',
        'Group 1 prize for this draw: ' + money(d.jackpot));
      card.appendChild(jp);
    }

    if ((d.groups || []).length) {
      var table = el('table', 'grouptable');
      var hr = el('tr');
      ['Prize Group', 'Share', 'Winners'].forEach(function (h, i) {
        hr.appendChild(el('th', i ? 'right' : null, h));
      });
      table.appendChild(hr);
      d.groups.forEach(function (g) {
        var tr = el('tr');
        var won = g.shares > 0;
        tr.appendChild(el('td', null, 'Group ' + g.group));
        tr.appendChild(el('td', 'right' + (won ? '' : ' nowin'),
          g.prize === null || g.prize === undefined ? '—' : money(g.prize)));
        tr.appendChild(el('td', 'right' + (won ? '' : ' nowin'),
          won ? g.shares.toLocaleString('en-SG') : '—'));
        table.appendChild(tr);
      });
      card.appendChild(table);
    }
  }

  function renderSweep(d, card) {
    var top = el('div', 'top3');
    [['1st Prize', d.first, ''], ['2nd Prize', d.second, 'second'], ['3rd Prize', d.third, 'third']]
      .forEach(function (p) {
        var box = el('div', 'prize ' + p[2]);
        box.appendChild(el('div', 'label', p[0]));
        box.appendChild(el('div', 'num sweep', sweepPretty(p[1]) || '—'));
        top.appendChild(box);
      });
    card.appendChild(top);

    (d.groups || []).forEach(function (g) {
      var isTwoD = g.label.indexOf('2D') !== -1;
      var heading = g.label + ' · ' + money(g.amount) + ' each';
      var nums = isTwoD ? g.numbers : g.numbers.map(sweepPretty);
      card.appendChild(numberBlock(heading, nums, isTwoD ? 'numgrid twod' : 'numgrid sweepgrid'));
    });
  }

  var RENDER = { fourd: renderFourD, toto: renderToto, sweep: renderSweep };

  function renderResults() {
    renderNextDraw();
    var host = $('#result-card');
    host.innerHTML = '';
    var d = selectedDraw(ui.game);

    if (!d) {
      host.appendChild(el('p', 'empty', 'No ' + SGData.label(ui.game) + ' results stored yet.'));
    } else {
      var card = el('div', 'result');
      resultHead(card, d);
      RENDER[ui.game](d, card);
      host.appendChild(card);
    }

    renderRecent();
    var oldest = draws(ui.game).slice(-1)[0];
    $('#source-note').textContent = oldest
      ? 'Results published by Singapore Pools. ' + SGData.label(ui.game) +
        ' history in this app goes back to ' + prettyDate(oldest.date) +
        '. Official results are whatever Singapore Pools publishes.'
      : '';
  }

  function recentSummary(game, d) {
    if (game === 'fourd') return d.first;
    if (game === 'toto') return d.numbers.join('  ') + '  +' + d.additional;
    return sweepPretty(d.first);
  }

  function renderRecent() {
    var host = $('#recent-list');
    host.innerHTML = '';
    draws(ui.game).slice(0, 20).forEach(function (d) {
      var row = el('div', 'recent');
      row.appendChild(el('div', 'when', prettyDate(d.date)));
      var what = el('div', 'what' + (ui.game === 'toto' ? ' small-balls' : ''));
      what.textContent = recentSummary(ui.game, d);
      row.appendChild(what);
      row.addEventListener('click', function () {
        ui.selected[ui.game] = d.draw;
        $('#draw-select').value = String(d.draw);
        renderResults();
        $('#views').scrollTop = 0;
      });
      host.appendChild(row);
    });
    $('#recent-sub').textContent = draws(ui.game).length + ' stored';
  }

  /* ---------------- check: 4D ---------------- */

  /** Whatever was typed into a bet field, as a non-negative number. */
  function betAmount(sel) {
    var v = parseFloat(String($(sel).value).replace(/[^\d.]/g, ''));
    return isFinite(v) && v > 0 ? v : 0;
  }

  function fourdBets() {
    return { big: betAmount('#fourd-big'), small: betAmount('#fourd-small') };
  }

  /** Amount is the total of the two, kept live as either is typed. */
  function renderAmount() {
    var b = fourdBets();
    $('#fourd-amount').textContent = betMoney(b.big + b.small);
  }

  function describeFourD() {
    renderAmount();
    var raw = $('#fourd-entry').value.trim().toUpperCase();
    var note = $('#fourd-entry-note');
    var bets = fourdBets();
    var stake = bets.big + bets.small;
    note.textContent = '';
    if (!raw) return;

    if (!stake) { note.textContent = 'Enter an amount for Big, Small, or both.'; return; }

    // Which sides were bought, for the cost sentences below.
    var sides = [];
    if (bets.big) sides.push(betMoney(bets.big) + ' Big');
    if (bets.small) sides.push(betMoney(bets.small) + ' Small');
    var sideText = sides.join(' + ');

    if (ui.fourdType === 'roll') {
      var nums = SGCheck.rollNumbers(raw);
      if (!nums) { note.textContent = 'A 4D Roll needs one rolling digit, e.g. 58R2.'; return; }
      note.textContent = 'Covers 10 numbers (' + nums[0] + '–' + nums[9] + '), ' + sideText +
        ' on each. Costs ' + betMoney(10 * stake) + '.';
      return;
    }
    if (!/^\d{4}$/.test(raw)) { note.textContent = 'Enter a 4-digit number from 0000 to 9999.'; return; }

    var pattern = SGCheck.digitPattern(raw);
    var perms = SGCheck.permutationCount(raw);
    var label = {
      allDifferent: 'four different digits', onePair: 'one repeated digit',
      twoPairs: 'two pairs', threeSame: 'three of a kind', allSame: 'four identical digits'
    }[pattern];

    if (ui.fourdType === 'system') {
      if (pattern === 'allSame') {
        note.textContent = 'A number with four identical digits has only one permutation, so it cannot be a System Entry.';
        return;
      }
      note.textContent = 'Covers all ' + perms + ' permutations (' + label + '), ' + sideText +
        ' on each. Costs ' + betMoney(perms * stake) + ', and each pays the full fixed prize.';
    } else if (ui.fourdType === 'ibet') {
      if (pattern === 'allSame') {
        note.textContent = 'A number with four identical digits has only one permutation, so it cannot be an iBet.';
        return;
      }
      note.textContent = 'Covers all ' + perms + ' permutations (' + label + ') for ' + sideText +
        '. Prizes are correspondingly smaller — that is the trade.';
    } else {
      note.textContent = 'One number, exact order. ' + label.charAt(0).toUpperCase() + label.slice(1) +
        (bets.big && bets.small ? '. Big and Small both collect where they apply.' : '.');
    }
  }

  function summaryCard(out, won, headline, sub) {
    var box = el('div', 'win-summary' + (won ? ' won' : ''));
    box.appendChild(el('div', 'headline', headline));
    if (sub) box.appendChild(el('div', 'sub', sub));
    out.appendChild(box);
  }

  function hitRow(out, dateLabel, amountText, amountCls, detail) {
    var row = el('div', 'hitrow');
    var top = el('div', 'top');
    top.appendChild(el('div', 'date', dateLabel));
    top.appendChild(el('div', 'amt' + (amountCls ? ' ' + amountCls : ''), amountText));
    row.appendChild(top);
    if (detail) row.appendChild(el('div', 'detail', detail));
    out.appendChild(row);
  }

  function runFourDCheck() {
    var raw = $('#fourd-entry').value.trim().toUpperCase();
    var bets = fourdBets();
    var out = $('#fourd-check-out');
    out.innerHTML = '';
    if (!raw) return;

    var list = draws('fourd').slice(0, 30);
    var hits = [], total = 0, error = null;
    list.forEach(function (d) {
      var r = SGCheck.checkFourDBet(raw, ui.fourdType, bets.big, bets.small, d);
      if (r.error) { error = r.error; return; }
      if (r.total > 0) { hits.push({ draw: d, result: r }); total += r.total; }
    });

    if (error) { summaryCard(out, false, 'Check that entry', error); return; }

    var sides = [];
    if (bets.big) sides.push(betMoney(bets.big) + ' Big');
    if (bets.small) sides.push(betMoney(bets.small) + ' Small');

    summaryCard(out, hits.length,
      hits.length ? money(total) + ' across ' + hits.length + (hits.length === 1 ? ' draw' : ' draws')
                  : 'No wins in the last ' + list.length + ' draws',
      raw + ' · ' + ui.fourdType + ' · ' + sides.join(' + ') +
      ' per number, checked against the last ' + list.length + ' draws held in this app.');

    hits.forEach(function (h) {
      hitRow(out, prettyDate(h.draw.date) + ' · Draw ' + h.draw.draw, money(h.result.total), '',
        h.result.lines.map(function (l) {
          // Name the side only when both were bought, otherwise it is noise.
          var side = (bets.big && bets.small) ? l.size + ' ' : '';
          return side + l.category + (l.count > 1 ? ' ×' + l.count : '') + ' — ' + money(l.amount);
        }).join(' · '));
    });
  }

  /* ---------------- check: TOTO ---------------- */

  function buildTotoGrid() {
    var grid = $('#toto-grid');
    grid.innerHTML = '';
    for (var n = 1; n <= 49; n++) {
      (function (n) {
        var b = el('button', null, String(n));
        b.addEventListener('click', function () {
          var at = ui.totoPicks.indexOf(n);
          if (at !== -1) ui.totoPicks.splice(at, 1);
          else if (ui.totoPicks.length < 12) ui.totoPicks.push(n);
          renderTotoPicks();
        });
        grid.appendChild(b);
      })(n);
    }
  }

  function renderTotoPicks() {
    $$('#toto-grid button').forEach(function (b) {
      b.classList.toggle('picked', ui.totoPicks.indexOf(parseInt(b.textContent, 10)) !== -1);
    });
    var count = ui.totoPicks.length;
    $('#toto-pick-count').textContent = count + ' of 6' + (count > 6 ? ' (System ' + count + ')' : '');
    var note = $('#toto-entry-note');
    if (count < 6) note.textContent = 'Pick ' + (6 - count) + ' more.';
    else if (count === 6) note.textContent = 'Ordinary Entry — one set of six.';
    else {
      note.textContent = 'System ' + count + ' — ' +
        SGCheck.combinations(ui.totoPicks, 6).length +
        ' separate sets of six, each checked on its own.';
    }
  }

  function runTotoCheck() {
    var out = $('#toto-check-out');
    out.innerHTML = '';
    if (ui.totoPicks.length < 6) return;

    var list = draws('toto').slice(0, 30);
    var hits = [], exact = 0, anyUnknown = false;
    list.forEach(function (d) {
      var r = SGCheck.checkToto(ui.totoPicks, d);
      if (r.error || !r.lines.length) return;
      hits.push({ draw: d, result: r });
      exact += r.total;
      if (r.totalIsPartial) anyUnknown = true;
    });

    if (!hits.length) {
      summaryCard(out, false, 'No prizes in the last ' + list.length + ' draws',
        'A TOTO prize needs at least three of the six winning numbers.');
      return;
    }

    // Lead with the prize, not the arithmetic. When every prize won is a pool
    // share the exact total is legitimately $0, and "$0" is the wrong thing to
    // tell someone who just matched all six.
    var best = 8;
    hits.forEach(function (h) {
      h.result.lines.forEach(function (l) { if (l.group < best) best = l.group; });
    });
    var word = hits.length === 1 ? ' draw' : ' draws';
    var headline;
    if (exact > 0 && !anyUnknown) headline = money(exact) + ' across ' + hits.length + word;
    else if (exact > 0) headline = money(exact) + ' plus pool shares, across ' + hits.length + word;
    else headline = (SGCheck.TOTO_GROUP_LABEL[best] || ('Group ' + best)) + ' — a share of the prize pool';

    summaryCard(out, true, headline,
      ui.totoPicks.join(', ') + ' — checked against the last ' + list.length + ' draws. ' +
      (anyUnknown ? 'Groups 1 to 4 are a share of that draw’s pool, so where the published share is not stored the amount is left open rather than estimated.' : ''));

    hits.forEach(function (h) {
      var known = h.result.total > 0;
      hitRow(out, prettyDate(h.draw.date) + ' · Draw ' + h.draw.draw,
        known ? money(h.result.total) : 'pool share', known ? '' : 'unknown',
        h.result.lines.map(function (l) {
          return l.label + ' (' + l.rule + ')' + (l.shares > 1 ? ' ×' + l.shares : '') +
                 ' — ' + (l.amount !== null ? money(l.amount) : l.note);
        }).join(' · '));
    });
  }

  /* ---------------- check: Sweep ---------------- */

  function describeSweep() {
    var t = SGCheck.sweepTicket($('#sweep-entry').value);
    var note = $('#sweep-entry-note');
    if (!t) { note.textContent = ''; return; }
    note.textContent = t.length === 7
      ? 'Ticket ' + sweepPretty(t) + '. Checked against every stored draw, including the last two digits for 2D Delight.'
      : 'A Singapore Sweep ticket number has 7 digits — you have ' + t.length + '.';
  }

  function runSweepCheck() {
    var out = $('#sweep-check-out');
    out.innerHTML = '';
    var raw = $('#sweep-entry').value.trim();
    if (!raw) return;

    var list = draws('sweep');
    var hits = [], total = 0, error = null, anyUnknown = false;
    list.forEach(function (d) {
      var r = SGCheck.checkSweep(raw, d);
      if (r.error) { error = r.error; return; }
      if (!r.lines.length) return;
      hits.push({ draw: d, result: r });
      total += r.total;
      if (r.lines.some(function (l) { return l.amount === null; })) anyUnknown = true;
    });

    if (error) { summaryCard(out, false, 'Check that ticket', error); return; }

    summaryCard(out, hits.length,
      hits.length
        ? (total > 0 ? money(total) : 'A top prize') +
          (anyUnknown && total > 0 ? ' plus a top prize' : '') +
          ' across ' + hits.length + (hits.length === 1 ? ' draw' : ' draws')
        : 'No prizes in ' + list.length + ' stored draws',
      sweepPretty(SGCheck.sweepTicket(raw)) + ' — checked against every Singapore Sweep draw in this app.');

    hits.forEach(function (h) {
      var known = h.result.total > 0;
      hitRow(out, prettyDate(h.draw.date) + ' · Draw ' + h.draw.draw,
        known ? money(h.result.total) : 'see Pools', known ? '' : 'unknown',
        h.result.lines.map(function (l) {
          return l.label + (l.amount !== null ? ' — ' + money(l.amount) : ' — ' + l.note);
        }).join(' · '));
    });
  }

  /* ---------------- stats ---------------- */

  function windowed(list) { return ui.statsWindow ? list.slice(0, ui.statsWindow) : list; }

  function bars(host, rows, maxValue, labelFn, valueFn) {
    var wrap = el('div', 'bars');
    rows.forEach(function (r) {
      var bar = el('div', 'bar');
      bar.appendChild(el('div', null, labelFn(r)));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = Math.round(100 * valueFn(r) / Math.max(maxValue, 1)) + '%';
      track.appendChild(fill);
      bar.appendChild(track);
      bar.appendChild(el('div', 'v', String(valueFn(r))));
      wrap.appendChild(bar);
    });
    host.appendChild(wrap);
  }

  function statsFourD(host) {
    var list = windowed(draws('fourd'));
    if (!list.length) { host.appendChild(el('p', 'empty', 'No draws stored.')); return; }

    var freq = SGStats.digitFrequency(list, 'all');
    host.appendChild(el('h3', null, 'Digit frequency by position'));
    host.appendChild(el('p', 'muted-sm',
      'Across all 23 numbers drawn each time (3 prizes, 10 starters, 10 consolations) over ' +
      list.length + ' draws. Expected per cell: ' + freq.expectedPerPosition.toFixed(0) + '.'));

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
        if (counts[d] === max) cell.classList.add('top');
        grid.appendChild(cell);
      }
      block.appendChild(grid);
      host.appendChild(block);
    });

    var tally = SGStats.numberTally(list, 'all');
    host.appendChild(el('h3', null, 'Most frequent numbers'));
    host.appendChild(el('p', 'muted-sm',
      'Out of 10,000 possible numbers, ' + tally.length + ' have appeared at least once in this window.'));
    var grid = el('div', 'statgrid');
    tally.slice().sort(function (a, b) { return b.count - a.count || a.lastIndex - b.lastIndex; })
      .slice(0, 21).forEach(function (t) {
        var cell = el('div', 'statcell hot');
        cell.appendChild(el('div', 'n', t.number));
        cell.appendChild(el('div', 'c', t.count + '×'));
        grid.appendChild(cell);
      });
    host.appendChild(grid);
  }

  function statsToto(host) {
    var list = windowed(draws('toto'));
    if (!list.length) { host.appendChild(el('p', 'empty', 'No draws stored.')); return; }

    var freq = SGStats.ballFrequency(list, false);
    host.appendChild(el('h3', null, 'Ball frequency'));
    host.appendChild(el('p', 'muted-sm',
      'Over ' + list.length + ' draws each ball should appear about ' + freq.expected.toFixed(1) +
      ' times. The highlighted ten are the most drawn — note how close they are to expected.'));

    var sorted = freq.balls.slice().sort(function (a, b) { return b.count - a.count; });
    var hot = {};
    sorted.slice(0, 10).forEach(function (b) { hot[b.number] = true; });

    var grid = el('div', 'statgrid');
    freq.balls.forEach(function (b) {
      var cell = el('div', 'statcell' + (hot[b.number] ? ' hot' : ''));
      cell.appendChild(el('div', 'n', String(b.number)));
      cell.appendChild(el('div', 'c', b.count + '×'));
      grid.appendChild(cell);
    });
    host.appendChild(grid);

    host.appendChild(el('h3', null, 'Longest without appearing'));
    var stale = freq.balls.filter(function (b) { return b.drawsSince !== null; })
      .sort(function (a, b) { return b.drawsSince - a.drawsSince; }).slice(0, 8);
    bars(host, stale, stale.length ? stale[0].drawsSince : 1,
      function (b) { return 'No. ' + b.number; }, function (b) { return b.drawsSince; });

    var shape = SGStats.shapeStats(list);
    host.appendChild(el('h3', null, 'Shape of the winning sets'));
    host.appendChild(el('p', 'muted-sm',
      'Sum of the six numbers ranged ' + shape.sumMin + ' to ' + shape.sumMax +
      ', median ' + shape.sumMedian + '.'));
    var oddRows = [];
    shape.oddSplit.forEach(function (c, odd) { if (c) oddRows.push({ odd: odd, count: c }); });
    bars(host, oddRows, Math.max.apply(null, shape.oddSplit),
      function (r) { return r.odd + ' odd'; }, function (r) { return r.count; });

    host.appendChild(el('h3', null, 'How often each group was won'));
    var table = el('table', 'grouptable');
    var hr = el('tr');
    ['Group', 'Draws won', 'Biggest share'].forEach(function (h, i) {
      hr.appendChild(el('th', i ? 'right' : null, h));
    });
    table.appendChild(hr);
    SGStats.groupHistory(list).forEach(function (g) {
      var tr = el('tr');
      tr.appendChild(el('td', null, 'Group ' + g.group + ' (' + SGCheck.TOTO_GROUP_RULE[g.group] + ')'));
      tr.appendChild(el('td', 'right', g.drawsWon + ' of ' + list.length));
      tr.appendChild(el('td', 'right', g.biggestShare === null ? '—' : money(g.biggestShare)));
      table.appendChild(tr);
    });
    host.appendChild(table);
  }

  function renderStats() {
    var host = $('#stats-body');
    host.innerHTML = '';
    if (ui.statsGame === 'toto') statsToto(host); else statsFourD(host);
  }

  /* ---------------- saved ---------------- */

  function readSaved() {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
    catch (e) { return []; }
  }
  function writeSaved(list) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function savedStatus(item) {
    if (item.game === 'fourd') {
      var list = draws('fourd').slice(0, 60);
      var wins = 0, total = 0, latest = null;
      list.forEach(function (d) {
        var r = SGCheck.checkFourD(item.number, 'ordinary', 'big', 1, d);
        if (!r.error && r.total > 0) { wins++; total += r.total; if (!latest) latest = { d: d, r: r }; }
      });
      return wins
        ? { hit: true, text: wins + (wins === 1 ? ' win' : ' wins') + ' in the last ' + list.length +
            ' draws — ' + money(total) + ' at $1 Big, most recently ' + prettyDate(latest.d.date) +
            ' (' + latest.r.lines[0].category + ').' }
        : { hit: false, text: 'No win in the last ' + list.length + ' draws.' };
    }
    if (item.game === 'toto') {
      var tl = draws('toto').slice(0, 60), count = 0, best = null;
      tl.forEach(function (d) {
        var r = SGCheck.checkToto(item.picks, d);
        if (r.error || !r.lines.length) return;
        count++;
        if (!best || r.lines[0].group < best.line.group) best = { line: r.lines[0], draw: d };
      });
      return count
        ? { hit: true, text: count + (count === 1 ? ' prize' : ' prizes') + ' in the last ' + tl.length +
            ' draws — best was ' + best.line.label + ' on ' + prettyDate(best.draw.date) + '.' }
        : { hit: false, text: 'No prize in the last ' + tl.length + ' draws.' };
    }
    var sl = draws('sweep'), sCount = 0, sTotal = 0, sLatest = null;
    sl.forEach(function (d) {
      var r = SGCheck.checkSweep(item.ticket, d);
      if (r.error || !r.lines.length) return;
      sCount++; sTotal += r.total;
      if (!sLatest) sLatest = { d: d, r: r };
    });
    return sCount
      ? { hit: true, text: sCount + (sCount === 1 ? ' prize' : ' prizes') + ' in ' + sl.length +
          ' stored draws — ' + (sTotal > 0 ? money(sTotal) : 'a top prize') + ', most recently ' +
          prettyDate(sLatest.d.date) + '.' }
      : { hit: false, text: 'No prize in ' + sl.length + ' stored draws.' };
  }

  function savedLabel(item) {
    if (item.game === 'fourd') return item.number;
    if (item.game === 'toto') return item.picks.join('  ');
    return sweepPretty(item.ticket);
  }

  function renderSaved() {
    var host = $('#saved-list');
    host.innerHTML = '';
    var list = readSaved();
    if (!list.length) { host.appendChild(el('p', 'empty', 'Nothing saved yet.')); return; }

    list.forEach(function (item, index) {
      var card = el('div', 'saved');
      var top = el('div', 'top');
      var nums = el('div', 'nums' + (item.game === 'fourd' ? '' : ' set'), savedLabel(item));
      top.appendChild(nums);
      var tag = el('span', 'gametag', SGData.label(item.game));
      nums.appendChild(tag);
      var del = el('button', 'del', '✕');
      del.setAttribute('aria-label', 'Remove ' + savedLabel(item));
      del.addEventListener('click', function () {
        var cur = readSaved();
        cur.splice(index, 1);
        writeSaved(cur);
        renderSaved();
      });
      top.appendChild(del);
      card.appendChild(top);

      var s = savedStatus(item);
      var status = el('div', 'status' + (s.hit ? ' hit' : ''), s.text);
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

  function showCheckPane() {
    ['fourd', 'toto', 'sweep'].forEach(function (g) {
      $('#pane-' + g).classList.toggle('hidden', ui.checkGame !== g);
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

    $$('#results-game .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.game = c.getAttribute('data-game');
        selectChip('#results-game', 'data-game', ui.game);
        renderDrawPicker();
        renderResults();
        $('#views').scrollTop = 0;
      });
    });

    $('#draw-select').addEventListener('change', function (e) {
      ui.selected[ui.game] = parseInt(e.target.value, 10);
      renderResults();
    });

    $$('#check-game .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.checkGame = c.getAttribute('data-checkgame');
        selectChip('#check-game', 'data-checkgame', ui.checkGame);
        showCheckPane();
      });
    });

    $$('#stats-game .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.statsGame = c.getAttribute('data-statsgame');
        selectChip('#stats-game', 'data-statsgame', ui.statsGame);
        renderStats();
      });
    });

    $$('#fourd-type .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        ui.fourdType = c.getAttribute('data-type');
        selectChip('#fourd-type', 'data-type', ui.fourdType);
        $('#fourd-entry-hint').classList.toggle('hidden', ui.fourdType !== 'roll');
        describeFourD();
      });
    });
    $('#fourd-entry').addEventListener('input', describeFourD);
    ['#fourd-big', '#fourd-small'].forEach(function (sel) {
      $(sel).addEventListener('input', describeFourD);
      // Normalise on the way out rather than while typing, so "1." or an empty
      // field is not rewritten under the cursor mid-entry.
      $(sel).addEventListener('blur', function () {
        var v = betAmount(sel);
        $(sel).value = v ? String(v) : '0';
        renderAmount();
      });
    });
    $('#fourd-check-btn').addEventListener('click', runFourDCheck);

    $('#toto-clear').addEventListener('click', function () {
      ui.totoPicks = [];
      renderTotoPicks();
      $('#toto-check-out').innerHTML = '';
    });
    $('#toto-quickpick').addEventListener('click', function () {
      ui.totoPicks = SGStats.randomToto(6);
      renderTotoPicks();
    });
    $('#toto-check-btn').addEventListener('click', runTotoCheck);

    $('#sweep-entry').addEventListener('input', describeSweep);
    $('#sweep-check-btn').addEventListener('click', runSweepCheck);

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
      var list = readSaved(); list.push({ game: 'fourd', number: v }); writeSaved(list);
      $('#save-fourd').value = '';
      renderSaved();
    });
    $('#save-toto-btn').addEventListener('click', function () {
      var picks = ($('#save-toto').value.match(/\d+/g) || []).map(Number)
        .filter(function (n) { return n >= 1 && n <= 49; });
      var uniq = picks.filter(function (n, i) { return picks.indexOf(n) === i; });
      if (uniq.length < 6) return;
      var list = readSaved();
      list.push({ game: 'toto', picks: uniq.slice(0, 12).sort(function (a, b) { return a - b; }) });
      writeSaved(list);
      $('#save-toto').value = '';
      renderSaved();
    });
    $('#save-sweep-btn').addEventListener('click', function () {
      var t = SGCheck.sweepTicket($('#save-sweep').value);
      if (t.length !== 7) return;
      var list = readSaved(); list.push({ game: 'sweep', ticket: t }); writeSaved(list);
      $('#save-sweep').value = '';
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
    buildTotoGrid();
    renderTotoPicks();
    renderAmount();
    showCheckPane();
    wire();

    var seen = false;
    try { seen = !!localStorage.getItem(SEEN_KEY); } catch (e) { /* ignore */ }
    if (!seen) $('#disclaimer').classList.remove('hidden');

    $('#build-note').textContent = 'Results by Singapore Pools · independent app';

    // Inside the app, data.js watches for a due draw and calls this the moment
    // it lands. Only move the user onto the new draw if they are still sitting
    // on the latest one for that game — if they have gone back to an older
    // draw, pulling the view out from under them would be worse than waiting.
    SGData.onLiveResult = function () {
      var list = draws(ui.game);
      var previousNewest = list[1] && list[1].draw;
      var wasOnLatest = !ui.selected[ui.game] || ui.selected[ui.game] === previousNewest;
      renderStatus();
      if (wasOnLatest && list[0]) ui.selected[ui.game] = list[0].draw;
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
