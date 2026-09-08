/* XAUUSD Signal Lokal — engine murni frontend, tanpa API key.
   Urutan data: 1) Stooq XAUUSD asli  2) Binance PAXGUSDT (proxy gold)  3) Demo sintetik.
   Live price: Gold-API -> goldprice.org -> Stooq quote -> Binance.
*/
const $ = (id) => document.getElementById(id);
const state = {
  tf: "M15",
  candles: [],
  live: null, prevLive: null,
  lastSignal: null, countdown: 60, timer: null,
  ws: null, wsOk: false, wsRetry: 0, ticks: [],
  lastPaint: 0, lastRecomp: 0, _bt: null, lastTickT: 0,
};

/* ---------- fundamental + regime ---------- */
/* Pelajaran backtrace 4401: teknikal M15 saja menjual dasar pullback di tengah
   bull-market D1. Backdrop fundamental (DXY, US10Y, regime D1) kini ikut voting
   dan membuat ambang melawan-angin lebih berat (asimetris). Best-effort: jika
   feed gagal, engine jatuh kembali ke murni teknikal tanpa crash. */
const fundState = { ok: false, score: 0, dxy: null, dxyChg: null, y10: null, y10Chg: null, d1: null, d1ema: null, note: "belum dimuat", src: "" };
async function getStooqDaily(sym) {
  const r = await fetchTO(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, 7000);
  const lines = (await r.text()).trim().split("\n");
  if (lines.length < 3) throw new Error("stooq " + sym + " kosong");
  return lines.slice(1).map(l => { const p = l.split(","); return { t: p[0], c: +p[4] }; }).filter(x => isFinite(x.c));
}
async function refreshFundamentals() {
  try {
    const all = await Promise.allSettled([
      fetchTO("https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=80", 9000).then(r => r.json()),
      getStooqDaily("dx.f").catch(() => getStooqDaily("dxy")),
      getStooqDaily("10usy.b"),
    ]);
    let score = 0; const parts = [];
    if (all[0].status === "fulfilled") {
      const cl = all[0].value.map(k => +k[4]).filter(isFinite);
      if (cl.length > 55) {
        const e = ema(cl, 50), d1 = cl[cl.length - 1], de = e[e.length - 1];
        fundState.d1 = d1; fundState.d1ema = de;
        if (d1 > de) { score++; parts.push(`D1 ${d1.toFixed(0)}>EMA50 ${de.toFixed(0)} (bull — pullback = peluang buy)`); }
        else if (d1 < de) { score--; parts.push(`D1 ${d1.toFixed(0)}<EMA50 ${de.toFixed(0)} (bear — rally = peluang sell)`); }
      }
    }
    if (all[1].status === "fulfilled") {
      const q = all[1].value, n = q.length;
      if (n >= 2) {
        fundState.dxy = q[n - 1].c; fundState.dxyChg = 100 * (q[n - 1].c - q[n - 2].c) / (q[n - 2].c || 1);
        if (fundState.dxyChg <= -0.2) { score++; parts.push(`DXY melemah ${fundState.dxyChg.toFixed(2)}% (bullish gold)`); }
        else if (fundState.dxyChg >= 0.2) { score--; parts.push(`DXY menguat +${fundState.dxyChg.toFixed(2)}% (bearish gold)`); }
        else parts.push(`DXY flat ${fundState.dxyChg >= 0 ? "+" : ""}${fundState.dxyChg.toFixed(2)}%`);
      }
    }
    if (all[2].status === "fulfilled") {
      const q = all[2].value, n = q.length;
      if (n >= 2) {
        fundState.y10 = q[n - 1].c; fundState.y10Chg = q[n - 1].c - q[n - 2].c;
        if (fundState.y10Chg <= -0.03) { score++; parts.push(`US10Y turun ${fundState.y10Chg.toFixed(2)}pp (bullish gold)`); }
        else if (fundState.y10Chg >= 0.03) { score--; parts.push(`US10Y naik +${fundState.y10Chg.toFixed(2)}pp (bearish gold)`); }
        else parts.push(`US10Y flat ${fundState.y10Chg >= 0 ? "+" : ""}${fundState.y10Chg.toFixed(2)}pp`);
      }
    }
    fundState.score = Math.max(-3, Math.min(3, score));
    fundState.ok = parts.length > 0;
    fundState.note = parts.join("; ") || "offline";
    fundState.src = "binance D1 + stooq";
  } catch (e) { fundState.ok = false; fundState.note = "fundamental offline (" + e.message + ")"; }
}

const TF_CONF = {
  M15: { stooq: "15", binance: "15m", tv: "15",  ws: "15m", name: "M15" },
  H1:  { stooq: "60", binance: "1h",  tv: "60",  ws: "1h",  name: "H1"  },
  H4:  { stooq: "60", binance: "4h",  tv: "240", ws: "4h",  name: "H4", resample: 4 },
  D1:  { stooq: "d",  binance: "1d",  tv: "D",   ws: "1d",  name: "D1"  },
};

/* ---------- TradingView widget (port dari React kamu, symbol -> OANDA:XAUUSD) ---------- */
function loadTV(tf) {
  const c = TF_CONF[tf];
  const holder = $("tv-container");
  holder.innerHTML = '<div id="tv-widget" class="tradingview-widget-container__widget"></div>';
  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
  script.type = "text/javascript";
  script.async = true;
  script.innerHTML = JSON.stringify({
    allow_symbol_change: true, calendar: false, details: false,
    hide_side_toolbar: true, hide_top_toolbar: false, hide_legend: false,
    hide_volume: false, hotlist: false, interval: String(c.tv), locale: "en",
    save_image: true, style: "1", symbol: "OANDA:XAUUSD", theme: "dark",
    timezone: "Etc/UTC", backgroundColor: "#0F0F0F",
    gridColor: "rgba(242, 242, 242, 0.2)",
    watchlist: [], withdateranges: false, compareSymbols: [],
    support_host: "https://www.tradingview.com", studies: [], autosize: true,
  });
  holder.appendChild(script);
}

/* ---------- fetch helpers ---------- */
async function fetchTO(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return r; }
  finally { clearTimeout(t); }
}
function parseStooqCSV(txt) {
  const lines = txt.trim().split("\n");
  if (lines.length < 3) throw new Error("stooq kosong");
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 6) continue;
    const close = parseFloat(p[4]); if (!isFinite(close)) continue;
    out.push({ time: p[0], open: +p[1], high: +p[2], low: +p[3], close, volume: +(p[5] || 0) });
  }
  return out;
}
async function getStooq(tf) {
  const i = TF_CONF[tf].stooq;
  const r = await fetchTO(`https://stooq.com/q/d/l/?s=xauusd&i=${i}`);
  return parseStooqCSV(await r.text());
}
async function getBinance(tf) {
  const iv = TF_CONF[tf].binance;
  const lim = tf === "M15" ? 480 : 300; // M15 butuh bar lebih agar bias HTF (resample ×16) valid
  const r = await fetchTO(`https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${iv}&limit=${lim}`);
  const j = await r.json();
  return j.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}
function genDemo(seedPrice = 2650, n = 300) {
  let p = seedPrice, out = [], t = Date.now() - n * 360e4;
  let s = 1234567;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  for (let i = 0; i < n; i++) {
    const o = p, drift = Math.sin(i / 20) * 1.2;
    const c = o + rnd() * 6 + drift;
    out.push({ time: t + i * 360e4, open: o, high: Math.max(o, c) + Math.random() * 2, low: Math.min(o, c) - Math.random() * 2, close: c, volume: 100 });
    p = c;
  }
  return out;
}
function resample(candles, n) {
  const out = [];
  for (let i = 0; i < candles.length; i += n) {
    const g = candles.slice(i, i + n); if (!g.length) continue;
    out.push({ time: g[0].time, open: g[0].open, high: Math.max(...g.map(x => x.high)), low: Math.min(...g.map(x => x.low)), close: g[g.length - 1].close, volume: g.reduce((a, x) => a + x.volume, 0) });
  }
  return out;
}

/* ---------- indikator ---------- */
const closes = (cs) => cs.map(c => c.close);
function ema(vals, p) { const k = 2 / (p + 1); let e = vals[0]; const o = [e]; for (let i = 1; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); o.push(e); } return o; }
function sma(vals, p) { return vals.map((_, i) => i < p - 1 ? null : vals.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p); }
function rsi(cl, p = 14) {
  const o = new Array(cl.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    if (i <= p) { if (d > 0) g += d; else l -= d; if (i === p) { g /= p; l /= p; o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); } }
    else { const up = Math.max(d, 0), dn = Math.max(-d, 0); g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = 100 - 100 / (1 + (l === 0 ? 100 : g / l)); }
  }
  return o;
}
function macd(cl, f = 12, s = 26, sig = 9) {
  const ef = ema(cl, f), es = ema(cl, s);
  const line = cl.map((_, i) => ef[i] - es[i]);
  const signal = ema(line.slice(s), sig); const full = new Array(cl.length).fill(null);
  for (let i = 0; i < signal.length; i++) full[i + s] = signal[i];
  return { line, signal: full, hist: line.map((v, i) => full[i] == null ? null : v - full[i]) };
}
function atr(cs, p = 14) {
  const trs = cs.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close)));
  const o = new Array(cs.length).fill(null); let a = trs.slice(0, p).reduce((x, y) => x + y, 0) / p; o[p - 1] = a;
  for (let i = p; i < trs.length; i++) { a = (a * (p - 1) + trs[i]) / p; o[i] = a; }
  return o;
}
function stoch(cs, k = 14, d = 3) {
  const kk = cs.map((_, i) => {
    if (i < k - 1) return null;
    const w = cs.slice(i - k + 1, i + 1);
    const hh = Math.max(...w.map(x => x.high)), ll = Math.min(...w.map(x => x.low));
    return hh === ll ? 50 : ((cs[i].close - ll) / (hh - ll)) * 100;
  });
  const dd = kk.map((_, i) => { if (i < k - 1 + d - 1 || kk[i] == null) return null; const w = kk.slice(i - d + 1, i + 1); return w.reduce((a, b) => a + b, 0) / d; });
  return { k: kk, d: dd };
}

