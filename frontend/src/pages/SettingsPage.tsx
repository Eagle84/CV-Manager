import { useEffect, useState } from "react";
import axios from "axios";
import { apiClient, type SettingsDto } from "../lib/api.ts";

type PendingAction = "connect" | "disconnect" | "save" | "sync" | "digest" | "reset_sync" | null;

const schedulePresets = [
  {
    label: "High activity",
    description: "Poll every 5 minutes, digest at 08:00.",
    pollMinutes: 5,
    digestTime: "08:00",
  },
  {
    label: "Balanced (recommended)",
    description: "Poll every 15 minutes, digest at 09:00.",
    pollMinutes: 15,
    digestTime: "09:00",
  },
  {
    label: "Light usage",
    description: "Poll every 30 minutes, digest at 10:00.",
    pollMinutes: 30,
    digestTime: "10:00",
  },
];

const parsePollCron = (value: string): number | null => {
  if (value.trim() === "0 * * * *") {
    return 60;
  }

  const everyMinutes = value.match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  if (!everyMinutes) {
    return null;
  }

  const minutes = Number(everyMinutes[1]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    return null;
  }

  return minutes;
};

const parseDigestCron = (value: string): string | null => {
  const match = value.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!match) {
    return null;
  }

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
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return "0 9 * * *";
  }
  return `${minute} ${hour} * * *`;
};

