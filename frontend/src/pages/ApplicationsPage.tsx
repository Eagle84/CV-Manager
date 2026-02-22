import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/api.ts";
import type { ApplicationDetail, ApplicationSummary } from "shared";

const statuses = ["submitted", "received", "interview", "assessment", "offer", "rejected", "withdrawn"];

type InferredDecision = "approved" | "rejected" | "pending";

const APPROVED_KEYWORDS = [
  "approved",
  "selected",
  "accepted",
  "offer",
  "moving forward with your application",
  "pleased to inform",
];

const REJECTED_KEYWORDS = [
  "rejected",
  "not selected",
  "not moving forward",
  "regret to inform",
  "declined",
  "position has been filled",
  "unfortunately",
];

const toPlainEmailText = (bodyText: string, bodyHtml: string): string => {
  if (bodyText.trim().length > 0) {
    return bodyText.trim();
  }

  return bodyHtml
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
};

const inferDecision = (classification: string, text: string): InferredDecision => {
  const normalized = text.toLowerCase();

  if (classification === "rejected" || REJECTED_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "rejected";
  }

  if (classification === "offer" || APPROVED_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "approved";
  }

  return "pending";
};

const getDecisionLabel = (decision: InferredDecision): string => {
  if (decision === "approved") {
    return "Approved";
  }
  if (decision === "rejected") {
    return "Rejected";
  }
  return "Pending Review";
};

