import JSZip from 'jszip';

import { buildOutputFilename, getMimeTypeForFormat, getPreviewKind, normalizeFormatId } from '../formats';
import type { ConversionArtifact, ConversionContext, ConversionPlan, TextBundle } from './types';
import {
  AUDIO_INPUT_FORMATS,
  PRESENTATION_INPUT_FORMATS,
  STRUCTURED_INPUT_FORMATS,
  VIDEO_INPUT_FORMATS,
} from './types';
import {
  buildSheetBundle,
  buildTextBundleFromDocx,
  buildTextBundleFromEpub,
  buildTextBundleFromPdf,
  buildTextBundleFromPresentation,
  buildTextBundleFromTextInput,
  canvasToBlob,
  createImagePdf,
  ensureTextBundleSection,
  escapeHtml,
  exportTextBundle,
  renderImageFile,
  textToHtmlBlock,
} from './bundles';

let ffmpegSingleton: { ffmpeg: Awaited<ReturnType<typeof createFfmpeg>>['ffmpeg']; fetchFile: Awaited<ReturnType<typeof createFfmpeg>>['fetchFile'] } | null = null;

export async function executeConversion(
  plan: ConversionPlan,
  input: { name: string; extension: string; file: File; formatId: string },
  context: ConversionContext,
): Promise<ConversionArtifact> {
  switch (plan.engineId) {
    case 'text-local':
      return executeTextConversion(input, plan, context);
    case 'document-local':
      return executeDocumentConversion(input, plan, context);
    case 'spreadsheet-local':
      return executeSpreadsheetConversion(input, plan, context);
    case 'presentation-local':
      return executePresentationConversion(input, plan, context);
    case 'image-local':
      return executeImageConversion(input, plan, context);
    case 'ocr-local':
      return executeOcrConversion(input, plan, context);
    case 'archive-local':
      return executeArchiveConversion(input, plan, context);
    case 'ebook-local':
      return executeEbookConversion(input, plan, context);
    case 'media-local':
      return executeMediaConversion(input, plan, context);
    case 'convertapi-remote':
      return executeConvertApiConversion(input, plan, context);
    case 'cloudconvert-remote':
      return executeCloudConvertConversion(input, plan, context);
    default:
      throw new Error(`Unsupported engine ${plan.engineId}`);
  }
}