/* ----- indikator lanjutan: ADX, Bollinger %B, bias higher-timeframe, rasio volatilitas ----- */
function adx(cs, p = 14) {
  const n = cs.length, plus = new Array(n).fill(null), minus = new Array(n).fill(null), out = new Array(n).fill(null);
  if (n < 2 * p + 1) return { adx: out, plus, minus };
  const tr = [], pdm = [], mdm = [];
  for (let j = 1; j < n; j++) {
    const up = cs[j].high - cs[j - 1].high, dn = cs[j - 1].low - cs[j].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(cs[j].high - cs[j].low, Math.abs(cs[j].high - cs[j - 1].close), Math.abs(cs[j].low - cs[j - 1].close)));
  }
  let av = 0, pd = 0, md = 0;
  for (let j = 0; j < p; j++) { av += tr[j]; pd += pdm[j]; md += mdm[j]; }
  av /= p; pd /= p; md /= p;
  const dx = [];
  for (let j = p; j < tr.length; j++) {
    av = (av * (p - 1) + tr[j]) / p; pd = (pd * (p - 1) + pdm[j]) / p; md = (md * (p - 1) + mdm[j]) / p;
    const pdi = 100 * pd / (av || 1), mdi = 100 * md / (av || 1);
    plus[j + 1] = pdi; minus[j + 1] = mdi;
    dx.push(100 * Math.abs(pdi - mdi) / ((pdi + mdi) || 1));
  }
  let ax = dx.slice(0, p).reduce((s, v) => s + v, 0) / p;
  out[2 * p] = ax;
  for (let j = p; j < dx.length; j++) { ax = (ax * (p - 1) + dx[j]) / p; out[j + p + 1] = ax; }
  return { adx: out, plus, minus };
}
function bollinger(cl, p = 20, m = 2) {
  return cl.map((_, j) => {
    if (j < p - 1) return null;
    const w = cl.slice(j - p + 1, j + 1);
    const mean = w.reduce((s, v) => s + v, 0) / p;
    const sd = Math.sqrt(w.reduce((s, v) => s + (v - mean) ** 2, 0) / p);
    return sd === 0 ? 0.5 : (cl[j] - (mean - m * sd)) / (2 * m * sd);
  });
}
/* Divergensi RSI: harga lower-low tapi RSI higher-high (bullish, +1) atau sebaliknya (-1). */
function divergence(cl, r, look = 14) {
  const n = cl.length;
  if (n < look + 3) return 0;
  const half = Math.floor(look / 2);
  const segP = cl.slice(n - look), segR = r.slice(n - look);
  let iLo1 = 0; for (let k = 1; k < half; k++) if (segP[k] < segP[iLo1]) iLo1 = k;
  let iLo2 = half; for (let k = half + 1; k < look; k++) if (segP[k] < segP[iLo2]) iLo2 = k;
  let iHi1 = 0; for (let k = 1; k < half; k++) if (segP[k] > segP[iHi1]) iHi1 = k;
  let iHi2 = half; for (let k = half + 1; k < look; k++) if (segP[k] > segP[iHi2]) iHi2 = k;
  const rLo1 = segR[iLo1], rLo2 = segR[iLo2], rHi1 = segR[iHi1], rHi2 = segR[iHi2];
  if (rLo1 == null || rLo2 == null || rHi1 == null || rHi2 == null) return 0;
  if (segP[iLo2] < segP[iLo1] && rLo2 > rLo1 + 1) return 1;
  if (segP[iHi2] > segP[iHi1] && rHi2 < rHi1 - 1) return -1;
  return 0;
}
const HTF_MAP = { M15: { k: 16, n: "H4" }, H1: { k: 4, n: "H4" }, H4: { k: 6, n: "D1" }, D1: { k: 5, n: "W1" } };
function htfBias(cs, tf) {
  const cfg = HTF_MAP[tf] || { k: 4, n: "HTF" };
  const hc = resample(cs, cfg.k);
  if (hc.length < 20) return { ok: false, name: cfg.n };
  const cl = hc.map(c => c.close), e = ema(cl, 20), r = rsi(cl, 14), j = cl.length - 1;
  if (r[j] == null) return { ok: false, name: cfg.n };
  return { ok: true, name: cfg.n, ema: e[j], rsi: r[j] };
}
function volRatio(a, j) {
  const w = a.slice(Math.max(0, j - 29), j + 1).filter(v => v != null);
  if (w.length < 10 || a[j] == null) return 1;
  const s = [...w].sort((x, y) => x - y), med = s[Math.floor(s.length / 2)];
  return med ? a[j] / med : 1;
}

/* ---------- analisa lanjutan: pola candle, pivot harian, fibonacci ---------- */
/* Pola candle terakhir (informasi saja — tidak mengubah voting engine). */
function candlePattern(cs) {
  const i = cs.length - 1;
  if (i < 2) return { name: "—", dir: 0, note: "data kurang" };
  const c = cs[i], p = cs[i - 1];
  const body = Math.abs(c.close - c.open), range = (c.high - c.low) || 1e-9;
  const up = c.close >= c.open;
  const prevBody = Math.abs(p.close - p.open), prevUp = p.close >= p.open;
  const upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low;
  if (body <= 0.1 * range) return { name: "Doji", dir: 0, note: "indecision — tunggu konfirmasi candle berikutnya" };
  if (prevBody > 0 && body > prevBody && up !== prevUp && c.close > p.open && c.open < p.close)
    return { name: up ? "Bullish Engulfing" : "Bearish Engulfing", dir: up ? 1 : -1, note: up ? "pembeli mengambil alih dari penjual" : "penjual mengambil alih dari pembeli" };
  if (lower >= 2 * body && upper <= 0.3 * body) return { name: "Hammer", dir: 1, note: "rejection bawah — rawan pantul naik" };
  if (upper >= 2 * body && lower <= 0.3 * body) return { name: "Shooting Star", dir: -1, note: "rejection atas — rawan turun" };
  if (body >= 0.9 * range) return { name: up ? "Marubozu Bullish" : "Marubozu Bearish", dir: up ? 1 : -1, note: "body penuh — momentum kuat searah" };
  if (c.high <= p.high && c.low >= p.low) return { name: "Inside Bar", dir: 0, note: "kompresi volatilitas — tunggu breakout arah" };
  return { name: up ? "Bullish" : "Bearish", dir: up ? 1 : -1, note: "candle normal tanpa sinyal spesifik" };
}
function dayKey(t) {
  if (typeof t === "number") return new Date(t).toISOString().slice(0, 10);
  const s = String(t);
  return s.length > 10 ? s.slice(0, 10) : s;
}
/* Pivot harian klasik dari hari trading terakhir yang sudah selesai. */
function pivotLevels(cs) {
  const lastDay = dayKey(cs[cs.length - 1].time);
  let hi = -Infinity, lo = Infinity, cl = null;
  for (let i = cs.length - 1; i >= 0; i--) {
    if (dayKey(cs[i].time) === lastDay) continue;
    hi = Math.max(hi, cs[i].high); lo = Math.min(lo, cs[i].low); cl = cs[i].close;
  }
  if (!isFinite(hi) || cl == null) return null;
  const P = (hi + lo + cl) / 3;
  return { P, R1: 2 * P - lo, S1: 2 * P - hi, R2: P + (hi - lo), S2: P - (hi - lo), R3: hi + 2 * (P - lo), S3: lo - 2 * (hi - P) };
}
/* Fibonacci retracement dari swing terakhir (n bar). */
function fibLevels(cs, n = 60) {
  const w = cs.slice(Math.max(0, cs.length - n));
  let hi = -Infinity, lo = Infinity;
  w.forEach(c => { hi = Math.max(hi, c.high); lo = Math.min(lo, c.low); });
  const rg = hi - lo;
  if (rg <= 0) return null;
  return { hi, lo, levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(f => ({ f, p: hi - rg * f })) };
}

