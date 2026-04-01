const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname, '..', 'node_modules', 'app-builder-lib',
  'templates', 'nsis', 'include', 'installUtil.nsh'
);

console.log('Reading:', file);
console.log('Exists:', fs.existsSync(file));

let content = fs.readFileSync(file, 'utf-8');
console.log('File length:', content.length);

// Find the exact line containing copyFile and uninstallerFileNameTemp
const lines = content.split('\n');
let targetLineIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('copyFile') && lines[i].includes('uninstallerFileNameTemp')) {
    console.log(`Found target at line ${i + 1}: ${lines[i].trim()}`);
    targetLineIdx = i;
    break;
  }
}

if (targetLineIdx === -1) {
  console.log('ERROR: copyFile line not found');
  process.exit(1);
}

// Check if already patched
if (content.includes('PATCHED: skip old uninstaller')) {
  console.log('Already patched, skipping');
  process.exit(0);
}

// Insert Return after the copyFile line
lines.splice(targetLineIdx + 1, 0,
  '  ; PATCHED: skip old uninstaller to avoid blocking dialogs',
  '  Return'
);

fs.writeFileSync(file, lines.join('\n'));
console.log('SUCCESS: Patched installUtil.nsh - added Return after copyFile line');
