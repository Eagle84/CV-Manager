import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiClient, type FollowupItem } from "../lib/api.ts";
import type { DashboardSummary } from "shared";

const statusOrder = ["submitted", "received", "interview", "assessment", "offer", "rejected", "withdrawn"];

export const DashboardPage = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [followups, setFollowups] = useState<FollowupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [dashboard, tasks] = await Promise.all([
        apiClient.fetchDashboard(),
        apiClient.fetchFollowups(),
      ]);
      setSummary(dashboard);
      setFollowups(tasks.slice(0, 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  if (loading && !summary) {
    return <div className="panel">Loading dashboard...</div>;
  }

  if (error) {
    return (
      <div className="panel">
        <p className="error-text">{error}</p>
        <button onClick={() => void loadData()}>Retry</button>
      </div>
    );
  }

  const totalApplications = summary?.totalApplications ?? 0;
  const followupsDue = summary?.followupsDue ?? 0;
  const openPipeline =
    (summary?.statusCounts.submitted ?? 0) +
    (summary?.statusCounts.received ?? 0) +
    (summary?.statusCounts.interview ?? 0) +
    (summary?.statusCounts.assessment ?? 0);

  const completeTask = async (taskId: string) => {
    try {
      setCompletingTaskId(taskId);
      await apiClient.completeFollowup(taskId);
      await loadData();
    } finally {
      setCompletingTaskId(null);
    }
  };

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>Pipeline Overview</h2>
          <button onClick={() => void loadData()} disabled={loading}>
            {loading ? <span className="btn-inline"><span className="spinner" />Refreshing...</span> : "Refresh"}
          </button>
        </div>
        <p className="panel-help">A quick snapshot of where active applications currently stand.</p>
        <div className="stats-highlight-grid">
          <article className="stat-highlight">
            <p>Total applications</p>
            <strong>{totalApplications}</strong>
          </article>
          <article className="stat-highlight">
            <p>Active pipeline</p>
            <strong>{openPipeline}</strong>
          </article>
          <article className="stat-highlight">
            <p>Follow-ups due</p>
            <strong>{followupsDue}</strong>
          </article>
        </div>
        <div className="status-grid">
          {statusOrder.map((status) => (
            <article key={status} className="status-card">
              <p>{status}</p>
              <strong>{summary?.statusCounts[status as keyof DashboardSummary["statusCounts"]] ?? 0}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Recent Applications</h2>
        <p className="panel-help">Latest activity across companies and roles.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.recentApplications ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.companyName}</td>
                  <td>{item.roleTitle}</td>
                  <td><span className={`chip chip-${item.status}`}>{item.status}</span></td>
                  <td>{dayjs(item.lastActivityAt).format("YYYY-MM-DD")}</td>
                </tr>
              ))}
              {(summary?.recentApplications ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4}>No applications available yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Follow-ups Due</h2>
        <p className="panel-help">Mark tasks done once you send a follow-up email.</p>
        <ul className="task-list">
          {followups.map((task) => (
            <li key={task.id}>
              <div>
                <button
                  className="link-button"
                  onClick={() => navigate(`/companies/${encodeURIComponent(task.application.companyDomain)}`)}
                >
                  {task.application.companyName}
                </button>
                <p>{task.application.roleTitle}</p>
                <small>{task.reason}</small>
              </div>
              <div>
                <span>{dayjs(task.dueAt).format("YYYY-MM-DD")}</span>
                <button onClick={() => void completeTask(task.id)} disabled={completingTaskId === task.id}>
                  {completingTaskId === task.id ? <span className="btn-inline"><span className="spinner" />Saving...</span> : "Done"}
                </button>
              </div>
            </li>
          ))}
          {followups.length === 0 ? <li>No pending follow-ups.</li> : null}
        </ul>
      </section>
    </div>
  );
};