/* ---------- engine sinyal ---------- */
function buildSignal(cs) {
  const cl = closes(cs), i = cs.length - 1, prev = cs.length - 2;
  const e20 = ema(cl, 20), e50 = ema(cl, 50), e200 = ema(cl, Math.min(200, cl.length - 1));
  const r = rsi(cl), m = macd(cl), a = atr(cs), st = stoch(cs);
  const ax = adx(cs), bb = bollinger(cl), htf = htfBias(cs, state.tf);
  const div = divergence(cl, r);
  const win20 = cs.slice(Math.max(0, i - 19), i + 1);
  const win50 = cs.slice(Math.max(0, i - 49), i + 1);
  const majHi = Math.max(...win50.map(x => x.high)), majLo = Math.min(...win50.map(x => x.low));
  const last = {
    e20: e20[i], e50: e50[i], e200: e200[i], rsi: r[i], rsiPrev: r[prev], rsi2: r[cs.length - 3],
    macdH: m.hist[i], macdHp: m.hist[prev], macdH2: m.hist[cs.length - 3], macdLine: m.line[i], macdSig: m.signal[i],
    kPrev: st.k[prev], dPrev: st.d[prev], kPrev2: st.k[cs.length - 3],
    atr: a[i], k: st.k[i], d: st.d[i], close: cs[i].close,
    swingHi: Math.max(...win20.map(x => x.high)), swingLo: Math.min(...win20.map(x => x.low)),
    adx: ax.adx[i], plusDI: ax.plus[i], minusDI: ax.minus[i], bb: bb[i],
    htfE: htf.ema ?? null, htfR: htf.rsi ?? null, htfN: htf.name, htfOk: htf.ok,
    volX: volRatio(a, i),
    div, prox: 0,
  };
  const votes = [];
  votes.push({ n: "Trend EMA20>EMA50", v: last.e20 > last.e50 ? 1 : -1, w: 2 });
  votes.push({ n: `Harga vs EMA50 (${cs[i].close.toFixed(1)} vs ${last.e50.toFixed(1)})`, v: cs[i].close > last.e50 ? 1 : -1, w: 2 });
  votes.push({ n: `Harga vs EMA200`, v: cs[i].close > last.e200 ? 1 : -1, w: 1 });
  votes.push({ n: `RSI(14) ${last.rsi?.toFixed(1)}`, v: last.rsi > 55 ? 1 : last.rsi < 45 ? -1 : 0, w: 2 });
  // MACD: hargai PERUBAHAN momentum. Dulu hist negatif-yang-membaik dinilai 0 (netral)
  // sehingga reversal awal seperti 4401 (hist -2.1→-1.3→-0.6) terkubur. Kini: pulih 2 bar = +1.
  const macdUp = last.macdH != null && last.macdHp != null && last.macdH > last.macdHp;
  const macdUp2 = macdUp && last.macdHp != null && last.macdH2 != null && last.macdHp > last.macdH2;
  const macdDn2 = !macdUp && last.macdHp != null && last.macdH2 != null && last.macdHp < last.macdH2;
  const macdV = last.macdH == null ? 0 : last.macdH > 0 ? (macdUp ? 1 : -1) : (macdUp2 ? 1 : (!macdUp ? -1 : 0));
  votes.push({ n: `MACD hist ${last.macdH?.toFixed(2)}${last.macdH < 0 && macdUp2 ? " (pulih ↑)" : last.macdH > 0 && !macdUp ? " (melemah ↓)" : ""}`, v: macdV, w: 2 });
  // Stochastic: yang dinilai CROSS-nya, bukan level jenuh. Di tren kuat K nempel >80
  // adalah strength — dulu dinilai 0 sehingga vote bullish hilang tepat saat dibutuhkan.
  const stochX = last.k != null && last.d != null && last.kPrev != null && last.dPrev != null &&
    ((last.k > last.d && last.kPrev <= last.dPrev) || (last.k < last.d && last.kPrev >= last.dPrev));
  const kRising2 = last.k != null && last.kPrev != null && last.kPrev2 != null && last.k > last.kPrev && last.kPrev > last.kPrev2;
  const kFalling2 = last.k != null && last.kPrev != null && last.kPrev2 != null && last.k < last.kPrev && last.kPrev < last.kPrev2;
  const stochV = last.k == null || last.d == null ? 0 : last.k > last.d ? 1 : last.k < last.d ? -1 : 0;
  votes.push({ n: `Stoch K/D ${last.k?.toFixed(0)}/${last.d?.toFixed(0)}${stochX ? " (cross)" : ""}`, v: stochV, w: 1 });
  const mom = cl[i] - cl[Math.max(0, i - 5)];
  votes.push({ n: `Momentum 5 bar ${mom >= 0 ? "+" : ""}${mom.toFixed(1)}`, v: mom > 0 ? 1 : -1, w: 1 });
  const dSup = cs[i].close - last.swingLo, dRes = last.swingHi - cs[i].close;
  last.prox = dSup < 0.5 * last.atr ? 1 : dRes < 0.5 * last.atr ? -1 : 0;
  // Jangan fade tren sehat: abaikan vote S/R 20-bar yang melawan DI dominan saat ADX kuat.
  const diBull = last.plusDI != null && last.minusDI != null && last.plusDI > last.minusDI;
  if (last.prox !== 0 && last.adx != null && last.adx >= 25 && ((last.prox < 0 && diBull) || (last.prox > 0 && !diBull))) last.prox = 0;
  if (last.div !== 0) votes.push({ n: `Divergensi RSI ${last.div > 0 ? "bullish" : "bearish"}`, v: last.div, w: 1 });
  if (last.prox !== 0) votes.push({ n: last.prox > 0 ? `Dekat support ${last.swingLo.toFixed(1)}` : `Dekat resistance ${last.swingHi.toFixed(1)}`, v: last.prox, w: 1 });
  if (htf.ok) votes.push({ n: `HTF ${htf.name} EMA20 ${htf.ema.toFixed(1)} RSI ${htf.rsi.toFixed(0)}`, v: cs[i].close > htf.ema && htf.rsi > 50 ? 1 : cs[i].close < htf.ema && htf.rsi < 50 ? -1 : 0, w: 2 });
  // Bollinger: hanya di-fade saat market range (ADX<20). Saat tren kuat, %B ekstrem = strength.
  const trendStrong = last.adx != null && last.adx >= 20;
  if (last.bb != null) votes.push({ n: `Bollinger %B ${last.bb.toFixed(2)}${trendStrong ? " (tren: tak di-fade)" : ""}`, v: trendStrong ? 0 : last.bb < 0.15 ? 1 : last.bb > 0.85 ? -1 : 0, w: 1 });
  if (last.adx != null) votes.push({ n: `ADX ${last.adx.toFixed(1)} (DI+ ${last.plusDI.toFixed(0)}/DI- ${last.minusDI.toFixed(0)})`, v: last.plusDI > last.minusDI ? 1 : -1, w: 1 });
  // Fundamental ikut voting (DXY • US10Y • regime D1). Best-effort: offline = tak ada vote.
  const F = (typeof fundState !== "undefined" && fundState.ok) ? fundState.score : 0;
  if (F !== 0) votes.push({ n: `Fundamental ${F > 0 ? "+" : ""}${F} (${fundState.note.split(";")[0].slice(0, 60)}${fundState.note.includes(";") ? "…" : ""})`, v: Math.sign(F), w: Math.abs(F) >= 2 ? 2 : 1 });
  const score = votes.reduce((s, x) => s + x.v * x.w, 0);
  // Ambang asimetris: ikuti angin fundamental, persulit sinyal lawan arah.
  let buyThr = 4, sellThr = -4;
  if (F > 0) { buyThr = 3; sellThr = -6; } else if (F < 0) { buyThr = 6; sellThr = -3; }
  let dir = score >= buyThr ? "BUY" : score <= sellThr ? "SELL" : "NEUTRAL";
  // confidence = porsi bobot kubu menang (kesepakatan), bukan skor/max
  const sgn = Math.sign(score);
  let winW = 0, loseW = 0, flatW = 0;
  votes.forEach(x => { if (x.v === 0 || x.w === 0) flatW += x.w; else if (Math.sign(x.v) === sgn) winW += x.w; else loseW += x.w; });
  let conf = (winW + loseW) === 0 ? 0 : Math.round(100 * winW / (winW + loseW + 0.5 * flatW));
  const chop = last.adx != null && last.adx < 15;
  if (chop) conf = Math.min(conf, 45); // pasar sideways: paksa tidak pede
  if (last.adx >= 20 && htf.ok && ((dir === "BUY" && cs[i].close > htf.ema) || (dir === "SELL" && cs[i].close < htf.ema))) conf = Math.min(95, conf + 8);
  const price = state.live ?? cs[i].close;
  const slD = last.atr * 1.5, tp1D = last.atr * 1.5, tp2D = last.atr * 3;
  // --- Bukti reversal + regime tren (pelajaran backtrace 4401) ---
  // Kasus 4401: RSI 32.6→39.1→41.1 (menengadah) + MACD pulih 2 bar + Stoch bullish
  // di atas support 50-bar, tapi engine lama tetap SELL karena vote EMA-stack/ADX
  // yang lagging menenggelamkan semuanya.
  const pat0 = candlePattern(cs);
  const rsiTurnUp = last.rsi != null && last.rsiPrev != null && last.rsi < 48 && last.rsi > last.rsiPrev;
  const rsiTurnDn = last.rsi != null && last.rsiPrev != null && last.rsi > 52 && last.rsi < last.rsiPrev;
  const stochBullR = last.k != null && last.d != null && last.k > last.d && (last.k ?? 99) < 65 && (stochX || kRising2);
  const stochBearR = last.k != null && last.d != null && last.k < last.d && (last.k ?? 0) > 35 && (stochX || kFalling2);
  const nearSup50 = (cs[i].close - majLo) < 3 * last.atr;
  const nearRes50 = (majHi - cs[i].close) < 3 * last.atr;
  const revBull = [rsiTurnUp, stochBullR, macdUp2, pat0.dir > 0 || last.div > 0].filter(Boolean).length;
  const revBear = [rsiTurnDn, stochBearR, macdDn2, pat0.dir < 0 || last.div < 0].filter(Boolean).length;
  last.revBull = revBull; last.revBear = revBear; last.nearSup50 = nearSup50; last.nearRes50 = nearRes50;
  last.majHi = majHi; last.majLo = majLo;
  // Tren kuat = ADX>=25 + DI dominan + (jika ada) HTF searah. Fade/countertrend dilarang melawannya.
  const strongUp = last.adx != null && last.adx >= 25 && diBull && (!htf.ok || (cs[i].close > htf.ema && htf.rsi > 50));
  const strongDn = last.adx != null && last.adx >= 25 && !diBull && (!htf.ok || (cs[i].close < htf.ema && htf.rsi < 50));
  // --- Exhaustion: jangan kejar ujung (pelajaran backtrace 4401 & 4420) ---
  // Diblokir KECUALI tren kuat tanpa bukti reversal (continuation diizinkan, bukan kejar ujung buta).
  let exNote = "", tag = "TREND", bounce = false;
  const overbought = last.rsi != null && last.rsi > 68 && last.bb != null && last.bb > 0.75;
  const oversold = last.rsi != null && last.rsi < 32 && last.bb != null && last.bb < 0.25;
  if (dir === "BUY" && overbought && !(strongUp && revBear < 2)) { dir = "NEUTRAL"; exNote = `BUY ditahan: overbought (RSI ${last.rsi.toFixed(0)}, %B ${last.bb.toFixed(2)}) — tunggu pullback`; }
  if (dir === "SELL" && oversold && !(strongDn && revBull < 2)) { dir = "NEUTRAL"; exNote = `SELL ditahan: oversold (RSI ${last.rsi.toFixed(0)}, %B ${last.bb.toFixed(2)}) — jangan sell di dasar`; }
  // --- Pullback guard: sinyal tren yang melawan bukti reversal di dekat S/R mayor ---
  // Guard ini membatalkan sinyal tren yang melawan bukti reversal (sesuai regime D1 & fundamental).
  if (dir === "SELL" && nearSup50 && revBull >= 3) {
    // Bounce BUY dibatalkan jika tren DAN fundamental kompak bearish (pisau jatuh) — cukup berdiri pinggir.
    if ((revBull >= 4 || F > 0) && !(strongDn && F < 0)) { dir = "BUY"; bounce = true; exNote = `SELL dibatalkan → flip BUY: dasar pullback (${revBull}/4 bukti reversal: RSI menengadah, MACD pulih, Stoch bullish, candle/divergence) di dekat support ${majLo.toFixed(1)}`; }
    else { dir = "NEUTRAL"; exNote = `SELL ditahan: ${revBull}/4 bukti reversal di dekat support ${majLo.toFixed(1)} — jangan sell di dasar, tunggu konfirmasi`; }
  }
  if (dir === "BUY" && nearRes50 && revBear >= 3) {
    if ((revBear >= 4 || F < 0) && !(strongUp && F > 0)) { dir = "SELL"; bounce = true; exNote = `BUY dibatalkan → flip SELL: puncak pullback (${revBear}/4 bukti reversal bearish) di dekat resistance ${majHi.toFixed(1)}`; }
    else { dir = "NEUTRAL"; exNote = `BUY ditahan: ${revBear}/4 bukti reversal di dekat resistance ${majHi.toFixed(1)} — jangan kejar puncak, tunggu konfirmasi`; }
  }
  // Bukti reversal bulat (4/4) di tengah range = berdiri di pinggir, jangan lawan tren yang kehabisan bahan bakar.
  if (dir === "SELL" && !nearSup50 && revBull >= 4) { dir = "NEUTRAL"; exNote = `SELL ditahan: reversal bullish bulat 4/4 (RSI menengadah, MACD pulih, Stoch bullish, candle/divergence) — tren turun kehabisan bahan bakar`; }
  if (dir === "BUY" && !nearRes50 && revBear >= 4) { dir = "NEUTRAL"; exNote = `BUY ditahan: reversal bearish bulat 4/4 — tren naik kehabisan bahan bakar`; }
  // --- Bounce countertrend: divergensi / extreme + support-resistance ---
  // Fade ekstrem DILARANG melawan tren kuat (dulu SELL-buta di pucuk uptrend / BUY-buta di dasar downtrend).
  const nearSup = (cs[i].close - last.swingLo) < 0.5 * last.atr;
  const nearRes = (last.swingHi - cs[i].close) < 0.5 * last.atr;
  const rsiX = last.rsi ?? 50, bbX = last.bb ?? 0.5;
  if (dir === "NEUTRAL") {
    if (!strongDn && rsiX < 40 && bbX < 0.1 && nearSup && (last.div > 0 || bbX < 0 || rsiX < 32)) { dir = "BUY"; bounce = true; }
    else if (!strongUp && rsiX > 60 && bbX > 0.9 && nearRes && (last.div < 0 || bbX > 1 || rsiX > 68)) { dir = "SELL"; bounce = true; }
    // Bounce berbasis bukti (4/4) BOLEH melawan tren M15/H4 — itu inti pelajaran 4401.
    // Yang dilarang hanya pisau jatuh total: tren kuat DAN fundamental kompak melawannya.
    else if (nearSup50 && revBull >= 4 && !(strongDn && F < 0)) { dir = "BUY"; bounce = true; exNote = `BUY bounce: ${revBull}/4 bukti reversal di dekat support ${majLo.toFixed(1)} (target mean-reversion ke EMA, size setengah)`; }
    else if (nearRes50 && revBear >= 4 && !(strongUp && F > 0)) { dir = "SELL"; bounce = true; exNote = `SELL bounce: ${revBear}/4 bukti reversal di dekat resistance ${majHi.toFixed(1)} (target mean-reversion ke EMA, size setengah)`; }
  }
  if (bounce) {
    // confidence countertrend dihitung dari bukti reversal, BUKAN skor trend
    let bc = 55;
    if ((dir === "BUY" && last.div > 0) || (dir === "SELL" && last.div < 0)) bc += 10;
    if (rsiX < 30 || rsiX > 70) bc += 8;
    if ((dir === "BUY" && bbX < 0) || (dir === "SELL" && bbX > 1)) bc += 7;
    if ((dir === "BUY" && revBull >= 4) || (dir === "SELL" && revBear >= 4)) bc += 5;
    if ((dir === "BUY" && F > 0) || (dir === "SELL" && F < 0)) bc += 5; // didukung fundamental
    if (typeof fundState !== "undefined" && fundState.d1 != null && fundState.d1ema != null &&
      ((dir === "BUY") === (fundState.d1 > fundState.d1ema))) bc += 5; // searah regime D1
    conf = Math.min(80, bc);
  }
  const strength = conf >= 60 && dir !== "NEUTRAL" ? "STRONG " : "";
  let lv;
  if (bounce) {
    tag = "COUNTERTREND";
    const buf = last.atr * 0.3;
    if (dir === "BUY") {
      const sl = Math.min(price - slD, last.swingLo - buf), risk = price - sl;
      lv = { e: price, sl, tp1: last.e20 > price ? last.e20 : price + risk, tp2: last.e50 > price ? last.e50 : price + risk * 1.5 };
    } else {
      const sl = Math.max(price + slD, last.swingHi + buf), risk = sl - price;
      lv = { e: price, sl, tp1: last.e20 < price ? last.e20 : price - risk, tp2: last.e50 < price ? last.e50 : price - risk * 1.5 };
    }
  } else lv = dir === "BUY" ? { e: price, sl: price - slD, tp1: price + tp1D, tp2: price + tp2D }
    : dir === "SELL" ? { e: price, sl: price + slD, tp1: price - tp1D, tp2: price - tp2D }
    : { e: price, sl: price - slD, tp1: price, tp2: price + tp2D };
  // Grade setup: A+ = elite (boleh bunyi), A = bagus, B = campuran, TUNGGU = tak ada edge.
  // Tak ada sinyal "pasti win" — A+ artinya semua filter confluence lolos, probabilitas tertinggi.
  const htfAgree = htf.ok && ((dir === "BUY" && cs[i].close > htf.ema && htf.rsi > 50) || (dir === "SELL" && cs[i].close < htf.ema && htf.rsi < 50));
  const whyNot = [];
  if (dir === "NEUTRAL") whyNot.push("skor voting tak mencapai ambang arah (±4)");
  if (dir !== "NEUTRAL" && conf < 70) whyNot.push(`confidence ${conf}<70 (kubu lawan masih kuat)`);
  if (dir !== "NEUTRAL" && !(last.adx >= 20)) whyNot.push(`ADX ${last.adx != null ? last.adx.toFixed(0) : "?"}<20 (trend belum sehat)`);
  if (dir !== "NEUTRAL" && !htfAgree) whyNot.push(`melawan bias ${htf.name}`);
  if (dir !== "NEUTRAL" && !(last.volX <= 1.8)) whyNot.push(`volatilitas melonjak ${last.volX.toFixed(1)}×`);
  if (chop) whyNot.push("pasar CHOP (sideways)");
  if (bounce) whyNot.push("countertrend: TP di mean (EMA) + SL di luar extreme, size setengah");
  if ((dir === "SELL" && F > 0) || (dir === "BUY" && F < 0)) whyNot.push(`melawan backdrop fundamental ${F > 0 ? "+" : ""}${F} — sinyal ini menentang angin DXY/US10Y/D1`);
  if (exNote) whyNot.push(exNote);
  let grade = "TUNGGU";
  if (dir !== "NEUTRAL") {
    grade = "B";
    if (conf >= 60 && last.adx >= 18 && htfAgree) grade = "A";
    if (conf >= 70 && last.adx >= 20 && htfAgree && last.volX <= 1.8 && !chop) grade = "A+";
    if (bounce && grade === "A+") grade = "A";
  }
  const extATR = Math.abs(price - last.e20) / (last.atr || 1);
  const zone = dir === "BUY" ? (price > last.e20 ? last.e20 : last.e50)
    : dir === "SELL" ? (price < last.e20 ? last.e20 : last.e50) : null;
  return { dir: strength + dir, raw: dir, conf, votes, last, lv, price, atr: last.atr, score, chop, grade, whyNot, htfAgree, extATR, zone, tag, exNote, pattern: pat0 };
}
function backtest(cs) {
  let t = 0, w1 = 0, w2 = 0;
  const start = Math.max(60, cs.length - 101), end = cs.length - 2;
  for (let i = start; i < end; i++) {
    const keep = state.live; state.live = null;
    const s = buildSignal(cs.slice(0, i + 1)); state.live = keep;
    if (s.raw === "NEUTRAL") continue;
    t++;
    const risk = s.atr * 1.5;
    let h1 = false, h2 = false;
    for (let j = i + 1; j < Math.min(i + 11, cs.length); j++) {
      if (s.raw === "BUY") {
        if (cs[j].high >= cs[i].close + risk * 2) { h1 = true; h2 = true; break; }
        if (cs[j].high >= cs[i].close + risk) h1 = true;
        if (cs[j].low <= cs[i].close - risk) break;
      } else {
        if (cs[j].low <= cs[i].close - risk * 2) { h1 = true; h2 = true; break; }
        if (cs[j].high >= cs[i].close + risk) break;
        if (cs[j].low <= cs[i].close - risk) h1 = true;
      }
    }
    if (h1) w1++; if (h2) w2++;
  }
  return t ? `TP1 ${Math.round(w1 / t * 100)}% • TP2 ${Math.round(w2 / t * 100)}% (${t})` : "—";
}

