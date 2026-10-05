// Demo-Bank: simuliert eine Bankverbindung mit Anmeldename und PIN.
// Dient zum Ausprobieren des gesamten Ablaufs ohne echte Zugangsdaten.

const PROFILES = {
  balanced: [
    { isin: 'IE00B4L5Y983', wkn: 'A0RPWH', name: 'iShares Core MSCI World UCITS ETF', quantity: 85, buyPrice: 78.4, buyCurrency: 'EUR' },
    { isin: 'IE00BKM4GZ66', wkn: 'A111X9', name: 'iShares Core MSCI EM IMI UCITS ETF', quantity: 40, buyPrice: 29.1, buyCurrency: 'EUR' },
    { isin: 'US4642872265', name: 'iShares Core US Aggregate Bond ETF', quantity: 25, buyPrice: 92.0, buyCurrency: 'EUR' },
    { isin: 'DE0007164600', wkn: '716460', name: 'SAP SE', quantity: 6, buyPrice: 121.5, buyCurrency: 'EUR' },
    { isin: 'DE0008404005', wkn: '840400', name: 'Allianz SE', quantity: 3, buyPrice: 201.0, buyCurrency: 'EUR' },
    { isin: 'US78463V1070', name: 'SPDR Gold Shares', quantity: 5, buyPrice: 168.0, buyCurrency: 'EUR' },
  ],
  growth: [
    { isin: 'US67066G1040', wkn: '918422', name: 'NVIDIA Corp.', quantity: 30, buyPrice: 45.2, buyCurrency: 'EUR' },
    { isin: 'US0378331005', wkn: '865985', name: 'Apple Inc.', quantity: 15, buyPrice: 151.0, buyCurrency: 'EUR' },
    { isin: 'US5949181045', wkn: '870747', name: 'Microsoft Corp.', quantity: 8, buyPrice: 280.0, buyCurrency: 'EUR' },
    { isin: 'NL0010273215', wkn: 'A1J4U4', name: 'ASML Holding N.V.', quantity: 3, buyPrice: 610.0, buyCurrency: 'EUR' },
    { isin: 'XS0000000000', name: 'Unbekannte Anleihe (nicht zuordenbar)', quantity: 1000, buyPrice: 0.98, buyCurrency: 'EUR' },
  ],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function checkLogin(config) {
  if (!/^\d{5,6}$/.test(config.pin)) {
    const err = new Error('Anmeldung bei der Demo-Bank fehlgeschlagen: Die PIN muss 5 oder 6 Ziffern haben.');
    err.userFacing = true;
    throw err;
  }
}

export default {
  id: 'demo',
  name: 'Demo-Bank',
  category: 'Test & Entwicklung',
  status: 'available',
  description: 'Simulierte Bank zum Ausprobieren: Jeder Anmeldename und jede 5- oder 6-stellige PIN funktioniert.',
  fields: [
    { key: 'login', label: 'Anmeldename', type: 'text', required: true, placeholder: 'z. B. max.mustermann' },
    { key: 'pin', label: 'PIN', type: 'password', required: true, secret: true, help: 'Demo: beliebige 5–6 Ziffern' },
    {
      key: 'profile',
      label: 'Depotinhalt',
      type: 'select',
      required: true,
      options: [
        { value: 'balanced', label: 'Ausgewogenes ETF-Depot' },
        { value: 'growth', label: 'Wachstumsdepot (Einzelaktien)' },
      ],
    },
  ],

  async test(config) {
    await wait(150);
    checkLogin(config);
    return { ok: true, message: `Verbindung zur Demo-Bank hergestellt (Anmeldename ${config.login}).` };
  },

  async fetchPositions(config) {
    await wait(250);
    checkLogin(config);
    return {
      account: { name: `Demo-Depot ${config.login}` },
      positions: PROFILES[config.profile] ?? PROFILES.balanced,
    };
  },
};
