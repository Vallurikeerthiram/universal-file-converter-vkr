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
import type { AnalyzedFile, ConversionPlan, OutputSuggestion, QualityLabel } from './types';
import {
  AUDIO_INPUT_FORMATS,
  EBOOK_INPUT_FORMATS,
  IMAGE_INPUT_FORMATS,
  LOCAL_TARGETS,
  PRESENTATION_INPUT_FORMATS,
  SPREADSHEET_INPUT_FORMATS,
  STRUCTURED_INPUT_FORMATS,
  TEXT_INPUT_FORMATS,
  VIDEO_INPUT_FORMATS,
} from './types';

const remoteDiscoveryCache = new Map<string, Promise<string[]>>();

export async function analyzeFile(file: File): Promise<AnalyzedFile> {
  const extension = getFileExtension(file.name);
  const resolvedFormat =
    resolveFormatDefinition(extension, file.type);
  const formatId = resolvedFormat?.id || extension || 'bin';
  const detectedMimeType = file.type || '';
  const warnings: string[] = [];

  if (!resolvedFormat) {
    warnings.push('The file type is outside the built-in registry. Remote discovery may expose extra routes.');
  }

  if (file.size > 500 * 1024 * 1024) {
    warnings.push('Large files can exceed browser memory limits. Consider remote execution if needed.');
  }

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
    warnings,
    summary: `${summarizeFormat(formatId)} • ${formatBytes(file.size)}`,
  };
}

export async function discoverRemoteTargets(formatId: string): Promise<string[]> {
  const normalized = normalizeFormatId(formatId);

  if (!remoteDiscoveryCache.has(normalized)) {
    remoteDiscoveryCache.set(normalized, fetchRemoteTargets(normalized));
  }

  return remoteDiscoveryCache.get(normalized) ?? Promise.resolve([]);
}

async function fetchRemoteTargets(formatId: string): Promise<string[]> {
  const response = await fetch(`https://v2.convertapi.com/info/openapi/${formatId}/to/*`);
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { paths?: Record<string, unknown> };
  const targets = new Set<string>();

  for (const path of Object.keys(payload.paths ?? {})) {
    const match = path.match(/^\/convert\/([^/]+)\/to\/([^/]+)$/i);
    if (!match) {
      continue;
    }

    if (normalizeFormatId(match[1]) === formatId) {
      targets.add(normalizeFormatId(match[2]));
    }
  }

  return [...targets];
}

export async function getOutputSuggestions(
  input: AnalyzedFile,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): Promise<OutputSuggestion[]> {
  const targetIds = new Set<string>(LOCAL_TARGETS[input.family] ?? LOCAL_TARGETS.unknown);
  for (const target of remoteTargets) {
    targetIds.add(normalizeFormatId(target));
  }

  const suggestions: OutputSuggestion[] = [];
  for (const targetId of targetIds) {
    if (targetId === input.formatId) {
      continue;
    }

    const localPlan = buildBestLocalPlan(input, targetId, preferences);
    const remoteAvailable = remoteTargets.includes(targetId);
    if (!localPlan && !remoteAvailable) {
      continue;
    }

    suggestions.push({
      formatId: targetId,
      label: getFormatLabel(targetId),
      family: getFamilyForFormat(targetId),
      recommended: Boolean(localPlan && localPlan.score >= 120) || (!localPlan && remoteAvailable),
      availableLocally: Boolean(localPlan),
      availableRemotely: remoteAvailable,
      quality: localPlan?.quality ?? 'high',
      lossy: localPlan?.lossy ?? inferLossy(input.formatId, targetId),
      rationale: localPlan?.rationale ?? 'Discovered through remote compatibility introspection.',
      blockedReason:
        !localPlan && remoteAvailable && !providerSettings.convertApiToken
          ? 'Add a provider token in Advanced Options to execute this remote route.'
          : undefined,
    });
  }

  return suggestions.sort((left, right) => {
    if (left.recommended !== right.recommended) {
      return Number(right.recommended) - Number(left.recommended);
    }
    if (left.availableLocally !== right.availableLocally) {
      return Number(right.availableLocally) - Number(left.availableLocally);
    }
    return left.label.localeCompare(right.label);
  });
}

export async function planConversion(
  input: AnalyzedFile,
  targetFormatId: string,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): Promise<ConversionPlan | null> {
  const target = normalizeFormatId(targetFormatId);
  const localPlan = buildBestLocalPlan(input, target, preferences);

  if (preferences.privacyMode !== 'external-ready' && localPlan) {
    return localPlan;
  }

  const externalPlans = [
    buildConvertApiPlan(input, target, preferences, providerSettings, remoteTargets),
    buildCloudConvertPlan(input, target, preferences, providerSettings, remoteTargets),
  ].filter(Boolean) as ConversionPlan[];

  if (preferences.privacyMode === 'external-ready' && externalPlans.length > 0) {
    return externalPlans.sort((left, right) => right.score - left.score)[0];
  }

  return localPlan ?? externalPlans.sort((left, right) => right.score - left.score)[0] ?? null;
}

function buildBestLocalPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const plans = [
    buildTextPlan(input, targetFormatId, preferences),
    buildDocumentPlan(input, targetFormatId, preferences),
    buildSpreadsheetPlan(input, targetFormatId, preferences),
    buildPresentationPlan(input, targetFormatId, preferences),
    buildImagePlan(input, targetFormatId, preferences),
    buildOcrPlan(input, targetFormatId, preferences),
    buildArchivePlan(input, targetFormatId, preferences),
    buildEbookPlan(input, targetFormatId, preferences),
    buildMediaPlan(input, targetFormatId, preferences),
  ].filter(Boolean) as ConversionPlan[];

  return plans.sort((left, right) => right.score - left.score)[0] ?? null;
}

function buildTextPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const source = input.formatId;
  const target = normalizeFormatId(targetFormatId);
  const isTextInput = TEXT_INPUT_FORMATS.has(source) || isTextLikeFormat(source);
  if (!isTextInput) {
    return null;
  }

  const plainTargets = new Set(['txt', 'md', 'html', 'pdf', 'docx', 'pptx', 'zip']);
  const structuredTargets = new Set(['json', 'xml', 'yaml']);
  if (!plainTargets.has(target) && !(STRUCTURED_INPUT_FORMATS.has(source) && structuredTargets.has(target))) {
    return null;
  }

  const lossy = inferLossy(source, target);
  if (lossy && !preferences.allowLossy && target !== 'zip') {
    return null;
  }

  return {
    engineId: 'text-local',
    engineName: 'Local text and markup engine',
    location: 'local',
    targetFormatId: target,
    quality: target === 'pptx' ? 'medium' : 'high',
    lossy,
    steps: ['Read text payload', 'Normalize structure', `Export ${getFormatLabel(target)}`],
    rationale: 'Fast browser-native route for text, markup, and lightweight document exports.',
    warnings: lossy ? ['Formatting or schema details may be simplified in the target format.'] : [],
    score: scorePlan('local', target === 'pptx' ? 'medium' : 'high', lossy, preferences),
  };
}

function buildDocumentPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const source = input.formatId;
  const target = normalizeFormatId(targetFormatId);
  if (!['docx', 'pdf', 'rtf', 'txt', 'md', 'html'].includes(source)) {
    return null;
  }
  if (!['pdf', 'docx', 'txt', 'md', 'html', 'pptx', 'zip'].includes(target)) {
    return null;
  }

  const quality: QualityLabel = source === 'pdf' && ['docx', 'pptx'].includes(target) ? 'medium' : 'high';
  const lossy = inferLossy(source, target);
  if (lossy && !preferences.allowLossy && target !== 'zip') {
    return null;
  }

  return {
    engineId: 'document-local',
    engineName: 'Local document pipeline',
    location: 'local',
    targetFormatId: target,
    quality,
    lossy,
    steps: ['Extract document text', 'Normalize content blocks', `Render ${getFormatLabel(target)}`],
    rationale: 'Uses DOCX/PDF parsing with lightweight local export to keep documents on-device.',
    warnings:
      source === 'pdf' && target === 'docx'
        ? ['PDF reflow is approximate. Complex layouts, tables, and footnotes may simplify.']
        : lossy
          ? ['Cross-family export can simplify layout and visual hierarchy.']
          : [],
    score: scorePlan('local', quality, lossy, preferences),
  };
}

function buildSpreadsheetPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  if (!SPREADSHEET_INPUT_FORMATS.has(input.formatId)) {
    return null;
  }
  if (!['xlsx', 'csv', 'tsv', 'json', 'html', 'txt', 'pdf', 'zip'].includes(target)) {
    return null;
  }

  const quality: QualityLabel = target === 'pdf' ? 'medium' : 'high';
  const lossy = inferLossy(input.formatId, target);
  if (lossy && !preferences.allowLossy && target !== 'zip') {
    return null;
  }

  return {
    engineId: 'spreadsheet-local',
    engineName: 'Local spreadsheet engine',
    location: 'local',
    targetFormatId: target,
    quality,
    lossy,
    steps: ['Load workbook', 'Materialize sheets', `Export ${getFormatLabel(target)}`],
    rationale: 'Client-side spreadsheet conversion using a browser-friendly workbook pipeline.',
    warnings: lossy ? ['Charts, formulas, and rich formatting may flatten in the target file.'] : [],
    score: scorePlan('local', quality, lossy, preferences),
  };
}

function buildPresentationPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  if (!PRESENTATION_INPUT_FORMATS.has(input.formatId) && target !== 'pptx') {
    return null;
  }
  if (!['pptx', 'txt', 'md', 'html', 'pdf', 'docx', 'json', 'zip'].includes(target)) {
    return null;
  }

  const lossy = inferLossy(input.formatId, target);
  return {
    engineId: 'presentation-local',
    engineName: 'Local slide text extractor',
    location: 'local',
    targetFormatId: target,
    quality: 'medium',
    lossy,
    steps: ['Read slide package', 'Extract slide text', `Export ${getFormatLabel(target)}`],
    rationale: 'Best-effort local presentation conversion without uploading slide content.',
    warnings: ['Slide design, media, notes, and advanced animations may not survive local reflow.'],
    score: scorePlan('local', 'medium', lossy, preferences),
  };
}

function buildImagePlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  if (!IMAGE_INPUT_FORMATS.has(input.formatId)) {
    return null;
  }
  if (!['png', 'jpg', 'webp', 'tiff', 'pdf', 'zip'].includes(target)) {
    return null;
  }

  const quality: QualityLabel = ['jpg', 'webp'].includes(target) ? 'high' : 'lossless';
  const lossy = inferLossy(input.formatId, target);
  if (lossy && !preferences.allowLossy && target !== 'zip') {
    return null;
  }

  return {
    engineId: 'image-local',
    engineName: 'Local raster engine',
    location: 'local',
    targetFormatId: target,
    quality,
    lossy,
    steps: ['Decode source image', 'Render to canvas', `Encode ${getFormatLabel(target)}`],
    rationale: 'Local canvas/TIFF/HEIC route for privacy-preserving image transformations.',
    warnings: lossy ? ['Transparency or source metadata can be lost in compressed raster targets.'] : [],
    score: scorePlan('local', quality, lossy, preferences),
  };
}

function buildOcrPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  const supportsSource = IMAGE_INPUT_FORMATS.has(input.formatId) || input.formatId === 'pdf';
  if (!supportsSource || !['txt', 'md', 'html', 'docx', 'pdf'].includes(target)) {
    return null;
  }
  if (!preferences.forceOcr && target === 'pdf') {
    return null;
  }

  return {
    engineId: 'ocr-local',
    engineName: 'Local OCR engine',
    location: 'local',
    targetFormatId: target,
    quality: 'medium',
    lossy: false,
    steps: ['Rasterize pages', 'Run OCR', `Export ${getFormatLabel(target)}`],
    rationale: 'Privacy-preserving OCR route for scanned PDFs and images.',
    warnings: ['OCR accuracy depends on scan quality, language coverage, and page complexity.'],
    score: scorePlan('local', 'medium', false, preferences) - 5,
  };
}

function buildArchivePlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  if (target === 'zip') {
    return {
      engineId: 'archive-local',
      engineName: 'Local archive wrapper',
      location: 'local',
      targetFormatId: target,
      quality: 'lossless',
      lossy: false,
      steps: ['Package payload', 'Generate ZIP archive'],
      rationale: 'Universal local fallback for packaging one or more files.',
      warnings: [],
      score: scorePlan('local', 'lossless', false, preferences) - 12,
    };
  }
  if (input.formatId !== 'zip' || !['json', 'txt'].includes(target)) {
    return null;
  }

  return {
    engineId: 'archive-local',
    engineName: 'Local archive inspector',
    location: 'local',
    targetFormatId: target,
    quality: 'high',
    lossy: false,
    steps: ['Open ZIP archive', 'Build manifest', `Export ${getFormatLabel(target)}`],
    rationale: 'Local archive inspection without sending compressed payloads off-device.',
    warnings: [],
    score: scorePlan('local', 'high', false, preferences),
  };
}

function buildEbookPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  if (!EBOOK_INPUT_FORMATS.has(input.formatId)) {
    return null;
  }
  if (!['txt', 'html', 'pdf', 'docx', 'zip'].includes(target)) {
    return null;
  }

  const quality: QualityLabel = target === 'html' ? 'high' : 'medium';
  const lossy = inferLossy(input.formatId, target);
  return {
    engineId: 'ebook-local',
    engineName: 'Local EPUB reader',
    location: 'local',
    targetFormatId: target,
    quality,
    lossy,
    steps: ['Open EPUB package', 'Extract reading order text', `Export ${getFormatLabel(target)}`],
    rationale: 'Client-side EPUB extraction keeps ebook contents local whenever possible.',
    warnings: ['Inline media, annotations, and EPUB navigation aids are flattened during export.'],
    score: scorePlan('local', quality, lossy, preferences),
  };
}