/* ---------- analisa naratif realtime: kapan buy/sell, SL/TP + alasan ---------- */
function buildAnalysis(cs, sig) {
  const L = sig.last, tf = state.tf;
  const f1 = (n) => (+n).toFixed(1), f2 = (n) => (+n).toFixed(2);
  const px = sig.price, atr = L.atr, buf = atr * 0.3;
  const bull = sig.votes.filter(v => v.v > 0).map(v => v.n);
  const bear = sig.votes.filter(v => v.v < 0).map(v => v.n);
  const flat = sig.votes.filter(v => v.v === 0).map(v => v.n);
  const pos = px > L.swingHi ? "di ATAS resistance 20-bar (breakout)" : px < L.swingLo ? "di BAWAH support 20-bar (breakdown)" : "di DALAM range 20-bar";

  function plan(side) {
    const isBuy = side === "BUY";
    const openDet = (typeof window === "undefined" || window.innerWidth >= 700) ? "open" : "";
    const entry = sig.raw === side ? px : L.e50;
    const sl = isBuy ? entry - atr * 1.5 : entry + atr * 1.5;
    const risk = Math.abs(entry - sl);
    const tp1 = isBuy ? entry + risk : entry - risk;
    const tp2 = isBuy ? entry + risk * 2 : entry - risk * 2;
    const structSL = isBuy ? L.swingLo - buf : L.swingHi + buf;
    const structTgt = isBuy ? L.swingHi : L.swingLo;
    const now = sig.raw === side;
    const why = (isBuy ? bull : bear).slice(0, 3).join("; ") || "—";
    const lawan = (isBuy ? bear : bull).slice(0, 2).join("; ") || "—";
    const kapan = now
      ? `Momentum SEARAH ${side} di ${tf} (confidence ${sig.conf}%). Opsi: market dengan size kecil, atau buy-limit/sell-limit di pullback EMA50 ${f1(L.e50)}.`
      : `JANGAN market-${isBuy ? "buy" : "sell"} sekarang. TUNGGU ${isBuy ? "pullback ke EMA50 " + f1(L.e50) + " + konfirmasi: candle " + tf + " tutup searah & RSI menembus 50" : "rally ke EMA50 " + f1(L.e50) + " + konfirmasi: candle " + tf + " tutup searah & RSI menembus 50"}. Alternatif agresif: ${isBuy ? "buy-stop di atas " + f1(L.swingHi) : "sell-stop di bawah " + f1(L.swingLo)} jika breakout dengan body penuh.`;
    const batal = isBuy ? `Close ${tf} di bawah ${f1(L.swingLo)} → ide buy BATAL (flip ke bias sell).` : `Close ${tf} di atas ${f1(L.swingHi)} → ide sell BATAL (flip ke bias buy).`;
    return `<details class="plan ${isBuy ? "buy" : "sell"}" ${openDet}><summary><b>Rencana ${side}</b> — Entry ${f2(entry)} | SL ${f2(sl)} | TP1 ${f2(tp1)} | TP2 ${f2(tp2)}</summary>
      <ul><li><b>Kapan:</b> ${kapan}</li>
      <li><b>Kenapa entry di situ:</b> ${now ? "harga sudah di sisi benar EMA50 + voting indikator menang." : "EMA50 = value-area dinamis " + tf + "; entry di sana memberi risk/reward terbaik, bukan kejar harga."} ${why}.</li>
      <li><b>Kenapa SL di situ:</b> 1.5× ATR(${f2(atr)}) = risiko $${f1(risk)}. Alternatif SL struktur: ${f2(structSL)} (di luar ${isBuy ? "support" : "resistance"} ${f1(isBuy ? L.swingLo : L.swingHi)} + buffer $${f1(buf)} anti-noise).</li>
      <li><b>Kenapa TP di situ:</b> TP1 = 1R (${f2(tp1)}, dekat target struktur ${f1(structTgt)} → kunci partial), TP2 = 2R (${f2(tp2)} → runner).</li>
      <li><b>Waspada (kubu lawan):</b> ${lawan}.</li>
      <li><b>Batal jika:</b> ${batal}</li></ul></details>`;
  }
  const gBanner = sig.grade === "A+" ? "PROBABILITAS TERTINGGI — semua filter lolos, ikuti trigger di bawah"
    : sig.grade === "A" ? "Bagus tapi belum elite — size kecil, atau tunggu konfirmasi candle berikutnya"
    : sig.grade === "B" ? "Campuran — JANGAN entry dulu, tunggu setup A+"
    : "Tidak ada edge — tutup chart, jangan paksa entry. Disiplin menunggu = profit.";
  // --- analisa lanjutan: skor voting, level kunci, pivot, fibonacci, sesi, manajemen trade ---
  let wBull = 0, wBear = 0;
  sig.votes.forEach(v => { if (v.v > 0) wBull += v.w; else if (v.v < 0) wBear += v.w; });
  const totW = wBull + wBear;
  const scoreTxt = totW ? `${Math.round(100 * wBull / totW)}% BULL vs ${Math.round(100 * wBear / totW)}% BEAR (net ${sig.score >= 0 ? "+" : ""}${sig.score})` : "imbang";
  const win50 = cs.slice(Math.max(0, cs.length - 50));
  const majHi = Math.max(...win50.map(x => x.high)), majLo = Math.min(...win50.map(x => x.low));
  const majTxt = `${f1(majLo)} / ${f1(majHi)}` + (px < majLo ? " — di BAWAH support utama (breakdown)" : px > majHi ? " — di ATAS resistance utama (breakout)" : " — harga di dalam area ini");
  const pv = pivotLevels(cs);
  const pvTxt = pv ? `P ${f1(pv.P)} • R1 ${f1(pv.R1)} • R2 ${f1(pv.R2)} • S1 ${f1(pv.S1)} • S2 ${f1(pv.S2)}${px > pv.R1 ? " — di atas R1" : px < pv.S1 ? " — di bawah S1" : ""}` : "data harian belum cukup";
  const fibs = fibLevels(cs);
  let fibTxt = "—";
  if (fibs) {
    const near = fibs.levels.filter(l => Math.abs(l.p - px) <= 2 * atr);
    fibTxt = fibs.levels.map(l => l.p.toFixed(1)).join(" / ") + (near.length ? ` — dekat harga: ${near.map(l => l.p.toFixed(1)).join(", ")}` : "");
  }
  const hNow = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
  const sessName = hNow >= 7 && hNow < 12 ? "London" : hNow >= 12 && hNow < 21 ? "New York" : hNow >= 0 && hNow < 7 ? "Asia" : "Off";
  const liq = hNow >= 12 && hNow < 16 ? "Overlap London–NY, likuiditas tertinggi" : hNow >= 7 && hNow < 12 ? "London aktif" : hNow >= 12 && hNow < 21 ? "New York aktif" : hNow >= 0 && hNow < 7 ? "Asia aktif" : "Jam sepi — spread lebar, hindari entry";
  const mgmt = sig.raw === "BUY"    ? `TP1 (1R) → kunci 50% posisi, SL pindah ke breakeven. TP2 (2R) → runner, trailing 2×ATR. Batal jika close ${tf} < ${f1(L.swingLo)}.`
    : sig.raw === "SELL"
    ? `TP1 (1R) → kunci 50% posisi, SL pindah ke breakeven. TP2 (2R) → runner, trailing 2×ATR. Batal jika close ${tf} > ${f1(L.swingHi)}.`
    : "Belum ada posisi — disiplin menunggu setup A+ lebih baik daripada memaksa entry.";
  const gWhy = sig.whyNot && sig.whyNot.length ? `<div class="kv"><span>Syarat A+ yg belum lolos</span><b>${sig.whyNot.join("; ")}</b></div>` : "";
  const gZone = sig.zone != null ? `<div class="kv"><span>Zona limit ideal</span><b>${sig.zone.toFixed(1)} (tunggu pullback ke EMA, entry lebih murah; ekstensi harga ${sig.extATR.toFixed(1)}× ATR${sig.extATR > 1 ? " — KEJAR HARGA = dilarang" : ""})</b></div>` : "";
  return `<div class="gradebanner g${sig.grade.replace("+", "p")}">SETUP ${sig.grade} — ${gBanner}</div>${gWhy}${gZone}
  <div class="kv"><span>Posisi harga</span><b>${f2(px)} — ${pos}</b></div>
    <div class="kv"><span>Skor voting</span><b>${scoreTxt}</b></div>
    <div class="kv"><span>Support/Resistance utama (50 bar)</span><b>${majTxt}</b></div>
    <div class="kv"><span>Pivot harian (klasik)</span><b>${pvTxt}</b></div>
    <div class="kv"><span>Fibonacci (swing 60 bar)</span><b>${fibTxt}</b></div>
    <div class="kv"><span>Range 20 bar</span><b>${f1(L.swingLo)} – ${f1(L.swingHi)}</b></div>
    <div class="kv"><span>EMA20 / 50 / 200</span><b>${f1(L.e20)} / ${f1(L.e50)} / ${f1(L.e200)}</b></div>
    <div class="kv"><span>RSI14</span><b>${f1(L.rsi)} (bar lalu ${f1(L.rsiPrev)}) ${L.rsi > 55 ? "— bullish" : L.rsi < 45 ? "— bearish" : "— netral"}</b></div>
    <div class="kv"><span>MACD line/signal/hist</span><b>${f2(L.macdLine)} / ${f2(L.macdSig)} / ${f2(L.macdH)} ${L.macdH > 0 ? "— momentum beli" : "— momentum jual"}</b></div>
    <div class="kv"><span>ADX / DI+ / DI-</span><b>${L.adx != null ? f1(L.adx) + " / " + f1(L.plusDI) + " / " + f1(L.minusDI) + (L.adx < 15 ? " — CHOP, jangan kejar trend" : L.adx >= 20 ? " — TREND sehat" : " — transisi") : "data kurang"}</b></div>
    <div class="kv"><span>Bias ${L.htfN} (HTF)</span><b>${L.htfOk ? "EMA " + f1(L.htfE) + " • RSI " + f1(L.htfR) + (px > L.htfE && L.htfR > 50 ? " — searah BUY" : px < L.htfE && L.htfR < 50 ? " — searah SELL" : " — mixed, hati-hati") : "data kurang"}</b></div>
    <div class="kv"><span>Bollinger %B</span><b>${L.bb != null ? L.bb.toFixed(2) + (L.bb < 0.15 ? " — oversold, rawan pantul" : L.bb > 0.85 ? " — overbought, rawan reject" : " — tengah band") : "—"}</b></div>
    <div class="kv"><span>Volatilitas</span><b>ATR ${f2(atr)} (${f1(L.volX)}× normal)${L.volX > 1.8 ? " — MELONJAK: setengah lot, jangan rapatkan SL" : ""}</b></div>
    <div class="kv"><span>Divergensi RSI</span><b>${L.div > 0 ? "BULLISH — harga LL, RSI HL (waspada pantulan)" : L.div < 0 ? "BEARISH — harga HH, RSI LH (waspada reject)" : "tidak ada"}</b></div>
    <div class="kv"><span>Fundamental (DXY•US10Y•D1)</span><b>${(typeof fundState !== "undefined" && fundState.ok) ? `skor ${fundState.score > 0 ? "+" : ""}${fundState.score} (${fundState.score > 0 ? "backdrop BULLISH — SELL dipersulit" : fundState.score < 0 ? "backdrop BEARISH — BUY dipersulit" : "netral"}) — ${fundState.note}` : "offline — keputusan murni teknikal, waspada"}</b></div>
    <div class="kv"><span>Bukti reversal (pelajaran 4401)</span><b>bull ${L.revBull ?? 0}/4 • bear ${L.revBear ?? 0}/4${L.nearSup50 ? ` • dekat support 50-bar ${f1(L.majLo)}` : ""}${L.nearRes50 ? ` • dekat resistance 50-bar ${f1(L.majHi)}` : ""}${(L.revBull >= 3 || L.revBear >= 3) ? " — sinyal tren yang melawan bukti ini DITAHAN/dibalik" : ""}</b></div>${sig.exNote ? `<div class="kv"><span>Rem exhaustion</span><b>${sig.exNote}</b></div>` : ""}${sig.tag === "COUNTERTREND" ? `<div class="kv"><span>Mode</span><b>COUNTERTREND — size setengah, TP di mean (EMA), batal jika extreme jebol lagi</b></div>` : ""}
    <div class="kv"><span>Sesi & likuiditas</span><b>${sessName} (${new Date().toISOString().slice(11, 16)} UTC) — ${liq}</b></div>
    <div class="kv"><span>Manajemen trade</span><b>${mgmt}</b></div>
    ${flat.length ? `<div class="kv"><span>Netral (tunggu)</span><b>${flat.join("; ")}</b></div>` : ""}
    ${plan("BUY")}${plan("SELL")}`;
}

