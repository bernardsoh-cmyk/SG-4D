/*
 * SG 4D — prize matching.
 *
 * Every number in here is transcribed from Singapore Pools' own published 4D
 * Game Rules (cl. 4.5), not from memory and not inferred from results pages.
 *
 * 4D pays FIXED amounts per $1 stake, so unlike a pari-mutuel game a win can be
 * computed exactly from the winning numbers alone. That is what makes this
 * checker worth having: the figures it shows are the real figures, not
 * estimates.
 */
window.SGCheck = (function () {
  'use strict';

  /* 4D Game Rules cl. 4.5 — Ordinary, 4D Roll and System Entry, per $1 stake. */
  var FOURD_FIXED = {
    big:   { first: 2000, second: 1000, third: 490, starter: 250, consolation: 60 },
    small: { first: 3000, second: 2000, third: 800, starter: 0,   consolation: 0 }
  };

  /* iBet pays less, and how much less depends on how many permutations the
   * number has — which is why this is a matrix and not a division. Columns are
   * the four digit patterns named in the rules. */
  var IBET_PATTERNS = ['allDifferent', 'onePair', 'twoPairs', 'threeSame'];
  var FOURD_IBET = {
    big: {
      first:       [83, 166, 335, 500],
      second:      [41,  83, 168, 250],
      third:       [20,  40,  85, 127],
      starter:     [10,  20,  41,  62],
      consolation: [ 3,   6,  10,  15]
    },
    small: {
      first:  [125, 250, 500, 750],
      second: [ 83, 167, 333, 500],
      third:  [ 33,  66, 133, 200],
      starter: [0, 0, 0, 0],
      consolation: [0, 0, 0, 0]
    }
  };

  var CATEGORIES = ['first', 'second', 'third', 'starter', 'consolation'];
  var CATEGORY_LABEL = {
    first: '1st Prize', second: '2nd Prize', third: '3rd Prize',
    starter: 'Starter', consolation: 'Consolation'
  };

  /** 'allDifferent' | 'onePair' | 'twoPairs' | 'threeSame' | 'allSame'. */
  function digitPattern(num) {
    var counts = {};
    String(num).split('').forEach(function (d) { counts[d] = (counts[d] || 0) + 1; });
    var shape = Object.keys(counts).map(function (k) { return counts[k]; })
                      .sort(function (a, b) { return b - a; }).join('');
    if (shape === '1111') return 'allDifferent';
    if (shape === '211') return 'onePair';
    if (shape === '22') return 'twoPairs';
    if (shape === '31') return 'threeSame';
    return 'allSame';
  }

  /** Distinct permutations of a 4-digit number: 24 / 12 / 6 / 4 / 1. */
  function permutationCount(num) {
    return { allDifferent: 24, onePair: 12, twoPairs: 6, threeSame: 4, allSame: 1 }[digitPattern(num)];
  }

  /** Every distinct arrangement of a 4-digit number, as zero-padded strings. */
  function permutations(num) {
    var digits = String(num).split('');
    var seen = {};
    (function recurse(prefix, rest) {
      if (!rest.length) { seen[prefix] = true; return; }
      for (var i = 0; i < rest.length; i++) {
        recurse(prefix + rest[i], rest.slice(0, i).concat(rest.slice(i + 1)));
      }
    })('', digits);
    return Object.keys(seen);
  }

  /** The ten numbers a 4D Roll covers, e.g. '58R2' or '58x2' -> 5802..5892. */
  function rollNumbers(pattern) {
    var s = String(pattern).toUpperCase();
    // Exactly one rolling slot; the other three must be digits.
    if (!/^[\dRX?]{4}$/.test(s) || (s.match(/[RX?]/g) || []).length !== 1) return null;
    var slot = s.search(/[RX?]/);
    var out = [];
    for (var d = 0; d <= 9; d++) out.push(s.slice(0, slot) + d + s.slice(slot + 1));
    return out;
  }

  /** Which prize categories `number` hits in `draw`, with how many hits each. */
  function hitsIn(number, draw) {
    var n = String(number);
    var hits = {};
    if (draw.first === n) hits.first = 1;
    if (draw.second === n) hits.second = 1;
    if (draw.third === n) hits.third = 1;
    var starter = (draw.starter || []).filter(function (x) { return x === n; }).length;
    var consol = (draw.consolation || []).filter(function (x) { return x === n; }).length;
    if (starter) hits.starter = starter;
    if (consol) hits.consolation = consol;
    return hits;
  }

  /**
   * Check one 4D bet against one draw.
   *
   *   entry  '1234', or '12R4' / '12x4' for a Roll
   *   type   'ordinary' | 'ibet' | 'system' | 'roll'
   *   size   'big' | 'small'
   *   stake  dollars per number (the unit stake, as printed on a ticket)
   *
   * Returns { total, unitsStaked, lines: [...] }. `lines` is one row per prize
   * actually hit, ready to render. Rule 4.6: a number that hits more than one
   * category collects all of them, so these add rather than replace.
   */
  function checkFourD(entry, type, size, stake, draw) {
    stake = stake || 1;
    var table = FOURD_FIXED[size];
    var ibet = FOURD_IBET[size];
    var lines = [];
    var total = 0;

    // Which numbers does this entry actually cover, and what does each cost?
    var numbers;
    if (type === 'roll') {
      numbers = rollNumbers(entry);
      if (!numbers) return { error: 'A 4D Roll needs one rolling digit, e.g. 58R2.' };
    } else if (type === 'system') {
      if (!/^\d{4}$/.test(String(entry))) return { error: 'Enter a 4-digit number from 0000 to 9999.' };
      if (digitPattern(entry) === 'allSame') {
        return { error: 'A number with four identical digits has only one permutation, so it cannot be a System Entry.' };
      }
      numbers = permutations(entry);
    } else {
      if (!/^\d{4}$/.test(String(entry))) return { error: 'Enter a 4-digit number from 0000 to 9999.' };
      numbers = [String(entry)];
    }

    if (type === 'ibet') {
      // One stake spread across every permutation, paying the iBet matrix.
      var pattern = digitPattern(entry);
      if (pattern === 'allSame') {
        return { error: 'A number with four identical digits has only one permutation, so it cannot be an iBet.' };
      }
      var col = IBET_PATTERNS.indexOf(pattern);
      var perms = permutations(entry);
      CATEGORIES.forEach(function (cat) {
        var count = perms.reduce(function (acc, p) { return acc + (hitsIn(p, draw)[cat] || 0); }, 0);
        if (!count) return;
        var per = ibet[cat][col] * stake;
        if (!per) return;                       // Small has no Starter/Consolation
        total += per * count;
        lines.push({
          category: CATEGORY_LABEL[cat], count: count,
          per: per, amount: per * count
        });
      });
      return {
        total: total, unitsStaked: 1, stake: stake,
        pattern: pattern, permutations: perms.length, lines: lines
      };
    }

    // Ordinary / Roll / System: every covered number is a full unit stake at
    // the fixed table, which is also why they cost more to place.
    CATEGORIES.forEach(function (cat) {
      var count = numbers.reduce(function (acc, n) { return acc + (hitsIn(n, draw)[cat] || 0); }, 0);
      if (!count) return;
      var per = table[cat] * stake;
      if (!per) return;
      total += per * count;
      lines.push({
        category: CATEGORY_LABEL[cat], count: count,
        per: per, amount: per * count
      });
    });

    return {
      total: total,
      unitsStaked: numbers.length,
      stake: stake,
      cost: numbers.length * stake,
      numbers: numbers,
      lines: lines
    };
  }

  /**
   * Check a 4D ticket carrying a Big amount, a Small amount, or both.
   *
   * Big and Small are not alternatives. A slip has an amount against each, and
   * rule 4.5 prices them as separate structures — Big pays across all five
   * categories, Small pays more on the top three and nothing on Starter or
   * Consolation. A ticket with both collects on both, so this scores each side
   * at its own amount and adds them.
   *
   * Either amount may be zero, which simply means that side was not bought.
   */
  function checkFourDBet(entry, type, bigAmount, smallAmount, draw) {
    var big = Number(bigAmount) || 0;
    var small = Number(smallAmount) || 0;
    if (big <= 0 && small <= 0) {
      return { error: 'Enter an amount for Big, Small, or both.' };
    }

    var lines = [], total = 0, cost = 0, units = 0, error = null, meta = null;

    [['big', big], ['small', small]].forEach(function (side) {
      if (side[1] <= 0) return;
      var r = checkFourD(entry, type, side[0], side[1], draw);
      if (r.error) { error = r.error; return; }
      meta = meta || r;
      total += r.total;
      cost += (r.cost !== undefined ? r.cost : side[1]);
      units = Math.max(units, r.unitsStaked || 1);
      r.lines.forEach(function (l) {
        lines.push({
          category: l.category, count: l.count, per: l.per, amount: l.amount,
          size: side[0] === 'big' ? 'Big' : 'Small'
        });
      });
    });

    if (error) return { error: error };

    // Highest-value prizes first, so the headline row of a win is the one that
    // matters rather than whichever side happened to be scored first.
    lines.sort(function (a, b) { return b.amount - a.amount; });

    return {
      total: total, cost: cost, unitsStaked: units, lines: lines,
      big: big, small: small,
      pattern: meta && meta.pattern, permutations: meta && meta.permutations,
      numbers: meta && meta.numbers
    };
  }

  /* =============================== TOTO ===============================
   *
   * TOTO Game Rules cl. 5.5. Unlike 4D, this is not a fixed-prize game:
   * Groups 1-4 are a share of that draw's prize pool, so the amount does not
   * exist until the draw is over and Singapore Pools publishes the share.
   * Only Groups 5, 6 and 7 are fixed. The checker reports an exact figure for
   * 5-7, the published share for 1-4 where the draw carries it, and null
   * where it does not. It never estimates a jackpot. */

  var TOTO_FIXED = { 5: 50, 6: 25, 7: 10 };
  var TOTO_GROUP_LABEL = {
    1: 'Group 1 (Jackpot)', 2: 'Group 2', 3: 'Group 3', 4: 'Group 4',
    5: 'Group 5', 6: 'Group 6', 7: 'Group 7'
  };
  var TOTO_GROUP_RULE = {
    1: '6 numbers', 2: '5 + additional', 3: '5 numbers', 4: '4 + additional',
    5: '4 numbers', 6: '3 + additional', 7: '3 numbers'
  };

  /** Prize group for one set of six, or 0 for none. Rule 5.9: highest only. */
  function totoGroup(set, winning, additional) {
    var matched = set.filter(function (n) { return winning.indexOf(n) !== -1; }).length;
    var bonus = set.indexOf(additional) !== -1;
    if (matched === 6) return 1;
    if (matched === 5) return bonus ? 2 : 3;
    if (matched === 4) return bonus ? 4 : 5;
    if (matched === 3) return bonus ? 6 : 7;
    return 0;
  }

  function combinations(arr, k) {
    var out = [];
    (function pick(start, acc) {
      if (acc.length === k) { out.push(acc.slice()); return; }
      for (var i = start; i < arr.length; i++) { acc.push(arr[i]); pick(i + 1, acc); acc.pop(); }
    })(0, []);
    return out;
  }

  /**
   * Check a TOTO entry against one draw.
   *
   *   picks  6-12 distinct numbers from 1-49. Seven or more is a System
   *          Entry, which the rules treat as every C(n,6) subset (cl. 5.8),
   *          each scored on its own.
   */
  function checkToto(picks, draw) {
    var clean = [];
    (picks || []).forEach(function (n) {
      n = parseInt(n, 10);
      if (n >= 1 && n <= 49 && clean.indexOf(n) === -1) clean.push(n);
    });
    if (clean.length < 6) return { error: 'Pick at least 6 different numbers from 1 to 49.' };
    if (clean.length > 12) return { error: 'A System Entry goes up to 12 numbers.' };

    clean.sort(function (a, b) { return a - b; });
    var sets = combinations(clean, 6);
    var counts = {};
    sets.forEach(function (set) {
      var g = totoGroup(set, draw.numbers, draw.additional);
      if (g) counts[g] = (counts[g] || 0) + 1;
    });

    var published = {};
    (draw.groups || []).forEach(function (g) { published[g.group] = g; });

    var lines = [], exact = 0, hasUnknown = false;
    Object.keys(counts).map(Number).sort(function (a, b) { return a - b; }).forEach(function (g) {
      var shares = counts[g];
      var line = {
        group: g, label: TOTO_GROUP_LABEL[g], rule: TOTO_GROUP_RULE[g],
        shares: shares, amount: null, fixed: false, note: ''
      };
      if (TOTO_FIXED[g]) {
        line.fixed = true;
        line.amount = TOTO_FIXED[g] * shares;
        exact += line.amount;
      } else if (published[g] && published[g].prize !== null && published[g].prize !== undefined) {
        line.amount = published[g].prize * shares;
        exact += line.amount;
        line.note = 'share published for this draw';
      } else {
        hasUnknown = true;
        line.note = 'a share of the prize pool — amount set after the draw';
      }
      lines.push(line);
    });

    return {
      sets: sets.length,
      system: clean.length > 6 ? ('System ' + clean.length) : 'Ordinary',
      lines: lines, total: exact, totalIsPartial: hasUnknown, picks: clean
    };
  }

  /* ============================ SINGAPORE SWEEP ============================
   *
   * The simplest of the three: a ticket either appears in a prize list or it
   * does not. Every amount is fixed and printed in the draw's own headings,
   * so nothing here is inferred — the figures come from the result itself
   * rather than from a table in this file that could drift out of date.
   *
   * 2D Delight is the exception to exact matching: it pays on the last two
   * digits, so it is checked as a suffix. */

  function sweepTicket(s) { return String(s || '').replace(/\D/g, ''); }

  /**
   * Check one 7-digit Sweep ticket against one draw.
   * Returns every prize it wins — the top three are exact matches, the group
   * prizes are list membership, and 2D Delight is a suffix match.
   */
  function checkSweep(ticket, draw) {
    var t = sweepTicket(ticket);
    if (t.length !== 7) return { error: 'A Singapore Sweep ticket number has 7 digits.' };

    var lines = [], total = 0;

    [['1st Prize', draw.first], ['2nd Prize', draw.second], ['3rd Prize', draw.third]]
      .forEach(function (p) {
        if (p[1] && sweepTicket(p[1]) === t) {
          // The top three amounts are not in the group headings, so they are
          // reported as a win without a figure rather than with a wrong one.
          lines.push({ label: p[0], amount: null, note: 'top prize — see Singapore Pools for the amount' });
        }
      });

    (draw.groups || []).forEach(function (g) {
      var isTwoD = g.label.indexOf('2D') !== -1;
      var hit = isTwoD
        ? g.numbers.indexOf(t.slice(-2)) !== -1
        : g.numbers.indexOf(t) !== -1;
      if (!hit) return;
      lines.push({
        label: g.label + (isTwoD ? ' (last 2 digits)' : ''),
        amount: g.amount,
        note: ''
      });
      total += g.amount || 0;
    });

    return { ticket: t, lines: lines, total: total };
  }

  return {
    checkFourD: checkFourD,
    checkFourDBet: checkFourDBet,
    checkToto: checkToto,
    checkSweep: checkSweep,
    totoGroup: totoGroup,
    combinations: combinations,
    digitPattern: digitPattern,
    permutationCount: permutationCount,
    permutations: permutations,
    rollNumbers: rollNumbers,
    hitsIn: hitsIn,
    sweepTicket: sweepTicket,
    FOURD_FIXED: FOURD_FIXED,
    FOURD_IBET: FOURD_IBET,
    TOTO_FIXED: TOTO_FIXED,
    TOTO_GROUP_LABEL: TOTO_GROUP_LABEL,
    TOTO_GROUP_RULE: TOTO_GROUP_RULE
  };
})();
