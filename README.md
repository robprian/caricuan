# XAUUSD Signal — Web Lokal

1 chart + sinyal + analisa multi-timeframe. Tanpa build, tanpa API key.

## Akses online (GitHub Pages)

[https://robprian.github.io/caricuan/](https://robprian.github.io/caricuan/)

## Cara pakai

```bash
cd xauusd-signal
python3 -m http.server 8080
# buka http://localhost:8080
```

## Isi folder

- `index.html` — UI: 1 chart + sinyal + analisa ringkas
- `styles.css` — tema dark gold
- `app.js` — engine sinyal lokal: voting EMA/RSI/MACD/Stoch/ATR/ADX/Bollinger +
  pullback guard + vote fundamental (DXY/US10Y/regime D1, ambang asimetris) +
  analisa MTF (M15/H1/H4/D1) + live WS + backtest + kalkulator lot + riwayat
- `vendor/` — library chart lokal (offline-ready)

## Cara kerja singkat

| Bagian | Isi |
|---|---|
| Chart | 1 chart lokal (candlestick + EMA20/50 + marker ▲/▼ + garis Entry/SL/TP1/TP2) |
| Sinyal TF aktif | Voting indikator + guard anti-sell-di-dasar (pelajaran 4401) + fundamental |
| Analisa MTF | Tabel M15/H1/H4/D1 (sinyal, RSI, posisi vs EMA50) + vonis selaras/konflik |
| Analisa ringkas | Vonis 1 baris + rencana Entry/SL/TP + 3 alasan + 1 waspada + 1 baris fund |
| Data OHLC | Binance `PAXGUSDT` M15/H1/H4/D1 paralel (proxy gold ±0.5%) |
| Live price | Binance WebSocket tick/detik (auto-fallback polling gold-api → goldprice → binance) |
| Fundamental | Stooq harian DXY + US10Y, regime D1 dari PAXG daily — best-effort, offline = murni teknikal |

Aturan eksekusi: hanya grade **A+** yang bunyi alert. Sinyal melawan H4/D1 = skip
atau size ½. Selalu pakai SL.

## Disclaimer

Bukan saran keuangan. Selalu pakai SL.
