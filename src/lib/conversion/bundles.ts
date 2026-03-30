import { Document as WordDocument, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { marked } from 'marked';
import TurndownService from 'turndown';
import YAML from 'yaml';

import { buildOutputFilename, getMimeTypeForFormat, normalizeFormatId } from '../formats';
import type { ConversionArtifact, ConversionContext, SheetBundle, TextBundle } from './types';

marked.setOptions({ gfm: true, breaks: true });

const turndownService = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const xmlBuilder = new XMLBuilder({ format: true, ignoreAttributes: false, attributeNamePrefix: '@_' });

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function stripHtml(value: string): string {
  const template = document.createElement('template');
  template.innerHTML = value;
  return template.content.textContent?.replace(/\n{3,}/g, '\n\n').trim() ?? '';
}

export function textToHtmlBlock(text: string): string {
  return `<pre>${escapeHtml(text)}</pre>`;
}

export function ensureTextBundleSection(title: string, body: string): Array<{ title: string; body: string }> {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => ({
      title: index === 0 ? title : `${title} ${index + 1}`,
      body: paragraph,
    }));
}

export function bundleToHtmlDocument(bundle: TextBundle): string {
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(bundle.title)}</title>`,
    '<style>body{font-family:IBM Plex Sans,Arial,sans-serif;line-height:1.6;margin:2rem;color:#0f1720}pre{white-space:pre-wrap;background:#f2f5f8;padding:1rem;border-radius:0.75rem}h1,h2{line-height:1.2}section{margin-bottom:1.5rem}</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(bundle.title)}</h1>`,
    bundle.html,
    '</body>',
    '</html>',
  ].join('');
}

export async function buildTextBundleFromTextInput(fileName: string, formatId: string, file: File): Promise<TextBundle> {
  const raw = await file.text();
  const title = fileName.replace(/\.[^.]+$/, '');

  if (formatId === 'md') {
    return {
      title,
      text: stripHtml(String(marked.parse(raw))),
      html: String(marked.parse(raw)),
      markdown: raw,
      sections: ensureTextBundleSection(title, raw),
    };
  }

  if (formatId === 'html' || formatId === 'svg') {
    return {
      title,
      text: stripHtml(raw),
      html: raw,
      markdown: turndownService.turndown(raw),
      sections: ensureTextBundleSection(title, stripHtml(raw)),
    };
  }

  if (formatId === 'json') {
    const pretty = JSON.stringify(JSON.parse(raw), null, 2);
    return {
      title,
      text: pretty,
      html: textToHtmlBlock(pretty),
      markdown: `\`\`\`json\n${pretty}\n\`\`\``,
      sections: ensureTextBundleSection(title, pretty),
    };
  }

  if (formatId === 'yaml') {
    const pretty = YAML.stringify(YAML.parse(raw)).trim();
    return {
      title,
      text: pretty,
      html: textToHtmlBlock(pretty),
      markdown: `\`\`\`yaml\n${pretty}\n\`\`\``,
      sections: ensureTextBundleSection(title, pretty),
    };
  }

  if (formatId === 'xml') {
    const pretty = xmlBuilder.build(xmlParser.parse(raw));
    return {
      title,
      text: pretty,
      html: textToHtmlBlock(pretty),
      markdown: `\`\`\`xml\n${pretty}\n\`\`\``,
      sections: ensureTextBundleSection(title, pretty),
    };
  }

  return {
    title,
    text: raw,
    html: textToHtmlBlock(raw),
    markdown: raw,
    sections: ensureTextBundleSection(title, raw),
  };
}

export async function buildTextBundleFromDocx(fileName: string, file: File): Promise<TextBundle> {
  const mammoth = await import('mammoth');
  const buffer = await file.arrayBuffer();
  const [htmlResult, textResult] = await Promise.all([
    mammoth.convertToHtml({ arrayBuffer: buffer }),
    mammoth.extractRawText({ arrayBuffer: buffer }),
  ]);
  const title = fileName.replace(/\.[^.]+$/, '');
  return {
    title,
    text: textResult.value.trim(),
    html: htmlResult.value,
    markdown: turndownService.turndown(htmlResult.value),
    sections: ensureTextBundleSection(title, textResult.value.trim()),
  };
}

