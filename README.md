# Universal File Converter

Universal File Converter is a static, local-first web application for broad file conversion across documents, spreadsheets, presentations, images, media, archives, code, and ebooks.

The app is designed as an intelligent conversion orchestrator:

- It detects uploaded files and maps them to a conversion family.
- It recommends local browser-based routes first whenever possible.
- It falls back to external providers only with explicit confirmation.
- It keeps conversion history locally without storing user file contents.

## Highlights

- Drag-and-drop and multi-file upload
- Per-file output format selection
- Automatic route planning with local vs external visibility
- Progress tracking and batch download
- Local history stored in `localStorage`
- Provider tokens stored in `sessionStorage`
- Responsive system-style UI
- Static-hosting-ready build with no backend ownership required

## Local Engines

The browser-side conversion layer includes:

- Text and markup conversions: `txt`, `md`, `html`, `json`, `xml`, `yaml`
- Document conversions: `docx`, `pdf`, text-based document exports
- Spreadsheet conversions: `xls`, `xlsx`, `csv`, `tsv`, `ods`
- Presentation text extraction: `pptx`, `odp`
- Image conversions: `jpg`, `png`, `webp`, `bmp`, `tiff`, `svg`, `heic`, `gif`, `avif`
- OCR: image and PDF to text-style outputs
- Media conversion with lazy-loaded FFmpeg
- ZIP packaging and ZIP manifest extraction
- EPUB text extraction and re-export

## External Fallbacks

The app ships with pluggable remote adapters for:

- `ConvertAPI`
- `CloudConvert`

Remote execution is only used if:

1. A local route is unavailable or you choose an external-first policy.
2. The required provider token is present.
3. You explicitly confirm the upload when a remote route is selected.

## Architecture

Relevant source layout:

- `src/App.tsx`: app shell, queue state, previews, advanced options
- `src/lib/formats.ts`: format registry and detection helpers
- `src/lib/storage.ts`: preferences, provider settings, local history
- `src/lib/conversion/types.ts`: shared conversion types
- `src/lib/conversion/planner.ts`: analysis, compatibility discovery, route planning
- `src/lib/conversion/bundles.ts`: parsers and exporters for textual, spreadsheet, image, and ebook flows
- `src/lib/conversion/executor.ts`: local engine execution, OCR, media, ZIP, and remote provider calls

## Setup

Requirements:

- Node.js 22+
- npm 11+

Install and run:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Static Deployment

The app is configured with a relative Vite base path, so the generated `dist/` output can be deployed to static hosts such as:

- GitHub Pages
- Netlify
- Vercel static output
- Cloudflare Pages

Basic GitHub Pages workflow:

1. Run `npm run build`
2. Publish the contents of `dist/`
3. If you use a branch-based Pages setup, point Pages at the built artifact branch or deploy through your CI

## Provider Tokens

The UI exposes token fields in Advanced Options.

- `ConvertAPI token`
- `CloudConvert token`

These are stored only in `sessionStorage`, which means they disappear when the browser session ends.

## Privacy Model

- Files stay local by default.
- History stores only metadata, not file contents.
- Remote transfers require explicit user confirmation.
- No custom backend is required for core operation.

## Practical Limits

This project aims for the broadest practical universality in a static browser app, but there are still real-world limits:

- Very large media files can exceed browser memory budgets.
- Some complex Office layout fidelity is best-effort when converted locally.
- OCR quality depends on scan quality and language support.
- Exotic archive and proprietary formats may require remote providers.

## Verification

Current verification completed:

```bash
npm run build
```
