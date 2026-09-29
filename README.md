# Aktienanalyse

Web-Tool zur technischen Analyse von Aktien – läuft komplett im Browser, ohne Build-Schritt und ohne Abhängigkeiten.

## Funktionen

- **Kurschart** (Kerzen oder Linie) mit Volumen und Zeitraumwahl (3M, 6M, 1J, 3J, Max)
- **Overlays:** SMA 20 / 50 / 200, Bollinger-Bänder (20, 2)
- **Indikatoren:** RSI (14) und MACD (12, 26, 9) als synchronisierte Unter-Charts
- **Kennzahlen:** Performance (1M, 3M, YTD, 1J), 52-Wochen-Hoch/-Tief, Volatilität, Sharpe Ratio, maximaler Drawdown, CAGR, Ø-Volumen
- **Technische Signale:** Trend vs. SMA 200, Golden/Death Cross, RSI überkauft/überverkauft, MACD-Kreuzungen, Bollinger-Ausbrüche – mit Gesamteinschätzung
- **Watchlist** (lokal im Browser gespeichert), Hell-/Dunkelmodus, mobil nutzbar
- Direktlinks auf ein Symbol, z. B. `http://localhost:8080/#AAPL`

## Datenquellen

| Quelle | Beschreibung |
| --- | --- |
| **Demodaten** | Simulierte, reproduzierbare Kurse pro Symbol – zum Ausprobieren ohne Account. Keine echten Kurse! |
| **Twelve Data** | Echte Tageskurse über die [Twelve Data API](https://twelvedata.com). Kostenlosen API-Key in den Einstellungen (Zahnrad) hinterlegen; er wird nur lokal im Browser gespeichert. |
| **CSV-Import** | Eigene Kursdaten, z. B. Yahoo-Finance-Export (`Date,Open,High,Low,Close,Adj Close,Volume`) oder deutsches Format mit Semikolon und Dezimalkomma (`Datum;Eröffnung;Hoch;Tief;Schlusskurs;Volumen`). Mindestens Datum und Schlusskurs sind nötig. Beispiel: `examples/beispiel.csv` |

## Starten

Voraussetzung: Node.js ≥ 18 (nur für den lokalen Webserver und die Tests).

```bash
npm start        # startet http://localhost:8080
npm test         # Unit-Tests für Indikatoren, Kennzahlen und CSV-Parser
```

Alternativ funktioniert jeder statische Webserver, z. B. `python3 -m http.server 8080`.
Direktes Öffnen der `index.html` per Doppelklick funktioniert nicht, da Browser ES-Module über `file://` blockieren.

## Projektstruktur

```
index.html            Seitenaufbau
css/styles.css        Layout und Farben (Hell/Dunkel)
js/app.js             UI, Charts, Zustand
js/indicators.js      SMA, EMA, RSI, MACD, Bollinger (reine Funktionen)
js/analysis.js        Kennzahlen und Signale
js/data.js            Demodaten, Twelve-Data-Anbindung, CSV-Parser
js/vendor/            TradingView Lightweight Charts™ v4.2.3 (Apache 2.0)
tests/                Node-Tests (node --test)
scripts/serve.js      Minimaler Entwicklungs-Webserver
```

## Hinweis

Die Auswertungen sind rein regelbasiert und dienen nur zu Informationszwecken. Sie stellen keine Anlageberatung dar.

Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/), Copyright TradingView, Inc., Apache License 2.0 (siehe `js/vendor/LIGHTWEIGHT-CHARTS-LICENSE`).