export const SettingsPage = () => {
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(15);
  const [digestTime, setDigestTime] = useState("09:00");
  const [pollCron, setPollCron] = useState("*/15 * * * *");
  const [digestCron, setDigestCron] = useState("0 9 * * *");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [followupAfterDays, setFollowupAfterDays] = useState(7);
  const [syncLookbackDays, setSyncLookbackDays] = useState(120);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = pendingAction !== null;

  const syncUiFromSettings = (response: SettingsDto) => {
    setSettings(response);
    setFollowupAfterDays(response.followupAfterDays);
    setSyncLookbackDays(response.syncLookbackDays);
    setPollCron(response.pollCron);
    setDigestCron(response.digestCron);

    const parsedPoll = parsePollCron(response.pollCron);
    const parsedDigest = parseDigestCron(response.digestCron);
    if (parsedPoll && parsedDigest) {
      setPollIntervalMinutes(parsedPoll);
      setDigestTime(parsedDigest);
      setAdvancedMode(false);
      return;
    }

    setAdvancedMode(true);
  };

  const load = async () => {
    try {
      setError(null);
      const response = await apiClient.getSettings();
      syncUiFromSettings(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connectGoogle = async () => {
    try {
      setPendingAction("connect");
      setError(null);
      const url = await apiClient.getGoogleAuthUrl();
      window.location.href = url;
    } catch (err) {
      const apiError =
        axios.isAxiosError<{ error?: string }>(err) && typeof err.response?.data?.error === "string"
          ? err.response.data.error
          : null;
      setError(apiError ?? (err instanceof Error ? err.message : "Failed to start Google login"));
    } finally {
      setPendingAction(null);
    }
  };

  const disconnectGoogle = async () => {
    try {
      setPendingAction("disconnect");
      setError(null);
      await apiClient.disconnectGoogle();
      await load();
      setMessage("Disconnected Gmail account.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Gmail account");
    } finally {
      setPendingAction(null);
    }
  };

  const saveSettings = async () => {
    try {
      setPendingAction("save");
      setError(null);

      const finalPollCron = advancedMode ? pollCron : toPollCron(pollIntervalMinutes);
      const finalDigestCron = advancedMode ? digestCron : toDigestCron(digestTime);

      const updated = await apiClient.updateSettings({
        pollCron: finalPollCron,
        digestCron: finalDigestCron,
        followupAfterDays,
        syncLookbackDays,
      });
      syncUiFromSettings(updated);
      setMessage("Settings updated and scheduler reloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setPendingAction(null);
    }
  };

  const runSync = async () => {
    try {
      setPendingAction("sync");
      setError(null);
      const response = await apiClient.runSync();
      setMessage(
        response.ok
          ? `Sync complete: scanned ${response.stats.scanned}, imported ${response.stats.importedEmails}, apps ${response.stats.applicationsCreatedOrUpdated}, updates ${response.stats.statusesUpdated}, AI ${response.stats.aiProcessed}, fallback ${response.stats.aiFallbackUsed}, skipped ${response.stats.aiSkipped}${response.reason ? ` | ${response.reason}` : ""}`
          : response.reason ?? "Sync failed",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setPendingAction(null);
    }
  };

  const sendDigest = async () => {
    try {
      setPendingAction("digest");
      setError(null);
      const response = await apiClient.sendDigest();
      setMessage(response.sent ? "Digest sent." : response.reason ?? "Digest send failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Digest send failed");
    } finally {
      setPendingAction(null);
    }
  };

  const resetAndSync = async () => {
    try {
      setPendingAction("reset_sync");
      setError(null);
      const response = await apiClient.resetAndSync();
      if (!response.ok) {
        setError(response.reason ?? "Reset and sync failed");
        return;
      }

      setMessage(
        `Data erased: ${response.reset.applicationsDeleted} applications, ${response.reset.emailsDeleted} emails. ` +
          `Sync imported ${response.sync.stats.importedEmails} emails (AI ${response.sync.stats.aiProcessed}, fallback ${response.sync.stats.aiFallbackUsed})${response.sync.reason ? ` | ${response.sync.reason}` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset and sync failed");
    } finally {
      setPendingAction(null);
    }
  };

  const applyPreset = (pollMinutes: number, presetDigestTime: string) => {
    setPollIntervalMinutes(pollMinutes);
    setDigestTime(presetDigestTime);
    setPollCron(toPollCron(pollMinutes));
    setDigestCron(toDigestCron(presetDigestTime));
    setAdvancedMode(false);
    setMessage(`Preset applied: every ${pollMinutes} minutes, digest at ${presetDigestTime}`);
  };

  return (
    <section className="panel max-narrow">
      <h2>Settings</h2>
      <p className="panel-help">Manage Gmail connection, scheduler behavior, and maintenance actions.</p>
      {error ? <p className="error-text">{error}</p> : null}
      {message ? <p className="ok-text">{message}</p> : null}

      <article className="settings-block">
        <h3>Gmail</h3>
        <p>
          Connected account:
          {" "}
          <strong>{settings?.connectedEmail ?? "Not connected"}</strong>
        </p>
        <p className={settings?.connectedEmail ? "ok-text" : "error-text"}>
          {settings?.connectedEmail ? "Status: Connected" : "Status: Not connected"}
        </p>
        <div className="actions">
          <button onClick={() => void connectGoogle()} disabled={busy}>
            {pendingAction === "connect" ? <span className="btn-inline"><span className="spinner" />Connecting...</span> : "Connect Gmail"}
          </button>
          <button className="secondary" onClick={() => void disconnectGoogle()} disabled={busy}>
            {pendingAction === "disconnect" ? <span className="btn-inline"><span className="spinner spinner-dark" />Disconnecting...</span> : "Disconnect"}
          </button>
        </div>
      </article>

      <article className="settings-block">
        <h3>Scheduling</h3>
        <p className="panel-help">Use the picker mode for simple scheduling. Enable advanced mode if you need raw cron.</p>
        <div className="preset-grid">
          {schedulePresets.map((preset) => (
            <button
              key={preset.label}
              className="secondary"
              onClick={() => applyPreset(preset.pollMinutes, preset.digestTime)}
              disabled={busy}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <ul className="preset-list">
          {schedulePresets.map((preset) => (
            <li key={`${preset.label}-desc`}>
              <strong>{preset.label}:</strong> {preset.description}
            </li>
          ))}
        </ul>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={advancedMode}
            onChange={(event) => setAdvancedMode(event.target.checked)}
            disabled={busy}
          />
          Advanced cron mode
        </label>

        {!advancedMode ? (
          <>
            <div className="form-grid">
              <label>
                Poll every
                <select
                  value={pollIntervalMinutes}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setPollIntervalMinutes(next);
                    setPollCron(toPollCron(next));
                  }}
                  disabled={busy}
                >
                  <option value={5}>5 minutes</option>
                  <option value={10}>10 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={20}>20 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>60 minutes</option>
                </select>
              </label>

              <label>
                Digest time
                <input
                  type="time"
                  value={digestTime}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDigestTime(value);
                    setDigestCron(toDigestCron(value));
                  }}
                  disabled={busy}
                />
              </label>
            </div>
            <p className="panel-help">
              Generated cron: <code>{toPollCron(pollIntervalMinutes)}</code> and <code>{toDigestCron(digestTime)}</code>
            </p>
          </>
        ) : (
          <div className="form-grid">
            <label>
              Poll cron
              <input value={pollCron} onChange={(event) => setPollCron(event.target.value)} disabled={busy} />
            </label>
            <label>
              Digest cron
              <input value={digestCron} onChange={(event) => setDigestCron(event.target.value)} disabled={busy} />
            </label>
          </div>
        )}

        <label>
          Follow-up days
          <input
            type="number"
            min={1}
            max={60}
            value={followupAfterDays}
            onChange={(event) => setFollowupAfterDays(Number(event.target.value))}
            disabled={busy}
          />
          <small>How many days after the latest activity before a follow-up is due.</small>
        </label>
        <label>
          Sync lookback days
          <input
            type="number"
            min={1}
            max={3650}
            value={syncLookbackDays}
            onChange={(event) => setSyncLookbackDays(Number(event.target.value))}
            disabled={busy}
          />
          <small>Only sync and keep tracked data from this many recent days.</small>
        </label>
        <button onClick={() => void saveSettings()} disabled={busy}>
          {pendingAction === "save" ? <span className="btn-inline"><span className="spinner" />Saving...</span> : "Save Settings"}
        </button>
      </article>

      <article className="settings-block">
        <h3>Operations</h3>
        <p className="panel-help">Run manual sync, send digest, or erase tracked data and re-sync from Gmail.</p>
        <div className="actions">
          <button onClick={() => void runSync()} disabled={busy}>
            {pendingAction === "sync" ? <span className="btn-inline"><span className="spinner" />Running sync...</span> : "Run Sync Now"}
          </button>
          <button onClick={() => void sendDigest()} disabled={busy}>
            {pendingAction === "digest" ? <span className="btn-inline"><span className="spinner" />Sending...</span> : "Send Digest Now"}
          </button>
          <button className="danger" onClick={() => void resetAndSync()} disabled={busy}>
            {pendingAction === "reset_sync" ? (
              <span className="btn-inline"><span className="spinner" />Resetting + syncing...</span>
            ) : (
              "Erase Data + Sync Again"
            )}
          </button>
        </div>
      </article>
    </section>
  );
};