/* ---------- live price ---------- */
async function pollLive() {
  const tries = [
    async () => { const r = await fetchTO("https://api.gold-api.com/price/XAU"); const j = await r.json(); return { p: +j.price, s: "gold-api.com" }; },
    async () => { const r = await fetchTO("https://data-asg.goldprice.org/dbXRates/USD"); const j = await r.json(); return { p: +j.items[0].xauPrice, s: "goldprice.org" }; },
    async () => { const r = await fetchTO("https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=1m&limit=1"); const j = await r.json(); return { p: +j[0][4], s: "binance PAXG 1m*" }; },
    async () => { const r = await fetchTO("https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT"); const j = await r.json(); return { p: +j.price, s: "binance PAXG*" }; },
  ];
  for (const fn of tries) { try { const { p, s } = await fn(); if (isFinite(p) && p > 0) { state.prevLive = state.live; state.live = p; renderLive(s); return; } } catch { } }
}
function renderLive(src) {
  if (!state.wsOk) $("liveSrc").textContent = src || "";
  paintLive();
}

/* ---------- chart TradingView resmi (Lightweight Charts v4, file lokal di vendor/) ---------- */
let LW = null; // {chart, candle, ema20, ema50, key, lines}
function toTs(t) {
  if (typeof t === "number") return Math.floor(t / 1000);
  const s = String(t);
  return Math.floor(Date.parse(s.length > 10 ? s.replace(" ", "T") + "Z" : s + "T00:00:00Z") / 1000);
}
function sizeLW() {
  if (!LW) return;
  const el = $("lwChart");
  LW.chart.applyOptions({
    width: (el && el.clientWidth) || 800,
    height: (typeof window !== "undefined" && window.innerWidth < 700) ? 320 : 420,
  });
}
function initLW() {
  const el = $("lwChart");
  if (!el || typeof window === "undefined" || !window.LightweightCharts || LW) return !!LW;
  try {
    const chart = window.LightweightCharts.createChart(el, {
      layout: { background: { color: "#0d0d0d" }, textColor: "#9a9a9a", fontSize: 11 },
      grid: { vertLines: { color: "rgba(42,42,42,.6)" }, horzLines: { color: "rgba(42,42,42,.6)" } },
      rightPriceScale: { borderColor: "#2a2a2a" },
      timeScale: { borderColor: "#2a2a2a", timeVisible: true },
    });
    LW = {
      chart,
      candle: chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", wickUpColor: "#26a69a", wickDownColor: "#ef5350", borderVisible: false }),
      ema20: chart.addLineSeries({ color: "#e8b64c", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      ema50: chart.addLineSeries({ color: "#5b8ff9", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      key: "", lines: [],
    };
    sizeLW();
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => sizeLW()).observe(el);
    else window.addEventListener("resize", sizeLW);
    $("lwStatus").textContent = "chart: siap ✔";
    return true;
  } catch (e) { $("lwStatus").textContent = "chart: gagal (" + e.message + ")"; return false; }
}
function clearLWLines() {
  if (!LW) return;
  LW.lines.forEach(l => { try { LW.candle.removePriceLine(l); } catch { } });
  LW.lines = [];
}
function renderLW(sig) {
  if (!initLW()) return false;
  const cs = state.candles;
  if (cs.length < 30) return true;
  const N = Math.min(300, cs.length);
  const data = cs.slice(-N), off = cs.length - N;
  // saring bar agar waktu naik ketat (syarat mutlak library)
  const idx = [];
  let pt = -Infinity;
  data.forEach((c, j) => { const t = toTs(c.time); if (isFinite(t) && t > pt) { pt = t; idx.push(j); } });
  if (idx.length < 30) return true;
  const bars = idx.map(j => { const c = data[j]; return { time: toTs(c.time), open: c.open, high: c.high, low: c.low, close: c.close }; });
  const cl = closes(cs), e20f = ema(cl, 20), e50f = ema(cl, 50);
  const e20 = idx.map(j => ({ time: bars[idx.indexOf(j)].time, value: e20f[off + j] }));
  const e50 = idx.map(j => ({ time: bars[idx.indexOf(j)].time, value: e50f[off + j] }));
  const key = state.tf + "|" + bars.length + "|" + bars[0].time + "|" + bars[bars.length - 1].time;
  if (LW.key !== key) {
    LW.key = key;
    LW.candle.setData(bars);
    LW.ema20.setData(e20);
    LW.ema50.setData(e50);
    LW.chart.timeScale().scrollToRealTime();
  } else {
    const lb = bars[bars.length - 1];
    LW.candle.update(lb);
    LW.ema20.update(e20[e20.length - 1]);
    LW.ema50.update(e50[e50.length - 1]);
  }
  // marker flip sinyal
  const marks = [];
  let prevRaw = null;
  for (let g = Math.max(1, cs.length - 40); g < cs.length; g++) {
    const s = buildSignal(cs.slice(0, g + 1));
    if (s.raw !== "NEUTRAL" && s.raw !== prevRaw && s.conf >= 40) {
      marks.push({
        time: toTs(cs[g].time),
        position: s.raw === "BUY" ? "belowBar" : "aboveBar",
        color: s.raw === "BUY" ? "#26a69a" : "#ef5350",
        shape: s.raw === "BUY" ? "arrowUp" : "arrowDown",
        text: (s.raw === "BUY" ? "BUY " : "SELL ") + s.conf,
      });
    }
    if (s.raw !== "NEUTRAL") prevRaw = s.raw;
  }
  try { LW.candle.setMarkers(marks); } catch { }
  // garis posisi: entry / SL / TP / S-R
  clearLWLines();
  const lv = sig.lv, L = sig.last, f = (n) => (+n).toFixed(1);
  const add = (price, color, title, dash) => {
    try { LW.lines.push(LW.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: dash ? 2 : 0, axisLabelVisible: true, title })); } catch { }
  };
  add(L.swingHi, "#777777", "R " + f(L.swingHi), true);
  add(lv.tp2, "#26a69a", "TP2 " + f(lv.tp2), false);
  if (sig.raw !== "NEUTRAL") add(lv.tp1, "#26a69a", "TP1 " + f(lv.tp1), true);
  add(lv.e, "#e8b64c", (sig.raw === "NEUTRAL" ? "PX " : sig.raw + " ") + f(lv.e), false);
  add(lv.sl, "#ef5350", "SL " + f(lv.sl), true);
  add(L.swingLo, "#777777", "S " + f(L.swingLo), true);
  return true;
}
function renderChart(sig) {
  const pill = $("chartPill");
  if (pill) {
    pill.className = "chart-pill " + sig.raw.toLowerCase();
    pill.innerHTML = `<b>${sig.dir}</b> ${sig.conf}% • Entry ${sig.lv.e.toFixed(1)} • SL ${sig.lv.sl.toFixed(1)} • TP1 ${sig.lv.tp1.toFixed(1)} • TP2 ${sig.lv.tp2.toFixed(1)}`;
  }
  const pc = $("posCard");
  if (typeof window !== "undefined" && window.LightweightCharts) {
    const ok = renderLW(sig);
    if (pc) pc.hidden = ok;
  } else {
    if (pc) pc.hidden = false;
    drawPosChart(sig);
  }
}

/* ---------- realtime: WebSocket Binance (tick/detik + candle live) ---------- */
function setWsStatus(txt, ok) {
  $("wsStatus").textContent = txt;
  $("wsStatus").style.color = ok ? "#26a69a" : "#e8b64c";
  const d = $("liveDot");
  d.style.background = ok ? "#26a69a" : "#e8b64c";
  d.style.boxShadow = ok ? "0 0 8px #26a69a" : "none";
}
function connectWS() {
  if ($("demoMode").checked) { setWsStatus("WS off (demo)", false); return; }
  try { if (state.ws) state.ws.close(); } catch { }
  state.wsOk = false; setWsStatus("WS: menghubungkan…", false);
  const url = `wss://stream.binance.com:9443/stream?streams=paxgusdt@miniTicker/paxgusdt@kline_${TF_CONF[state.tf].ws}`;
  let ws;
  try { ws = new WebSocket(url); } catch { scheduleWsRetry(); return; }
  state.ws = ws;
  ws.onopen = () => { state.wsOk = true; state.wsRetry = 0; setWsStatus("WS: LIVE ✔", true); $("liveSrc").textContent = "binance WS"; };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    const d = m.data || m;
    if (d.e === "24hrMiniTicker" && d.c) onTick(+d.c);
    else if (d.e === "kline" && d.k) {
      if (d.k.x) refresh(); // candle tutup → sinkron histori langsung
      else onTick(+d.k.c);
    }
  };
  ws.onerror = () => { try { ws.close(); } catch { } };
  ws.onclose = () => {
    if (state.ws !== ws) return;
    state.wsOk = false; setWsStatus("WS putus → polling", false);
    scheduleWsRetry();
  };
}
function scheduleWsRetry() {
  if ($("demoMode").checked) return;
  state.wsRetry = (state.wsRetry || 0) + 1;
  setTimeout(() => { if (!state.wsOk && !$("demoMode").checked) connectWS(); }, Math.min(15000, 2000 * state.wsRetry));
}
function onTick(p) {
  if (!isFinite(p) || p <= 0) return;
  state.prevLive = state.live; state.live = p;
  state.ticks.push(p); if (state.ticks.length > 180) state.ticks.shift();
  const cs = state.candles;
  if (cs.length && !$("demoMode").checked) {
    const last = cs[cs.length - 1];
    last.close = p;
    if (p > last.high) last.high = p;
    if (p < last.low) last.low = p;
  }
  const now = Date.now();
  if (now - state.lastPaint > 400) { state.lastPaint = now; paintLive(); }
  if (now - state.lastRecomp > 3000 && cs.length > 60) { state.lastRecomp = now; liveRecompute(); }
}
function paintLive() {
  if (state.live == null) return;
  const el = $("livePrice");
  el.textContent = state.live.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (state.prevLive && state.live !== state.prevLive) {
    const up = state.live > state.prevLive;
    $("priceChg").textContent = `${up ? "▲ +" : "▼ "}${(state.live - state.prevLive).toFixed(2)}`;
    $("priceChg").style.color = up ? "#26a69a" : "#ef5350";
    el.classList.remove("fup", "fdn"); void el.offsetWidth; el.classList.add(up ? "fup" : "fdn");
  }
  $("lastUpdate").textContent = "live " + new Date().toLocaleTimeString("id-ID");
  state.lastTickT = Date.now();
  $("tickRate").textContent = state.wsOk ? `${state.ticks.length} tick WS` : "mode polling";
  drawSpark();
}
function drawSpark() {
  const cv = $("spark"), t = state.ticks;
  if (!cv || t.length < 2) return;
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  const mn = Math.min(...t), mx = Math.max(...t), rg = (mx - mn) || 1;
  const Y = (p) => H - 4 - ((p - mn) / rg) * (H - 10);
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  t.forEach((p, i) => { const x = (i / (t.length - 1)) * W; i ? ctx.lineTo(x, Y(p)) : ctx.moveTo(x, Y(p)); });
  const up = t[t.length - 1] >= t[0];
  ctx.strokeStyle = up ? "#26a69a" : "#ef5350"; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = up ? "#26a69a" : "#ef5350";
  ctx.beginPath(); ctx.arc(W - 3, Y(t[t.length - 1]), 2.6, 0, 7); ctx.fill();
}
function liveRecompute() {
  if (!state.candles.length) return;
  render(buildSignal(state.candles), state._bt || "…"); // alert STRONG ikut bunyi realtime via guard internal render()
}
/* Staleness guard: harga basi >20 dtk TANPA update = jangan dipercaya. */
function checkFresh() {
  const el = $("wsStatus");
  if (!el || $("demoMode").checked) return;
  const age = Date.now() - (state.lastTickT || 0);
  if (!state.lastTickT || age > 20000) {
    el.dataset.stale = "1";
    el.textContent = `⚠ DATA BASI ${state.lastTickT ? Math.round(age / 1000) + "s" : "—"} — harga di layar mungkin tidak akurat`;
    el.style.color = "#ef5350";
    const d = $("liveDot");
    d.style.background = "#ef5350"; d.style.boxShadow = "none";
  } else if (el.dataset.stale === "1") {
    el.dataset.stale = "";
    setWsStatus(state.wsOk ? "WS: LIVE ✔" : "polling 8s ✔", state.wsOk);
  }
}
function candleCloseMs() {
  const n = Date.now();
  if (state.tf === "M15") return 900e3 - (n % 900e3);
  if (state.tf === "H1") return 3600e3 - (n % 3600e3);
  if (state.tf === "H4") return 4 * 3600e3 - (n % (4 * 3600e3));
  return 86400e3 - (n % 86400e3);
}
function fmtMs(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + "j " : "") + String(m).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
}

