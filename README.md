# CSDL Study Pack Extractor

Tool local dùng Playwright để gom tài liệu học môn Cơ sở dữ liệu từ E-Learning thành bộ học liệu offline.

## Cấu trúc thư mục

```text
Database_Study_Pack/
├── materials/
├── quizzes/
│   ├── html/
│   ├── pdf/
│   ├── markdown/
│   └── json/
├── videos/
├── exports/
├── browser-profile/
└── code/
```

## Yêu cầu

- Windows + Node.js 18+ (khuyến nghị Node 20+)
- Google Chrome (để Playwright mở channel `chrome`)
- Tài khoản E-Learning hợp lệ

## Cài đặt

Từ thư mục `Database_Study_Pack/code`:

```bash
npm install
npm run setup
```

`npm run setup` sẽ tải browser Chrome dành cho Playwright (khớp với cấu hình `channel: "chrome"`).

## Bước 1: Đăng nhập 1 lần và lưu session

```bash
npm run login
```

- Tool sẽ hỏi URL khóa học (nếu chưa có trong `config.local.json`).
- Browser mở ra, bạn đăng nhập Microsoft.
- Sau khi vào được trang khóa học, quay lại terminal nhấn Enter.
- Session được lưu trong `../browser-profile/`.

## Bước 2: Chạy trích xuất

```bash
npm run extract
```

Kết quả:
- PDF/tài liệu: `../materials/`
- Quiz HTML/PDF/Markdown/JSON: `../quizzes/`
- Danh sách video: `../videos/videos.md`
- Mục lục + báo cáo: `../exports/index.html`, `../exports/extraction-report.md`

## Bước 3: Tạo lại report/index (nếu cần)

```bash
npm run report
```

## Cấu hình

File `config.local.json` được tạo trong thư mục `code/`.

Ví dụ:

```json
{
  "courseUrl": "https://<domain>/course/view.php?id=123",
  "headlessExtraction": true,
  "timeoutMs": 45000,
  "maxItemsPerChapter": 0
}
```

- `headlessExtraction: false` nếu bạn muốn nhìn browser chạy trực tiếp.
- `maxItemsPerChapter: 0` nghĩa là không giới hạn.

## Kiểm tra nhanh cú pháp

```bash
npm run check
```

## Lưu ý

- Tool không lưu mật khẩu.
- Tool chỉ lưu session local trong `browser-profile`.
- Nếu session hết hạn, chạy lại `npm run login`.
