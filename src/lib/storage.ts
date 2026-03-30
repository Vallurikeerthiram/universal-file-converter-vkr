export interface HistoryEntry {
  id: string;
  fileName: string;
  sourceFormat: string;
  targetFormat: string;
  route: 'local' | 'external';
  engineName: string;
  createdAt: string;
  fileSize: number;
  quality: string;
  lossy: boolean;
}

export interface StoredPreferences {
  privacyMode: 'local-first' | 'balanced' | 'external-ready';
  allowLossy: boolean;
  forceOcr: boolean;
  qualityProfile: 'maximum' | 'balanced' | 'compact';
  ocrLanguage: string;
  preferredExternalProvider: 'convertapi' | 'cloudconvert';
}

const HISTORY_KEY = 'ufc.history.v1';
const PREFS_KEY = 'ufc.preferences.v1';
const PROVIDER_KEY = 'ufc.provider-settings.v1';

export interface ProviderSettings {
  convertApiToken: string;
  cloudConvertToken: string;
}

export const DEFAULT_PREFERENCES: StoredPreferences = {
  privacyMode: 'local-first',
  allowLossy: true,
  forceOcr: false,
  qualityProfile: 'balanced',
  ocrLanguage: 'eng',
  preferredExternalProvider: 'convertapi',
};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  convertApiToken: '',
  cloudConvertToken: '',
};

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return { ...fallback, ...(JSON.parse(value) as object) } as T;
  } catch {
    return fallback;
  }
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') {
    return [];
  }

  return safeParse<HistoryEntry[]>(window.localStorage.getItem(HISTORY_KEY), []);
}

export function saveHistory(history: HistoryEntry[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 40)));
}

export function loadPreferences(): StoredPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES;
  }

  return safeParse<StoredPreferences>(window.localStorage.getItem(PREFS_KEY), DEFAULT_PREFERENCES);
}

export function savePreferences(preferences: StoredPreferences): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
}

export function loadProviderSettings(): ProviderSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PROVIDER_SETTINGS;
  }

  return safeParse<ProviderSettings>(window.sessionStorage.getItem(PROVIDER_KEY), DEFAULT_PROVIDER_SETTINGS);
}

export function saveProviderSettings(providerSettings: ProviderSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(PROVIDER_KEY, JSON.stringify(providerSettings));
}