/* ---------- chart lokal + marker posisi (TradingView iframe tak bisa digambari) ---------- */
function tstr(t) {
  if (typeof t === "number") { const d = new Date(t); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); }
  const s = String(t);
  return s.length > 10 ? s.slice(11, 16) : s.slice(5);
}
function drawPosChart(sig) {
  const cv = $("posChart");
  if (!cv || !state.candles.length || typeof cv.getContext !== "function") return;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const W = cv.clientWidth || 800, H = 400;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px";
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const N = Math.min(120, state.candles.length);
  const data = state.candles.slice(-N);
  const lv = sig.lv, L = sig.last;
  const px = state.live ?? L.close;
  let mn = Math.min(...data.map(c => c.low), lv.sl, lv.tp1, lv.tp2, lv.e, px);
  let mx = Math.max(...data.map(c => c.high), lv.sl, lv.tp1, lv.tp2, lv.e, px);
  const pad = (mx - mn) * 0.08 || 1; mn -= pad; mx += pad;
  const ML = 6, MR = 66, MT = 10, MB = 20, PW = W - ML - MR, PH = H - MT - MB;
  const X = j => ML + ((j + 0.5) / N) * PW;
  const Y = p => MT + (1 - (p - mn) / (mx - mn)) * PH;
  const cw = Math.max(2, (PW / N) * 0.62);
  ctx.font = "10px system-ui"; ctx.lineWidth = 1;
  ctx.strokeStyle = "#242424"; ctx.fillStyle = "#888";
  for (let g = 0; g <= 4; g++) {
    const p = mn + ((mx - mn) * g) / 4, y = Y(p);
    ctx.beginPath(); ctx.moveTo(ML, y); ctx.lineTo(W - MR, y); ctx.stroke();
    ctx.fillText(p.toFixed(1), W - MR + 5, y + 3);
  }
  for (let j = 0; j < N; j += Math.ceil(N / 6)) ctx.fillText(tstr(data[j].time), X(j) - 12, H - 5);
  data.forEach((c, j) => {
    const col = c.close >= c.open ? "#26a69a" : "#ef5350";
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(X(j), Y(c.high)); ctx.lineTo(X(j), Y(c.low)); ctx.stroke();
    const yO = Y(c.open), yC = Y(c.close);
    ctx.fillRect(X(j) - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
  });
  const cl = closes(state.candles);
  [["#e8b64c", ema(cl, 20)], ["#5b8ff9", ema(cl, 50)]].forEach(([col, arr]) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath();
    arr.slice(-N).forEach((v, j) => { j ? ctx.lineTo(X(j), Y(v)) : ctx.moveTo(X(j), Y(v)); });
    ctx.stroke(); ctx.lineWidth = 1;
  });
  // marker flip sinyal historis (▲ BUY / ▼ SELL, conf>=40)
  let prevRaw = null;
  const off = state.candles.length - N;
  for (let j = Math.max(1, N - 40); j < N; j++) {
    const s = buildSignal(state.candles.slice(0, off + j + 1));
    if (s.raw !== "NEUTRAL" && s.raw !== prevRaw && s.conf >= 40) {
      const c = data[j];
      ctx.fillStyle = s.raw === "BUY" ? "#26a69a" : "#ef5350";
      if (s.raw === "BUY") {
        const y = Y(c.low) + 9;
        ctx.beginPath(); ctx.moveTo(X(j), y + 8); ctx.lineTo(X(j) - 5, y); ctx.lineTo(X(j) + 5, y); ctx.fill();
      } else {
        const y = Y(c.high) - 9;
        ctx.beginPath(); ctx.moveTo(X(j), y - 8); ctx.lineTo(X(j) - 5, y); ctx.lineTo(X(j) + 5, y); ctx.fill();
      }
    }
    if (s.raw !== "NEUTRAL") prevRaw = s.raw;
  }
  const line = (p, col, tag, dash) => {
    const y = Y(p);
    ctx.strokeStyle = col; ctx.setLineDash(dash || []); ctx.beginPath();
    ctx.moveTo(ML, y); ctx.lineTo(W - MR, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; ctx.fillRect(W - MR, y - 9, MR - 2, 17);
    ctx.fillStyle = "#0d0d0d"; ctx.fillText(tag, W - MR + 5, y + 3.5);
  };
  line(L.swingHi, "#777", "R " + L.swingHi.toFixed(1), [3, 3]);
  line(lv.tp2, "#26a69a", "TP2 " + lv.tp2.toFixed(1));
  if (sig.raw !== "NEUTRAL") line(lv.tp1, "#26a69a", "TP1 " + lv.tp1.toFixed(1), [6, 3]);
  line(lv.e, "#e8b64c", (sig.raw === "NEUTRAL" ? "PX " : sig.raw + " ") + lv.e.toFixed(1));
  line(lv.sl, "#ef5350", "SL " + lv.sl.toFixed(1), [6, 3]);
  line(L.swingLo, "#777", "S " + L.swingLo.toFixed(1), [3, 3]);
  ctx.strokeStyle = "#f2f2f2"; ctx.setLineDash([2, 3]); ctx.beginPath();
  ctx.moveTo(ML, Y(px)); ctx.lineTo(W - MR, Y(px)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#f2f2f2"; ctx.beginPath(); ctx.arc(W - MR - 4, Y(px), 3, 0, 7); ctx.fill();
}

/* ---------- render ---------- */
function beep() {
  if (!$("soundOn").checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination); o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    o.start(); o.stop(ctx.currentTime + 0.35);
  } catch { }
}
function render(sig, bt) {
  const box = $("signalBox");
  box.className = "signal " + sig.raw.toLowerCase();
  $("signalDir").textContent = sig.dir;
  $("signalConf").textContent = `Confidence ${sig.conf}% • ${state.tf} • ATR ${sig.atr.toFixed(2)}${sig.chop ? " • RANGE" : ""}`;
  const gEl = $("signalGrade");
  if (gEl) {
    const gMsg = { "A+": "SETUP A+ • LAYAK EKSEKUSI", "A": "Setup A • size kecil / tunggu konfirmasi", "B": "Setup B • TUNGGU A+", "TUNGGU": "TUNGGU — tak ada edge, jangan paksa" }[sig.grade];
    gEl.textContent = gMsg;
    gEl.className = "grade g" + sig.grade.replace("+", "p");
  }
  const top = [...sig.votes].sort((a, b) => b.w - a.w).slice(0, 3).map(v => v.n).join(" • ");
  $("signalReason").textContent = top;
  const patEl = $("signalPattern");
  if (patEl && sig.pattern) {
    patEl.className = "pattern " + (sig.pattern.dir > 0 ? "bull" : sig.pattern.dir < 0 ? "bear" : "flat");
    patEl.innerHTML = `Pola candle: <b>${sig.pattern.name}</b> — ${sig.pattern.note}`;
  }
  $("lvEntry").textContent = sig.lv.e.toFixed(2);
  $("lvSL").textContent = sig.lv.sl.toFixed(2);
  $("lvTP1").textContent = sig.lv.tp1.toFixed(2);
  $("lvTP2").textContent = sig.lv.tp2.toFixed(2);
  $("mATR").textContent = sig.atr.toFixed(2);
  $("mSpread").textContent = (sig.atr * 0.08).toFixed(2) + " est";
  const h = new Date().getUTCHours();
  $("mSession").textContent = h >= 7 && h < 12 ? "London" : h >= 12 && h < 21 ? "New York" : h >= 0 && h < 7 ? "Asia" : "Off";
  $("mWin").textContent = bt;
  $("indBody").innerHTML = sig.votes.map(v =>
    `<tr><td>${v.n}</td><td class="${v.v > 0 ? "bull" : v.v < 0 ? "bear" : "flat"}">${v.v > 0 ? "BULLISH" : v.v < 0 ? "BEARISH" : "FLAT"}</td></tr>`).join("");
  $("analysisBox").innerHTML = buildAnalysis(state.candles, sig);
  state._sig = sig;
  const pt = $("posTF"); if (pt) pt.textContent = state.tf;
  renderChart(sig);
  const sb = $("stickyBar");
  if (sb) {
    const sd = $("sbDir"), sl2 = $("sbLv");
    sd.textContent = `${sig.grade} ${sig.raw} ${sig.conf}%`;
    sd.className = "sb-dir " + sig.raw.toLowerCase();
    sl2.textContent = `E ${sig.lv.e.toFixed(1)} • SL ${sig.lv.sl.toFixed(1)} • TP1 ${sig.lv.tp1.toFixed(1)}`;
  }
  calcLot(sig);
  if (sig.grade === "A+" && state.lastSignal !== sig.dir + sig.lv.e.toFixed(0)) {
    state.lastSignal = sig.dir + sig.lv.e.toFixed(0);
    beep(); pushHist(sig);
  }
}
function calcLot(sig) {
  const bal = +$("inBalance").value || 0, risk = +$("inRisk").value || 0;
  const dist = Math.abs(sig.lv.e - sig.lv.sl);
  if (!dist) { $("outLot").textContent = "—"; return; }
  const lot = (bal * risk / 100) / (dist * 100); // 1 lot XAU = 100 oz
  $("outLot").textContent = lot.toFixed(2) + " lot";
  $("outRiskUsd").textContent = `($${(bal * risk / 100).toFixed(0)} risk, SL ${dist.toFixed(1)} $)`;
}
function pushHist(sig) {
  const k = "xau_hist";
  const h = JSON.parse(localStorage.getItem(k) || "[]");
  h.unshift({ t: new Date().toLocaleString("id-ID"), tf: state.tf, d: sig.dir, c: sig.conf + "%", e: sig.lv.e.toFixed(1), sl: sig.lv.sl.toFixed(1), tp2: sig.lv.tp2.toFixed(1) });
  localStorage.setItem(k, JSON.stringify(h.slice(0, 50)));
  drawHist();
}
function drawHist() {
  const h = JSON.parse(localStorage.getItem("xau_hist") || "[]");
  $("histBody").innerHTML = h.length ? h.map(x =>
    `<tr><td>${x.t}</td><td>${x.tf}</td><td>${x.d}</td><td>${x.c}</td><td>${x.e}</td><td>${x.sl}</td><td>${x.tp2}</td></tr>`).join("")
    : `<tr><td colspan="7">Belum ada.</td></tr>`;
}

/* ---------- main flow ---------- */
async function refresh() {
  const demo = $("demoMode").checked;
  $("dataStatus").textContent = "memuat data…";
  try {
    let cs, fromStooq = false;
    if (demo) throw new Error("demo");
    try { cs = await getStooq(state.tf); fromStooq = true; $("dataStatus").textContent = "data: Stooq XAUUSD ✔"; }
    catch { cs = await getBinance(state.tf); $("dataStatus").textContent = "data: Binance PAXG (proxy) ✔"; }
    if (fromStooq && TF_CONF[state.tf].resample) cs = resample(cs, TF_CONF[state.tf].resample);
    // M15 butuh 480 bar agar bias HTF H4 (resample ×16 → 30 bar) valid; dulu slice(-300)
    // membuat htf.ok selalu false di M15 sehingga filter HTF mati diam-diam.
    state.candles = cs.slice(-(state.tf === "M15" ? 480 : 300));
  } catch {
    state.candles = genDemo(state.live || 2650);
    $("dataStatus").textContent = "data: DEMO offline (simulasi)";
  }
  if (!state.wsOk) await pollLive();
  state._bt = state.candles.length > 60 ? backtest(state.candles) : "—";
  render(buildSignal(state.candles), state._bt);
  // Fundamental non-blocking (jangan perlambat render): setelah tiba, hitung ulang sekali.
  refreshFundamentals().then(() => { if (state.candles.length) render(buildSignal(state.candles), state._bt); }).catch(() => {});
  if (!state.wsOk && !demo) connectWS();
  state.countdown = 60;
}

document.querySelectorAll(".tf").forEach(b => b.onclick = () => {
  document.querySelectorAll(".tf").forEach(x => x.classList.remove("active"));
  b.classList.add("active"); state.tf = b.dataset.tf;
  $("activeTF").textContent = state.tf; state.lastSignal = null;
  state.ticks = []; state._bt = null;
  loadTV(state.tf); refresh(); connectWS();
});
$("btnClearHist").onclick = () => { localStorage.removeItem("xau_hist"); drawHist(); };
$("inBalance").oninput = $("inRisk").oninput = () => { if (state.candles.length) calcLot(buildSignal(state.candles)); };
$("demoMode").onchange = () => {
  if ($("demoMode").checked) { try { state.ws.close(); } catch { } state.wsOk = false; }
  else state.ticks = [];
  refresh(); connectWS();
};

loadTV(state.tf); drawHist(); refresh(); connectWS();
if (typeof window !== "undefined") {
  let rT;
  window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(() => { sizeLW(); if (state._sig) renderChart(state._sig); }, 200); });
}
setInterval(() => { if (!state.wsOk && !$("demoMode").checked) pollLive(); }, 8000);
setInterval(async () => {
  $("candleCd").textContent = "candle tutup " + fmtMs(candleCloseMs());
  $("countdown").textContent = state.wsOk ? "WS live" : ("sync " + state.countdown + "s");
  checkFresh();
  if (--state.countdown <= 0) refresh();
}, 1000);
