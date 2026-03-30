import type { FileFamily, PreviewKind } from '../formats';
import type { ProviderSettings, StoredPreferences } from '../storage';

export type QualityLabel = 'lossless' | 'high' | 'medium' | 'low';
export type RouteLocation = 'local' | 'external';

export interface AnalyzedFile {
  id: string;
  file: File;
  name: string;
  size: number;
  extension: string;
  detectedMimeType: string;
  formatId: string;
  family: FileFamily;
  previewKind: PreviewKind;
  warnings: string[];
  summary: string;
}

export interface OutputSuggestion {
  formatId: string;
  label: string;
  family: FileFamily;
  recommended: boolean;
  availableLocally: boolean;
  availableRemotely: boolean;
  quality: QualityLabel;
  lossy: boolean;
  rationale: string;
  blockedReason?: string;
}

export interface ConversionPlan {
  engineId:
    | 'text-local'
    | 'document-local'
    | 'spreadsheet-local'
    | 'presentation-local'
    | 'image-local'
    | 'ocr-local'
    | 'archive-local'
    | 'ebook-local'
    | 'media-local'
    | 'convertapi-remote'
    | 'cloudconvert-remote';
  engineName: string;
  location: RouteLocation;
  targetFormatId: string;
  quality: QualityLabel;
  lossy: boolean;
  steps: string[];
  rationale: string;
  warnings: string[];
  score: number;
}

export interface ConversionProgress {
  stage: string;
  percent: number;
  detail?: string;
}

export interface ConversionArtifact {
  blob: Blob;
  fileName: string;
  formatId: string;
  mimeType: string;
  previewText?: string;
  previewUrl?: string;
  metadata?: Record<string, string>;
}

export interface ConversionContext {
  preferences: StoredPreferences;
  providerSettings: ProviderSettings;
  onProgress: (progress: ConversionProgress) => void;
}

export interface TextBundle {
  title: string;
  text: string;
  html: string;
  markdown: string;
  sections: Array<{ title: string; body: string }>;
}

export interface SheetBundle {
  title: string;
  sheets: Array<{ name: string; rows: string[][] }>;
}

export const TEXT_INPUT_FORMATS = new Set(['txt', 'md', 'html', 'xml', 'json', 'yaml', 'rtf', 'svg']);
export const STRUCTURED_INPUT_FORMATS = new Set(['json', 'xml', 'yaml']);
export const SPREADSHEET_INPUT_FORMATS = new Set(['xls', 'xlsx', 'csv', 'tsv', 'ods']);
export const PRESENTATION_INPUT_FORMATS = new Set(['pptx', 'odp']);
export const IMAGE_INPUT_FORMATS = new Set(['jpg', 'png', 'webp', 'bmp', 'tiff', 'svg', 'heic', 'gif', 'avif']);
export const AUDIO_INPUT_FORMATS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']);
export const VIDEO_INPUT_FORMATS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif']);
export const ARCHIVE_INPUT_FORMATS = new Set(['zip']);
export const EBOOK_INPUT_FORMATS = new Set(['epub']);

export const LOCAL_TARGETS: Record<FileFamily, string[]> = {
  document: ['pdf', 'docx', 'txt', 'md', 'html', 'pptx', 'zip'],
  spreadsheet: ['xlsx', 'csv', 'tsv', 'json', 'html', 'txt', 'pdf', 'zip'],
  presentation: ['pptx', 'txt', 'md', 'html', 'pdf', 'docx', 'json', 'zip'],
  image: ['png', 'jpg', 'webp', 'tiff', 'pdf', 'txt', 'docx', 'zip'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'zip'],
  video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'wav', 'zip'],
  archive: ['zip', 'json', 'txt'],
  code: ['txt', 'md', 'html', 'json', 'xml', 'yaml', 'pdf', 'docx', 'pptx', 'zip'],
  ebook: ['txt', 'html', 'pdf', 'docx', 'zip'],
  data: ['txt', 'json', 'zip'],
  unknown: ['zip'],
};
