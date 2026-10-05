# Aktienanalyse

Web-Tool zur Aktien- und Depotanalyse mit Benutzerkonten und Schnittstellen zu Banken und Brokern – ohne Build-Schritt und ohne externe Abhängigkeiten (nur Node.js).

## Funktionen

- **Kurschart** (Kerzen oder Linie) mit Volumen und Zeitraumwahl (3M, 6M, 1J, 3J, Max)
- **Overlays:** SMA 20 / 50 / 200, Bollinger-Bänder (20, 2)
- **Indikatoren:** RSI (14) und MACD (12, 26, 9) als synchronisierte Unter-Charts
- **Kennzahlen:** Performance (1M, 3M, YTD, 1J), 52-Wochen-Hoch/-Tief, Volatilität, Sharpe Ratio, maximaler Drawdown, CAGR, Ø-Volumen
- **Technische Signale:** Trend vs. SMA 200, Golden/Death Cross, RSI überkauft/überverkauft, MACD-Kreuzungen, Bollinger-Ausbrüche – mit Gesamteinschätzung
- **Watchlist** (lokal im Browser gespeichert), Hell-/Dunkelmodus, mobil nutzbar
- Direktlinks auf ein Symbol, z. B. `http://localhost:8080/#AAPL`

### Depot-Bewertung (`#depot`)

Depot aus Aktien, ETFs, Anleihen-ETFs und Rohstoffen zusammenstellen – per Betrag in € oder Stückzahl
(mit optionalem Kaufkurs für Gewinn/Verlust). Sektor, Region, Anlageklasse und Währung sind für rund
50 bekannte Werte vorbelegt und pro Position änderbar. Drei Beispieldepots zeigen die Bewertung sofort.

- **Risikoklasse 1–7** aus der annualisierten Volatilität (angelehnt an die SRI-Skala der EU-Basisinformationsblätter)
- **Streuungs-Score 0–100** aus effektiver Anzahl Positionen, Sektoren, Regionen und Korrelation
- **Risikokennzahlen:** Volatilität, maximaler Drawdown, Value at Risk und Expected Shortfall (95 %),
  schlechtester Monat, Sharpe Ratio, Diversifikationseffekt
- **Aufteilung** nach Positionen, Sektoren, Regionen (globale ETFs anteilig „durchgeschaut“), Anlageklassen und Währungen
- **Risikobeitrag je Position** – welche Position wie viel der Depotschwankung verursacht
- **Korrelationsmatrix** der Positionen
- **Wertentwicklung** des heutigen Depots im Rückblick (Buy & Hold) im Vergleich zu einem wählbaren Index
  (MSCI World, FTSE All-World, S&P 500, FTSE Europe, Emerging Markets)
- **Beta zum Markt** und Korrelation zum Vergleichsindex
- **Laufende Kosten (TER)**, gewichtet über das Depot, in € pro Jahr und über 10 Jahre (Richtwerte für bekannte ETFs, editierbar)
- **Stresstest** mit fünf Szenarien: Aktien-Crash (−30 %), Marktkorrektur (−10 %), platzende Tech-Blase,
  starker Zinsanstieg, Euro-Aufwertung – jeweils mit Verlust in % und € und den größten Verlusttreibern
- **Verbesserungsvorschläge:** simulierte Umschichtungen (Welt-ETF als Kern, Anleihen- oder Goldbeimischung,
  Einzelwerte auf 10 % begrenzen, Sektor-Übergewicht abbauen, Gleichgewichtung) mit Vorher-/Nachher-Vergleich
  von Streuung, Risikoklasse, Volatilität und Crash-Verlust – per Klick übernehmbar
- **Mehrere Depots** anlegen, umbenennen, löschen sowie als JSON-Datei **exportieren und importieren**
- **Depotvergleich:** alle Depots nebeneinander mit denselben Kennzahlen, bester Wert je Zeile markiert
- **Umrechnung in Euro:** Kurse in USD, CHF, GBP, DKK und JPY werden täglich mit dem Wechselkurs umgerechnet –
  das Währungsrisiko fließt so in Volatilität, Korrelationen und Drawdown ein (abschaltbar)
- **Zukunftsprojektion & Sparplan:** Monte-Carlo-Simulation (2.000 Verläufe) mit Startkapital, monatlicher Sparrate,
  Anlagedauer bis 40 Jahre, optionalem Sparziel und Inflationsbereinigung. Ergebnis als Fächerdiagramm mit
  Median, 50-%- und 80-%-Band, dazu Verlustrisiko und Wahrscheinlichkeit, das Sparziel zu erreichen
- **Hinweise** mit Einstufung (Kritisch / Warnung / Hinweis / Positiv), u. a. zu Klumpenrisiken, Sektor- und
  Regionen-Übergewichten, Home Bias, Fremdwährungsanteil, fehlendem Stabilitätsanker, hoher Korrelation und schwachem Trend

