import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import {
  ensurePackDirectories,
  getBaseUrl,
  loadRuntimeConfig,
  PATHS,
  resolveCourseUrl
} from './config.js';
import { quizDomEvaluator } from './parsers/quizParser.js';
import {
  dedupeByUrl,
  ensureDirectory,
  sanitizeFileName,
  shortStamp,
  slugify,
  writeBinaryFile,
  writeJsonFile,
  writeTextFile
} from './utils/files.js';
import { generateExtractionReport, generateOfflineIndex, writeVideoMarkdown } from './report.js';

async function main() {
  ensurePackDirectories();

  const config = loadRuntimeConfig();
  const courseUrl = await resolveCourseUrl(config);
  const baseUrl = getBaseUrl(courseUrl);

  const context = await chromium.launchPersistentContext(PATHS.browserProfileRoot, {
    channel: 'chrome',
    headless: Boolean(config.headlessExtraction),
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled']
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    page.setDefaultTimeout(config.timeoutMs || 45000);

    console.log('Mở trang khóa học...');
    await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs || 45000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);

    if (await isLoginPage(page)) {
      await handleLoginFlow(page, courseUrl, config);
    }

    await openCoreMoodleCourse(page, courseUrl, config);

    await waitForCourseRender(page);
    await clickLikelyCourseEntry(page);
    await waitForCourseRender(page);
    await expandLikelyContent(page);
    await writeDebugSnapshot(page);

    let chapters = await discoverMoodleStateChapters(page, courseUrl);
    if (chapters.length === 0) {
      chapters = await discoverChapters(page, baseUrl);
    }
    if (chapters.length === 0) {
      throw new Error('Không tìm thấy chương/mục học phần. Hãy mở đúng URL trang khóa học.');
    }

    console.log(`Tìm thấy ${chapters.length} chương, bắt đầu trích xuất...`);

    const manifest = {
      generatedAt: new Date().toISOString(),
      courseUrl,
      summary: {
        chapterCount: chapters.length,
        materialCount: 0,
        videoCount: 0,
        quizCount: 0
      },
      chapters: []
    };

    let chapterOrder = 0;

    for (const chapter of chapters) {
      chapterOrder += 1;
      const chapterTitle = chapter.title || `Chuong ${chapterOrder}`;
      console.log(`- [${chapterOrder}/${chapters.length}] ${chapterTitle}`);

      const chapterSlug = `${String(chapterOrder).padStart(2, '0')}-${slugify(chapterTitle, `chuong-${chapterOrder}`)}`;

      const materialDir = path.join(PATHS.materialsRoot, chapterSlug);
      ensureDirectory(materialDir);

      const chapterRecord = {
        chapterOrder,
        chapterTitle,
        chapterSlug,
        materials: [],
        videos: [],
        quizzes: []
      };

      const items = applyMaxItems(chapter.items || [], config.maxItemsPerChapter);

      for (const item of items) {
        const normalizedType = classifyItemType(item);

        if (normalizedType === 'material') {
          const material = await handleMaterialDownload(page, item, materialDir);
          chapterRecord.materials.push(material);
          continue;
        }

        if (normalizedType === 'video') {
          const video = await resolveVideoLink(context, item);
          chapterRecord.videos.push(video);
          continue;
        }

        if (normalizedType === 'quiz') {
          const quiz = await extractQuizAssets(context, item, chapterSlug);
          chapterRecord.quizzes.push(quiz);
        }
      }

      chapterRecord.materials = dedupeByUrl(chapterRecord.materials);
      chapterRecord.videos = dedupeByUrl(chapterRecord.videos);
      chapterRecord.quizzes = dedupeByUrl(chapterRecord.quizzes);

      manifest.summary.materialCount += chapterRecord.materials.length;
      manifest.summary.videoCount += chapterRecord.videos.length;
      manifest.summary.quizCount += chapterRecord.quizzes.length;

      manifest.chapters.push(chapterRecord);
    }

    writeJsonFile(PATHS.manifestPath, manifest);
    writeVideoMarkdown(manifest);
    generateExtractionReport(manifest);
    generateOfflineIndex(manifest);

    console.log('Hoàn tất trích xuất.');
    console.log(`- Manifest: ${PATHS.manifestPath}`);
    console.log(`- Index: ${PATHS.indexPath}`);

    if (config.keepBrowserOpenAfterExtract) {
      await waitForEnter('Browser đang được giữ mở để bạn kiểm tra. Nhấn Enter trong terminal để đóng...');
    }
  } catch (error) {
    if (config.keepBrowserOpenAfterExtract) {
      console.error('Trích xuất gặp lỗi:', error.message);
      await waitForEnter('Browser vẫn được giữ mở để bạn kiểm tra lỗi. Nhấn Enter trong terminal để đóng...');
    }

    throw error;
  } finally {
    await context.close();
  }
}

