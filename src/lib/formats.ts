export type FileFamily =
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'code'
  | 'ebook'
  | 'data'
  | 'unknown';

export type PreviewKind = 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'none';

export interface FormatDefinition {
  id: string;
  label: string;
  family: FileFamily;
  extensions: string[];
  mimeTypes: string[];
  preview: PreviewKind;
  textLike?: boolean;
}

export const FORMAT_DEFINITIONS: FormatDefinition[] = [
  { id: 'pdf', label: 'PDF', family: 'document', extensions: ['pdf'], mimeTypes: ['application/pdf'], preview: 'pdf' },
  { id: 'doc', label: 'Word DOC', family: 'document', extensions: ['doc'], mimeTypes: ['application/msword'], preview: 'none' },
  {
    id: 'docx',
    label: 'Word DOCX',
    family: 'document',
    extensions: ['docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    preview: 'none',
  },
  {
    id: 'odt',
    label: 'OpenDocument Text',
    family: 'document',
    extensions: ['odt'],
    mimeTypes: ['application/vnd.oasis.opendocument.text'],
    preview: 'none',
  },
  { id: 'rtf', label: 'Rich Text', family: 'document', extensions: ['rtf'], mimeTypes: ['application/rtf', 'text/rtf'], preview: 'text', textLike: true },
  { id: 'txt', label: 'Plain Text', family: 'document', extensions: ['txt', 'text'], mimeTypes: ['text/plain'], preview: 'text', textLike: true },
  { id: 'md', label: 'Markdown', family: 'document', extensions: ['md', 'markdown'], mimeTypes: ['text/markdown'], preview: 'text', textLike: true },
  { id: 'html', label: 'HTML', family: 'code', extensions: ['html', 'htm'], mimeTypes: ['text/html'], preview: 'text', textLike: true },
  { id: 'xml', label: 'XML', family: 'code', extensions: ['xml'], mimeTypes: ['application/xml', 'text/xml'], preview: 'text', textLike: true },
  { id: 'json', label: 'JSON', family: 'code', extensions: ['json'], mimeTypes: ['application/json'], preview: 'text', textLike: true },
  { id: 'yaml', label: 'YAML', family: 'code', extensions: ['yaml', 'yml'], mimeTypes: ['application/yaml', 'text/yaml'], preview: 'text', textLike: true },
  { id: 'csv', label: 'CSV', family: 'spreadsheet', extensions: ['csv'], mimeTypes: ['text/csv'], preview: 'text', textLike: true },
  { id: 'tsv', label: 'TSV', family: 'spreadsheet', extensions: ['tsv'], mimeTypes: ['text/tab-separated-values'], preview: 'text', textLike: true },
  {
    id: 'xls',
    label: 'Excel XLS',
    family: 'spreadsheet',
    extensions: ['xls'],
    mimeTypes: ['application/vnd.ms-excel'],
    preview: 'none',
  },
  {
    id: 'xlsx',
    label: 'Excel XLSX',
    family: 'spreadsheet',
    extensions: ['xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    preview: 'none',
  },
  {
    id: 'ods',
    label: 'OpenDocument Spreadsheet',
    family: 'spreadsheet',
    extensions: ['ods'],
    mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'],
    preview: 'none',
  },
  {
    id: 'ppt',
    label: 'PowerPoint PPT',
    family: 'presentation',
    extensions: ['ppt'],
    mimeTypes: ['application/vnd.ms-powerpoint'],
    preview: 'none',
  },
  {
    id: 'pptx',
    label: 'PowerPoint PPTX',
    family: 'presentation',
    extensions: ['pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    preview: 'none',
  },
  {
    id: 'odp',
    label: 'OpenDocument Presentation',
    family: 'presentation',
    extensions: ['odp'],
    mimeTypes: ['application/vnd.oasis.opendocument.presentation'],
    preview: 'none',
  },
  { id: 'jpg', label: 'JPEG', family: 'image', extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg'], preview: 'image' },
  { id: 'png', label: 'PNG', family: 'image', extensions: ['png'], mimeTypes: ['image/png'], preview: 'image' },
  { id: 'webp', label: 'WebP', family: 'image', extensions: ['webp'], mimeTypes: ['image/webp'], preview: 'image' },
  { id: 'bmp', label: 'BMP', family: 'image', extensions: ['bmp'], mimeTypes: ['image/bmp'], preview: 'image' },
  { id: 'tiff', label: 'TIFF', family: 'image', extensions: ['tiff', 'tif'], mimeTypes: ['image/tiff'], preview: 'image' },
  { id: 'svg', label: 'SVG', family: 'image', extensions: ['svg'], mimeTypes: ['image/svg+xml'], preview: 'image', textLike: true },
  { id: 'heic', label: 'HEIC', family: 'image', extensions: ['heic', 'heif'], mimeTypes: ['image/heic', 'image/heif'], preview: 'image' },
  { id: 'gif', label: 'GIF', family: 'image', extensions: ['gif'], mimeTypes: ['image/gif'], preview: 'image' },
  { id: 'avif', label: 'AVIF', family: 'image', extensions: ['avif'], mimeTypes: ['image/avif'], preview: 'image' },
  { id: 'mp3', label: 'MP3', family: 'audio', extensions: ['mp3'], mimeTypes: ['audio/mpeg'], preview: 'audio' },
  { id: 'wav', label: 'WAV', family: 'audio', extensions: ['wav'], mimeTypes: ['audio/wav', 'audio/x-wav'], preview: 'audio' },
  { id: 'ogg', label: 'OGG', family: 'audio', extensions: ['ogg'], mimeTypes: ['audio/ogg'], preview: 'audio' },
  { id: 'flac', label: 'FLAC', family: 'audio', extensions: ['flac'], mimeTypes: ['audio/flac'], preview: 'audio' },
  { id: 'aac', label: 'AAC', family: 'audio', extensions: ['aac'], mimeTypes: ['audio/aac'], preview: 'audio' },
  { id: 'm4a', label: 'M4A', family: 'audio', extensions: ['m4a'], mimeTypes: ['audio/mp4'], preview: 'audio' },
  { id: 'mp4', label: 'MP4', family: 'video', extensions: ['mp4'], mimeTypes: ['video/mp4'], preview: 'video' },
  { id: 'webm', label: 'WebM', family: 'video', extensions: ['webm'], mimeTypes: ['video/webm'], preview: 'video' },
  { id: 'mov', label: 'MOV', family: 'video', extensions: ['mov'], mimeTypes: ['video/quicktime'], preview: 'video' },
  { id: 'mkv', label: 'MKV', family: 'video', extensions: ['mkv'], mimeTypes: ['video/x-matroska'], preview: 'video' },
  { id: 'avi', label: 'AVI', family: 'video', extensions: ['avi'], mimeTypes: ['video/x-msvideo'], preview: 'video' },
  { id: 'zip', label: 'ZIP', family: 'archive', extensions: ['zip'], mimeTypes: ['application/zip'], preview: 'none' },
  { id: 'tar', label: 'TAR', family: 'archive', extensions: ['tar'], mimeTypes: ['application/x-tar'], preview: 'none' },
  { id: 'gz', label: 'GZip', family: 'archive', extensions: ['gz'], mimeTypes: ['application/gzip'], preview: 'none' },
  { id: 'rar', label: 'RAR', family: 'archive', extensions: ['rar'], mimeTypes: ['application/vnd.rar'], preview: 'none' },
  { id: '7z', label: '7Z', family: 'archive', extensions: ['7z'], mimeTypes: ['application/x-7z-compressed'], preview: 'none' },
  { id: 'epub', label: 'EPUB', family: 'ebook', extensions: ['epub'], mimeTypes: ['application/epub+zip'], preview: 'none' },
  { id: 'mobi', label: 'MOBI', family: 'ebook', extensions: ['mobi'], mimeTypes: ['application/x-mobipocket-ebook'], preview: 'none' },
];

const extensionLookup = new Map<string, FormatDefinition>();
const formatLookup = new Map<string, FormatDefinition>();
const mimeLookup = new Map<string, FormatDefinition>();

for (const format of FORMAT_DEFINITIONS) {
  formatLookup.set(format.id, format);
  for (const extension of format.extensions) {
    extensionLookup.set(extension.toLowerCase(), format);
  }
  for (const mimeType of format.mimeTypes) {
    mimeLookup.set(mimeType.toLowerCase(), format);
  }
}

export const FAMILY_LABELS: Record<FileFamily, string> = {
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archive',
  code: 'Code / Markup',
  ebook: 'Ebook',
  data: 'Data',
  unknown: 'Unknown',
};

export function getFormatDefinition(formatId: string | null | undefined): FormatDefinition | null {
  if (!formatId) {
    return null;
  }

  return formatLookup.get(normalizeFormatId(formatId)) ?? null;
}

export function normalizeFormatId(formatId: string): string {
  const normalized = formatId.trim().toLowerCase().replace(/^\./, '');
  if (normalized === 'jpeg') {
    return 'jpg';
  }
  if (normalized === 'tif') {
    return 'tiff';
  }
  if (normalized === 'yml') {
    return 'yaml';
  }
  if (normalized === 'htm') {
    return 'html';
  }
  if (normalized === 'text') {
    return 'txt';
  }
  return normalized;
}

export function getFileExtension(fileName: string): string {
  const extension = fileName.split('.').pop();
  return extension ? normalizeFormatId(extension) : '';
}

export function resolveFormatDefinition(extension: string, mimeType = ''): FormatDefinition | null {
  const normalizedExtension = normalizeFormatId(extension);
  const normalizedMime = mimeType.toLowerCase().trim();

  if (normalizedExtension && extensionLookup.has(normalizedExtension)) {
    return extensionLookup.get(normalizedExtension) ?? null;
  }

  if (normalizedMime && mimeLookup.has(normalizedMime)) {
    return mimeLookup.get(normalizedMime) ?? null;
  }

  if (normalizedMime.startsWith('text/')) {
    return getFormatDefinition('txt');
  }

  if (normalizedMime.startsWith('image/')) {
    return getFormatDefinition('png');
  }

  if (normalizedMime.startsWith('audio/')) {
    return getFormatDefinition('mp3');
  }

  if (normalizedMime.startsWith('video/')) {
    return getFormatDefinition('mp4');
  }

  return null;
}

export function getFormatLabel(formatId: string): string {
  const definition = getFormatDefinition(formatId);
  return definition?.label ?? formatId.toUpperCase();
}

export function getFamilyForFormat(formatId: string): FileFamily {
  return getFormatDefinition(formatId)?.family ?? 'unknown';
}

export function isTextLikeFormat(formatId: string): boolean {
  return getFormatDefinition(formatId)?.textLike ?? false;
}

export function getPreviewKind(formatId: string, mimeType = ''): PreviewKind {
  const definition = getFormatDefinition(formatId);
  if (definition) {
    return definition.preview;
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (mimeType.startsWith('text/')) {
    return 'text';
  }
  return 'none';
}

export function getMimeTypeForFormat(formatId: string): string {
  const definition = getFormatDefinition(formatId);
  return definition?.mimeTypes[0] ?? 'application/octet-stream';
}

export function buildOutputFilename(originalName: string, targetFormatId: string): string {
  const stem = originalName.replace(/\.[^.]+$/, '') || 'converted-file';
  return `${stem}.${normalizeFormatId(targetFormatId)}`;
}

export function formatBytes(value: number): string {
  if (value === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / 1024 ** exponent;
  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function summarizeFormat(formatId: string): string {
  const definition = getFormatDefinition(formatId);
  if (!definition) {
    return `${formatId.toUpperCase()} format`;
  }

  return `${definition.label} ${FAMILY_LABELS[definition.family].toLowerCase()}`;
}
