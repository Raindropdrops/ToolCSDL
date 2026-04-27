import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '..', 'src');

function main() {
  const jsFiles = collectJsFiles(srcDir);

  if (jsFiles.length === 0) {
    console.log('[WARN] Không tìm thấy file .js để kiểm tra.');
    return;
  }

  let failed = false;

  for (const filePath of jsFiles) {
    const checkResult = spawnSync(process.execPath, ['--check', filePath], {
      encoding: 'utf8'
    });

    if (checkResult.status === 0) {
      console.log(`[OK] ${path.relative(srcDir, filePath)}`);
      continue;
    }

    failed = true;
    const message = (checkResult.stderr || checkResult.stdout || 'Syntax error').trim();
    console.error(`[X] ${path.relative(srcDir, filePath)} -> ${message}`);
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }

  console.log('Tất cả file syntax OK.');
}

function collectJsFiles(directoryPath) {
  const result = [];
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      result.push(...collectJsFiles(absolute));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      result.push(absolute);
    }
  }

  return result;
}

main();