function buildMediaPlan(input: AnalyzedFile, targetFormatId: string, preferences: StoredPreferences): ConversionPlan | null {
  const target = normalizeFormatId(targetFormatId);
  const isAudio = AUDIO_INPUT_FORMATS.has(input.formatId);
  const isVideo = VIDEO_INPUT_FORMATS.has(input.formatId);
  const supportedTarget =
    AUDIO_INPUT_FORMATS.has(target) || VIDEO_INPUT_FORMATS.has(target) || ['gif', 'mp3', 'wav'].includes(target);

  if ((!isAudio && !isVideo) || !supportedTarget) {
    return null;
  }

  const quality: QualityLabel = preferences.qualityProfile === 'maximum' ? 'high' : 'medium';
  const lossy = inferLossy(input.formatId, target);
  if (lossy && !preferences.allowLossy) {
    return null;
  }

  return {
    engineId: 'media-local',
    engineName: 'Local FFmpeg pipeline',
    location: 'local',
    targetFormatId: target,
    quality,
    lossy,
    steps: ['Lazy-load FFmpeg', 'Transcode media stream', `Mux ${getFormatLabel(target)}`],
    rationale: 'Broad in-browser media conversion with lazy-loaded FFmpeg.',
    warnings: ['Large media jobs can be slow or memory-intensive inside the browser.'],
    score: scorePlan('local', quality, lossy, preferences) - 10,
  };
}

function buildConvertApiPlan(
  input: AnalyzedFile,
  targetFormatId: string,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): ConversionPlan | null {
  if (!providerSettings.convertApiToken || !remoteTargets.includes(targetFormatId)) {
    return null;
  }

  if (preferences.preferredExternalProvider !== 'convertapi' && providerSettings.cloudConvertToken) {
    return null;
  }

  const quality: QualityLabel = input.family === 'audio' || input.family === 'video' ? 'medium' : 'high';
  const lossy = inferLossy(input.formatId, targetFormatId);
  return {
    engineId: 'convertapi-remote',
    engineName: 'ConvertAPI remote provider',
    location: 'external',
    targetFormatId,
    quality,
    lossy,
    steps: ['Upload to ConvertAPI', 'Run cloud conversion', 'Download result back into the browser'],
    rationale: 'Remote fallback discovered from provider OpenAPI compatibility metadata.',
    warnings: ['The source file leaves the browser for remote processing.'],
    score: scorePlan('external', quality, lossy, preferences),
  };
}

function buildCloudConvertPlan(
  input: AnalyzedFile,
  targetFormatId: string,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): ConversionPlan | null {
  if (!providerSettings.cloudConvertToken || preferences.preferredExternalProvider !== 'cloudconvert') {
    return null;
  }

  const supportedFamilies = new Set<FileFamily>([
    'document',
    'spreadsheet',
    'presentation',
    'image',
    'audio',
    'video',
    'ebook',
    'archive',
  ]);

  if (!supportedFamilies.has(input.family) || (!remoteTargets.includes(targetFormatId) && targetFormatId === input.formatId)) {
    return null;
  }

  const quality: QualityLabel = input.family === 'audio' || input.family === 'video' ? 'medium' : 'high';
  const lossy = inferLossy(input.formatId, targetFormatId);
  return {
    engineId: 'cloudconvert-remote',
    engineName: 'CloudConvert remote provider',
    location: 'external',
    targetFormatId,
    quality,
    lossy,
    steps: ['Create CloudConvert job', 'Direct browser upload', 'Run remote conversion', 'Fetch export URL result'],
    rationale: 'Secondary remote provider for cases where a direct ConvertAPI route is not preferred.',
    warnings: ['The source file leaves the browser for remote processing.'],
    score: scorePlan('external', quality, lossy, preferences) - 3,
  };
}

function scorePlan(location: 'local' | 'external', quality: QualityLabel, lossy: boolean, preferences: StoredPreferences): number {
  const qualityScore = { lossless: 50, high: 35, medium: 20, low: 10 }[quality];
  const locationBias =
    preferences.privacyMode === 'local-first'
      ? location === 'local'
        ? 40
        : 5
      : preferences.privacyMode === 'external-ready'
        ? location === 'external'
          ? 30
          : 15
        : location === 'local'
          ? 25
          : 18;
  const lossyPenalty = lossy ? (preferences.allowLossy ? 8 : 40) : 0;
  return qualityScore + locationBias - lossyPenalty;
}

export function inferLossy(sourceFormatId: string, targetFormatId: string): boolean {
  const lossyTargets = new Set(['jpg', 'webp', 'mp3', 'aac', 'm4a', 'gif']);
  const formatSwitches = new Set([
    'pdf->docx',
    'pptx->docx',
    'pptx->pdf',
    'docx->pptx',
    'xlsx->pdf',
    'xlsx->txt',
    'epub->pdf',
  ]);

  return lossyTargets.has(targetFormatId) || formatSwitches.has(`${sourceFormatId}->${targetFormatId}`);
}

export { buildBestLocalPlan };
