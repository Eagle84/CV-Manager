import { useState } from "react";
import { apiClient } from "../lib/api.ts";
import type { DuplicateCheckResponse } from "shared";

export const DuplicateCheckPage = () => {
  const [companyDomain, setCompanyDomain] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [result, setResult] = useState<DuplicateCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.checkDuplicate(companyDomain, roleTitle);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel max-narrow">
      <h2>Duplicate Guard</h2>
      <p className="panel-help">Check company domain + role before sending a CV.</p>

      <div className="form-grid">
        <label>
          Company domain
          <input
            placeholder="company.com"
            value={companyDomain}
            onChange={(event) => setCompanyDomain(event.target.value)}
          />
        </label>

        <label>
          Role title
          <input
            placeholder="Software Engineer"
            value={roleTitle}
            onChange={(event) => setRoleTitle(event.target.value)}
          />
        </label>
      </div>

      <button onClick={() => void handleCheck()} disabled={loading}>
        {loading ? <span className="btn-inline"><span className="spinner" />Checking...</span> : "Check Duplicate"}
      </button>

      {error ? <p className="error-text">{error}</p> : null}
      {result ? (
        <article className={`result ${result.exists ? "danger" : "safe"}`}>
          <h3>{result.exists ? "Duplicate detected" : "No duplicate found"}</h3>
          <p className="result-key">Key: <code>{result.key}</code></p>
          {result.matchedApplication ? (
            <p>
              Existing: {result.matchedApplication.companyName} | {result.matchedApplication.roleTitle} |
              {" "}{result.matchedApplication.status}
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
};
