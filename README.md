# XAUUSD Signal — Web Lokal

Jalankan lokal, tanpa build, tanpa API key.

## Akses online (GitHub Pages)

[https://robprian.github.io/caricuan/](https://robprian.github.io/caricuan/)

## Cara pakai (pilih satu)

```bash
cd xauusd-signal
python3 -m http.server 8080
# buka http://localhost:8080
```

atau double-click `index.html` (mode demo tetap jalan; live price butuh http agar tidak kena CORS `file://`).

## Isi folder

- `index.html` — UI utama
- `styles.css` — tema dark gold
- `app.js` — engine sinyal lokal (EMA20/50/200, RSI14, MACD pulih-2-bar, Stochastic cross, ATR14, momentum, ADX, Bollinger regime-aware, bias HTF, vote fundamental DXY/US10Y/regime-D1 + ambang asimetris, pullback guard anti-sell-di-dasar) + live price + backtest 100 bar + kalkulator lot + riwayat localStorage
- `TradingViewWidget.jsx` — port 1:1 dari kode kamu, symbol diganti `OANDA:XAUUSD` (untuk proyek React)

## Sumber data

| Kebutuhan | Sumber | Keterangan |
|---|---|---|
| Chart visual | TradingView embed `OANDA:XAUUSD` | butuh internet sekali load; tidak menyediakan API data |
| OHLC histori | `stooq.com/q/d/l/?s=xauusd` | XAUUSD spot asli, gratis, tanpa key |
| Fallback OHLC | Binance `PAXGUSDT` klines | proxy gold (±0.5%) |
| Live price | Binance WebSocket `miniTicker` + `kline` (tick per detik, auto-fallback ke polling gold-api.com → goldprice.org → binance REST 8 detik) |
| Offline | Mode demo (centang di UI) | random-walk sintetik |
| Fundamental | Stooq harian `dx.f` (DXY) + `10usy.b` (US10Y) dan klines harian Binance PAXG (regime D1 vs EMA50) | best-effort tanpa key; offline = engine murni teknikal |

> Catatan jujur: widget `embed-widget-advanced-chart.js` TIDAK mengekspos data OHLC ke JS — ia hanya iframe visual. Jadi sinyal dihitung dari feed publik di atas, bukan "disedot" dari TradingView. Ini batasan resmi TradingView; alternatif resmi berbayar adalah Webhook/Strategy Alert.

## Timeframe

M15 / H1 / H4 (resample 4×H1) / D1 — ganti TF maka chart TradingView + engine ikut ganti.

## Disclaimer

Bukan saran keuangan. Selalu pakai SL.