export async function buildTextBundleFromPdf(fileName: string, file: File, context: ConversionContext): Promise<TextBundle> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
  context.onProgress({ stage: 'Parsing PDF', percent: 24 });
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (pageText) {
      pages.push(pageText);
    }
    context.onProgress({
      stage: 'Extracting PDF text',
      percent: 24 + Math.round((pageNumber / pdf.numPages) * 28),
      detail: `Page ${pageNumber} of ${pdf.numPages}`,
    });
  }

  const text = pages.join('\n\n');
  const title = fileName.replace(/\.[^.]+$/, '');
  return {
    title,
    text,
    html: textToHtmlBlock(text),
    markdown: text,
    sections: ensureTextBundleSection(title, text),
  };
}

export async function buildTextBundleFromPresentation(fileName: string, formatId: string, file: File): Promise<TextBundle> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const title = fileName.replace(/\.[^.]+$/, '');
  const sections: Array<{ title: string; body: string }> = [];

  if (formatId === 'pptx') {
    const slides = Object.keys(zip.files)
      .filter((entry) => entry.startsWith('ppt/slides/slide') && entry.endsWith('.xml'))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    for (const [index, slide] of slides.entries()) {
      const xml = await zip.files[slide].async('text');
      const matches = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map((entry) => decodeXmlEntities(entry[1]));
      const body = matches.join('\n').trim();
      if (body) {
        sections.push({ title: `Slide ${index + 1}`, body });
      }
    }
  } else {
    const contentXml = await zip.files['content.xml']?.async('text');
    if (contentXml) {
      const paragraphs = [...contentXml.matchAll(/<text:p[^>]*>(.*?)<\/text:p>/g)]
        .map((entry) => stripHtml(decodeXmlEntities(entry[1].replace(/<[^>]+>/g, ' '))))
        .filter(Boolean);
      chunk(paragraphs, 6).forEach((group, index) => {
        sections.push({ title: `Slide ${index + 1}`, body: group.join('\n') });
      });
    }
  }

  const text = sections.map((section) => `${section.title}\n${section.body}`).join('\n\n');
  return {
    title,
    text,
    html: sections
      .map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body).replaceAll('\n', '<br />')}</p></section>`)
      .join(''),
    markdown: sections.map((section) => `## ${section.title}\n\n${section.body}`).join('\n\n'),
    sections: sections.length > 0 ? sections : ensureTextBundleSection(title, text),
  };
}

export async function buildSheetBundle(fileName: string, file: File): Promise<SheetBundle> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return {
    title: fileName.replace(/\.[^.]+$/, ''),
    sheets: workbook.SheetNames.map((sheetName) => ({
      name: sheetName,
      rows: XLSX.utils
        .sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false })
        .map((row) => (row as Array<string | number | boolean | null | undefined>).map((cell) => `${cell ?? ''}`)) as string[][],
    })),
  };
}

export async function buildTextBundleFromEpub(fileName: string, file: File): Promise<TextBundle> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const title = fileName.replace(/\.[^.]+$/, '');
  const htmlEntries = Object.keys(zip.files)
    .filter((entry) => /\.(xhtml|html|htm)$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));

  const sections: Array<{ title: string; body: string }> = [];
  for (const [index, entry] of htmlEntries.entries()) {
    const html = await zip.files[entry].async('text');
    const text = stripHtml(html);
    if (text) {
      sections.push({ title: `Chapter ${index + 1}`, body: text });
    }
  }

  const text = sections.map((section) => `${section.title}\n${section.body}`).join('\n\n');
  return {
    title,
    text,
    html: sections
      .map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body).replaceAll('\n', '<br />')}</p></section>`)
      .join(''),
    markdown: sections.map((section) => `## ${section.title}\n\n${section.body}`).join('\n\n'),
    sections,
  };
}

