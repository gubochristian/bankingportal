// Geplante Schnittstellen: werden im Frontend angezeigt, sind aber noch nicht nutzbar.
// Für jede ist vermerkt, was für die Umsetzung nötig ist.

export const PLANNED = [
  {
    id: 'fints',
    name: 'FinTS / HBCI (Banken & Sparkassen)',
    category: 'Bankstandard',
    status: 'planned',
    description:
      'Deutscher Standard für Online-Banking. Damit lassen sich Depotbestände der meisten deutschen Banken und Sparkassen abrufen (Geschäftsvorfall HKWPD).',
    notes: 'Voraussetzung: kostenlose Produktregistrierung bei der Deutschen Kreditwirtschaft sowie Umsetzung von PSD2-SCA (TAN-Verfahren, z. B. pushTAN, photoTAN).',
  },
  {
    id: 'finapi',
    name: 'finAPI (Kontoaggregator)',
    category: 'Aggregator (PSD2)',
    status: 'planned',
    website: 'https://www.finapi.io',
    description: 'Lizenzierter Kontoinformationsdienst, der über eine REST-API Zugriff auf Konten und Depots tausender Banken bietet.',
    notes: 'Voraussetzung: Vertrag mit finAPI (Client-ID und -Secret); die Bankanmeldung läuft über das finAPI Web Form.',
  },
  {
    id: 'comdirect',
    name: 'comdirect REST-API',
    category: 'Bank (API)',
    status: 'planned',
    website: 'https://www.comdirect.de',
    description: 'Offizielle Schnittstelle der comdirect für Konto- und Depotdaten.',
    notes: 'Voraussetzung: Freischaltung des API-Zugangs im comdirect-Konto; Anmeldung mit photoTAN-Freigabe.',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers',
    category: 'Broker (API)',
    status: 'planned',
    website: 'https://www.interactivebrokers.com',
    description: 'Positionen über die Client Portal Web API von Interactive Brokers.',
    notes: 'Voraussetzung: lokal laufendes Client Portal Gateway oder OAuth-Zugang für Drittanbieter.',
  },
];
