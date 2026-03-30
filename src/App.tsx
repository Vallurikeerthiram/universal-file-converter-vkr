import { startTransition, useEffect, useRef, useState } from 'react';

import {
  analyzeFile,
  discoverRemoteTargets,
  executeConversion,
  getOutputSuggestions,
  packageBatchResults,
  planConversion,
  triggerDownload,
  type AnalyzedFile,
  type ConversionArtifact,
  type ConversionPlan,
  type ConversionProgress,
  type OutputSuggestion,
} from './lib/conversion';
import { getFormatLabel } from './lib/formats';
import {
  loadHistory,
  loadPreferences,
  loadProviderSettings,
  saveHistory,
  savePreferences,
  saveProviderSettings,
  type HistoryEntry,
  type ProviderSettings,
  type StoredPreferences,
} from './lib/storage';

type QueueStatus = 'ready' | 'converting' | 'done' | 'error';

interface QueueItem {
  id: string;
  input: AnalyzedFile;
  remoteTargets: string[];
  suggestions: OutputSuggestion[];
  selectedTarget: string;
  plan: ConversionPlan | null;
  status: QueueStatus;
  progress: ConversionProgress;
  result?: ConversionArtifact;
  error?: string;
}

function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [preferences, setPreferences] = useState<StoredPreferences>(() => loadPreferences());
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState('');

  const selectedItem = queue.find((item) => item.id === selectedId) ?? queue[0] ?? null;

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    saveProviderSettings(providerSettings);
  }, [providerSettings]);

  useEffect(() => {
    if (!selectedItem || selectedItem.result?.previewUrl || ['text', 'none'].includes(selectedItem.input.previewKind)) {
      setSelectedPreviewUrl('');
      return;
    }

    const url = URL.createObjectURL(selectedItem.input.file);
    setSelectedPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedItem?.id, selectedItem?.result?.previewUrl, selectedItem?.input.previewKind]);

  async function handleFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setIsAnalyzing(true);
    const analyzed = await Promise.all(files.map((file) => analyzeFile(file)));
    const items = await Promise.all(analyzed.map((input) => buildQueueItem(input, preferences, providerSettings, [])));

    startTransition(() => {
      setQueue((current) => [...items, ...current]);
      setSelectedId((current) => current || items[0]?.id || '');
    });

    setIsAnalyzing(false);

    for (const input of analyzed) {
      void refreshRemoteTargets(input, preferences, providerSettings);
    }
  }

  async function refreshRemoteTargets(input: AnalyzedFile, nextPreferences: StoredPreferences, nextProviderSettings: ProviderSettings) {
    const remoteTargets = await discoverRemoteTargets(input.formatId).catch(() => []);
    const suggestions = await getOutputSuggestions(input, nextPreferences, nextProviderSettings, remoteTargets);
    const defaultTarget = selectDefaultTarget(input, suggestions);
    const plan = defaultTarget
      ? await planConversion(input, defaultTarget, nextPreferences, nextProviderSettings, remoteTargets)
      : null;

    setQueue((current) =>
      current.map((item) =>
        item.id === input.id
          ? {
              ...item,
              remoteTargets,
              suggestions,
              selectedTarget: item.selectedTarget || defaultTarget,
              plan: item.selectedTarget ? item.plan : plan,
            }
          : item,
      ),
    );
  }

  async function rebuildAll(nextPreferences: StoredPreferences, nextProviderSettings: ProviderSettings) {
    const snapshot = queue;
    const rebuilt = await Promise.all(
      snapshot.map(async (item) => ({
        id: item.id,
        suggestions: await getOutputSuggestions(item.input, nextPreferences, nextProviderSettings, item.remoteTargets),
        plan: item.selectedTarget
          ? await planConversion(item.input, item.selectedTarget, nextPreferences, nextProviderSettings, item.remoteTargets)
          : null,
      })),
    );

    setQueue((current) =>
      current.map((item) => {
        const update = rebuilt.find((candidate) => candidate.id === item.id);
        return update ? { ...item, suggestions: update.suggestions, plan: update.plan } : item;
      }),
    );
  }

  function updatePreferences(partial: Partial<StoredPreferences>) {
    const nextPreferences = { ...preferences, ...partial };
    setPreferences(nextPreferences);
    void rebuildAll(nextPreferences, providerSettings);
  }

  function updateProviderSettings(partial: Partial<ProviderSettings>) {
    const nextProviderSettings = { ...providerSettings, ...partial };
    setProviderSettings(nextProviderSettings);
    void rebuildAll(preferences, nextProviderSettings);
  }

  async function changeTarget(itemId: string, target: string) {
    const item = queue.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    const plan = target ? await planConversion(item.input, target, preferences, providerSettings, item.remoteTargets) : null;
    if (item.result?.previewUrl) {
      URL.revokeObjectURL(item.result.previewUrl);
    }
    setQueue((current) =>
      current.map((candidate) =>
        candidate.id === itemId
          ? {
              ...candidate,
              selectedTarget: target,
              plan,
              status: candidate.status === 'done' ? 'ready' : candidate.status,
              result: undefined,
              error: undefined,
            }
          : candidate,
      ),
    );
  }

  async function convertOne(itemId: string) {
    const item = queue.find((candidate) => candidate.id === itemId);
    if (!item || !item.selectedTarget) {
      return;
    }

    const plan = await planConversion(item.input, item.selectedTarget, preferences, providerSettings, item.remoteTargets);
    if (!plan) {
      setQueue((current) =>
        current.map((candidate) =>
          candidate.id === itemId ? { ...candidate, status: 'error', error: 'No compatible route could be planned.' } : candidate,
        ),
      );
      return;
    }

    if (
      plan.location === 'external' &&
      !window.confirm(
        `This conversion will upload ${item.input.name} to ${plan.engineName} for remote processing. Continue?`,
      )
    ) {
      return;
    }

    setQueue((current) =>
      current.map((candidate) =>
        candidate.id === itemId
          ? {
              ...candidate,
              status: 'converting',
              error: undefined,
              plan,
              progress: { stage: 'Queued', percent: 0 },
            }
          : candidate,
      ),
    );

    try {
      const result = await executeConversion(plan, item.input, {
        preferences,
        providerSettings,
        onProgress: (progress) =>
          setQueue((current) =>
            current.map((candidate) => (candidate.id === itemId ? { ...candidate, progress } : candidate)),
          ),
      });

      setQueue((current) =>
        current.map((candidate) =>
          candidate.id === itemId
            ? {
                ...candidate,
                status: 'done',
                result,
                plan,
                progress: { stage: 'Completed', percent: 100 },
              }
            : candidate,
        ),
      );

      setHistory((current) => [
        {
          id: crypto.randomUUID(),
          fileName: item.input.name,
          sourceFormat: item.input.formatId,
          targetFormat: plan.targetFormatId,
          route: plan.location,
          engineName: plan.engineName,
          createdAt: new Date().toISOString(),
          fileSize: item.input.size,
          quality: plan.quality,
          lossy: plan.lossy,
        },
        ...current,
      ]);
    } catch (error) {
      setQueue((current) =>
        current.map((candidate) =>
          candidate.id === itemId
            ? {
                ...candidate,
                status: 'error',
                error: error instanceof Error ? error.message : 'Conversion failed.',
                progress: { stage: 'Failed', percent: 100 },
              }
            : candidate,
        ),
      );
    }
  }

  async function convertAll() {
    setIsBatchRunning(true);
    const snapshot = [...queue];
    for (const item of snapshot) {
      if (item.selectedTarget && !['converting', 'done'].includes(item.status)) {
        await convertOne(item.id);
      }
    }
    setIsBatchRunning(false);
  }

  async function downloadAll() {
    const results = queue.filter((item) => item.result).map((item) => ({ fileName: item.result!.fileName, blob: item.result!.blob }));
    if (results.length === 0) {
      return;
    }

    if (results.length === 1) {
      triggerDownload(results[0]);
      return;
    }

    const archive = await packageBatchResults(results);
    triggerDownload(archive);
  }

  function removeItem(itemId: string) {
    const item = queue.find((candidate) => candidate.id === itemId);
    if (item?.result?.previewUrl) {
      URL.revokeObjectURL(item.result.previewUrl);
    }
    setQueue((current) => current.filter((candidate) => candidate.id !== itemId));
    setSelectedId((current) => (current === itemId ? '' : current));
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Static, local-first conversion workstation</p>
          <h1>Universal File Converter</h1>
          <p className="lede">
            Upload, detect, route, convert, and download. Local engines are preferred automatically, and remote providers are only used with explicit user confirmation.
          </p>
        </div>
        <div className="status-cluster">
          <div className="metric">
            <strong>{queue.length}</strong>
            <span>Queued</span>
          </div>
          <div className="metric">
            <strong>{queue.filter((item) => item.result).length}</strong>
            <span>Completed</span>
          </div>
          <div className="metric">
            <strong>{preferences.privacyMode}</strong>
            <span>Route policy</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="main-column">
          <section className="panel upload-panel">
            <button className="dropzone" onClick={() => fileInputRef.current?.click()} type="button">
              <span>{isAnalyzing ? 'Analyzing files…' : 'Drop files here or click to add a batch'}</span>
              <small>Supports documents, spreadsheets, presentations, images, audio, video, archives, code, ebooks, and provider-discovered remote routes.</small>
            </button>
            <input
              ref={fileInputRef}
              hidden
              multiple
              type="file"
              onChange={(event) => void handleFiles(Array.from(event.target.files ?? []))}
            />
            <div className="toolbar">
              <button onClick={() => void convertAll()} disabled={queue.length === 0 || isBatchRunning} type="button">
                {isBatchRunning ? 'Running batch…' : 'Convert All'}
              </button>
              <button onClick={() => void downloadAll()} disabled={!queue.some((item) => item.result)} type="button">
                Download All
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Conversion Queue</h2>
              <p>Each file keeps its own output target, plan, warnings, and result.</p>
            </div>
            <div className="queue">
              {queue.length === 0 ? (
                <div className="empty-state">No files loaded yet.</div>
              ) : (
                queue.map((item) => (
                  <article
                    key={item.id}
                    className={`queue-item ${selectedItem?.id === item.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="queue-main">
                      <h3>{item.input.name}</h3>
                      <p>{item.input.summary}</p>
                      <div className="meta-row">
                        <span className={`badge ${item.plan?.location === 'external' ? 'remote' : 'local'}`}>
                          {item.plan?.location === 'external' ? 'Remote' : 'Local'}
                        </span>
                        <span className="badge neutral">{item.plan?.quality ?? 'unplanned'}</span>
                        {item.plan?.lossy ? <span className="badge warn">Lossy</span> : null}
                      </div>
                    </div>
                    <div className="queue-controls">
                      <label>
                        Output
                        <select value={item.selectedTarget} onChange={(event) => void changeTarget(item.id, event.target.value)}>
                          <option value="">Select format</option>
                          {item.suggestions.map((suggestion) => (
                            <option key={`${item.id}-${suggestion.formatId}`} value={suggestion.formatId}>
                              {suggestion.label}
                              {suggestion.availableLocally ? ' • local' : ' • remote'}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="action-row">
                        <button onClick={(event) => { event.stopPropagation(); void convertOne(item.id); }} disabled={!item.selectedTarget || item.status === 'converting'} type="button">
                          {item.status === 'converting' ? `${item.progress.percent}%` : 'Convert'}
                        </button>
                        {item.result ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              triggerDownload(item.result!);
                            }}
                            type="button"
                          >
                            Download
                          </button>
                        ) : null}
                        <button className="ghost" onClick={(event) => { event.stopPropagation(); removeItem(item.id); }} type="button">
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <aside className="sidebar">
          <section className="panel">
            <div className="panel-head">
              <h2>Inspector</h2>
              <p>{selectedItem ? 'Route, preview, and warnings for the selected file.' : 'Select a queued file to inspect it.'}</p>
            </div>
            {selectedItem ? (
              <div className="inspector">
                <div className="inspector-block">
                  <h3>{selectedItem.input.name}</h3>
                  <p>{selectedItem.input.summary}</p>
                </div>
                <div className="inspector-block">
                  <strong>Detected</strong>
                  <p>{getFormatLabel(selectedItem.input.formatId)} • {selectedItem.input.detectedMimeType || 'Unknown MIME'}</p>
                </div>
                <div className="inspector-block">
                  <strong>Plan</strong>
                  {selectedItem.plan ? (
                    <ul className="flat-list">
                      {selectedItem.plan.steps.map((step) => <li key={step}>{step}</li>)}
                    </ul>
                  ) : (
                    <p>No route planned yet.</p>
                  )}
                </div>
                <div className="inspector-block">
                  <strong>Recommended outputs</strong>
                  <div className="chip-list">
                    {selectedItem.suggestions.slice(0, 8).map((suggestion) => (
                      <button
                        key={suggestion.formatId}
                        className={`chip ${selectedItem.selectedTarget === suggestion.formatId ? 'selected' : ''}`}
                        onClick={() => void changeTarget(selectedItem.id, suggestion.formatId)}
                        type="button"
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                </div>
                {(selectedItem.input.warnings.length > 0 || selectedItem.plan?.warnings.length || selectedItem.error) ? (
                  <div className="inspector-block">
                    <strong>Warnings</strong>
                    <ul className="flat-list warn-list">
                      {selectedItem.input.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      {selectedItem.plan?.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      {selectedItem.error ? <li>{selectedItem.error}</li> : null}
                    </ul>
                  </div>
                ) : null}
                <div className="inspector-block">
                  <strong>Preview</strong>
                  {selectedItem.result?.previewText ? <pre className="text-preview">{selectedItem.result.previewText}</pre> : null}
                  {selectedItem.result?.previewUrl || selectedPreviewUrl ? (
                    renderPreview(selectedItem.result?.previewUrl || selectedPreviewUrl, selectedItem.result?.formatId || selectedItem.input.formatId)
                  ) : (
                    <p className="preview-placeholder">No inline preview available for this format.</p>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Advanced Options</h2>
              <p>Control routing, OCR, quality, and remote providers.</p>
            </div>
            <div className="settings-grid">
              <label>
                Privacy mode
                <select value={preferences.privacyMode} onChange={(event) => updatePreferences({ privacyMode: event.target.value as StoredPreferences['privacyMode'] })}>
                  <option value="local-first">Local first</option>
                  <option value="balanced">Balanced</option>
                  <option value="external-ready">External ready</option>
                </select>
              </label>
              <label>
                Quality
                <select value={preferences.qualityProfile} onChange={(event) => updatePreferences({ qualityProfile: event.target.value as StoredPreferences['qualityProfile'] })}>
                  <option value="maximum">Maximum</option>
                  <option value="balanced">Balanced</option>
                  <option value="compact">Compact</option>
                </select>
              </label>
              <label>
                OCR language
                <input value={preferences.ocrLanguage} onChange={(event) => updatePreferences({ ocrLanguage: event.target.value })} />
              </label>
              <label>
                Remote provider
                <select value={preferences.preferredExternalProvider} onChange={(event) => updatePreferences({ preferredExternalProvider: event.target.value as StoredPreferences['preferredExternalProvider'] })}>
                  <option value="convertapi">ConvertAPI</option>
                  <option value="cloudconvert">CloudConvert</option>
                </select>
              </label>
            </div>
            <div className="toggle-row">
              <label><input checked={preferences.allowLossy} onChange={(event) => updatePreferences({ allowLossy: event.target.checked })} type="checkbox" /> Allow lossy conversions</label>
              <label><input checked={preferences.forceOcr} onChange={(event) => updatePreferences({ forceOcr: event.target.checked })} type="checkbox" /> Force OCR routes</label>
            </div>
            <div className="settings-grid">
              <label>
                ConvertAPI token
                <input type="password" value={providerSettings.convertApiToken} onChange={(event) => updateProviderSettings({ convertApiToken: event.target.value })} />
              </label>
              <label>
                CloudConvert token
                <input type="password" value={providerSettings.cloudConvertToken} onChange={(event) => updateProviderSettings({ cloudConvertToken: event.target.value })} />
              </label>
            </div>
            <p className="panel-note">Provider tokens are kept in session storage only. Converted files are not persisted by this app.</p>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>History</h2>
              <button className="ghost" onClick={() => setHistory([])} type="button">Clear</button>
            </div>
            <div className="history-list">
              {history.length === 0 ? <div className="empty-state">No conversions recorded yet.</div> : history.slice(0, 10).map((entry) => (
                <article key={entry.id} className="history-item">
                  <strong>{entry.fileName}</strong>
                  <span>{entry.sourceFormat.toUpperCase()} → {entry.targetFormat.toUpperCase()}</span>
                  <span>{entry.engineName} • {entry.route}</span>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

async function buildQueueItem(
  input: AnalyzedFile,
  preferences: StoredPreferences,
  providerSettings: ProviderSettings,
  remoteTargets: string[],
): Promise<QueueItem> {
  const suggestions = await getOutputSuggestions(input, preferences, providerSettings, remoteTargets);
  const selectedTarget = selectDefaultTarget(input, suggestions);
  const plan = selectedTarget ? await planConversion(input, selectedTarget, preferences, providerSettings, remoteTargets) : null;
  return {
    id: input.id,
    input,
    remoteTargets,
    suggestions,
    selectedTarget,
    plan,
    status: 'ready',
    progress: { stage: 'Ready', percent: 0 },
  };
}

function selectDefaultTarget(input: AnalyzedFile, suggestions: OutputSuggestion[]): string {
  const preferredByFamily: Record<string, string> = {
    document: 'pdf',
    spreadsheet: 'xlsx',
    presentation: 'pdf',
    image: 'png',
    audio: 'mp3',
    video: 'mp4',
    code: 'txt',
    archive: 'zip',
    ebook: 'pdf',
  };

  const preferred = preferredByFamily[input.family];
  const exact = suggestions.find((suggestion) => suggestion.formatId === preferred);
  return exact?.formatId ?? suggestions[0]?.formatId ?? '';
}

function renderPreview(url: string, formatId: string) {
  if (['jpg', 'png', 'webp', 'bmp', 'tiff', 'svg', 'heic', 'gif', 'avif'].includes(formatId)) {
    return <img alt="Preview" className="asset-preview" src={url} />;
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(formatId)) {
    return <audio className="asset-preview" controls src={url} />;
  }
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(formatId)) {
    return <video className="asset-preview" controls src={url} />;
  }
  if (formatId === 'pdf') {
    return <iframe className="asset-preview frame-preview" src={url} title="PDF preview" />;
  }
  return null;
}

export default App;
