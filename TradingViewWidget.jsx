// TradingViewWidget.jsx — versi XAUUSD (port 1:1 dari kode NASDAQ:AAPL kamu)
import React, { useEffect, useRef, memo } from 'react';

function TradingViewWidget() {
  const container = useRef();

  useEffect(() => {
    container.current.innerHTML = '';
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = `
      {
        "allow_symbol_change": true,
        "calendar": false,
        "details": false,
        "hide_side_toolbar": true,
        "hide_top_toolbar": false,
        "hide_legend": false,
        "hide_volume": false,
        "hotlist": false,
        "interval": "60",
        "locale": "en",
        "save_image": true,
        "style": "1",
        "symbol": "OANDA:XAUUSD",
        "theme": "dark",
        "timezone": "Etc/UTC",
        "backgroundColor": "#0F0F0F",
        "gridColor": "rgba(242, 242, 242, 0.2)",
        "watchlist": ["OANDA:XAUUSD", "TVC:GOLD", "BINANCE:PAXGUSDT"],
        "withdateranges": false,
        "compareSymbols": [],
        "support_host": "https://www.tradingview.com",
        "studies": ["STD;EMA", "STD;RSI", "STD;MACD"],
        "autosize": true
      }`;
    container.current.appendChild(script);
  }, []);

  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
      <div className="tradingview-widget-copyright"><a href="https://www.tradingview.com/symbols/OANDA-XAUUSD/" rel="noopener nofollow" target="_blank"><span className="blue-text">XAUUSD chart</span></a><span className="trademark"> by TradingView</span></div>
    </div>
  );
}

export default memo(TradingViewWidget);