export async function exportTextBundle(bundle: TextBundle, targetFormatId: string, context: ConversionContext): Promise<ConversionArtifact> {
  const target = normalizeFormatId(targetFormatId);
  let blob: Blob;
  let mimeType = getMimeTypeForFormat(target);

  context.onProgress({ stage: 'Exporting', percent: 64, detail: target.toUpperCase() });

  if (target === 'txt') {
    blob = new Blob([bundle.text], { type: mimeType });
  } else if (target === 'md') {
    blob = new Blob([bundle.markdown], { type: 'text/markdown' });
    mimeType = 'text/markdown';
  } else if (target === 'html') {
    blob = new Blob([bundleToHtmlDocument(bundle)], { type: 'text/html' });
    mimeType = 'text/html';
  } else if (target === 'json') {
    blob = new Blob([JSON.stringify({ title: bundle.title, sections: bundle.sections }, null, 2)], { type: 'application/json' });
    mimeType = 'application/json';
  } else if (target === 'xml') {
    blob = new Blob([xmlBuilder.build({ document: { title: bundle.title, section: bundle.sections } })], { type: 'application/xml' });
    mimeType = 'application/xml';
  } else if (target === 'yaml') {
    blob = new Blob([YAML.stringify({ title: bundle.title, sections: bundle.sections })], { type: 'application/yaml' });
    mimeType = 'application/yaml';
  } else if (target === 'pdf') {
    blob = await createPdfFromTextBundle(bundle, context);
    mimeType = 'application/pdf';
  } else if (target === 'docx') {
    blob = await createDocxFromTextBundle(bundle, context);
    mimeType = getMimeTypeForFormat('docx');
  } else if (target === 'pptx') {
    blob = await createPptxFromTextBundle(bundle, context);
    mimeType = getMimeTypeForFormat('pptx');
  } else {
    throw new Error(`Unsupported text export target: ${target}`);
  }

  return {
    blob,
    fileName: buildOutputFilename(bundle.title, target),
    formatId: target,
    mimeType,
    previewText: ['txt', 'md', 'html', 'json', 'xml', 'yaml'].includes(target) ? bundle.text.slice(0, 1200) : undefined,
    previewUrl: target === 'pdf' ? URL.createObjectURL(blob) : undefined,
  };
}

export async function createImagePdf(imageBlob: Blob, context: ConversionContext): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  context.onProgress({ stage: 'Embedding image into PDF', percent: 76 });
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const imageBytes = await imageBlob.arrayBuffer();
  const embedded =
    imageBlob.type === 'image/jpeg' ? await pdf.embedJpg(imageBytes) : await pdf.embedPng(imageBytes);
  const size = embedded.scale(1);
  const scale = Math.min(480 / size.width, 700 / size.height, 1);
  page.drawImage(embedded, {
    x: (page.getWidth() - size.width * scale) / 2,
    y: (page.getHeight() - size.height * scale) / 2,
    width: size.width * scale,
    height: size.height * scale,
  });
  const saved = await pdf.save();
  return new Blob([toBlobPart(saved)], { type: 'application/pdf' });
}

export async function renderImageFile(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.match(/\.(heic|heif)$/i)) {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/png' });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return renderImageFile(new File([blob], `${file.name}.png`, { type: 'image/png' }));
  }

  if (file.type === 'image/tiff' || file.name.match(/\.(tif|tiff)$/i)) {
    const UTIF = await import('utif');
    const buffer = await file.arrayBuffer();
    const ifds = UTIF.decode(buffer);
    UTIF.decodeImage(buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const canvas = document.createElement('canvas');
    canvas.width = ifds[0].width;
    canvas.height = ifds[0].height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D is unavailable.');
    }
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), ifds[0].width, ifds[0].height), 0, 0);
    return { blob: await canvasToBlob(canvas, 'image/png', 0.95), width: canvas.width, height: canvas.height };
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D is unavailable.');
  }
  context.drawImage(bitmap, 0, 0);
  return {
    blob: await canvasToBlob(canvas, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95),
    width: bitmap.width,
    height: bitmap.height,
  };
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas export failed.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

