import { useEffect, useState } from "react";
import axios from "axios";
import { apiClient, type SettingsDto } from "../lib/api.ts";

type PendingAction = "save" | "sync" | "digest" | "reset_sync" | null;

const schedulePresets = [
  { label: "High activity", pollMinutes: 5, digestTime: "08:00" },
  { label: "Balanced", pollMinutes: 15, digestTime: "09:00" },
  { label: "Light usage", pollMinutes: 30, digestTime: "10:00" },
];

const parsePollCron = (value: string): number | null => {
  if (value.trim() === "0 * * * *") return 60;
  const everyMinutes = value.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (!everyMinutes) return null;
  const minutes = Number(everyMinutes[1]);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 60 ? minutes : null;
};

const parseDigestCron = (value: string): string | null => {
  const match = value.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const toPollCron = (minutes: number): string => (minutes === 60 ? "0 * * * *" : `*/${minutes} * * * *`);
const toDigestCron = (timeValue: string): string => {
  const [hour, minute] = timeValue.split(":").map((part) => Number(part));
  return `${minute || 0} ${hour || 9} * * *`;
};

const friendlyError = (err: unknown): string => {
  const apiError = axios.isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
  if (apiError) return apiError;
  if (err instanceof Error) return err.message;
  return "Action failed";
};

export const SettingsPage = () => {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(15);
  const [digestTime, setDigestTime] = useState("09:00");
  const [pollCron, setPollCron] = useState("*/15 * * * *");
  const [digestCron, setDigestCron] = useState("0 9 * * *");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [followupAfterDays, setFollowupAfterDays] = useState(7);
  const [syncFromDate, setSyncFromDate] = useState<string | null>(null);
  const [modelEmail, setModelEmail] = useState("");
  const [modelCv, setModelCv] = useState("");
  const [modelMatcher, setModelMatcher] = useState("");
  const [modelExplorer, setModelExplorer] = useState("");
  const [modelClassification, setModelClassification] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncJobId, setSyncJobId] = useState<string | null>(null);

  const busy = pendingAction !== null;

  const syncUiFromSettings = (response: SettingsDto) => {
    setFollowupAfterDays(response.followupAfterDays);
    setSyncFromDate(response.syncFromDate);
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
      const [settingsRes, modelsRes] = await Promise.all([apiClient.getSettings(), apiClient.getOllamaModels()]);
      syncUiFromSettings(settingsRes);
      setOllamaModels(modelsRes);
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!syncJobId) return;

    const interval = setInterval(async () => {
      try {
        const job = await apiClient.getSyncJobStatus(syncJobId);
        if (job.status === "running") return;

        clearInterval(interval);
        setSyncJobId(null);
        setPendingAction(null);

        if (job.status === "done") {
          const result = job.result as any;
          const stats = result?.stats ?? result?.sync?.stats;
          const scanned = stats?.scanned ?? "?";
          const updated = stats?.applicationsCreatedOrUpdated ?? "?";
          setMessage({ text: `Sync complete: ${scanned} emails scanned, ${updated} applications updated.`, type: "ok" });
          if (job.type === "reset-and-sync") void load();
          return;
        }

        setError(job.error ?? "Sync failed");
      } catch (err) {
        clearInterval(interval);
        setSyncJobId(null);
        setPendingAction(null);
        setError(friendlyError(err));
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [syncJobId]);

  const runAction = async (action: PendingAction, fn: () => Promise<void>) => {
    try {
      setPendingAction(action);
      setError(null);
      setMessage(null);
      await fn();
      if (action !== "sync" && action !== "reset_sync") {
        setPendingAction(null);
      }
    } catch (err) {
      setPendingAction(null);
      setError(friendlyError(err));
    }
  };

  const saveSettings = () =>
    runAction("save", async () => {
      const finalPollCron = advancedMode ? pollCron : toPollCron(pollIntervalMinutes);
      const finalDigestCron = advancedMode ? digestCron : toDigestCron(digestTime);
      const updated = await apiClient.updateSettings({
        pollCron: finalPollCron,
        digestCron: finalDigestCron,
        followupAfterDays,
        syncFromDate,
        modelEmail,
        modelCv,
        modelMatcher,
        modelExplorer,
        modelClassification,
      });
      syncUiFromSettings(updated);
      setMessage({ text: "Settings saved.", type: "ok" });
    });

  const startSync = () =>
    runAction("sync", async () => {
      const { jobId } = await apiClient.runSync();
      setSyncJobId(jobId);
      setMessage({ text: "Sync started in background.", type: "ok" });
    });

  const sendDigest = () =>
    runAction("digest", async () => {
      await apiClient.sendDigest();
      setMessage({ text: "Digest sent.", type: "ok" });
    });

  const resetAndSync = () =>
    runAction("reset_sync", async () => {
      if (!confirm("This will erase tracked applications and rebuild from Gmail. Continue?")) {
        return;
      }
      const { jobId } = await apiClient.resetAndSync();
      setSyncJobId(jobId);
      setMessage({ text: "Reset + sync started in background.", type: "ok" });
    });

  const modelOptions = (currentValue: string) => (
    <>
      {ollamaModels.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
      {!ollamaModels.includes(currentValue) && currentValue ? <option value={currentValue}>{currentValue}</option> : null}
    </>
  );

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>Settings</h2>
          <button onClick={saveSettings} disabled={busy}>
            {pendingAction === "save" ? "Saving..." : "Save"}
          </button>
        </div>
        <p className="panel-help">Control schedule, models, and maintenance actions from one place.</p>
        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className={message.type === "ok" ? "ok-text" : "error-text"}>{message.text}</p> : null}
      </section>

      <section className="panel">
        <h3>Schedule</h3>
        <div className="preset-grid">
          {schedulePresets.map((preset) => (
            <button
              key={preset.label}
              className="secondary"
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

        <div className="settings-grid">
          <label>
            Follow-up after (days)
            <input
              type="number"
              value={followupAfterDays}
              onChange={(e) => setFollowupAfterDays(Number(e.target.value))}
              disabled={busy}
              min={1}
              max={60}
            />
          </label>
          <label>
            Sync start date
            <input type="date" value={syncFromDate || ""} onChange={(e) => setSyncFromDate(e.target.value || null)} disabled={busy} />
          </label>
        </div>

        <label className="checkbox-label">
          <input type="checkbox" checked={advancedMode} onChange={(e) => setAdvancedMode(e.target.checked)} disabled={busy} />
          Advanced cron mode
        </label>

        {!advancedMode ? (
          <div className="settings-grid">
            <label>
              Poll frequency
              <select value={pollIntervalMinutes} onChange={(e) => setPollIntervalMinutes(Number(e.target.value))} disabled={busy}>
                {[5, 10, 15, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    Every {minutes} min
                  </option>
                ))}
              </select>
            </label>
            <label>
              Daily digest time
              <input type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} disabled={busy} />
            </label>
          </div>
        ) : (
          <div className="settings-grid">
            <label>
              Poll cron
              <input value={pollCron} onChange={(e) => setPollCron(e.target.value)} disabled={busy} />
            </label>
            <label>
              Digest cron
              <input value={digestCron} onChange={(e) => setDigestCron(e.target.value)} disabled={busy} />
            </label>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>AI Models</h3>
        <div className="settings-grid">
          <label>
            Email extractor
            <select value={modelEmail} onChange={(e) => setModelEmail(e.target.value)} disabled={busy}>
              {modelOptions(modelEmail)}
            </select>
          </label>
          <label>
            CV processor
            <select value={modelCv} onChange={(e) => setModelCv(e.target.value)} disabled={busy}>
              {modelOptions(modelCv)}
            </select>
          </label>
          <label>
            Job matcher
            <select value={modelMatcher} onChange={(e) => setModelMatcher(e.target.value)} disabled={busy}>
              {modelOptions(modelMatcher)}
            </select>
          </label>
          <label>
            Job explorer
            <select value={modelExplorer} onChange={(e) => setModelExplorer(e.target.value)} disabled={busy}>
              {modelOptions(modelExplorer)}
            </select>
          </label>
          <label>
            Company classifier
            <select value={modelClassification} onChange={(e) => setModelClassification(e.target.value)} disabled={busy}>
              {modelOptions(modelClassification)}
            </select>
          </label>
        </div>
      </section>

      <section className="panel">
        <h3>Operations</h3>
        <p className="panel-help">Run immediate actions when you do not want to wait for schedule.</p>
        <div className="actions">
          <button onClick={startSync} disabled={busy}>
            {pendingAction === "sync" ? "Running sync..." : "Run Sync"}
          </button>
          <button className="secondary" onClick={sendDigest} disabled={busy}>
            {pendingAction === "digest" ? "Sending..." : "Send Digest"}
          </button>
          <button className="danger" onClick={resetAndSync} disabled={busy}>
            {pendingAction === "reset_sync" ? "Resetting..." : "Reset + Full Sync"}
          </button>
        </div>
      </section>
    </div>
  );
};
