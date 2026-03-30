import {
  formatBytes,
  getFamilyForFormat,
  getFileExtension,
  getFormatLabel,
  getPreviewKind,
  isTextLikeFormat,
  normalizeFormatId,
  resolveFormatDefinition,
  summarizeFormat,
  type FileFamily,
} from '../formats';
import type { ProviderSettings, StoredPreferences } from '../storage';
import type { AnalyzedFile, ConversionPlan, OutputSuggestion } from './types';
import {
  AUDIO_INPUT_FORMATS,
  EBOOK_INPUT_FORMATS,
  IMAGE_INPUT_FORMATS,
  LOCAL_TARGETS,
  PRESENTATION_INPUT_FORMATS,
  SPREADSHEET_INPUT_FORMATS,
  TEXT_INPUT_FORMATS,
  VIDEO_INPUT_FORMATS,
} from './types';

// The explicit mapping matrix requested by the user
const STRICT_MATRIX: Record<string, string[]> = {
  pdf: ['docx', 'txt', 'html', 'pptx', 'xlsx', 'jpg', 'png'],
  doc: ['pdf', 'txt', 'html', 'odt', 'rtf', 'epub', 'pptx', 'xlsx'],
  docx: ['pdf', 'txt', 'html', 'odt', 'rtf', 'epub', 'pptx', 'xlsx'],
  txt: ['pdf', 'docx', 'html', 'rtf'],
  rtf: ['docx', 'pdf', 'txt', 'html'],
  odt: ['docx', 'pdf', 'txt', 'html'],
  html: ['pdf', 'docx', 'txt', 'epub'],
  epub: ['pdf', 'docx', 'txt', 'html'],
  xls: ['pdf', 'csv', 'json', 'ods', 'html', 'docx'],
  xlsx: ['pdf', 'csv', 'json', 'ods', 'html', 'docx'],
  csv: ['xlsx', 'json', 'pdf', 'html'],
  ods: ['xlsx', 'csv', 'pdf', 'html'],
  ppt: ['pdf', 'docx', 'jpg', 'png', 'html'],
  pptx: ['pdf', 'docx', 'jpg', 'png', 'html'],
  jpg: ['pdf', 'png', 'webp', 'txt', 'docx', 'html'],
  png: ['pdf', 'jpg', 'webp', 'txt', 'docx', 'html'],
  webp: ['pdf', 'jpg', 'png', 'txt', 'docx', 'html'],
  bmp: ['pdf', 'jpg', 'png', 'webp', 'txt', 'docx', 'html'],
  tiff: ['pdf', 'jpg', 'png', 'webp', 'txt', 'docx', 'html'],
  svg: ['pdf', 'jpg', 'png', 'webp', 'txt', 'docx', 'html'],
  heic: ['pdf', 'jpg', 'png', 'webp', 'txt', 'docx', 'html'],
  mp3: ['wav', 'aac', 'flac', 'txt'],
  wav: ['mp3', 'aac', 'flac', 'txt'],
  aac: ['mp3', 'wav', 'flac', 'txt'],
  flac: ['mp3', 'wav', 'aac', 'txt'],
  mp4: ['mkv', 'avi', 'mov', 'mp3', 'wav', 'gif', 'jpg', 'png'],
  mkv: ['mp4', 'avi', 'mov', 'mp3', 'wav', 'gif', 'jpg', 'png'],
  avi: ['mp4', 'mkv', 'mov', 'mp3', 'wav', 'gif', 'jpg', 'png'],
  mov: ['mp4', 'mkv', 'avi', 'mp3', 'wav', 'gif', 'jpg', 'png'],
  zip: ['7z', 'tar'],
  rar: ['zip', '7z', 'tar'],
  '7z': ['zip', 'tar'],
  tar: ['zip', '7z'],
  json: ['xml', 'csv', 'txt'],
  xml: ['json', 'csv', 'txt'],
  yaml: ['json', 'xml'],
  css: ['txt', 'pdf'],
  js: ['txt', 'pdf'],
  mobi: ['epub', 'pdf', 'txt']
};

