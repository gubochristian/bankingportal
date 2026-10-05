// Baut einen eigenständigen Mockup der App nach dist/mockup/:
// echtes Frontend + simulierter Server im Browser (mock/mock-server.js).
// Aufruf: npm run build:mockup

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'mockup');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['css', 'js', 'mock', join('server', 'connectors')]) {
  cpSync(join(root, dir), join(out, dir), { recursive: true });
}

// Seite ohne eigenes Dokumentgerüst (die Vorschau-Umgebung ergänzt es); Mockup-Skript vor der App laden
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<body[^>]*>\s*/i, '')
  .replace(/<\/body>\s*/i, '')
  .replace('<title>Aktienanalyse</title>', '<title>Aktienanalyse Mockup</title>')
  .replace('<link rel="stylesheet" href="css/styles.css" />', '<link rel="stylesheet" href="css/styles.css" />\n    <link rel="stylesheet" href="mock/mock.css" />')
  .replace('<script type="module" src="js/app.js"></script>', '<script type="module" src="mock/mock-server.js"></script>\n    <script type="module" src="js/app.js"></script>');
if (!html.includes('mock/mock-server.js')) throw new Error('index.html: Einstiegspunkt für das Mockup-Skript nicht gefunden');
writeFileSync(join(out, 'index.html'), html.trimStart());
console.log(`Mockup gebaut: ${out}`);