Die Berechnungsmethodik ist in der App unter „So wird bewertet“ beschrieben.

## Datenquellen

| Quelle | Beschreibung |
| --- | --- |
| **Demodaten** | Simulierte, reproduzierbare Kurse pro Symbol – zum Ausprobieren ohne Account. Keine echten Kurse! Ein einfaches Faktormodell (Markt + Sektor + Einzeltitel) sorgt für realistische Korrelationen, damit die Depot-Bewertung aussagekräftig bleibt. |
| **Twelve Data** | Echte Tageskurse über die [Twelve Data API](https://twelvedata.com). Kostenlosen API-Key in den Einstellungen (Zahnrad) hinterlegen; er wird verschlüsselt im Konto gespeichert. Der kostenlose Tarif erlaubt nur wenige Abrufe pro Minute – bei größeren Depots wartet die App automatisch. Kurse werden pro Sitzung zwischengespeichert. |
| **CSV-Import** | Eigene Kursdaten, z. B. Yahoo-Finance-Export (`Date,Open,High,Low,Close,Adj Close,Volume`) oder deutsches Format mit Semikolon und Dezimalkomma (`Datum;Eröffnung;Hoch;Tief;Schlusskurs;Volumen`). Mindestens Datum und Schlusskurs sind nötig. Beispiel: `examples/beispiel.csv` |

## Konto, Anmeldung & Sitzungen

Die App ist nur nach Anmeldung nutzbar. Depots, Einstellungen und Bankverbindungen werden pro Nutzerkonto auf dem Server gespeichert.

- **Registrierung & Login** mit E-Mail und Passwort (mind. 10 Zeichen, einfache Passwörter werden abgelehnt)
- **Passwörter** werden mit scrypt und zufälligem Salt gehasht
- **Sitzungen:** zufälliges 256-Bit-Token im Cookie (`HttpOnly`, `SameSite=Strict`, `Secure` unter HTTPS); in der Datenbank liegt nur der SHA-256-Hash
- **Automatische Abmeldung** nach 30 Minuten Inaktivität und spätestens nach 12 Stunden; zwei Minuten vorher erscheint eine Warnung mit „Angemeldet bleiben“
- **Schutz vor Brute Force:** Sperre nach 5 Fehlversuchen je E-Mail-Adresse und IP für 15 Minuten; gleiche Fehlermeldung für unbekannte E-Mail und falsches Passwort
- **Schutz vor Session Fixation** (neues Token bei jedem Login) und **CSRF** (Same-Origin-Prüfung, nur JSON-Anfragen)
- **Konto-Seite:** aktive Sitzungen mit Gerät und IP einsehen und einzeln oder gesammelt beenden, Passwort ändern (beendet alle anderen Sitzungen), Aktivitätsprotokoll, Konto löschen
- **Sicherheits-Header:** Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, HSTS unter HTTPS
- Läuft die Sitzung ab, erscheint die Anmeldung; danach geht es ohne Datenverlust weiter

## Schnittstellen zu Banken & Brokern (`#verbindungen`)

Nutzer richten Verbindungen selbst ein. Abgerufene Bestände landen in einem **verknüpften Depot**, das bei jedem Abruf aktualisiert wird; eigene Anpassungen (Sektor, Region, TER) bleiben erhalten.

| Anbieter | Status | Beschreibung |
| --- | --- | --- |
| Demo-Bank | verfügbar | Simulierte Bank mit Anmeldename und PIN zum Ausprobieren |
| Depotauszug (CSV) | verfügbar | Bestandsexport fast jeder Bank; Spalten (ISIN, WKN, Bezeichnung, Stück, Einstandskurs …) und Formate werden automatisch erkannt |
| Trading 212 | Beta | Offizielle Public API (API-Schlüssel, nur Lesezugriff) – noch nicht mit einem echten Konto getestet |
| FinTS/HBCI, finAPI, comdirect, Interactive Brokers | geplant | in der App mit den jeweiligen Voraussetzungen beschrieben |

- **Zugangsdaten** (PIN, API-Schlüssel) werden mit AES-256-GCM verschlüsselt gespeichert, an Nutzer und Verbindung gebunden und nie an den Browser zurückgegeben (Anzeige nur maskiert)
- Positionen werden über die **ISIN** den Wertpapieren mit Kursdaten zugeordnet; verbreitete UCITS-ETFs (z. B. iShares Core MSCI World) werden auf ein US-Pendant mit gleichem Index abgebildet. Nicht zuordenbare Positionen werden angezeigt, fließen aber nicht in die Analyse ein
- **Neuen Anbieter hinzufügen:** Datei in `server/connectors/` anlegen (Felder, `test()`, `fetchPositions()`) und in `server/connectors/index.js` registrieren – Formular, Verschlüsselung und Übernahme ins Depot funktionieren dann automatisch

## Starten

Voraussetzung: Node.js ≥ 22.5 (nutzt das eingebaute `node:sqlite`).

```bash
npm start        # startet http://127.0.0.1:8080
npm test         # Unit- und API-Tests
```

Beim ersten Start werden `data/app.db` (SQLite) und `data/secret.key` (Schlüssel für Zugangsdaten) angelegt. Beides **nicht** einchecken und gemeinsam sichern – ohne den Schlüssel sind gespeicherte Zugangsdaten nicht mehr lesbar.

### Mockup ohne Server

```bash
npm run build:mockup   # erzeugt dist/mockup/
```

Der Mockup enthält das unveränderte Frontend und simuliert die Server-API im Browser (`mock/mock-server.js`): Demo-Konto `demo@beispiel.de` / `Demo-Passwort-2026` mit Beispieldepots und einer Demo-Bankverbindung. Er läuft auf jedem statischen Webserver und eignet sich zum Vorführen. Alle Daten, auch Passwörter, liegen dort im Klartext im Browser – nur zum Ausprobieren, nie mit echten Zugangsdaten.

### Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Adresse des Servers |
| `DATA_DIR` | `./data` | Ablage für Datenbank und Schlüssel |
| `APP_SECRET` | – | Geheimnis für die Verschlüsselung (statt `secret.key`), z. B. aus einem Secret-Store |
| `SESSION_IDLE_MINUTES` | `30` | Abmeldung nach Inaktivität |
| `SESSION_MAX_HOURS` | `12` | maximale Sitzungsdauer |
| `ALLOW_REGISTRATION` | `true` | Registrierung neuer Konten erlauben |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | `5` / `15` | Sperre nach Fehlversuchen |
| `COOKIE_SECURE` | `auto` | `Secure`-Cookie bei HTTPS; `true` erzwingt es |
| `TRUST_PROXY` | `false` | hinter einem Reverse Proxy auf `true` setzen (für IP-Adresse und HTTPS-Erkennung) |

**Produktivbetrieb:** nur hinter HTTPS (z. B. Reverse Proxy mit `TRUST_PROXY=true`), `APP_SECRET` setzen und Datenbank regelmäßig sichern.

## Projektstruktur

```
server/index.js       Startpunkt des Servers
server/app.js         HTTP-Server: API-Routen, Auth-Middleware, Sicherheits-Header, Auslieferung des Frontends
server/auth.js        Registrierung, Login, Sitzungen, Brute-Force-Schutz, Protokoll
server/security.js    Passwort-Hashing (scrypt), Tokens, AES-256-GCM-Verschlüsselung
server/db.js          SQLite-Schema und Migrationen
server/connectors/    Bank- und Broker-Schnittstellen (Registry, Demo-Bank, CSV, Trading 212, geplante)
index.html            Seitenaufbau
css/styles.css        Layout und Farben (Hell/Dunkel)
js/app.js             Start, Anmeldung, Navigation, Einzelanalyse (UI, Charts)
js/api.js             Client für die Server-API
js/auth-ui.js         Anmelde- und Registrierungsmaske
js/session.js         Sitzungsüberwachung (Verlängerung bei Aktivität, Warnung vor Abmeldung)
js/connections.js     Ansicht „Schnittstellen“
js/account.js         Ansicht „Mein Konto“
js/depot.js           Depot-Ansicht (Erfassung, Darstellung der Bewertung)
js/portfolio.js       Depot-Bewertung: Allokation, Risiko, Benchmark, Stresstests, Kosten, Hinweise
js/optimizer.js       Verbesserungsvorschläge durch simulierte Umschichtungen
js/depot-file.js      Export-/Importformat für Depots
js/forecast.js        Monte-Carlo-Simulation für die Zukunftsprojektion
js/securities.js      Stammdaten bekannter Wertpapiere (Sektor, Region, Klasse, Währung)
js/indicators.js      SMA, EMA, RSI, MACD, Bollinger (reine Funktionen)
js/analysis.js        Kennzahlen und Signale
js/market.js          Gemeinsamer Kurs-Loader mit Cache, Wechselkurse und Euro-Umrechnung
js/data.js            Demodaten, Twelve-Data-Anbindung, CSV-Parser
js/util.js            Formatierung und Hilfsfunktionen
js/vendor/            TradingView Lightweight Charts™ v4.2.3 (Apache 2.0)
tests/                Node-Tests (node --test), inkl. API-Tests gegen einen Testserver
mock/                 Simulierter Server für den Mockup (nur im Mockup-Build eingebunden)
scripts/build-mockup.js  Baut den Mockup nach dist/mockup/
```

## Hinweis

Die Auswertungen sind rein regelbasiert und dienen nur zu Informationszwecken. Sie stellen keine Anlageberatung dar.

Charts: [TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/), Copyright TradingView, Inc., Apache License 2.0 (siehe `js/vendor/LIGHTWEIGHT-CHARTS-LICENSE`).
