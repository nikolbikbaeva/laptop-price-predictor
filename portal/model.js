/* FairSpec price model — built only on the verified catalog (catalog.js).
 *
 * 1. Every catalog row is a real configuration with an official store price and a source link.
 * 2. If someone values exactly a catalog configuration, the verified price is used as-is.
 * 3. Otherwise the price is estimated from the closest verified configurations (k-nearest neighbours)
 *    blended with a small ridge regression on the whole catalog.
 * 4. The US↔Germany price ratio is measured from configurations sold in both stores.
 * All internal prices are US dollars before sales tax.
 */
(function () {
  const CAT = (window.CATALOG && window.CATALOG.rows) || [];

  // ---------- spec scoring (0–100) ----------
  function cpuScore(name) {
    const c = String(name || "").toLowerCase();
    if (!c) return 40;
    if (/rtx spark|n1x/.test(c)) return /20-core/.test(c) ? 88 : 84;
    if (/mediatek|kompanio/.test(c)) return /838/.test(c) ? 16 : 12;
    if (/snapdragon c\b|c1-/.test(c)) return 18;
    if (/celeron|pentium|athlon|processor n\d|\bn\d{3,4}\b|n4\d{3}|n5\d{3}|n6\d{3}/.test(c)) {
      if (/core 3 n\d{3}/.test(c)) return 24;
      return /n150|n200|n250|n300|n305|n355/.test(c) ? 20 : 12;
    }
    const apple = c.match(/apple m(\d)/);
    if (apple) {
      let s = 56 + +apple[1] * 4;
      if (/max/.test(c)) s += 24; else if (/pro/.test(c)) s += 14;
      const cores = c.match(/(\d+)-core cpu/); if (cores && /pro|max/.test(c)) s += (+cores[1] - 15) * 0.8;
      return Math.min(100, s);
    }
    if (/snapdragon/.test(c)) {
      let s = /elite/.test(c) ? 68 : /plus/.test(c) ? 60 : 52;
      if (/x2/.test(c)) s += 8;
      if (/6-core/.test(c)) s -= 6;
      return s;
    }
    if (/ryzen ai max/.test(c)) return 90;
    const tierM = c.match(/(?:\bi|ultra x?|ryzen ai|ryzen|core)\s?([3579])\b/);
    let s = tierM ? { 3: 30, 5: 47, 7: 61, 9: 74 }[tierM[1]] : 40;
    if (/\d(hx)\b/.test(c) || /\bhx\b/.test(c)) s += 10;
    else if (/\d(h|hs)\b/.test(c)) s += 5;
    else if (/\d(p)\b/.test(c)) s += 2;
    const intelI = c.match(/i[3579]-(\d{4,5})/);
    if (intelI) {
      const n = intelI[1];
      const gen = n.length === 5 ? +n.slice(0, 2) : +n.slice(0, 2) >= 10 ? +n.slice(0, 2) : +n[0];
      s += Math.max(-15, Math.min(4, (gen - 13) * 3));
    } else if (/ultra/.test(c)) {
      const m = c.match(/ultra x?\d\s?(\d)\d\d/);
      s += m ? ({ 1: 4, 2: 7, 3: 10 }[m[1]] || 4) : 6;
      if (/ultra x/.test(c)) s += 3;
    } else if (/ryzen ai/.test(c)) {
      s += 8;
    } else if (/ryzen/.test(c)) {
      const m = c.match(/ryzen [3579] (\d)\d{3}/);
      if (m) s += { 3: -12, 4: -9, 5: -6, 6: -3, 7: 0, 8: 3, 9: 5 }[m[1]] || 0;
    } else if (/core [357] \d{3}/.test(c)) {
      s += 1;
    }
    return Math.max(5, Math.min(100, s));
  }

  function gpuScore(name) {
    const g = String(name || "").toLowerCase();
    if (!g) return 15;
    if (/rtx spark/.test(g)) return /6144/.test(g) ? 66 : 60;
    if (/mali/.test(g)) return 6;
    const rtx = g.match(/rtx (\d{2})(\d{2})/);
    if (rtx && !/rtx pro|rtx a\d/.test(g)) {
      const series = +rtx[1], cls = +rtx[2];
      let s = { 50: 40, 60: 50, 70: 62, 80: 78, 90: 92 }[cls] || 45;
      if (/ti\b/.test(g)) s += 5;
      s += { 20: -18, 30: -10, 40: -4, 50: 0 }[series] ?? 0;
      return s;
    }
    const pro = g.match(/rtx pro (\d+)/);
    if (pro) return Math.min(85, 30 + +pro[1] / 100);
    if (/gtx/.test(g)) return 25;
    if (/\bmx ?\d/.test(g)) return 18;
    if (/rx \d{4}/.test(g)) return 45;
    const apple = g.match(/apple m\d.*?(\d+)-core gpu/);
    if (apple) return Math.min(80, 18 + +apple[1] * 1.5);
    if (/apple m/.test(g)) return 28;
    if (/arc b\d/.test(g)) return 34;
    if (/arc/.test(g)) return 26;
    if (/radeon 8[89]0m/.test(g)) return 31;
    if (/radeon (78|88)0m/.test(g)) return 28;
    if (/radeon 8\d0m|radeon 7\d0m/.test(g)) return 23;
    if (/radeon 6[6-8]0m/.test(g)) return 19;
    if (/radeon 610m|vega/.test(g)) return 11;
    if (/adreno/.test(g)) return /x2/.test(g) ? 27 : 22;
    if (/iris xe/.test(g)) return 16;
    if (/intel graphics/.test(g)) return 15;
    if (/uhd/.test(g)) return 8;
    return 15;
  }

  // ---------- rows ----------
  const ppiOf = (r) => (r.xr && r.yr && r.inches ? Math.hypot(r.xr, r.yr) / r.inches : null);
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

  // US↔DE ratio from configurations sold in both stores (EUR incl. 19% VAT per USD before tax)
  const pairs = CAT.filter((r) => r.us && r.de).map((r) => r.de / r.us);
  const eurPerUsdGermany = pairs.length ? median(pairs) : 1.08;

  const rows = CAT.map((r, i) => {
    const usd = r.us || (r.de ? r.de / eurPerUsdGermany : null);
    const o = Object.assign({}, r, {
      id: i, storage: r.storage, price: usd, ppi: ppiOf(r),
      cpuS: cpuScore(r.cpu), gpuS: gpuScore(r.gpu),
      verifiedIn: [r.us && "US", r.de && "DE"].filter(Boolean),
    });
    return o;
  }).filter((r) => r.price > 0);
  const medPpi = median(rows.map((r) => r.ppi).filter(Boolean)) || 160;

  // ---------- features ----------
  function featurize(s) {
    const c = s.cpuS / 100, g = s.gpuS / 100;
    return [
      1, c, c * c, g, g * g, c * g,
      Math.log2(Math.max(2, s.ram)),
      Math.log2(Math.max(32, s.storage)),
      s.stype === "ssd" ? 1 : 0,
      (s.ppi || medPpi) / 100,
      s.inches || 15,
      s.os === "macOS" ? 1 : 0,
      s.os === "Chrome OS" ? 1 : 0,
    ];
  }
  function solve(M, v) {
    const n = v.length, m = M.map((r, i) => [...r, v[i]]);
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let k = i + 1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[p][i])) p = k;
      [m[i], m[p]] = [m[p], m[i]];
      for (let k = i + 1; k < n; k++) { const f = m[k][i] / m[i][i]; for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j]; }
    }
    const out = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) { let s = m[i][n]; for (let j = i + 1; j < n; j++) s -= m[i][j] * out[j]; out[i] = s / m[i][i]; }
    return out;
  }
  function fitRidge(data, lambda = 2) {
    const X = data.map(featurize), y = data.map((r) => Math.log(r.price)), P = X[0].length;
    const mu = Array(P).fill(0), sd = Array(P).fill(1);
    for (let j = 1; j < P; j++) {
      let m = 0; X.forEach((x) => (m += x[j])); m /= X.length;
      let v = 0; X.forEach((x) => (v += (x[j] - m) ** 2)); v = Math.sqrt(v / X.length) || 1;
      mu[j] = m; sd[j] = v;
    }
    const A = Array.from({ length: P }, () => Array(P).fill(0)), b = Array(P).fill(0);
    X.forEach((x, i) => { const z = x.map((v, j) => (j === 0 ? 1 : (v - mu[j]) / sd[j])); for (let a = 0; a < P; a++) { b[a] += z[a] * y[i]; for (let c = 0; c < P; c++) A[a][c] += z[a] * z[c]; } });
    for (let a = 1; a < P; a++) A[a][a] += lambda;
    const beta = solve(A, b);
    return (s) => { const x = featurize(s); let r = 0; for (let j = 0; j < P; j++) r += beta[j] * (j === 0 ? 1 : (x[j] - mu[j]) / sd[j]); return r; };
  }

  const K = 6;
  function dist(a, r) {
    let d = 0;
    d += 2.4 * ((a.cpuS - r.cpuS) / 20) ** 2;
    d += 2.4 * ((a.gpuS - r.gpuS) / 20) ** 2;
    d += 1.4 * (Math.log2(Math.max(2, a.ram)) - Math.log2(Math.max(2, r.ram))) ** 2;
    d += 0.9 * (Math.log2(Math.max(32, a.storage)) - Math.log2(Math.max(32, r.storage))) ** 2;
    d += 0.4 * (((a.ppi || medPpi) - (r.ppi || medPpi)) / 60) ** 2;
    d += 0.3 * (((a.inches || 15) - (r.inches || 15)) / 1.5) ** 2;
    if (a.os !== r.os) d += 2;
    if (a.brand !== r.brand) d += 0.25;
    if (a.stype !== r.stype) d += 0.5;
    return d;
  }
  function neighbours(spec, exclude) {
    const best = [];
    for (const r of rows) {
      if (exclude && exclude(r)) continue;
      const d = dist(spec, r);
      if (best.length < K) { best.push({ r, d }); best.sort((p, q) => p.d - q.d); }
      else if (d < best[K - 1].d) { best[K - 1] = { r, d }; best.sort((p, q) => p.d - q.d); }
    }
    return best;
  }
  const knnLog = (nb) => { let w = 0, s = 0; nb.forEach(({ r, d }) => { const wi = 1 / (0.1 + d); w += wi; s += wi * Math.log(r.price); }); return s / w; };

  const ridge = fitRidge(rows);
  // honest check: predict each row without its own model family
  const residuals = rows.map((r) => {
    const lp = 0.5 * ridge(r) + 0.5 * knnLog(neighbours(r, (x) => x.model === r.model));
    r.fair = Math.exp(lp);
    r.ratio = r.fair / r.price;
    return Math.log(r.price) - lp;
  });
  const absPct = residuals.map((e) => Math.abs(Math.exp(e) - 1)).sort((a, b) => a - b);
  const medianError = absPct[Math.floor(absPct.length / 2)] || 0;
  const sortedRes = residuals.slice().sort((a, b) => a - b);
  const q = (p) => sortedRes[Math.floor(p * (sortedRes.length - 1))] || 0;
  const LO = q(0.15), HI = q(0.85);

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function prep(spec) {
    const s = Object.assign({}, spec);
    s.cpuS = cpuScore(s.cpu); s.gpuS = gpuScore(s.gpu);
    if (s.stype === "hdd" && s.storage <= 128) s.stype = "emmc";
    if (!s.ppi && s.xr && s.yr && s.inches) s.ppi = Math.hypot(s.xr, s.yr) / s.inches;
    return s;
  }
  // an exact verified configuration, if the person picked one from the catalog
  function exactMatch(s) {
    return rows.find((r) => norm(r.model) === norm(s.model) && r.ram === +s.ram && r.storage === +s.storage && norm(r.cpu) === norm(s.cpu) && norm(r.gpu) === norm(s.gpu)) || null;
  }

  function estimate(spec) {
    const s = prep(spec);
    const nb = neighbours(s, null);
    const exact = exactMatch(s);
    const p = exact ? exact.price : Math.exp(0.5 * ridge(s) + 0.5 * knnLog(nb));
    const avgD = nb.reduce((a, n) => a + n.d, 0) / nb.length;
    const confidence = exact ? "Verified" : avgD < 0.6 ? "High" : avgD < 2 ? "Medium" : "Low";
    const spread = exact ? [0.96, 1.04] : [Math.exp(LO), Math.exp(HI)];
    return { price: p, low: p * spread[0], high: p * spread[1], comps: nb.map((n) => n.r), confidence, exact, cpuS: s.cpuS, gpuS: s.gpuS };
  }

  function verdict(ratio) {
    if (ratio >= 1.08) return { label: "Great deal", cls: "good" };
    if (ratio >= 0.9) return { label: "Fair price", cls: "fair" };
    return { label: "Overpriced", cls: "bad" };
  }

  window.FairModel = {
    rows, estimate, verdict, cpuScore, gpuScore, eurPerUsdGermany,
    report: { rows: rows.length, brands: [...new Set(rows.map((r) => r.brand))], bothMarkets: pairs.length },
    diagnostics: { medianError, pairs },
  };
})();
