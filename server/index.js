// Startpunkt: `npm start`

import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { server } = createApp(config);

server.listen(config.port, config.host, () => {
  console.log(`Aktienanalyse läuft auf http://${config.host}:${config.port}`);
  if (!config.appSecret) console.log(`Hinweis: Schlüssel für Zugangsdaten liegt in ${config.dataDir}/secret.key – sicher aufbewahren.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
