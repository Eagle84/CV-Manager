import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient, type CompanyOverviewDto, type CompanyOverviewPosition } from "../lib/api.ts";

const flowStages = ["submitted", "received", "interview", "assessment", "offer"];

const getStageIndex = (status: string): number => {
  if (status === "submitted") return 0;
  if (status === "received") return 1;
  if (status === "interview") return 2;
  if (status === "assessment") return 3;
  if (status === "offer") return 4;
  if (status === "rejected" || status === "withdrawn") return 4;
  return 0;
};

const getTerminalLabel = (status: string): string | null => {
  if (status === "rejected") return "Rejected";
  if (status === "withdrawn") return "Withdrawn";
  if (status === "offer") return "Offer";
  return null;
};

const PositionFlow = ({ item }: { item: CompanyOverviewPosition }) => {
  const activeIndex = getStageIndex(item.status);
  const terminal = getTerminalLabel(item.status);

  return (
    <div className="position-flow">
      <div className="flow-track">
        {flowStages.map((stage, index) => {
          const isReached = index <= activeIndex;
          const isCurrent = stage === item.status || (index === activeIndex && (item.status === "rejected" || item.status === "withdrawn"));
          return (
            <div key={`${item.id}-${stage}`} className={`flow-stage ${isReached ? "reached" : ""} ${isCurrent ? "current" : ""}`}>
              <span className="flow-dot" />
              <span className="flow-label">{stage}</span>
            </div>
          );
        })}
      </div>
      <div className="flow-terminal">
        <span className={`chip chip-${item.status}`}>{item.status}</span>
        {terminal && item.status !== "offer" ? <span className="terminal-note">{terminal} process</span> : null}
      </div>
    </div>
  );
};

export const CompanyOverviewPage = () => {
  const navigate = useNavigate();
  const { companyDomain } = useParams();
  const [data, setData] = useState<CompanyOverviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!companyDomain) {
      setError("Missing company domain");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.fetchCompanyOverview(companyDomain);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load company overview");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [companyDomain]);

  const topStatuses = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.statusCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([, count]) => count > 0);
  }, [data]);

  if (loading && !data) {
    return <section className="panel">Loading company overview...</section>;
  }

  if (error && !data) {
    return (
      <section className="panel">
        <p className="error-text">{error}</p>
        <div className="actions">
          <button onClick={() => navigate("/dashboard")}>Back to Dashboard</button>
          <button className="secondary" onClick={() => void load()}>Retry</button>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel">
        <p>No company data available.</p>
      </section>
    );
  }

  return (
    <section className="page-grid">
      <article className="panel">
        <div className="panel-header">
          <h2>{data.companyName}</h2>
          <div className="actions">
            <button className="secondary" onClick={() => navigate("/dashboard")}>Back</button>
            <button onClick={() => void load()} disabled={loading}>
              {loading ? <span className="btn-inline"><span className="spinner" />Refreshing...</span> : "Refresh"}
            </button>
          </div>
        </div>
        <p className="panel-help">
          Company domain: <code>{data.companyDomain}</code> | First seen {dayjs(data.firstSeenAt).format("YYYY-MM-DD")} |
          Last activity {dayjs(data.lastActivityAt).format("YYYY-MM-DD")}
        </p>
        <div className="status-grid">
          <article className="status-card">
            <p>Website</p>
            <strong>
              {data.profile.websiteUrl ? (
                <a href={data.profile.websiteUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : (
                "Not found"
              )}
            </strong>
          </article>
          <article className="status-card">
            <p>Careers page</p>
            <strong>
              {data.profile.careersUrl ? (
                <a href={data.profile.careersUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : (
                "Not found"
              )}
            </strong>
          </article>
          <article className="status-card">
            <p>Profile source</p>
            <strong>{data.profile.sourceDomain || "n/a"}</strong>
          </article>
        </div>
        {data.profile.pageTitle ? <p className="panel-help">Page title: {data.profile.pageTitle}</p> : null}
        {data.profile.pageDescription ? <p className="panel-help">About: {data.profile.pageDescription}</p> : null}
        <div className="stats-highlight-grid">
          <article className="stat-highlight">
            <p>Total positions</p>
            <strong>{data.totalApplications}</strong>
          </article>
          <article className="stat-highlight">
            <p>Active positions</p>
            <strong>{data.activeApplications}</strong>
          </article>
          <article className="stat-highlight">
            <p>Closed positions</p>
            <strong>{data.closedApplications}</strong>
          </article>
        </div>
        <div className="stats-highlight-grid">
          <article className="stat-highlight">
            <p>Response rate</p>
            <strong>{data.insights.responseRate}%</strong>
          </article>
          <article className="stat-highlight">
            <p>Decision rate</p>
            <strong>{data.insights.decisionRate}%</strong>
          </article>
          <article className="stat-highlight">
            <p>Tracked emails</p>
            <strong>{data.insights.emailsTracked}</strong>
          </article>
        </div>
        <p className="panel-help">
          Unique roles: {data.insights.uniqueRoles} | Inbound emails: {data.insights.inboundEmails} | Last incoming:{" "}
          {data.insights.lastIncomingEmailAt
            ? dayjs(data.insights.lastIncomingEmailAt).format("YYYY-MM-DD HH:mm")
            : "N/A"}
        </p>
        {data.insights.topSenderDomains.length > 0 ? (
          <p className="panel-help">
            Top sender domains: {data.insights.topSenderDomains.join(", ")}
          </p>
        ) : null}
        <div className="status-grid">
          {topStatuses.map(([status, count]) => (
            <article key={status} className="status-card">
              <p>{status}</p>
              <strong>{count}</strong>
            </article>
          ))}
        </div>
      </article>

      <article className="panel">
        <h3>Positions & Process</h3>
        <p className="panel-help">
          Click any position in Applications for deeper email timeline. Flow chart shows stage progression.
          Grouped by sender+subject.
        </p>
        <ul className="company-position-list">
          {data.positions.map((position) => (
            <li key={position.id} className="company-position-card">
              <div className="company-position-header">
                <div>
                  <strong>{position.roleTitle}</strong>
                  <p>
                    Updated {dayjs(position.lastActivityAt).format("YYYY-MM-DD")} | First seen {dayjs(position.firstSeenAt).format("YYYY-MM-DD")}
                  </p>
                </div>
                <span className={`chip chip-${position.status}`}>{position.status}</span>
              </div>
              <PositionFlow item={position} />
              <div className="company-position-meta">
                <span>Manual lock: {position.manualStatusLocked ? "Yes" : "No"}</span>
                <span>Next follow-up: {position.nextFollowupAt ? dayjs(position.nextFollowupAt).format("YYYY-MM-DD") : "None"}</span>
              </div>
              <p className="panel-help">
                Group key: <code>{position.groupSenderDomain || "unknown-domain"}</code> +{" "}
                <code>{position.groupSubjectKey || "unknown-subject"}</code>
              </p>
              {position.latestEmail ? (
                <p className="panel-help">
                  Latest email: <strong>{position.latestEmail.subject || "(No subject)"}</strong> ({position.latestEmail.classification})
                </p>
              ) : null}
              {position.latestEvent ? (
                <p className="panel-help">
                  Latest event: {position.latestEvent.eventType} at {dayjs(position.latestEvent.eventAt).format("YYYY-MM-DD HH:mm")}
                </p>
              ) : null}
              {position.notes ? <p className="company-position-notes">{position.notes}</p> : null}
            </li>
          ))}
          {data.positions.length === 0 ? <li className="company-position-card">No positions found for this company.</li> : null}
        </ul>
      </article>
    </section>
  );
};
