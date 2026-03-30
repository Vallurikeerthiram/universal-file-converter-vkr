import { startTransition, useRef, useState, useEffect } from 'react';

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
import { getFormatLabel, getFamilyForFormat, FAMILY_LABELS, type FileFamily } from './lib/formats';
import { loadHistory, saveHistory, loadPreferences, loadProviderSettings, saveProviderSettings, type HistoryEntry, type ProviderSettings } from './lib/storage';

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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory());
  
  const [showSettings, setShowSettings] = useState(false);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(loadProviderSettings);

  const preferences = loadPreferences();

  useEffect(() => {
    saveProviderSettings(providerSettings);
  }, [providerSettings]);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setIsAnalyzing(true);
    
    const analyzed = await Promise.all(files.map((f) => analyzeFile(f)));
    const items = await Promise.all(analyzed.map((input) => buildQueueItem(input, preferences, providerSettings, [])));

    startTransition(() => {
      setQueue((current) => [...items, ...current]);
    });
    setIsAnalyzing(false);

    for (const input of analyzed) {
      void refreshRemoteTargets(input, preferences, providerSettings);
    }
  }

  async function refreshRemoteTargets(input: AnalyzedFile, prefs: typeof preferences, provs: typeof providerSettings) {
    const remoteTargets = await discoverRemoteTargets(input.formatId).catch(() => []);
    const suggestions = await getOutputSuggestions(input, prefs, provs, remoteTargets);
    const defaultTarget = selectDefaultTarget(input, suggestions);
    const plan = defaultTarget ? await planConversion(input, defaultTarget, prefs, provs, remoteTargets) : null;

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

  async function changeTarget(itemId: string, target: string) {
    const item = queue.find((c) => c.id === itemId);
    if (!item) return;

    const plan = target ? await planConversion(item.input, target, preferences, providerSettings, item.remoteTargets) : null;
    setQueue((current) =>
      current.map((candidate) =>
        candidate.id === itemId
          ? {
              ...candidate,
              selectedTarget: target,
              plan,
              status: candidate.status === 'done' ? 'ready' : candidate.status,
              error: undefined,
            }
          : candidate,
      ),
    );
  }

  async function convertOne(itemId: string) {
    const item = queue.find((c) => c.id === itemId);
    if (!item || !item.selectedTarget) return;

    const plan = await planConversion(item.input, item.selectedTarget, preferences, providerSettings, item.remoteTargets);
    if (!plan) {
      setQueue((current) => current.map((c) => c.id === itemId ? { ...c, status: 'error', error: 'No compatible route.' } : c));
      return;
    }

    if (plan.location === 'external') {
      const consent = window.confirm(
        `Conversion will be performed by ${plan.engineName} on external servers, and file data will leave your browser. Proceed?`,
      );
      if (!consent) {
        setQueue((current) => current.map((c) => (c.id === itemId ? { ...c, status: 'ready', error: 'User declined external processing' } : c)));
        return;
      }
    }

    setQueue((current) => current.map((c) => c.id === itemId ? { ...c, status: 'converting', error: undefined, plan, progress: { stage: 'Queued', percent: 0 } } : c));

    try {
      const result = await executeConversion(plan, item.input, {
        preferences,
        providerSettings,
        onProgress: (progress) =>
          setQueue((current) => current.map((c) => (c.id === itemId ? { ...c, progress } : c))),
      });

      setQueue((current) => current.map((c) => c.id === itemId ? { ...c, status: 'done', result, plan, progress: { stage: 'Completed', percent: 100 } } : c));

      const entry: HistoryEntry = {
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
      };

      const nextHistory = [entry, ...history].slice(0, 40);
      setHistory(nextHistory);
      saveHistory(nextHistory);

    } catch (error) {
      setQueue((current) => current.map((c) => c.id === itemId ? { ...c, status: 'error', error: error instanceof Error ? error.message : 'Conversion failed.', progress: { stage: 'Failed', percent: 100 } } : c));
    }
  }

  async function convertAll() {
    setIsBatchRunning(true);
    for (const item of [...queue]) {
      if (item.selectedTarget && item.status !== 'converting' && item.status !== 'done') await convertOne(item.id);
    }
    setIsBatchRunning(false);
  }

  async function downloadAll() {
    const results = queue.filter((i) => i.result).map((i) => ({ fileName: i.result!.fileName, blob: i.result!.blob }));
    if (results.length === 0) return;
    if (results.length === 1) { triggerDownload(results[0]); return; }
    triggerDownload(await packageBatchResults(results));
  }

  function removeItem(itemId: string) {
    const item = queue.find((c) => c.id === itemId);
    if (item?.result?.previewUrl) URL.revokeObjectURL(item.result.previewUrl);
    setQueue((current) => current.filter((c) => c.id !== itemId));
  }

  function groupSuggestions(suggestions: OutputSuggestion[]) {
    const groups: Partial<Record<FileFamily, OutputSuggestion[]>> = {};
    for (const s of suggestions) {
      const family = getFamilyForFormat(s.formatId);
      if (!groups[family]) groups[family] = [];
      groups[family]!.push(s);
    }
    return groups;
  }

  return (
    <div className="container">
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
          <h1>Universal File Converter</h1>
          <button className="settings-btn" onClick={() => setShowSettings(true)} title="Advanced API Settings">
             ⚙️
          </button>
        </div>
        <p>A simple privacy-first tool to reliably convert any file format.</p>
      </header>

      <main>
        <div 
          className="dropzone" 
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) handleFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="dropzone-content">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            <h2>{isAnalyzing ? 'Analyzing files...' : 'Click or Drag files here'}</h2>
            <p>Upload documents, images, audio, video, spreadsheets, or any other file type.</p>
          </div>
        </div>
        <input ref={fileInputRef} hidden multiple type="file" onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))} />

        {queue.length > 0 && (
          <div className="queue-container">
            <div className="queue-header">
              <h3>Files ({queue.length})</h3>
              <div className="queue-actions">
                <button 
                  className="btn-primary" 
                  onClick={() => void convertAll()} 
                  disabled={isBatchRunning || queue.every(q => q.status === 'done')}
                >
                  {isBatchRunning ? 'Converting...' : 'Convert All'}
                </button>
                <button 
                  className="btn-secondary" 
                  onClick={() => void downloadAll()} 
                  disabled={!queue.some(q => q.status === 'done')}
                >
                  Download All
                </button>
              </div>
            </div>

            <div className="queue-list">
              {queue.map((item) => {
                const groups = groupSuggestions(item.suggestions);
                return (
                  <div key={item.id} className="file-card">
                    <div className="file-info">
                      <strong>{item.input.name}</strong>
                      <span className="file-type">{getFormatLabel(item.input.formatId)}</span>
                    </div>

                    <div className="file-controls">
                      <div className="format-selector">
                        <span>to</span>
                        <select 
                          value={item.selectedTarget} 
                          onChange={(e) => void changeTarget(item.id, e.target.value)}
                          disabled={item.status === 'converting'}
                        >
                          <option value="">Select format...</option>
                          {Object.entries(groups).map(([family, options]) => (
                            <optgroup key={family} label={FAMILY_LABELS[family as FileFamily]}>
                              {options.map((opt) => (
                                <option key={opt.formatId} value={opt.formatId}>{opt.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>

                      <div className="file-actions">
                        {item.status === 'converting' ? (
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${item.progress.percent}%` }}></div>
                            <span>{item.progress.percent}%</span>
                          </div>
                        ) : item.result ? (
                          <button className="btn-success" onClick={() => triggerDownload(item.result!)}>
                            Download
                          </button>
                        ) : (
                          <button 
                            className="btn-primary" 
                            onClick={() => void convertOne(item.id)} 
                            disabled={!item.selectedTarget}
                          >
                            Convert
                          </button>
                        )}
                        <button className="btn-icon" onClick={() => removeItem(item.id)} title="Remove">✕</button>
                      </div>
                    </div>
                    {item.error && <div className="file-error">{item.error}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {history.length > 0 && (
          <section className="history-panel">
            <div className="history-header">
              <h3>Conversion History</h3>
              <small>Last {history.length} executed conversions (metadata only).</small>
            </div>
            <div className="history-grid">
              {history.slice(0, 8).map((entry) => (
                <article key={entry.id} className="history-item">
                  <div><strong>{entry.fileName}</strong></div>
                  <div>{entry.sourceFormat} → {entry.targetFormat}</div>
                  <div>{entry.route} / {entry.engineName}</div>
                  <div>{new Date(entry.createdAt).toLocaleString()}</div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Advanced Routing Settings</h3>
            <p>For perfect "Top MNC" layout preservation, enter API tokens to enable secure remote processing.</p>
            <div className="input-group">
               <label>CloudConvert API Token</label>
               <input 
                 type="password" 
                 value={providerSettings.cloudConvertToken} 
                 onChange={(e) => setProviderSettings({...providerSettings, cloudConvertToken: e.target.value})} 
                 placeholder="Enter token..." 
               />
            </div>
            <div className="input-group">
               <label>ConvertAPI Token</label>
               <input 
                 type="password" 
                 value={providerSettings.convertApiToken} 
                 onChange={(e) => setProviderSettings({...providerSettings, convertApiToken: e.target.value})} 
                 placeholder="Enter token..." 
               />
            </div>
            <button className="btn-primary" onClick={() => setShowSettings(false)} style={{ width: '100%', marginTop: '1rem' }}>Save & Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

async function buildQueueItem(input: AnalyzedFile, prefs: typeof loadPreferences extends () => infer R ? R : never, provs: typeof loadProviderSettings extends () => infer P ? P : never, rt: string[]): Promise<QueueItem> {
  const suggestions = await getOutputSuggestions(input, prefs, provs, rt);
  const selectedTarget = selectDefaultTarget(input, suggestions);
  const plan = selectedTarget ? await planConversion(input, selectedTarget, prefs, provs, rt) : null;
  return { id: input.id, input, remoteTargets: rt, suggestions, selectedTarget, plan, status: 'ready', progress: { stage: 'Ready', percent: 0 } };
}

function selectDefaultTarget(input: AnalyzedFile, suggestions: OutputSuggestion[]): string {
  const preferredByFamily: Record<string, string> = {
    document: 'pdf', spreadsheet: 'xlsx', presentation: 'pdf', image: 'png', audio: 'mp3', video: 'mp4', code: 'txt', archive: 'zip', ebook: 'pdf'
  };
  const exact = suggestions.find((s) => s.formatId === preferredByFamily[input.family]);
  return exact?.formatId ?? suggestions[0]?.formatId ?? '';
}

export default App;
