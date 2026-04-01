const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const asarPath = 'C:\\Program Files\\AAGS\\resources\\app.asar';
const outDir = 'd:\\网格交易系统\\aags\\temp_asar_extract';

// Clean and extract
if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
asar.extractAll(asarPath, outDir);

// Check package.json version
const pkg = JSON.parse(fs.readFileSync(path.join(outDir, 'package.json'), 'utf-8'));
console.log('package.json version:', pkg.version);

// Check electron main.cjs
const mainPath = path.join(outDir, 'electron', 'main.cjs');
if (fs.existsSync(mainPath)) {
  const main = fs.readFileSync(mainPath, 'utf-8');
  const m = main.match(/version['":\s]+(\d+\.\d+\.\d+)/i);
  console.log('main.cjs version match:', m ? m[1] : 'none');
}

// Check dist/index.html
const htmlPath = path.join(outDir, 'dist', 'index.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  // Get the JS filename
  const jsMatch = html.match(/src="[^"]*?(index-[^"]+\.js)"/);
  console.log('JS bundle in index.html:', jsMatch ? jsMatch[1] : 'not found');
}

// List dist/assets
const assetsDir = path.join(outDir, 'dist', 'assets');
if (fs.existsSync(assetsDir)) {
  console.log('dist/assets files:', fs.readdirSync(assetsDir));
}

// Check for version in the JS bundle
const jsFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  const content = fs.readFileSync(path.join(assetsDir, f), 'utf-8');
  // Search for exportVersion or version display
  const ev = content.match(/exportVersion['":\s]+['"]([^'"]+)['"]/);
  if (ev) console.log(`${f} exportVersion:`, ev[1]);
  
  // Search for all 1.0.x patterns
  const versions = [...new Set((content.match(/['"]1\.0\.\d+['"]/g) || []))];
  if (versions.length > 0) console.log(`${f} version strings:`, versions);
}