export const ApplicationsPage = () => {
  const [items, setItems] = useState<ApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [company, setCompany] = useState("");
  const [domain, setDomain] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [statusGroup, setStatusGroup] = useState<"active" | "closed" | "">("active");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [hideUnknownRole, setHideUnknownRole] = useState(true);
  const [hasNotes, setHasNotes] = useState(false);
  const [manualOnly, setManualOnly] = useState(false);
  const [notes, setNotes] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = async () => {
    try {
      setLoadingList(true);
      setError(null);
      setMessage(null);
      const result = await apiClient.fetchApplications({
        company: company || undefined,
        domain: domain || undefined,
        role: role || undefined,
        status: status || undefined,
        statusGroup: statusGroup || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        hideUnknownRole,
        hasNotes,
        manualOnly,
      });
      // Filter out applications that are not real job applications (e.g., meetups, events, unknown-role)
      const filteredItems = result.filter((item) => {
        const title = item.roleTitle?.toLowerCase() || "";
        const company = item.companyName?.toLowerCase() || "";
        if (
          title.includes("meetup") ||
          title.includes("event") ||
          title.includes("thank you") ||
          title.includes("unknown-role") ||
          company.includes("meetup") ||
          company.includes("event") ||
          company.includes("thank you")
        ) {
          return false;
        }
        return true;
      });
      setItems(filteredItems);
      if (filteredItems.length && !selectedId) {
        setSelectedId(filteredItems[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
    } finally {
      setLoadingList(false);
    }
  };

  const loadDetail = async (id: string) => {
    try {
      setLoadingDetail(true);
      const response = await apiClient.fetchApplicationDetail(id);
      setDetail(response);
      setNotes(response.notes);
    } finally {
      setLoadingDetail(false);
    }
  };

  const saveChanges = async () => {
    if (!selectedId) {
      return;
    }
    try {
      setSaving(true);
      setError(null);
      await apiClient.patchApplication(selectedId, {
        notes,
        status: detail?.status,
        manualStatusLocked: true,
      });
      await Promise.all([loadList(), loadDetail(selectedId)]);
      setMessage("Application updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    }
  }, [selectedId]);

  const clearFilters = async () => {
    try {
      setCompany("");
      setDomain("");
      setRole("");
      setStatus("");
      setStatusGroup("active");
      setDateFrom("");
      setDateTo("");
      setHideUnknownRole(true);
      setHasNotes(false);
      setManualOnly(false);
      setSelectedId(null);
      setLoadingList(true);
      setError(null);
      const result = await apiClient.fetchApplications({ statusGroup: "active", hideUnknownRole: true });
      setItems(result);
      if (result.length > 0) {
        setSelectedId(result[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear filters");
    } finally {
      setLoadingList(false);
    }
  };

  return (
    <div className="split-layout">
      <section className="panel">
        <div className="panel-header">
          <h2>Applications</h2>
          <button onClick={() => void loadList()} disabled={loadingList}>
            {loadingList ? <span className="btn-inline"><span className="spinner" />Refreshing...</span> : "Refresh"}
          </button>
        </div>
        <p className="panel-help">
          Use status/date filters to remove noise. Default view shows active pipeline and hides unknown roles.
        </p>

        <div className="filters">
          <label>
            Company
            <input placeholder="Company or domain" value={company} onChange={(event) => setCompany(event.target.value)} />
          </label>
          <label>
            Sender domain
            <input placeholder="example.com" value={domain} onChange={(event) => setDomain(event.target.value)} />
          </label>
          <label>
            Role
            <input placeholder="Role title" value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
          <label>
            Status group
            <select value={statusGroup} onChange={(event) => setStatusGroup(event.target.value as "active" | "closed" | "")}>
              <option value="">All groups</option>
              <option value="active">Active pipeline</option>
              <option value="closed">Closed outcomes</option>
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              {statuses.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </label>
          <label>
            From date
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            To date
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hideUnknownRole}
              onChange={(event) => setHideUnknownRole(event.target.checked)}
            />
            Hide unknown roles
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={hasNotes}
              onChange={(event) => setHasNotes(event.target.checked)}
            />
            Notes only
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={manualOnly}
              onChange={(event) => setManualOnly(event.target.checked)}
            />
            Manual overrides only
          </label>
          <div className="filters-actions">
            <button onClick={() => void loadList()} disabled={loadingList}>
              {loadingList ? <span className="btn-inline"><span className="spinner" />Applying...</span> : "Apply"}
            </button>
            <button className="secondary" onClick={() => void clearFilters()} disabled={loadingList}>
              Clear
            </button>
          </div>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="ok-text">{message}</p> : null}
        <p className="list-meta">{items.length} result(s)</p>

        <ul className="application-list">
          {items.map((item) => (
            <li
              key={item.id}
              className={selectedId === item.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              <div>
                <strong>{item.roleTitle}</strong>
                <p>{item.companyName}</p>
              </div>
              <div>
                <span className={`chip chip-${item.status}`}>{item.status}</span>
                <small>Updated {dayjs(item.lastActivityAt).format("YYYY-MM-DD")}</small>
              </div>
            </li>
          ))}
          {items.length === 0 ? <li className="list-empty">No applications match your filters.</li> : null}
        </ul>
      </section>

      <section className="panel">
        {loadingDetail ? (
          <p><span className="btn-inline"><span className="spinner spinner-dark" />Loading details...</span></p>
        ) : !detail ? <p>Select an application to view details.</p> : (
          <>
            <div className="panel-header">
              <div>
                <h2>{detail.roleTitle}</h2>
                <p className="panel-help">{detail.companyName}</p>
              </div>
              <span className="domain-pill">{detail.companyDomain}</span>
            </div>
            <p className="panel-help">
              First seen {dayjs(detail.firstSeenAt).format("YYYY-MM-DD")} | Last activity {dayjs(detail.lastActivityAt).format("YYYY-MM-DD")}
            </p>

            <div className="detail-grid">
              <label>
                Status
                <select
                  value={detail.status}
                  onChange={(event) => setDetail({ ...detail, status: event.target.value as ApplicationDetail["status"] })}
                >
                  {statuses.map((entry) => (
                    <option key={entry} value={entry}>{entry}</option>
                  ))}
                </select>
              </label>
              <label>
                Role
                <input value={detail.roleTitle} readOnly />
              </label>
            </div>

            <label className="notes-box">
              Notes
              <textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>

            <button onClick={() => void saveChanges()} disabled={saving}>
              {saving ? <span className="btn-inline"><span className="spinner" />Saving...</span> : "Save Manual Override"}
            </button>

            <h3>Timeline</h3>
            <ul className="timeline">
              {detail.events.map((event) => (
                <li key={event.id}>
                  <strong>{event.eventType}</strong>
                  <span>{dayjs(event.eventAt).format("YYYY-MM-DD HH:mm")}</span>
                </li>
              ))}
              {detail.events.length === 0 ? <li>No events yet.</li> : null}
            </ul>

            <h3>Related Emails</h3>
            <p className="panel-help">
              Email content is shown below with an inferred decision from text: Approved, Rejected, or Pending.
            </p>
            <ul className="email-list">
              {detail.emails.map((email) => {
                const plainText = toPlainEmailText(email.bodyText, email.bodyHtml);
                const decision = inferDecision(email.classification, `${email.subject}\n${plainText}`);
                const emailDate = email.receivedAt ?? email.sentAt;

                return (
                  <li key={email.id} className="email-card">
                    <div className="email-card-head">
                      <strong>{email.subject || "(No subject)"}</strong>
                      <span className={`decision-chip decision-${decision}`}>{getDecisionLabel(decision)}</span>
                    </div>
                    <p className="email-meta">
                      From {email.fromEmail || "unknown"} to {email.toEmail || "unknown"}{" "}
                      {emailDate ? `| ${dayjs(emailDate).format("YYYY-MM-DD HH:mm")}` : ""}
                    </p>
                    <p className="email-meta">Classifier status: <code>{email.classification}</code></p>
                    <details>
                      <summary>View Email Content</summary>
                      <pre className="email-body">{plainText || "No readable content found for this email."}</pre>
                    </details>
                  </li>
                );
              })}
              {detail.emails.length === 0 ? (
                <li className="email-card">No related emails linked to this application yet.</li>
              ) : null}
            </ul>
          </>
        )}
      </section>
    </div>
  );
};