async function handleLoginFlow(page, courseUrl, config) {
  await clickMicrosoftLogin(page);
  const seconds = Math.max(3, Number(config.loginWaitSeconds) || 10);
  console.log(`Đang chờ đăng nhập tối đa ${seconds}s. Nếu phiên đã sẵn sàng, tool sẽ chạy ngay...`);

  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (!(await isLoginPage(page))) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  await page.goto(courseUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs || 45000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);
}

async function clickMicrosoftLogin(page) {
  const selectors = [
    'a:has-text("Office 365")',
    'a:has-text("Microsoft")',
    'button:has-text("Office 365")',
    'button:has-text("Microsoft")',
    'a[href*="microsoft"]',
    'a[href*="oauth2"]',
    'a[href*="auth"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count().catch(() => 0)) === 0) {
      continue;
    }

    console.log('Phát hiện nút đăng nhập Microsoft, đang click tự động...');
    await locator.click({ timeout: 5000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
    return;
  }
}

async function openCoreMoodleCourse(page, courseUrl, config) {
  const courseId = extractCourseId(courseUrl);
  if (!courseId || page.url().includes('core-lms.utc.edu.vn/course/view.php')) {
    return;
  }

  const coreUrl = `https://core-lms.utc.edu.vn/course/view.php?id=${courseId}&lang=vi`;
  await page.goto(coreUrl, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs || 45000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
}

function extractCourseId(courseUrl) {
  return String(courseUrl).match(/course\/(\d+)\/view|[?&]id=(\d+)/)?.slice(1).find(Boolean) || '';
}

async function waitForCourseRender(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(6000);
}

async function writeDebugSnapshot(page) {
  writeTextFile(PATHS.debugHtmlPath, await page.content());
  writeTextFile(PATHS.debugTextPath, await page.locator('body').innerText().catch(() => ''));
  console.log(`- Debug HTML: ${PATHS.debugHtmlPath}`);
  console.log(`- Debug Text: ${PATHS.debugTextPath}`);
}

async function isLoginPage(page) {
  const url = page.url().toLowerCase();
  if (url.includes('/login')) {
    return true;
  }

  return (await page.locator('#login, input[name="username"], input[name="password"], a:has-text("Office 365")').count()) > 0;
}

async function clickLikelyCourseEntry(page) {
  const candidates = [
    'a:has-text("Cơ sở dữ liệu")',
    'a:has-text("Co so du lieu")',
    'text=/Cơ sở dữ liệu/i'
  ];

  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }

    await locator.click({ timeout: 5000 }).catch(() => null);
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    return;
  }
}

async function expandLikelyContent(page) {
  const selectors = [
    'button:has-text("Mở")',
    'button:has-text("Xem")',
    'button:has-text("Chi tiết")',
    'button:has-text("Nội dung")',
    'a:has-text("Nội dung")',
    '.collapsed',
    '[aria-expanded="false"]'
  ];

  for (const selector of selectors) {
    const locators = page.locator(selector);
    const count = Math.min(await locators.count().catch(() => 0), 20);

    for (let index = 0; index < count; index += 1) {
      await locators.nth(index).click({ timeout: 1500 }).catch(() => null);
    }
  }

  await page.waitForTimeout(1500);
}

