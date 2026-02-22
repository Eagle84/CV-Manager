import { useEffect, useState } from "react";
import axios from "axios";
import { apiClient, type SettingsDto } from "../lib/api.ts";

type PendingAction = "connect" | "disconnect" | "save" | "sync" | "digest" | "reset_sync" | null;

const schedulePresets = [
  {
    label: "High activity",
    description: "Poll every 5 mins",
    pollMinutes: 5,
    digestTime: "08:00",
  },
  {
    label: "Balanced",
    description: "Poll every 15 mins",
    pollMinutes: 15,
    digestTime: "09:00",
  },
  {
    label: "Light usage",
    description: "Poll every 30 mins",
    pollMinutes: 30,
    digestTime: "10:00",
  },
];

const parsePollCron = (value: string): number | null => {
  if (value.trim() === "0 * * * *") return 60;
  const everyMinutes = value.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (!everyMinutes) return null;
  const minutes = Number(everyMinutes[1]);
  return (Number.isInteger(minutes) && minutes >= 1 && minutes <= 60) ? minutes : null;
};

const parseDigestCron = (value: string): string | null => {
  const match = value.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const toPollCron = (minutes: number): string => (minutes === 60 ? "0 * * * *" : `*/${minutes} * * * *`);

const toDigestCron = (timeValue: string): string => {
  const [hour, minute] = timeValue.split(":").map((part) => Number(part));
  return `${minute || 0} ${hour || 9} * * *`;
};

export const SettingsPage = () => {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  // Form State
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(15);
  const [digestTime, setDigestTime] = useState("09:00");
  const [pollCron, setPollCron] = useState("*/15 * * * *");
  const [digestCron, setDigestCron] = useState("0 9 * * *");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [followupAfterDays, setFollowupAfterDays] = useState(7);
  const [syncLookbackDays, setSyncLookbackDays] = useState(120);

  // AI Models State
  const [modelEmail, setModelEmail] = useState("");
  const [modelCv, setModelCv] = useState("");
  const [modelMatcher, setModelMatcher] = useState("");
  const [modelExplorer, setModelExplorer] = useState("");
  const [modelClassification, setModelClassification] = useState("");

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<{ text: string; type: 'ok' | 'error' } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = pendingAction !== null;

  const syncUiFromSettings = (response: SettingsDto) => {
    setSettings(response);
    setFollowupAfterDays(response.followupAfterDays);
    setSyncLookbackDays(response.syncLookbackDays);
    setPollCron(response.pollCron);
    setDigestCron(response.digestCron);
    setModelEmail(response.modelEmail);
    setModelCv(response.modelCv);
    setModelMatcher(response.modelMatcher);
    setModelExplorer(response.modelExplorer);
    setModelClassification(response.modelClassification);

    const parsedPoll = parsePollCron(response.pollCron);
    const parsedDigest = parseDigestCron(response.digestCron);
    if (parsedPoll && parsedDigest) {
      setPollIntervalMinutes(parsedPoll);
      setDigestTime(parsedDigest);
      setAdvancedMode(false);
    } else {
      setAdvancedMode(true);
    }
  };

  const load = async () => {
    try {
      const [settingsRes, modelsRes] = await Promise.all([
        apiClient.getSettings(),
        apiClient.getOllamaModels()
      ]);
      syncUiFromSettings(settingsRes);
      setOllamaModels(modelsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  };

  useEffect(() => { load(); }, []);

  const handleAction = async (action: PendingAction, fn: () => Promise<void>) => {
    try {
      setPendingAction(action);
      setError(null);
      setMessage(null);
      await fn();
    } catch (err) {
      const apiError = axios.isAxiosError<{ error?: string }>(err) && err.response?.data?.error;
      setError(apiError || (err instanceof Error ? err.message : "Action failed"));
    } finally {
      setPendingAction(null);
    }
  };

  const saveSettings = () => handleAction("save", async () => {
    const finalPollCron = advancedMode ? pollCron : toPollCron(pollIntervalMinutes);
    const finalDigestCron = advancedMode ? digestCron : toDigestCron(digestTime);
    const updated = await apiClient.updateSettings({
      pollCron: finalPollCron,
      digestCron: finalDigestCron,
      followupAfterDays,
      syncLookbackDays,
      modelEmail,
      modelCv,
      modelMatcher,
      modelExplorer,
      modelClassification
    });
    syncUiFromSettings(updated);
    setMessage({ text: "Settings saved successfully!", type: 'ok' });
  });

  return (
    <div className="page-grid" style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Configuration & LLM Registry</h1>
            <p className="panel-help">Manage your job search infrastructure, automation schedules, and AI models.</p>
          </div>
          {pendingAction && <div className="spinner" style={{ width: '2rem', height: '2rem' }}></div>}
        </div>

        {error && <div className="error-text" style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', marginTop: '1rem' }}>⚠️ {error}</div>}
        {message && <div className="ok-text" style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', marginTop: '1rem' }}>✅ {message.text}</div>}
      </section>

      {/* Gmail Section */}
      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '1.5rem' }}>📧</span>
          <h2 style={{ margin: 0 }}>Gmail Connection</h2>
        </div>
        <div className="cv-grid" style={{ gridTemplateColumns: '1fr', gap: '1rem' }}>
          <div className="panel highlighted" style={{ margin: 0 }}>
            <p className="panel-help" style={{ marginBottom: '0.5rem' }}>Connected Account</p>
            <code style={{ fontSize: '1.1rem', display: 'block', marginBottom: '1rem' }}>{settings?.connectedEmail || "Not connected"}</code>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => handleAction("connect", async () => { window.location.href = await apiClient.getGoogleAuthUrl(); })}
                disabled={busy}
                style={{ flex: 1 }}
              >
                {settings?.connectedEmail ? "Change Account" : "Connect Gmail"}
              </button>
              {settings?.connectedEmail && (
                <button className="button-secondary" onClick={() => handleAction("disconnect", async () => { await apiClient.disconnectGoogle(); load(); })} disabled={busy}>
                  Disconnect
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* LLM Agents Configuration */}
      <section className="panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '1.5rem' }}>🧠</span>
          <h2 style={{ margin: 0 }}>AI Agent Models</h2>
        </div>
        <p className="panel-help" style={{ marginBottom: '1.5rem' }}>Assign specific LLM models for each specialized task explorer.</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div className="form-group">
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
              Email Extractor <small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>(Status updates & dates)</small>
            </label>
            <select value={modelEmail} onChange={(e) => setModelEmail(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              {!ollamaModels.includes(modelEmail) && modelEmail && <option value={modelEmail}>{modelEmail} (Current)</option>}
            </select>
          </div>

          <div className="form-group">
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
              CV Processor <small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>(Skills & summary extraction)</small>
            </label>
            <select value={modelCv} onChange={(e) => setModelCv(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              {!ollamaModels.includes(modelCv) && modelCv && <option value={modelCv}>{modelCv} (Current)</option>}
            </select>
          </div>

          <div className="form-group">
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
              Job Matcher <small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>(Score & Matching analysis)</small>
            </label>
            <select value={modelMatcher} onChange={(e) => setModelMatcher(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              {!ollamaModels.includes(modelMatcher) && modelMatcher && <option value={modelMatcher}>{modelMatcher} (Current)</option>}
            </select>
          </div>

          <div className="form-group">
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
              Job Discovery <small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>(Careers portal exploration)</small>
            </label>
            <select value={modelExplorer} onChange={(e) => setModelExplorer(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              {!ollamaModels.includes(modelExplorer) && modelExplorer && <option value={modelExplorer}>{modelExplorer} (Current)</option>}
            </select>
          </div>

          <div className="form-group">
            <label style={{ fontWeight: '600', display: 'block', marginBottom: '0.5rem' }}>
              Company Classifier <small style={{ fontWeight: 'normal', color: 'var(--text-secondary)' }}>(Industry categorization)</small>
            </label>
            <select value={modelClassification} onChange={(e) => setModelClassification(e.target.value)} disabled={busy} style={{ width: '100%' }}>
              {ollamaModels.map(m => <option key={m} value={m}>{m}</option>)}
              {!ollamaModels.includes(modelClassification) && modelClassification && <option value={modelClassification}>{modelClassification} (Current)</option>}
            </select>
          </div>
        </div>
      </section>

      {/* Scheduling & Automation */}
      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <span style={{ fontSize: '1.5rem' }}>⚙️</span>
          <h2 style={{ margin: 0 }}>Automation & Behavior</h2>
        </div>

        <div className="stats-highlight-grid" style={{ marginBottom: '2rem' }}>
          <article className="panel highlighted" style={{ margin: 0 }}>
            <h3>Scheduling Policy</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              {schedulePresets.map((preset) => (
                <button
                  key={preset.label}
                  className="button-secondary"
                  onClick={() => {
                    setPollIntervalMinutes(preset.pollMinutes);
                    setDigestTime(preset.digestTime);
                    setAdvancedMode(false);
                  }}
                  disabled={busy}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </article>

          <article className="panel highlighted" style={{ margin: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <label>
                Follow-up Threshold
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="number" value={followupAfterDays} onChange={(e) => setFollowupAfterDays(Number(e.target.value))} disabled={busy} style={{ width: '80px' }} />
                  <span className="panel-help">days</span>
                </div>
              </label>
              <label>
                Sync Lookback
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input type="number" value={syncLookbackDays} onChange={(e) => setSyncLookbackDays(Number(e.target.value))} disabled={busy} style={{ width: '80px' }} />
                  <span className="panel-help">days</span>
                </div>
              </label>
            </div>
          </article>
        </div>

        <div className="panel" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', margin: 0 }}>
          <label className="checkbox-label" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={advancedMode} onChange={(e) => setAdvancedMode(e.target.checked)} disabled={busy} />
            Enable Advanced Cron Expressions
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: advancedMode ? '1fr 1fr' : '200px 200px', gap: '2rem' }}>
            {!advancedMode ? (
              <>
                <label>
                  Scan Frequency
                  <select value={pollIntervalMinutes} onChange={(e) => setPollIntervalMinutes(Number(e.target.value))} disabled={busy}>
                    {[5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
                  </select>
                </label>
                <label>
                  Daily Digest Time
                  <input type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} disabled={busy} />
                </label>
              </>
            ) : (
              <>
                <label>
                  Poll Cron
                  <input value={pollCron} onChange={(e) => setPollCron(e.target.value)} disabled={busy} style={{ fontFamily: 'monospace' }} />
                </label>
                <label>
                  Digest Cron
                  <input value={digestCron} onChange={(e) => setDigestCron(e.target.value)} disabled={busy} style={{ fontFamily: 'monospace' }} />
                </label>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button onClick={saveSettings} disabled={busy} style={{ padding: '0.75rem 2rem' }}>
            {pendingAction === "save" ? "Applying Changes..." : "🚀 Save Global Settings"}
          </button>
        </div>
      </section>

      {/* Maintenance Operations */}
      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>System Operations</h2>
        <div className="actions" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
          <article className="panel highlighted" style={{ margin: 0 }}>
            <h3>Manual Triggers</h3>
            <p className="panel-help" style={{ marginBottom: '1rem' }}>Trigger immediate system actions without waiting for schedule.</p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button disabled={busy} style={{ flex: 1 }} onClick={() => handleAction("sync", async () => { const res = await apiClient.runSync(); setMessage({ text: `Sync Ok: Scanned ${res.stats.scanned} IDs`, type: 'ok' }); })}>Run Sync</button>
              <button className="button-secondary" disabled={busy} style={{ flex: 1 }} onClick={() => handleAction("digest", async () => { await apiClient.sendDigest(); setMessage({ text: "Digest sent.", type: 'ok' }); })}>Send Digest</button>
            </div>
          </article>

          <article className="panel highlighted" style={{ margin: 0, borderLeft: '4px solid #ef4444' }}>
            <h3 style={{ color: '#ef4444' }}>Danger Zone</h3>
            <p className="panel-help" style={{ marginBottom: '1rem' }}>Erase all application data and rebuild from Gmail inbox.</p>
            <button className="danger" disabled={busy} style={{ width: '100%' }} onClick={() => handleAction("reset_sync", async () => { if (confirm("This will erase ALL tracked applications. Continue?")) { await apiClient.resetAndSync(); load(); setMessage({ text: "System fully reset and synchronized.", type: 'ok' }); } })}>
              Reset & Full Re-sync
            </button>
          </article>
        </div>
      </section>
    </div>
  );
};
