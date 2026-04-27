import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATHS } from './config.js';
import { ensureParentDirectory, writeTextFile } from './utils/files.js';

export function generateExtractionReport(manifest) {
  const lines = [];

  lines.push('# Extraction Report');
  lines.push('');
  lines.push(`- Generated At: ${manifest.generatedAt}`);
  lines.push(`- Course URL: ${manifest.courseUrl}`);
  lines.push(`- Chapters: ${manifest.summary.chapterCount}`);
  lines.push(`- Materials: ${manifest.summary.materialCount}`);
  lines.push(`- Videos: ${manifest.summary.videoCount}`);
  lines.push(`- Quizzes: ${manifest.summary.quizCount}`);
  lines.push('');
  lines.push('## Chapters');
  lines.push('');

  for (const chapter of manifest.chapters) {
    lines.push(`### ${chapter.chapterOrder}. ${chapter.chapterTitle}`);
    lines.push(`- Materials: ${chapter.materials.length}`);
    lines.push(`- Videos: ${chapter.videos.length}`);
    lines.push(`- Quizzes: ${chapter.quizzes.length}`);
    lines.push('');
  }

  writeTextFile(PATHS.extractionReportPath, `${lines.join('\n')}\n`);
}

export function generateOfflineIndex(manifest) {
  const chapterBlocks = manifest.chapters
    .map((chapter) => {
      const materials = chapter.materials
        .map((item) => `<li><a href="../${item.relativePath}">${escapeHtml(item.title)}</a></li>`)
        .join('');

      const videos = chapter.videos
        .map((item) => `<li><a href="${item.url}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a></li>`)
        .join('');

      const quizzes = chapter.quizzes
        .map((item) => {
          const links = [];
          if (item.paths?.htmlRelativePath) {
            links.push(`<a href="../${item.paths.htmlRelativePath}">HTML</a>`);
          }
          if (item.paths?.pdfRelativePath) {
            links.push(`<a href="../${item.paths.pdfRelativePath}">PDF</a>`);
          }
          if (item.paths?.markdownRelativePath) {
            links.push(`<a href="../${item.paths.markdownRelativePath}">Markdown</a>`);
          }
          if (item.paths?.jsonRelativePath) {
            links.push(`<a href="../${item.paths.jsonRelativePath}">JSON</a>`);
          }

          return `<li>${escapeHtml(item.title)} — ${links.join(' | ')}</li>`;
        })
        .join('');

      return `
      <section class="chapter">
        <h2>${chapter.chapterOrder}. ${escapeHtml(chapter.chapterTitle)}</h2>
        <div class="grid">
          <article>
            <h3>Tài liệu (PDF/File)</h3>
            <ul>${materials || '<li>Không có</li>'}</ul>
          </article>
          <article>
            <h3>Video</h3>
            <ul>${videos || '<li>Không có</li>'}</ul>
          </article>
          <article>
            <h3>Quiz đã gom</h3>
            <ul>${quizzes || '<li>Không có</li>'}</ul>
          </article>
        </div>
      </section>
      `;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CSDL Study Pack Index</title>
  <meta name="description" content="Mục lục offline tài liệu môn Cơ sở dữ liệu." />
  <style>
    :root {
      color-scheme: dark;
      --bg: #090c14;
      --panel: #12192a;
      --muted: #91a2bf;
      --text: #ebf2ff;
      --brand: #7cc6ff;
      --border: #24314d;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Roboto, Arial, sans-serif;
      background: radial-gradient(circle at top, #111b32 0%, var(--bg) 45%);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.5;
    }

    header {
      padding: 32px 20px 16px;
      max-width: 1100px;
      margin: 0 auto;
    }

    h1 { margin: 0 0 8px; font-size: 30px; }
    .meta { color: var(--muted); }

    main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 8px 20px 40px;
      display: grid;
      gap: 18px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 8px;
    }

    .card {
      background: rgba(18, 25, 42, 0.9);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 14px;
    }

    .stat { font-size: 28px; font-weight: 700; color: var(--brand); }

    .chapter {
      background: rgba(18, 25, 42, 0.95);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
    }

    .chapter h2 { margin-top: 0; }

    .grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    }

    article {
      background: #0b1222;
      border: 1px solid #1a2643;
      border-radius: 12px;
      padding: 12px;
    }

    article h3 { margin-top: 0; font-size: 16px; }

    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 6px; }

    a { color: #8fd7ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1 id="page-title">CSDL Study Pack</h1>
    <p class="meta">Generated at: ${escapeHtml(manifest.generatedAt)}</p>
    <p class="meta">Course: <a href="${escapeHtml(manifest.courseUrl)}" target="_blank" rel="noreferrer">${escapeHtml(manifest.courseUrl)}</a></p>
  </header>
  <main>
    <section class="summary" aria-label="Summary stats">
      <div class="card"><div class="stat">${manifest.summary.chapterCount}</div><div>Chương</div></div>
      <div class="card"><div class="stat">${manifest.summary.materialCount}</div><div>Tài liệu</div></div>
      <div class="card"><div class="stat">${manifest.summary.videoCount}</div><div>Video</div></div>
      <div class="card"><div class="stat">${manifest.summary.quizCount}</div><div>Quiz</div></div>
    </section>
    ${chapterBlocks}
  </main>
</body>
</html>`;

  ensureParentDirectory(PATHS.indexPath);
  fs.writeFileSync(PATHS.indexPath, html, 'utf8');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function writeVideoMarkdown(manifest) {
  const lines = ['# Video Links by Chapter', ''];

  for (const chapter of manifest.chapters) {
    lines.push(`## ${chapter.chapterOrder}. ${chapter.chapterTitle}`);

    if (chapter.videos.length === 0) {
      lines.push('- Không có video.');
      lines.push('');
      continue;
    }

    for (const video of chapter.videos) {
      lines.push(`- [${video.title}](${video.url})`);
      if (video.sourceUrl && video.sourceUrl !== video.url) {
        lines.push(`  - LMS: ${video.sourceUrl}`);
      }
    }

    lines.push('');
  }

  const targetPath = path.join(PATHS.videosRoot, 'videos.md');
  writeTextFile(targetPath, `${lines.join('\n')}\n`);
}

function runFromCli() {
  if (!fs.existsSync(PATHS.manifestPath)) {
    throw new Error('Chưa có manifest. Hãy chạy npm run extract trước.');
  }

  const manifest = JSON.parse(fs.readFileSync(PATHS.manifestPath, 'utf8'));
  writeVideoMarkdown(manifest);
  generateExtractionReport(manifest);
  generateOfflineIndex(manifest);

  console.log('Đã tạo lại report/index từ manifest hiện có.');
}

if (process.argv[1]) {
  const currentFilePath = fileURLToPath(import.meta.url);
  const cliFilePath = path.resolve(process.argv[1]);

  if (path.resolve(currentFilePath) === cliFilePath) {
    runFromCli();
  }
}