async function discoverMoodleStateChapters(page, courseUrl) {
  const courseId = extractCourseId(courseUrl);
  const sesskey = await page.evaluate(() => window.M?.cfg?.sesskey || document.body.innerHTML.match(/"sesskey":"([^"]+)/)?.[1] || '');
  if (!courseId || !sesskey) {
    return [];
  }

  const response = await page.request.post(
    `https://core-lms.utc.edu.vn/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_courseformat_get_state`,
    {
      data: [{ index: 0, methodname: 'core_courseformat_get_state', args: { courseid: Number(courseId) } }],
      timeout: 60000
    }
  );

  if (!response.ok()) {
    return [];
  }

  const payload = await response.json().catch(() => null);
  const state = payload?.[0]?.data ? JSON.parse(payload[0].data) : null;
  if (!state?.section || !state?.cm) {
    return [];
  }

  const itemsById = new Map(state.cm.map((item) => [String(item.id), item]));
  return state.section
    .map((section) => ({
      title: section.title || section.rawtitle || `Chuong ${section.number}`,
      items: (section.cmlist || [])
        .map((id) => itemsById.get(String(id)))
        .filter(Boolean)
        .map((item) => ({ title: item.name, url: item.url }))
        .filter((item) => item.title && item.url)
    }))
    .filter((section) => section.items.length > 0);
}

