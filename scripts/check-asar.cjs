const asar = require('@electron/asar');
const path = 'C:\\Program Files\\AAGS\\resources\\app.asar';

// Extract the JS bundle and search for version strings
const files = asar.listPackage(path);
const jsFile = files.find(f => f.includes('\\dist\\') && f.includes('index-') && f.endsWith('.js'));
console.log('JS bundle:', jsFile);

const content = asar.extractFile(path, jsFile).toString();

// Find FALLBACK_VERSION
const m1 = content.match(/FALLBACK_VERSION\s*=\s*["']([^"']+)["']/);
console.log('FALLBACK_VERSION:', m1 ? m1[1] : 'not found');

// Find all 1.0.x version strings  
const m2 = content.match(/1\.0\.\d+/g);
const unique = [...new Set(m2)];
console.log('All 1.0.x versions in JS:', unique);

// Check electron main.cjs
const mainFile = files.find(f => f.includes('main.cjs'));
console.log('Main file:', mainFile);
if (mainFile) {
  const mainContent = asar.extractFile(path, mainFile).toString();
  const m3 = mainContent.match(/1\.0\.\d+/g);
  console.log('Versions in main.cjs:', m3 ? [...new Set(m3)] : 'none');
}

// Check package.json
const pkg = JSON.parse(asar.extractFile(path, '\\package.json').toString());
console.log('package.json version:', pkg.version);