function decodeXmlEntities(value: string): string {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function createPdfFromTextBundle(bundle: TextBundle, context: ConversionContext): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  context.onProgress({ stage: 'Exporting PDF', percent: 72 });
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 56;
  const lineHeight = 16;
  let page = pdf.addPage(pageSize);
  let y = pageSize[1] - margin;

  const writeLine = (text: string, font = regular, size = 11, color = rgb(0.08, 0.12, 0.16)) => {
    if (y < margin) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
    }
    page.drawText(text, { x: margin, y, size, font, color });
    y -= lineHeight;
  };

  writeLine(bundle.title, bold, 18, rgb(0.04, 0.08, 0.12));
  y -= 10;

  for (const section of bundle.sections) {
    writeLine(section.title, bold, 13);
    const words = section.body.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      const next = currentLine ? `${currentLine} ${word}` : word;
      if (regular.widthOfTextAtSize(next, 11) > pageSize[0] - margin * 2) {
        writeLine(currentLine);
        currentLine = word;
      } else {
        currentLine = next;
      }
    }
    if (currentLine) {
      writeLine(currentLine);
    }
    y -= 8;
  }

  const saved = await pdf.save();
  return new Blob([toBlobPart(saved)], { type: 'application/pdf' });
}

async function createDocxFromTextBundle(bundle: TextBundle, context: ConversionContext): Promise<Blob> {
  context.onProgress({ stage: 'Exporting DOCX', percent: 76 });
  const document = new WordDocument({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(bundle.title)] }),
          ...bundle.sections.flatMap((section) => [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.title)] }),
            ...section.body
              .split(/\n+/)
              .map((paragraph) => paragraph.trim())
              .filter(Boolean)
              .map((paragraph) => new Paragraph({ children: [new TextRun(paragraph)] })),
          ]),
        ],
      },
    ],
  });
  return Packer.toBlob(document);
}

async function createPptxFromTextBundle(bundle: TextBundle, context: ConversionContext): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs');
  context.onProgress({ stage: 'Exporting PPTX', percent: 78 });
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Universal File Converter';
  pptx.subject = bundle.title;
  pptx.theme = { headFontFace: 'IBM Plex Sans', bodyFontFace: 'IBM Plex Sans' };

  const cover = pptx.addSlide();
  cover.background = { color: '0C1419' };
  cover.addText(bundle.title, { x: 0.8, y: 1.2, w: 11, h: 1, fontSize: 24, bold: true, color: 'F6F9FC' });
  cover.addText('Generated from a local text bundle', { x: 0.8, y: 2.2, w: 5, h: 0.5, fontSize: 10, color: '8CA5B7' });

  for (const section of bundle.sections.slice(0, 24)) {
    const slide = pptx.addSlide();
    slide.background = { color: '0F1A21' };
    slide.addText(section.title, { x: 0.7, y: 0.5, w: 11, h: 0.6, fontSize: 20, bold: true, color: 'EFF7FD' });
    slide.addText(
      section.body
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((line) => ({ text: line, options: { bullet: { indent: 18 } } })),
      { x: 0.9, y: 1.4, w: 10.5, h: 5, fontSize: 12, color: 'D6E4EF', breakLine: true, fit: 'shrink', valign: 'top' },
    );
  }

  const blob = await pptx.write({ outputType: 'blob' });
  return blob instanceof Blob ? blob : new Blob([blob as ArrayBuffer], { type: getMimeTypeForFormat('pptx') });
}

function toBlobPart(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}