async function discoverChapters(page, baseUrl) {
  return page.evaluate((baseUrl) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const courseLinkPattern = /(resource|pluginfile|mod\/resource|mod\/quiz|mod\/url|youtube|youtu\.be|\.pdf|\.ppt|\.doc|\.zip|quiz|attempt|review|video)/i;

    const sectionNodes = Array.from(
      document.querySelectorAll(
        '.section.main, .course-section, li.section, .topics > li, .accordion-item, .course-content-item, .chapter, .lesson, .card, tbody tr, main, [role="main"]'
      )
    );

    const sectionsToUse = sectionNodes.length > 0 ? sectionNodes : [document.body];

    const raw = sectionsToUse.map((section, index) => {
      const titleNode = section.querySelector('h1, h2, h3, h4, .sectionname, .name, .topic-title, .card-title, td:nth-child(2), a');
      const title = normalize(titleNode?.textContent || `Chuong ${index + 1}`);

      const links = Array.from(section.querySelectorAll('a[href]'))
        .map((link) => {
          const href = link.getAttribute('href') || '';
          const itemTitle = normalize(link.textContent || link.getAttribute('title') || href);
          if (!href || !itemTitle) {
            return null;
          }

          try {
            const url = new URL(href, baseUrl).toString();
            if (!courseLinkPattern.test(`${url} ${itemTitle}`)) {
              return null;
            }

            return { title: itemTitle, url };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      return {
        title,
        items: dedupeLinks(links)
      };
    });

    const chapters = raw.filter((chapter) => chapter.items.length > 0);

    if (chapters.length > 0) {
      return chapters;
    }

    const allLinks = collectCandidateUrls(document.body, baseUrl, courseLinkPattern, normalize);

    return allLinks.length > 0 ? [{ title: normalize(document.title || 'Course'), items: dedupeLinks(allLinks) }] : [];

    function collectCandidateUrls(root, baseUrl, pattern, normalize) {
      const items = [];
      const attributes = ['href', 'src', 'data-url', 'data-href', 'to'];

      for (const element of Array.from(root.querySelectorAll('*'))) {
        for (const attribute of attributes) {
          const value = element.getAttribute(attribute);
          if (!value) {
            continue;
          }

          addCandidate(items, value, element, baseUrl, pattern, normalize);
        }
      }

      for (const match of document.documentElement.innerHTML.matchAll(/https?:[^\"'<>\s]+/gi)) {
        addCandidate(items, match[0], document.body, baseUrl, pattern, normalize);
      }

      return dedupeLinks(items);
    }

    function addCandidate(items, rawUrl, element, baseUrl, pattern, normalize) {
      try {
        const url = new URL(rawUrl.replace(/&amp;/g, '&'), baseUrl).toString();
        const title = normalize(element.textContent || element.getAttribute('title') || url);
        if (pattern.test(`${url} ${title}`)) {
          items.push({ title, url });
        }
      } catch {
        // Ignore malformed values from dynamic attributes.
      }
    }

    function dedupeLinks(links) {
      const result = [];
      const seen = new Set();

      for (const item of links) {
        if (seen.has(item.url)) {
          continue;
        }
        seen.add(item.url);
        result.push(item);
      }

      return result;
    }
  }, baseUrl);
}

function classifyItemType(item) {
  const composite = `${item.title} ${item.url}`.toLowerCase();

  if (
    composite.includes('quiz') ||
    composite.includes('trắc nghiệm') ||
    composite.includes('kiem tra') ||
    composite.includes('kiểm tra')
  ) {
    return 'quiz';
  }

  if (
    composite.includes('youtube.com') ||
    composite.includes('youtu.be') ||
    composite.includes('video') ||
    composite.includes('/mod/url')
  ) {
    return 'video';
  }

  if (
    composite.includes('.pdf') ||
    composite.includes('pdf') ||
    composite.includes('/mod/resource') ||
    composite.includes('/pluginfile.php')
  ) {
    return 'material';
  }

  return 'unknown';
}

function applyMaxItems(items, maxItemsPerChapter) {
  if (!maxItemsPerChapter || maxItemsPerChapter <= 0) {
    return items;
  }

  return items.slice(0, maxItemsPerChapter);
}

async function handleMaterialDownload(page, item, materialDir) {
  const extension = detectExtension(item.url) || '.pdf';
  const baseName = sanitizeFileName(item.title, shortStamp());
  const targetFile = path.join(materialDir, `${baseName}${extension}`);

  let saved = false;

  try {
    const response = await page.request.get(item.url, { timeout: 60000 });
    if (response.ok()) {
      const buffer = await response.body();
      writeBinaryFile(targetFile, buffer);
      saved = true;
    }
  } catch {
    saved = false;
  }

  if (!saved) {
    const fallbackPath = path.join(materialDir, `${baseName}.url.txt`);
    writeTextFile(fallbackPath, `${item.url}\n`);
    return {
      title: item.title,
      url: item.url,
      relativePath: toWebRelativePath(fallbackPath)
    };
  }

  return {
    title: item.title,
    url: item.url,
    relativePath: toWebRelativePath(targetFile)
  };
}

function detectExtension(url) {
  const lower = url.toLowerCase();

  if (lower.includes('.pdf')) {
    return '.pdf';
  }

  if (lower.includes('.ppt') || lower.includes('.pptx')) {
    return '.pptx';
  }

  if (lower.includes('.doc') || lower.includes('.docx')) {
    return '.docx';
  }

  if (lower.includes('.zip')) {
    return '.zip';
  }

  return '.pdf';
}

async function resolveVideoLink(context, item) {
  const page = await context.newPage();

  try {
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1500);

    const youtubeUrl = await extractYoutubeUrl(page);
    return {
      title: item.title,
      url: youtubeUrl || item.url,
      sourceUrl: item.url
    };
  } finally {
    await page.close().catch(() => null);
  }
}

async function extractYoutubeUrl(page) {
  return page.evaluate(() => {
    const normalizeYoutubeUrl = (value) => {
      if (!value) {
        return '';
      }

      const decoded = String(value)
        .replaceAll('&amp;', '&')
        .replaceAll('\\/', '/');

      const patterns = [
        /https?:\/\/www\.youtube\.com\/watch\?v=[\w-]+(?:[&?][^\s"'<>]*)?/i,
        /https?:\/\/youtu\.be\/[\w-]+(?:[?][^\s"'<>]*)?/i,
        /https?:\/\/www\.youtube\.com\/embed\/([\w-]+)/i
      ];

      for (const pattern of patterns) {
        const match = decoded.match(pattern);
        if (!match) {
          continue;
        }

        if (pattern.source.includes('embed')) {
          return `https://www.youtube.com/watch?v=${match[1]}`;
        }

        return match[0].replace(/[),.;]+$/, '');
      }

      return '';
    };

    const attributes = ['href', 'src', 'data-src', 'data-url'];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of attributes) {
        const url = normalizeYoutubeUrl(element.getAttribute(attribute));
        if (url) {
          return url;
        }
      }
    }

    return normalizeYoutubeUrl(document.documentElement.innerHTML);
  });
}

async function extractQuizAssets(context, item, chapterSlug) {
  const quizSlug = slugify(item.title, `quiz-${shortStamp()}`);

  const htmlPath = path.join(PATHS.quizzesHtmlRoot, `${chapterSlug}__${quizSlug}.html`);
  const pdfPath = path.join(PATHS.quizzesPdfRoot, `${chapterSlug}__${quizSlug}.pdf`);
  const markdownPath = path.join(PATHS.quizzesMarkdownRoot, `${chapterSlug}__${quizSlug}.md`);
  const jsonPath = path.join(PATHS.quizzesJsonRoot, `${chapterSlug}__${quizSlug}.json`);

  const page = await context.newPage();

  try {
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle').catch(() => null);

    const reviewLink = await page
      .locator('a:has-text("Hoàn thành việc xem lại"), a:has-text("Review"), a:has-text("Xem lại")')
      .first();

    if (await reviewLink.count()) {
      await reviewLink.click();
      await page.waitForLoadState('domcontentloaded').catch(() => null);
      await page.waitForLoadState('networkidle').catch(() => null);
    }

    const html = await page.content();
    writeTextFile(htmlPath, html);

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '12mm',
        left: '10mm'
      }
    });

    const quizData = await page.evaluate(quizDomEvaluator);
    writeJsonFile(jsonPath, quizData);
    writeTextFile(markdownPath, renderQuizMarkdown(item.title, quizData));

    return {
      title: item.title,
      url: item.url,
      paths: {
        htmlRelativePath: toWebRelativePath(htmlPath),
        pdfRelativePath: toWebRelativePath(pdfPath),
        markdownRelativePath: toWebRelativePath(markdownPath),
        jsonRelativePath: toWebRelativePath(jsonPath)
      }
    };
  } finally {
    await page.close();
  }
}

function renderQuizMarkdown(quizTitle, quizData) {
  const lines = [];
  lines.push(`# ${quizTitle}`);
  lines.push('');
  lines.push(`- Extracted At: ${quizData.extractedAt}`);
  lines.push(`- Score: ${quizData.scoreText || 'N/A'}`);
  lines.push(`- Questions: ${quizData.questionCount}`);
  lines.push('');

  quizData.questions.forEach((question) => {
    lines.push(`## Câu ${question.index}: ${question.title || ''}`);
    lines.push('');
    lines.push(question.prompt || '_Không trích xuất được nội dung câu hỏi_');
    lines.push('');

    if (question.options.length > 0) {
      lines.push('### Lựa chọn');
      lines.push('');
      question.options.forEach((option) => {
        lines.push(`- ${option}`);
      });
      lines.push('');
    }

    if (question.selected) {
      lines.push(`- Selected/Answer hint: ${question.selected}`);
    }

    if (question.correctness) {
      lines.push(`- Status: ${question.correctness}`);
    }

    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

async function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await rl.question(`${message}\n`);
  rl.close();
}

function toWebRelativePath(targetPath) {
  return path.relative(PATHS.packRoot, targetPath).split(path.sep).join('/');
}

main().catch((error) => {
  console.error('Trích xuất thất bại:', error.message);
  process.exitCode = 1;
});
