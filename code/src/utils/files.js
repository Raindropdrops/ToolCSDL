import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_RESERVED_PATTERN = /[<>:"/\\|?*\x00-\x1F]/g;

export function slugify(input, fallback = 'item') {
  const normalized = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

export function sanitizeFileName(input, fallback = 'file') {
  const value = String(input || '').trim().replace(WINDOWS_RESERVED_PATTERN, ' ');
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact || fallback;
}

export function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

export function ensureParentDirectory(filePath) {
  ensureDirectory(path.dirname(filePath));
}

export function writeJsonFile(filePath, data) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function writeTextFile(filePath, content) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
}

export function writeBinaryFile(filePath, buffer) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, buffer);
}

export function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function dedupeByUrl(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (!item?.url) {
      continue;
    }

    if (seen.has(item.url)) {
      continue;
    }

    seen.add(item.url);
    result.push(item);
  }

  return result;
}

export function shortStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}
