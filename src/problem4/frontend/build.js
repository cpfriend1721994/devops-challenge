const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');
const assetsDir = path.join(distDir, 'assets');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

// Copy and fingerprint JS
const jsContent = "console.log('Trading SPA initialized.');";
const hash = crypto.createHash('md5').update(jsContent).digest('hex').slice(0, 8);
const jsFilename = `app-${hash}.js`;
fs.writeFileSync(path.join(assetsDir, jsFilename), jsContent);

// Process index.html
let html = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf-8');
html = html.replace('</body>', `  <script src="/assets/${jsFilename}"></script>\n</body>`);
fs.writeFileSync(path.join(distDir, 'index.html'), html);

console.log(`[BUILD] Production SPA bundled to dist/ with asset /assets/${jsFilename}`);
