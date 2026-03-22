/**
 * 这个脚本用于验证 Settings.tsx 中导出/导入的代码逻辑是否完整覆盖所有DB表。
 * 它不实际运行浏览器，而是通过静态分析来确认。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. 从 db/index.ts 提取所有表名
const dbSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'db', 'index.ts'), 'utf-8');
const tableRegex = /(\w+)!:\s*Table</g;
const allTables = [];
let match;
while ((match = tableRegex.exec(dbSource)) !== null) {
  allTables.push(match[1]);
}

console.log(`\n📦 DB 定义的表 (${allTables.length} 个):`);
allTables.forEach(t => console.log(`  - ${t}`));

// 2. 从 Settings.tsx 提取导出中使用的表名
const settingsSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'components', 'Settings.tsx'), 'utf-8');

// 导出: 匹配 "tableName: await db.tableName.toArray()"
const exportRegex = /(\w+):\s*await\s+db\.(\w+)\.toArray\(\)/g;
const exportedTables = [];
while ((match = exportRegex.exec(settingsSource)) !== null) {
  exportedTables.push(match[1]);
}

console.log(`\n📤 导出的表 (${exportedTables.length} 个):`);
exportedTables.forEach(t => console.log(`  - ${t}`));

// 3. 从 Settings.tsx 提取导入中使用的表名
const importRegex = /key:\s*'(\w+)',\s*table:\s*db\.(\w+)/g;
const importedTables = [];
while ((match = importRegex.exec(settingsSource)) !== null) {
  importedTables.push(match[1]);
}

console.log(`\n📥 导入的表 (${importedTables.length} 个):`);
importedTables.forEach(t => console.log(`  - ${t}`));

// 4. 检查遗漏
const missingExport = allTables.filter(t => !exportedTables.includes(t));
const missingImport = allTables.filter(t => !importedTables.includes(t));
const exportNotInDb = exportedTables.filter(t => !allTables.includes(t));
const importNotInDb = importedTables.filter(t => !allTables.includes(t));

console.log('\n' + '='.repeat(50));

if (missingExport.length === 0 && missingImport.length === 0) {
  console.log('✅ 所有 DB 表都已包含在导出和导入中！');
} else {
  if (missingExport.length > 0) {
    console.log(`❌ 导出遗漏的表: ${missingExport.join(', ')}`);
  }
  if (missingImport.length > 0) {
    console.log(`❌ 导入遗漏的表: ${missingImport.join(', ')}`);
  }
}

if (exportNotInDb.length > 0) {
  console.log(`⚠️  导出中存在但DB未定义的表: ${exportNotInDb.join(', ')}`);
}
if (importNotInDb.length > 0) {
  console.log(`⚠️  导入中存在但DB未定义的表: ${importNotInDb.join(', ')}`);
}

// 5. 检查导出和导入的表是否一致
const exportSet = new Set(exportedTables);
const importSet = new Set(importedTables);
const onlyExport = exportedTables.filter(t => !importSet.has(t));
const onlyImport = importedTables.filter(t => !exportSet.has(t));

if (onlyExport.length > 0) {
  console.log(`⚠️  只在导出中但不在导入中: ${onlyExport.join(', ')}`);
}
if (onlyImport.length > 0) {
  console.log(`⚠️  只在导入中但不在导出中: ${onlyImport.join(', ')}`);
}

// 6. 检查 localStorage keys
const lsExportRegex = /(\w[\w-]*):\s*localStorage\.getItem\(['"]([\w-]+)['"]\)/g;
const lsKeys = [];
while ((match = lsExportRegex.exec(settingsSource)) !== null) {
  lsKeys.push(match[2]);
}

console.log(`\n🔧 导出的 localStorage keys (${lsKeys.length} 个):`);
lsKeys.forEach(k => console.log(`  - ${k}`));

// Check localStorage restore
const lsRestoreCheck = settingsSource.includes('data.localStorage') && settingsSource.includes('localStorage.setItem');
console.log(`\n🔧 导入恢复 localStorage: ${lsRestoreCheck ? '✅ 是' : '❌ 否'}`);

// 7. 检查导入后刷新
const reloadCheck = settingsSource.includes('window.location.reload()');
console.log(`🔄 导入后自动刷新页面: ${reloadCheck ? '✅ 是' : '❌ 否'}`);

console.log('\n' + '='.repeat(50));
console.log('验证完成！\n');
