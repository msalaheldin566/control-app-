'# نظام حساب الكنترول التراكمي — Cumulative Control System

تطبيق ويب / سطح مكتب لحساب الـ cGPA والنسبة المئوية لترانسكريبتات طلاب كلية طب الأسنان، حسب قواعد الكنترول.

## هيكل الملفات

| الملف | الوظيفة |
|---|---|
| `index.html` | صفحة التطبيق الرئيسية |
| `css/style.css` | التنسيقات |
| `js/app.js` | منطق قراءة الترانسكريبتات والحساب والتصدير |
| `main.js` | ملف تشغيل Electron (لنسخة سطح المكتب) |
| `package.json` | إعدادات المشروع والـ build |
| `icon.ico` | أيقونة البرنامج (اختياري — ضع ملف الأيقونة هنا) |

## ١. النشر كموقع على GitHub Pages

1. اعمل مستودع جديد على GitHub وارفع الملفات كما هي.
2. من **Settings → Pages** اختر الفرع `main` والمجلد `/ (root)` واحفظ.
3. بعد دقيقة التطبيق هيكون متاح على: `https://اسم-المستخدم.github.io/اسم-المستودع/`

> ملاحظة: المكتبات (XLSX وJSZip وFileSaver) بتتحمّل من CDN، يعني الموقع يحتاج إنترنت.

## ٢. بناء ملف EXE (Windows) باستخدام Electron

### المتطلبات
- Node.js من [nodejs.org](https://nodejs.org) (الإصدار LTS)
- جهاز Windows (الـ build على Windows يطلّع ملف `.exe` مباشرة)

### الخطوات

```bash
# ١. افتح الطرفي (Terminal) جوه مجلد المشروع وثبّت الاعتماديات
npm install

# ٢. جرّب التطبيق أولًا
npm start

# ٣. ابني ملف التثبيت (Installer) والنسخة المحمولة (Portable)
npm run dist
```

بعد ما يخلص، هتلاقي النواتج في مجلد `dist/`:

- `نظام حساب الكنترول التراكمي Setup 1.0.0.exe` — ملف تثبيت
- `نظام حساب الكنترول التراكمي 1.0.0.exe` — نسخة محمولة (تشتغل من غير تثبيت)

### لو عايز بناء تلقائي عبر GitHub (من غير ما تثبّت حاجة على جهازك)

ضع ملف `.github/workflows/build.yml` في المستودع:

```yaml
name: Build EXE
on:
  push:
    tags: [ 'v*' ]
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run dist
      - uses: actions/upload-artifact@v4
        with:
          name: control-system-exe
          path: dist/*.exe
```

وبعدها اعمل `git tag v1.0.0` وادفعه — GitHub هيبني الـ exe وتحمّله من صفحة الـ Actions.

## آلية الحساب

- المقرر المكرر (تحسين/إعادة): الدرجة الأعلى داخلة في نقاط الجودة والمجموع التراكمي.
- مرة الرسوب (L=0) من المقرر المكرر: داخلة في نقاط الجودة فقط.
- مواد المعادلة TR: ساعاتها مستبعَدة من المقام.
- cGPA = Σ(L×N) ÷ (الساعات المكتسبة − ساعات TR)، والنسبة = Σ(M×N) ÷ نفس المقام.

---
Created and designed by Dr. Mohamed Salah
