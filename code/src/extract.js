import path from 'node:path';
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
    await page.goto(courseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => null);

    const chapters = await discoverChapters(page, baseUrl);
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
          chapterRecord.videos.push({
            title: item.title,
            url: item.url
          });
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
  } finally {
    await context.close();
  }
}

async function discoverChapters(page, baseUrl) {
  return page.evaluate((baseUrl) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const sectionNodes = Array.from(
      document.querySelectorAll(
        '.section.main, .course-section, li.section, .topics > li, .accordion-item, .course-content-item'
      )
    );

    const sectionsToUse = sectionNodes.length > 0 ? sectionNodes : [document.body];

    const raw = sectionsToUse.map((section, index) => {
      const titleNode = section.querySelector('h3, h4, .sectionname, .name, .topic-title, .card-title');
      const title = normalize(titleNode?.textContent || `Chuong ${index + 1}`);

      const links = Array.from(section.querySelectorAll('a[href]'))
        .map((link) => {
          const href = link.getAttribute('href') || '';
          const itemTitle = normalize(link.textContent || link.getAttribute('title'));
          if (!href || !itemTitle) {
            return null;
          }

          try {
            return {
              title: itemTitle,
              url: new URL(href, baseUrl).toString()
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const deduped = [];
      const seen = new Set();

      for (const item of links) {
        if (seen.has(item.url)) {
          continue;
        }

        seen.add(item.url);
        deduped.push(item);
      }

      return {
        title,
        items: deduped
      };
    });

    return raw.filter((chapter) => chapter.items.length > 0);
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

function toWebRelativePath(targetPath) {
  return path.relative(PATHS.packRoot, targetPath).split(path.sep).join('/');
}

main().catch((error) => {
  console.error('Trích xuất thất bại:', error.message);
  process.exitCode = 1;
});