async function executeTextConversion(
  input: { name: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  context.onProgress({ stage: 'Reading source', percent: 12 });
  const bundle = await buildTextBundleFromTextInput(input.name, input.formatId, input.file);

  if (STRUCTURED_INPUT_FORMATS.has(input.formatId) && STRUCTURED_INPUT_FORMATS.has(plan.targetFormatId)) {
    return exportTextBundle(bundle, plan.targetFormatId, context);
  }

  return exportTextBundle(bundle, plan.targetFormatId, context);
}

async function executeDocumentConversion(
  input: { name: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  const bundle =
    input.formatId === 'docx'
      ? await buildTextBundleFromDocx(input.name, input.file)
      : input.formatId === 'pdf'
        ? await buildTextBundleFromPdf(input.name, input.file, context)
        : await buildTextBundleFromTextInput(input.name, input.formatId, input.file);
  return exportTextBundle(bundle, plan.targetFormatId, context);
}

async function executeSpreadsheetConversion(
  input: { name: string; file: File },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  context.onProgress({ stage: 'Loading workbook', percent: 18 });
  const bundle = await buildSheetBundle(input.name, input.file);
  const target = plan.targetFormatId;
  const firstSheet = bundle.sheets[0];
  if (!firstSheet) {
    throw new Error('The spreadsheet does not contain any readable sheet.');
  }

  if (target === 'xlsx') {
    const workbook = await import('xlsx').then((module) => module.default ?? module);
    const sheetJs = workbook as typeof import('xlsx');
    const wb = sheetJs.utils.book_new();
    for (const sheet of bundle.sheets) {
      sheetJs.utils.book_append_sheet(wb, sheetJs.utils.aoa_to_sheet(sheet.rows), sheet.name);
    }
    const output = sheetJs.write(wb, { type: 'array', bookType: 'xlsx' });
    return {
      blob: new Blob([output], { type: getMimeTypeForFormat('xlsx') }),
      fileName: buildOutputFilename(input.name, 'xlsx'),
      formatId: 'xlsx',
      mimeType: getMimeTypeForFormat('xlsx'),
    };
  }

  if (target === 'csv' || target === 'tsv') {
    const delimiter = target === 'tsv' ? '\t' : ',';
    const text = firstSheet.rows.map((row) => row.map(escapeCsvCell).join(delimiter)).join('\n');
    return {
      blob: new Blob([text], { type: target === 'csv' ? 'text/csv' : 'text/tab-separated-values' }),
      fileName: buildOutputFilename(input.name, target),
      formatId: target,
      mimeType: target === 'csv' ? 'text/csv' : 'text/tab-separated-values',
      previewText: text.slice(0, 1200),
    };
  }

  if (target === 'json') {
    const [header, ...rows] = firstSheet.rows;
    const payload = rows.map((row) =>
      Object.fromEntries(header.map((column, index) => [column || `column_${index + 1}`, row[index] ?? ''])),
    );
    const text = JSON.stringify(payload, null, 2);
    return {
      blob: new Blob([text], { type: 'application/json' }),
      fileName: buildOutputFilename(input.name, 'json'),
      formatId: 'json',
      mimeType: 'application/json',
      previewText: text.slice(0, 1200),
    };
  }

  if (target === 'html') {
    const html = bundle.sheets
      .map(
        (sheet) =>
          `<section><h2>${escapeHtml(sheet.name)}</h2><table><tbody>${sheet.rows
            .map(
              (row) =>
                `<tr>${row
                  .map((cell, index) => `<${index === 0 ? 'th' : 'td'}>${escapeHtml(cell)}</${index === 0 ? 'th' : 'td'}>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table></section>`,
      )
      .join('');
    return {
      blob: new Blob(
        [
          `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>body{font-family:IBM Plex Sans,Arial,sans-serif;padding:2rem}table{width:100%;border-collapse:collapse;margin-bottom:1.5rem}th,td{border:1px solid #d9e2ec;padding:0.5rem;text-align:left;font-size:0.9rem}</style></head><body><h1>${escapeHtml(bundle.title)}</h1>${html}</body></html>`,
        ],
        { type: 'text/html' },
      ),
      fileName: buildOutputFilename(input.name, 'html'),
      formatId: 'html',
      mimeType: 'text/html',
      previewText: firstSheet.rows.slice(0, 8).map((row) => row.join(' | ')).join('\n'),
    };
  }

  const textBundle: TextBundle = {
    title: bundle.title,
    text: bundle.sheets.map((sheet) => `${sheet.name}\n${sheet.rows.map((row) => row.join(' | ')).join('\n')}`).join('\n\n'),
    html: bundle.sheets
      .map((sheet) => `<section><h2>${escapeHtml(sheet.name)}</h2><pre>${escapeHtml(sheet.rows.map((row) => row.join(' | ')).join('\n'))}</pre></section>`)
      .join(''),
    markdown: bundle.sheets.map((sheet) => `## ${sheet.name}\n\n${sheet.rows.map((row) => row.join(' | ')).join('\n')}`).join('\n\n'),
    sections: bundle.sheets.map((sheet) => ({ title: sheet.name, body: sheet.rows.map((row) => row.join(' | ')).join('\n') })),
  };

  if (target === 'txt') {
    return {
      blob: new Blob([textBundle.text], { type: 'text/plain' }),
      fileName: buildOutputFilename(input.name, 'txt'),
      formatId: 'txt',
      mimeType: 'text/plain',
      previewText: textBundle.text.slice(0, 1200),
    };
  }

  return exportTextBundle(textBundle, 'pdf', context);
}

async function executePresentationConversion(
  input: { name: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  const bundle = PRESENTATION_INPUT_FORMATS.has(input.formatId)
    ? await buildTextBundleFromPresentation(input.name, input.formatId, input.file)
    : await buildTextBundleFromTextInput(input.name, input.formatId, input.file);

  if (plan.targetFormatId === 'json') {
    const text = JSON.stringify({ title: bundle.title, slides: bundle.sections }, null, 2);
    return {
      blob: new Blob([text], { type: 'application/json' }),
      fileName: buildOutputFilename(input.name, 'json'),
      formatId: 'json',
      mimeType: 'application/json',
      previewText: text.slice(0, 1200),
    };
  }

  return exportTextBundle(bundle, plan.targetFormatId, context);
}

async function executeImageConversion(
  input: { name: string; file: File },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  context.onProgress({ stage: 'Decoding image', percent: 20 });
  const rendered = await renderImageFile(input.file);

  if (plan.targetFormatId === 'pdf') {
    const pdf = await createImagePdf(rendered.blob, context);
    return {
      blob: pdf,
      fileName: buildOutputFilename(input.name, 'pdf'),
      formatId: 'pdf',
      mimeType: 'application/pdf',
      previewUrl: URL.createObjectURL(pdf),
    };
  }

  const bitmap = await createImageBitmap(rendered.blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const drawContext = canvas.getContext('2d');
  if (!drawContext) {
    throw new Error('Canvas 2D is unavailable.');
  }
  drawContext.drawImage(bitmap, 0, 0);

  let mimeType = getMimeTypeForFormat(plan.targetFormatId);
  let blob: Blob;
  if (plan.targetFormatId === 'jpg') {
    blob = await canvasToBlob(canvas, 'image/jpeg', context.preferences.qualityProfile === 'maximum' ? 0.95 : 0.88);
    mimeType = 'image/jpeg';
  } else if (plan.targetFormatId === 'webp') {
    blob = await canvasToBlob(canvas, 'image/webp', context.preferences.qualityProfile === 'maximum' ? 0.96 : 0.86);
    mimeType = 'image/webp';
  } else if (plan.targetFormatId === 'png') {
    blob = await canvasToBlob(canvas, 'image/png', 0.95);
    mimeType = 'image/png';
  } else {
    const imageData = drawContext.getImageData(0, 0, canvas.width, canvas.height);
    const UTIF = await import('utif');
    blob = new Blob([UTIF.encodeImage(imageData.data, canvas.width, canvas.height, {})], { type: 'image/tiff' });
    mimeType = 'image/tiff';
  }

  return {
    blob,
    fileName: buildOutputFilename(input.name, plan.targetFormatId),
    formatId: plan.targetFormatId,
    mimeType,
    previewUrl: URL.createObjectURL(blob),
  };
}

async function executeOcrConversion(
  input: { name: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  context.onProgress({ stage: 'Loading OCR engine', percent: 12 });
  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker(context.preferences.ocrLanguage || 'eng', 1, {
    logger: (message) =>
      context.onProgress({
        stage: `OCR: ${message.status}`,
        percent: Math.min(90, 14 + Math.round(message.progress * 70)),
      }),
  });

  let text = '';
  let pdfBytes: Uint8Array | undefined;

  try {
    if (input.formatId === 'pdf') {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await input.file.arrayBuffer()) }).promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const renderContext = canvas.getContext('2d');
        if (!renderContext) {
          throw new Error('Canvas is unavailable for PDF OCR.');
        }
        await page.render({ canvas, canvasContext: renderContext, viewport }).promise;
        const result = await worker.recognize(canvas);
        pages.push(result.data.text);
        context.onProgress({
          stage: 'OCR on PDF pages',
          percent: 22 + Math.round((pageNumber / pdf.numPages) * 58),
          detail: `Page ${pageNumber} of ${pdf.numPages}`,
        });
      }
      text = pages.join('\n\n');
    } else {
      const result = await worker.recognize(input.file, {}, { pdf: plan.targetFormatId === 'pdf' });
      text = result.data.text;
      pdfBytes = result.data.pdf ? new Uint8Array(result.data.pdf) : undefined;
    }
  } finally {
    await worker.terminate();
  }

  if (plan.targetFormatId === 'pdf' && pdfBytes) {
      const blob = new Blob([toBlobPart(pdfBytes)], { type: 'application/pdf' });
    return {
      blob,
      fileName: buildOutputFilename(input.name, 'pdf'),
      formatId: 'pdf',
      mimeType: 'application/pdf',
      previewUrl: URL.createObjectURL(blob),
    };
  }

  const bundle: TextBundle = {
    title: input.name.replace(/\.[^.]+$/, ''),
    text,
    html: textToHtmlBlock(text),
    markdown: text,
    sections: ensureTextBundleSection(input.name.replace(/\.[^.]+$/, ''), text),
  };
  return exportTextBundle(bundle, plan.targetFormatId, context);
}

async function executeArchiveConversion(
  input: { name: string; file: File },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  if (plan.targetFormatId === 'zip') {
    const zip = new JSZip();
    zip.file(input.name, await input.file.arrayBuffer());
    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      context.onProgress({ stage: 'Compressing ZIP', percent: 45 + Math.round(meta.percent / 2) });
    });
    return {
      blob,
      fileName: buildOutputFilename(input.name, 'zip'),
      formatId: 'zip',
      mimeType: 'application/zip',
    };
  }

  const zip = await JSZip.loadAsync(await input.file.arrayBuffer());
  const manifest = Object.values(zip.files).map((entry) => `${entry.dir ? 'dir ' : 'file'} ${entry.name}`);
  const text = manifest.join('\n');
  return {
    blob: new Blob([plan.targetFormatId === 'json' ? JSON.stringify({ entries: manifest }, null, 2) : text], {
      type: plan.targetFormatId === 'json' ? 'application/json' : 'text/plain',
    }),
    fileName: buildOutputFilename(input.name, plan.targetFormatId),
    formatId: plan.targetFormatId,
    mimeType: plan.targetFormatId === 'json' ? 'application/json' : 'text/plain',
    previewText: text.slice(0, 1200),
  };
}

async function executeEbookConversion(
  input: { name: string; file: File },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  return exportTextBundle(await buildTextBundleFromEpub(input.name, input.file), plan.targetFormatId, context);
}

async function executeMediaConversion(
  input: { name: string; extension: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  const { ffmpeg, fetchFile } = await getFfmpeg(context);
  const inputName = `input.${input.extension || input.formatId}`;
  const outputName = `output.${normalizeFormatId(plan.targetFormatId)}`;
  const progressHandler = (message: { progress: number }) =>
    context.onProgress({ stage: 'Transcoding media', percent: 20 + Math.round(message.progress * 68) });

  ffmpeg.on('progress', progressHandler);
  await ffmpeg.writeFile(inputName, await fetchFile(input.file));
  await ffmpeg.exec(buildFfmpegArgs(input, plan.targetFormatId, outputName, context.preferences.qualityProfile));
  const output = await ffmpeg.readFile(outputName);
  ffmpeg.off('progress', progressHandler);

  const blob = new Blob([toBlobPart(output as Uint8Array)], { type: getMimeTypeForFormat(plan.targetFormatId) });
  return {
    blob,
    fileName: buildOutputFilename(input.name, plan.targetFormatId),
    formatId: plan.targetFormatId,
    mimeType: getMimeTypeForFormat(plan.targetFormatId),
    previewUrl: ['audio', 'video'].includes(getPreviewKind(plan.targetFormatId, blob.type)) ? URL.createObjectURL(blob) : undefined,
  };
}

async function executeConvertApiConversion(
  input: { name: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  const token = context.providerSettings.convertApiToken;
  if (!token) {
    throw new Error('ConvertAPI token is missing.');
  }

  const formData = new FormData();
  formData.append('File', input.file, input.name);
  formData.append('FileName', buildOutputFilename(input.name, plan.targetFormatId));
  formData.append('StoreFile', 'false');
  context.onProgress({ stage: 'Uploading to ConvertAPI', percent: 18 });

  const response = await fetch(`https://v2.convertapi.com/convert/${input.formatId}/to/${plan.targetFormatId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`ConvertAPI failed: ${await response.text()}`);
  }

  const payload = (await response.json()) as { Files?: Array<{ FileName?: string; FileData?: string; Url?: string }> };
  const output = payload.Files?.[0];
  if (!output) {
    throw new Error('ConvertAPI returned no output file.');
  }

  let blob: Blob;
  if (output.FileData) {
    blob = base64ToBlob(output.FileData, getMimeTypeForFormat(plan.targetFormatId));
  } else if (output.Url) {
    blob = await fetch(output.Url).then((result) => result.blob());
  } else {
    throw new Error('ConvertAPI returned neither FileData nor Url.');
  }

  return {
    blob,
    fileName: output.FileName || buildOutputFilename(input.name, plan.targetFormatId),
    formatId: plan.targetFormatId,
    mimeType: blob.type || getMimeTypeForFormat(plan.targetFormatId),
    previewUrl: createPreviewUrl(plan.targetFormatId, blob),
  };
}

async function executeCloudConvertConversion(
  input: { name: string; file: File; formatId: string },
  plan: ConversionPlan,
  context: ConversionContext,
): Promise<ConversionArtifact> {
  const token = context.providerSettings.cloudConvertToken;
  if (!token) {
    throw new Error('CloudConvert token is missing.');
  }

  context.onProgress({ stage: 'Creating CloudConvert job', percent: 12 });
  const createResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tasks: {
        upload_file: { operation: 'import/upload' },
        convert_file: { operation: 'convert', input: 'upload_file', input_format: input.formatId, output_format: plan.targetFormatId },
        export_file: { operation: 'export/url', input: 'convert_file', inline: false, archive_multiple_files: false },
      },
    }),
  });

  if (!createResponse.ok) {
    throw new Error(`CloudConvert job creation failed: ${await createResponse.text()}`);
  }

  const created = (await createResponse.json()) as {
    data: {
      id: string;
      tasks: Array<{ operation: string; result?: { form?: { url: string; parameters: Record<string, string | number> } } }>;
    };
  };
  const uploadForm = created.data.tasks.find((task) => task.operation === 'import/upload')?.result?.form;
  if (!uploadForm) {
    throw new Error('CloudConvert did not return an upload form.');
  }

  const uploadPayload = new FormData();
  for (const [key, value] of Object.entries(uploadForm.parameters)) {
    uploadPayload.append(key, String(value));
  }
  uploadPayload.append('file', input.file, input.name);
  context.onProgress({ stage: 'Uploading to CloudConvert', percent: 28 });
  await fetch(uploadForm.url, { method: 'POST', body: uploadPayload });

  const completed = await pollCloudConvertJob(created.data.id, token, context);
  const fileInfo = completed.tasks.find((task) => task.operation === 'export/url')?.result?.files?.[0];
  if (!fileInfo?.url) {
    throw new Error('CloudConvert did not return a downloadable export URL.');
  }

  context.onProgress({ stage: 'Downloading remote result', percent: 84 });
  const blob = await fetch(fileInfo.url).then((response) => response.blob());
  return {
    blob,
    fileName: fileInfo.filename || buildOutputFilename(input.name, plan.targetFormatId),
    formatId: plan.targetFormatId,
    mimeType: blob.type || getMimeTypeForFormat(plan.targetFormatId),
    previewUrl: createPreviewUrl(plan.targetFormatId, blob),
  };
}

export async function packageBatchResults(
  artifacts: Array<{ fileName: string; blob: Blob }>,
  archiveName = 'converted-batch.zip',
): Promise<ConversionArtifact> {
  const zip = new JSZip();
  for (const artifact of artifacts) {
    zip.file(artifact.fileName, await artifact.blob.arrayBuffer());
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, fileName: archiveName, formatId: 'zip', mimeType: 'application/zip' };
}

export function triggerDownload(artifact: Pick<ConversionArtifact, 'blob' | 'fileName'>): void {
  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

async function getFfmpeg(context: ConversionContext): Promise<{
  ffmpeg: Awaited<ReturnType<typeof createFfmpeg>>['ffmpeg'];
  fetchFile: typeof import('@ffmpeg/util').fetchFile;
}> {
  if (!ffmpegSingleton) {
    context.onProgress({ stage: 'Loading FFmpeg', percent: 8 });
    ffmpegSingleton = await createFfmpeg();
  }
  return ffmpegSingleton;
}

async function createFfmpeg() {
  const [{ FFmpeg }, { fetchFile }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  return { ffmpeg, fetchFile };
}

function buildFfmpegArgs(
  input: { extension: string; formatId: string },
  targetFormatId: string,
  outputName: string,
  qualityProfile: ConversionContext['preferences']['qualityProfile'],
): string[] {
  const args = ['-i', `input.${input.extension || input.formatId}`];
  const target = normalizeFormatId(targetFormatId);

  if (VIDEO_INPUT_FORMATS.has(input.formatId) && AUDIO_INPUT_FORMATS.has(target)) {
    args.push('-vn');
  }
  if (target === 'gif') {
    args.push('-vf', 'fps=10,scale=960:-1:flags=lanczos');
  } else if (target === 'mp3') {
    args.push('-codec:a', 'libmp3lame', '-qscale:a', qualityProfile === 'maximum' ? '2' : qualityProfile === 'compact' ? '6' : '4');
  } else if (target === 'wav') {
    args.push('-codec:a', 'pcm_s16le');
  } else if (target === 'flac') {
    args.push('-codec:a', 'flac');
  } else if (target === 'ogg') {
    args.push('-codec:a', 'libvorbis');
  } else if (target === 'aac' || target === 'm4a') {
    args.push('-codec:a', 'aac', '-b:a', qualityProfile === 'compact' ? '128k' : '192k');
  } else if (target === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-b:v', qualityProfile === 'compact' ? '1M' : '2M', '-c:a', 'libopus');
  } else if (target === 'mp4') {
    args.push('-c:v', 'libx264', '-preset', qualityProfile === 'maximum' ? 'slow' : 'medium', '-crf', qualityProfile === 'compact' ? '30' : '24');
  }

  args.push(outputName);
  return args;
}

async function pollCloudConvertJob(
  jobId: string,
  token: string,
  context: ConversionContext,
): Promise<{
  tasks: Array<{
    operation: string;
    result?: { files?: Array<{ url?: string; filename?: string }> };
  }>;
}> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`CloudConvert polling failed: ${await response.text()}`);
    }
    const payload = (await response.json()) as {
      data: {
        status: string;
        tasks: Array<{
          operation: string;
          result?: { files?: Array<{ url?: string; filename?: string }> };
        }>;
      };
    };

    if (payload.data.status === 'finished') {
      return payload.data;
    }
    if (payload.data.status === 'error') {
      throw new Error('CloudConvert reported a job error.');
    }

    context.onProgress({ stage: 'Waiting for CloudConvert', percent: Math.min(80, 52 + attempt) });
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }

  throw new Error('CloudConvert timed out before the job finished.');
}

function createPreviewUrl(formatId: string, blob: Blob): string | undefined {
  const previewKind = getPreviewKind(formatId, blob.type);
  if (previewKind === 'none' || previewKind === 'text') {
    return undefined;
  }
  return URL.createObjectURL(blob);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes.buffer], { type: mimeType });
}

function toBlobPart(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

function escapeCsvCell(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
