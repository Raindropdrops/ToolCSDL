import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CODE_ROOT = path.resolve(__dirname, '..');
export const PACK_ROOT = path.resolve(CODE_ROOT, '..');

export const PATHS = {
  packRoot: PACK_ROOT,
  materialsRoot: path.join(PACK_ROOT, 'materials'),
  quizzesRoot: path.join(PACK_ROOT, 'quizzes'),
  quizzesHtmlRoot: path.join(PACK_ROOT, 'quizzes', 'html'),
  quizzesPdfRoot: path.join(PACK_ROOT, 'quizzes', 'pdf'),
  quizzesMarkdownRoot: path.join(PACK_ROOT, 'quizzes', 'markdown'),
  quizzesJsonRoot: path.join(PACK_ROOT, 'quizzes', 'json'),
  videosRoot: path.join(PACK_ROOT, 'videos'),
  exportsRoot: path.join(PACK_ROOT, 'exports'),
  browserProfileRoot: path.join(PACK_ROOT, 'browser-profile'),
  manifestPath: path.join(PACK_ROOT, 'exports', 'manifest.json'),
  extractionReportPath: path.join(PACK_ROOT, 'exports', 'extraction-report.md'),
  indexPath: path.join(PACK_ROOT, 'exports', 'index.html'),
  debugHtmlPath: path.join(PACK_ROOT, 'exports', 'debug-page.html'),
  debugTextPath: path.join(PACK_ROOT, 'exports', 'debug-page.txt'),
  runtimeConfigPath: path.join(CODE_ROOT, 'config.local.json')
};

const DEFAULT_CONFIG = {
  courseUrl: '',
  headlessExtraction: true,
  timeoutMs: 45000,
  maxItemsPerChapter: 0,
  keepBrowserOpenAfterExtract: false,
  loginWaitSeconds: 10
};

export function ensurePackDirectories() {
  const directories = [
    PATHS.materialsRoot,
    PATHS.quizzesRoot,
    PATHS.quizzesHtmlRoot,
    PATHS.quizzesPdfRoot,
    PATHS.quizzesMarkdownRoot,
    PATHS.quizzesJsonRoot,
    PATHS.videosRoot,
    PATHS.exportsRoot,
    PATHS.browserProfileRoot
  ];

  for (const directoryPath of directories) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

export function loadRuntimeConfig() {
  if (!fs.existsSync(PATHS.runtimeConfigPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(PATHS.runtimeConfigPath, 'utf8'));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveRuntimeConfig(config) {
  fs.mkdirSync(path.dirname(PATHS.runtimeConfigPath), { recursive: true });
  fs.writeFileSync(PATHS.runtimeConfigPath, JSON.stringify(config, null, 2), 'utf8');
}

export async function resolveCourseUrl(config) {
  if (config.courseUrl && isValidHttpUrl(config.courseUrl)) {
    return config.courseUrl;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = (await rl.question('Nhập URL trang khóa học E-Learning: ')).trim();
  rl.close();

  if (!isValidHttpUrl(answer)) {
    throw new Error('URL không hợp lệ. Ví dụ: https://example.edu/course/view.php?id=123');
  }

  config.courseUrl = answer;
  saveRuntimeConfig(config);
  return answer;
}

export function getBaseUrl(courseUrl) {
  const parsed = new URL(courseUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