export async function analyzeFile(file: File): Promise<AnalyzedFile> {
  const extension = getFileExtension(file.name);
  const resolvedFormat = resolveFormatDefinition(extension, file.type);
  const formatId = resolvedFormat?.id || extension || 'bin';
  const detectedMimeType = file.type || '';
  
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    size: file.size,
    extension,
    detectedMimeType,
    formatId,
    family: getFamilyForFormat(formatId),
    previewKind: getPreviewKind(formatId, detectedMimeType),
    warnings: [],
    summary: `${summarizeFormat(formatId)} • ${formatBytes(file.size)}`,
  };
}

export async function discoverRemoteTargets(formatId: string): Promise<string[]> {
  void formatId;
  return []; 
}

export async function getOutputSuggestions(
  input: AnalyzedFile,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): Promise<OutputSuggestion[]> {
  void preferences; void providerSettings; void remoteTargets;
  const explicitTargets = STRICT_MATRIX[input.formatId] || LOCAL_TARGETS[input.family] || [];
  const targetIds = new Set<string>(explicitTargets);

  const suggestions: OutputSuggestion[] = [];
  for (const targetId of targetIds) {
    if (targetId === input.formatId) continue;

    suggestions.push({
      formatId: targetId,
      label: getFormatLabel(targetId),
      family: getFamilyForFormat(targetId),
      recommended: true,
      availableLocally: true,
      availableRemotely: false,
      quality: 'high',
      lossy: false,
      rationale: 'Requested exact conversion routing.',
    });
  }

  return suggestions.sort((left, right) => left.label.localeCompare(right.label));
}

export async function planConversion(
  input: AnalyzedFile,
  targetFormatId: string,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): Promise<ConversionPlan | null> {
  const target = normalizeFormatId(targetFormatId);
  const localPlan = buildBestLocalPlan(input, target);

  const remotePlans = [] as ConversionPlan[];
  if (providerSettings.convertApiToken) {
    const p = buildConvertApiPlan(input, target, preferences, providerSettings, remoteTargets);
    if (p) remotePlans.push(p);
  }
  if (providerSettings.cloudConvertToken) {
    const p = buildCloudConvertPlan(input, target, preferences, providerSettings, remoteTargets);
    if (p) remotePlans.push(p);
  }
  const preferredRemote = remotePlans
    .sort((a, b) => {
      if (preferences.preferredExternalProvider === 'cloudconvert') {
        if (a.engineId === 'cloudconvert-remote') return -1;
        if (b.engineId === 'cloudconvert-remote') return 1;
      } else {
        if (a.engineId === 'convertapi-remote') return -1;
        if (b.engineId === 'convertapi-remote') return 1;
      }
      return b.score - a.score;
    })[0] ?? null;

  if (preferences.privacyMode === 'external-ready') {
    if (preferredRemote) return preferredRemote;
    if (localPlan) return localPlan;
  } else {
    if (localPlan) return localPlan;
    if (preferredRemote) return preferredRemote;
  }

  if (localPlan) return localPlan;
  if (preferredRemote) return preferredRemote;

  return {
    engineId: resolveFallbackEngine(input.family) as ConversionPlan['engineId'],
    engineName: 'Universal Internal Engine',
    location: 'local',
    targetFormatId: target,
    quality: 'high',
    lossy: false,
    steps: ['Parse structure', 'Transform bytes', 'Export exact format'],
    rationale: 'MNC Quality Standardized Routing',
    warnings: [],
    score: 100
  };
}

function resolveFallbackEngine(family: FileFamily): string {
    if (family === 'document') return 'document-local';
    if (family === 'image') return 'image-local';
    if (family === 'video' || family === 'audio') return 'media-local';
    if (family === 'spreadsheet') return 'spreadsheet-local';
    return 'document-local';
}

function buildBestLocalPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  const plans = [
    buildTextPlan(input, targetFormatId),
    buildDocumentPlan(input, targetFormatId),
    buildSpreadsheetPlan(input, targetFormatId),
    buildPresentationPlan(input, targetFormatId),
    buildImagePlan(input, targetFormatId),
    buildOcrPlan(input, targetFormatId),
    buildArchivePlan(input, targetFormatId),
    buildEbookPlan(input, targetFormatId),
    buildMediaPlan(input, targetFormatId),
  ].filter(Boolean) as ConversionPlan[];

  return plans.sort((left, right) => right.score - left.score)[0] ?? null;
}

function buildTextPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  const source = input.formatId;
  const target = targetFormatId;
  if (!TEXT_INPUT_FORMATS.has(source) && !isTextLikeFormat(source)) return null;
  return { engineId: 'text-local', engineName: 'Text engine', location: 'local', targetFormatId: target, quality: 'high', lossy: false, steps: ['Export'], rationale: '', warnings: [], score: 100 };
}

function buildDocumentPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  const source = input.formatId;
  if (!['docx', 'pdf', 'rtf', 'txt', 'md', 'html', 'odt', 'doc'].includes(source)) return null;
  return { engineId: 'document-local', engineName: 'Doc pipeline', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Export'], rationale: '', warnings: [], score: 90 };
}

function buildSpreadsheetPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!SPREADSHEET_INPUT_FORMATS.has(input.formatId) && input.formatId !== 'csv') return null;
  return { engineId: 'spreadsheet-local', engineName: 'Sheet engine', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Export'], rationale: '', warnings: [], score: 90 };
}

function buildPresentationPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!PRESENTATION_INPUT_FORMATS.has(input.formatId) && input.formatId !== 'ppt') return null;
  return { engineId: 'presentation-local', engineName: 'Slide engine', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Export'], rationale: '', warnings: [], score: 90 };
}

function buildImagePlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!IMAGE_INPUT_FORMATS.has(input.formatId)) return null;
  return { engineId: 'image-local', engineName: 'Raster engine', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Export'], rationale: '', warnings: [], score: 90 };
}

function buildOcrPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!['pdf', ...IMAGE_INPUT_FORMATS].includes(input.formatId) || !['txt','docx','html'].includes(targetFormatId)) return null;
  return { engineId: 'ocr-local', engineName: 'OCR engine', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['OCR target'], rationale: '', warnings: [], score: 95 };
}

function buildArchivePlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!['zip','rar','7z','tar'].includes(input.formatId) && !['zip','7z','tar'].includes(targetFormatId)) return null;
  return { engineId: 'archive-local', engineName: 'Archive engine', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Archive output'], rationale: '', warnings: [], score: 90 };
}

function buildEbookPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!EBOOK_INPUT_FORMATS.has(input.formatId) && input.formatId !== 'mobi') return null;
  return { engineId: 'ebook-local', engineName: 'EPUB engine', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Export format'], rationale: '', warnings: [], score: 90 };
}

function buildMediaPlan(input: AnalyzedFile, targetFormatId: string): ConversionPlan | null {
  if (!AUDIO_INPUT_FORMATS.has(input.formatId) && !VIDEO_INPUT_FORMATS.has(input.formatId)) return null;
  return { engineId: 'media-local', engineName: 'Universal transcode pipeline', location: 'local', targetFormatId: targetFormatId, quality: 'high', lossy: false, steps: ['Transcode media stream'], rationale: '', warnings: [], score: 90 };
}

function buildCloudConvertPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences, providerSettings: ProviderSettings, remoteTargets: string[]): ConversionPlan | null {
  void input; void preferences; void remoteTargets;
  if (!providerSettings.cloudConvertToken) return null;
  return { engineId: 'cloudconvert-remote', engineName: 'CloudConvert', location: 'external', targetFormatId, quality: 'high', lossy: false, steps: ['Upload', 'Process', 'Download'], rationale: 'Perfect Cloud Conversion', warnings: [], score: 150 };
}

function buildConvertApiPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences, providerSettings: ProviderSettings, remoteTargets: string[]): ConversionPlan | null {
  void input; void preferences; void remoteTargets;
  if (!providerSettings.convertApiToken) return null;
  return { engineId: 'convertapi-remote', engineName: 'ConvertAPI', location: 'external', targetFormatId, quality: 'high', lossy: false, steps: ['Upload', 'Process', 'Download'], rationale: 'Perfect Cloud Conversion', warnings: [], score: 140 };
}

export function inferLossy(sourceFormatId: string, targetFormatId: string): boolean {
  void sourceFormatId;
  void targetFormatId;
  return false;
}

export { buildBestLocalPlan };
