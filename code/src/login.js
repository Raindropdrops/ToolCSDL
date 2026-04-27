import path from 'node:path';
import { chromium } from 'playwright';
import { ensurePackDirectories, loadRuntimeConfig, PATHS, resolveCourseUrl } from './config.js';

async function main() {
  ensurePackDirectories();

  const config = loadRuntimeConfig();
  const courseUrl = await resolveCourseUrl(config);

  const context = await chromium.launchPersistentContext(PATHS.browserProfileRoot, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    console.log('Mở trang khóa học để đăng nhập phiên đầu...');
    await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

    console.log('\nHoàn tất đăng nhập Microsoft trong browser vừa mở.');
    console.log('Khi đã vào được trang khóa học, quay lại terminal và nhấn Enter để lưu session...');

    await waitForEnter();

    await context.storageState({ path: path.join(PATHS.browserProfileRoot, 'storage-state.json') });

    console.log('Đã lưu session local vào browser-profile/.');
    console.log('Bây giờ bạn có thể chạy: npm run extract');
  } finally {
    await context.close();
  }
}

async function waitForEnter() {
  process.stdin.resume();
  return new Promise((resolve) => {
    process.stdin.once('data', () => resolve());
  });
}

main().catch((error) => {
  console.error('Login flow thất bại:', error.message);
  process.exitCode = 1;
});
