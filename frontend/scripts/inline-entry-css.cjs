const fs = require('fs');
const path = require('path');

const buildDirectory = path.resolve(__dirname, '..', 'build');
const htmlPath = path.join(buildDirectory, 'index.html');

if (!fs.existsSync(htmlPath)) {
  throw new Error(`Build output not found: ${htmlPath}`);
}

let html = fs.readFileSync(htmlPath, 'utf8');
let inlinedCount = 0;

html = html.replace(/<link\s+href="([^"]*\/static\/css\/main\.[^"]+\.css)"\s+rel="stylesheet"\s*\/?\s*>/g, (_link, assetUrl) => {
  const assetPath = path.join(buildDirectory, assetUrl.replace(/^\//, ''));
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Entry stylesheet not found: ${assetPath}`);
  }

  const css = fs.readFileSync(assetPath, 'utf8');
  if (/<\/style/i.test(css)) {
    throw new Error('Refusing to inline an entry stylesheet containing a closing style tag.');
  }

  inlinedCount += 1;
  return `<style data-inline-entry-css>${css}</style>`;
});

if (inlinedCount !== 1) {
  throw new Error(`Expected to inline one entry stylesheet; found ${inlinedCount}.`);
}

fs.writeFileSync(htmlPath, html);
console.log('Inlined the entry stylesheet to remove its render-blocking request.');
