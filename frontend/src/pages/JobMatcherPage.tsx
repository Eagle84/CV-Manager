import { useEffect, useRef, useState } from "react";
import { apiClient, type BatchJob, type JobAnalysisResult, type TargetCompanyDto } from "../lib/api.ts";

const STORAGE_KEYS = {
  URL: "job_matcher_url",
  RESULT: "job_matcher_result",
  DISCOVERED: "job_matcher_discovered",
};

interface CsvRow {
  url: string;
  company: string;
  selected: boolean;
}

const ITEMS_PER_PAGE = 10;

const getScoreColor = (score: number) => {
  if (score >= 75) return "var(--safe)";
  if (score >= 50) return "var(--accent-2)";
  return "var(--danger)";
};

export const JobMatcherPage = () => {
  const [activeTab, setActiveTab] = useState<"library" | "match" | "discover">("library");
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEYS.URL) || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<JobAnalysisResult | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RESULT);
    return saved ? JSON.parse(saved) : null;
  });
  const [discoveredJobs, setDiscoveredJobs] = useState<{ title: string; url: string; reasoning: string }[] | null>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.DISCOVERED);
    return saved ? JSON.parse(saved) : null;
  });

  const [showImporter, setShowImporter] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [detectedCols, setDetectedCols] = useState<{ url: string; company: string | null } | null>(null);
  const [csvPage, setCsvPage] = useState(1);
  const [batchPage, setBatchPage] = useState(1);

  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
  const pollInterval = useRef<number | null>(null);

  const [targetCompanies, setTargetCompanies] = useState<TargetCompanyDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.URL, url);
  }, [url]);

  useEffect(() => {
    if (result) {
      localStorage.setItem(STORAGE_KEYS.RESULT, JSON.stringify(result));
    } else {
      localStorage.removeItem(STORAGE_KEYS.RESULT);
    }
  }, [result]);

  useEffect(() => {
    if (discoveredJobs) {
      localStorage.setItem(STORAGE_KEYS.DISCOVERED, JSON.stringify(discoveredJobs));
    } else {
      localStorage.removeItem(STORAGE_KEYS.DISCOVERED);
    }
  }, [discoveredJobs]);

  const loadHistory = async (requestedPage: number, search?: string) => {
    try {
      setHistoryLoading(true);
      const response = await apiClient.fetchTargetCompanies(requestedPage, ITEMS_PER_PAGE, search);
      setTargetCompanies(response.items);
      setPage(response.page);
      setTotalPages(response.totalPages);
    } catch {
      setError("Failed to load target companies.");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadHistory(1, searchTerm.trim() || undefined);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    void loadHistory(1);
  }, []);

  useEffect(() => {
    if (!activeBatchId) return;

    pollInterval.current = window.setInterval(async () => {
      try {
        const status = await apiClient.getBatchStatus(activeBatchId);
        setBatchJob(status);
        if (status.status === "done") {
          if (pollInterval.current) {
            clearInterval(pollInterval.current);
            pollInterval.current = null;
          }
          void loadHistory(1, searchTerm.trim() || undefined);
        }
      } catch {
        if (pollInterval.current) {
          clearInterval(pollInterval.current);
          pollInterval.current = null;
        }
      }
    }, 3000);

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
        pollInterval.current = null;
      }
    };
  }, [activeBatchId, searchTerm]);

  const clearWorkspace = () => {
    setUrl("");
    setResult(null);
    setDiscoveredJobs(null);
    setError(null);
    setCsvRows([]);
    setDetectedCols(null);
    setShowImporter(false);
    setBatchJob(null);
    setActiveBatchId(null);
    localStorage.removeItem(STORAGE_KEYS.URL);
    localStorage.removeItem(STORAGE_KEYS.RESULT);
    localStorage.removeItem(STORAGE_KEYS.DISCOVERED);
  };

  const handleAction = async (mode: "analyze" | "explore", targetUrl?: string) => {
    const finalUrl = (targetUrl || url).trim();
    if (!finalUrl) return;

    try {
      setLoading(true);
      setError(null);
      if (mode === "analyze") {
        const data = await apiClient.analyzeJobUrl(finalUrl);
        setResult(data);
        setActiveTab("match");
      } else {
        const data = await apiClient.exploreJobsOnPage(finalUrl);
        setDiscoveredJobs(data);
        setActiveTab("discover");
      }
      setUrl(finalUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (readEvent) => {
      const text = (readEvent.target?.result as string) || "";
      if (!text.trim()) return;

      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) return;

      const headers = lines[0].split(",").map((entry) => entry.trim().replace(/^"|"$/g, ""));
      const urlKeywords = ["url", "link", "careers", "website"];
      const companyKeywords = ["company", "name", "organization", "employer"];
      let urlIndex = -1;
      let companyIndex = -1;

      headers.forEach((header, index) => {
        const lower = header.toLowerCase();
        if (urlIndex === -1 && urlKeywords.some((item) => lower.includes(item))) urlIndex = index;
        if (companyIndex === -1 && companyKeywords.some((item) => lower.includes(item))) companyIndex = index;
      });

      if (urlIndex === -1) {
        setError("Could not detect a URL column.");
        return;
      }

      const parsedRows: CsvRow[] = lines
        .slice(1)
        .map((line) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, "")))
        .map((cells) => ({
          url: cells[urlIndex] || "",
          company: companyIndex !== -1 ? cells[companyIndex] || "Unknown" : "Unknown",
          selected: Boolean(cells[urlIndex]),
        }))
        .filter((row) => row.url.startsWith("http"));

      setDetectedCols({
        url: headers[urlIndex],
        company: companyIndex !== -1 ? headers[companyIndex] : null,
      });
      setCsvRows(parsedRows);
      setCsvPage(1);
      setError(null);
    };

    reader.readAsText(file);
  };

  const toggleRow = (index: number) => {
    const updated = [...csvRows];
    updated[index].selected = !updated[index].selected;
    setCsvRows(updated);
  };

  const toggleAll = () => {
    const allSelected = csvRows.length > 0 && csvRows.every((row) => row.selected);
    setCsvRows(csvRows.map((row) => ({ ...row, selected: !allSelected })));
  };

  const selectedRows = csvRows.filter((row) => row.selected);

  const importCompanies = async () => {
    if (selectedRows.length === 0) return;
    try {
      setLoading(true);
      setError(null);
      await apiClient.importTargetCompanies(selectedRows.map((row) => ({ url: row.url, company: row.company })));
      setShowImporter(false);
      await loadHistory(1, searchTerm.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  const runBatch = async () => {
    if (selectedRows.length === 0) return;
    try {
      setLoading(true);
      setError(null);
      const { batchId } = await apiClient.startBatchAnalysis(selectedRows.map((row) => ({ url: row.url, company: row.company })));
      setActiveBatchId(batchId);
      setBatchJob(null);
      setBatchPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch start failed.");
    } finally {
      setLoading(false);
    }
  };

  const visibleCsvRows = csvRows.slice((csvPage - 1) * ITEMS_PER_PAGE, csvPage * ITEMS_PER_PAGE);
  const visibleBatchRows = batchJob?.items.slice((batchPage - 1) * ITEMS_PER_PAGE, batchPage * ITEMS_PER_PAGE) ?? [];

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>Job Matcher</h2>
          <button className="secondary" onClick={clearWorkspace}>
            Clear
          </button>
        </div>
        <div className="actions">
          <button className={activeTab === "library" ? "" : "secondary"} onClick={() => setActiveTab("library")}>
            Library
          </button>
          <button className={activeTab === "match" ? "" : "secondary"} onClick={() => setActiveTab("match")}>
            Match
          </button>
          <button className={activeTab === "discover" ? "" : "secondary"} onClick={() => setActiveTab("discover")}>
            Discover
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      {activeTab === "library" ? (
        <>
          <section className="panel">
            <div className="panel-header">
              <h3>Target Company Library</h3>
              <button className="secondary" onClick={() => setShowImporter((prev) => !prev)}>
                {showImporter ? "Close Importer" : "Import CSV"}
              </button>
            </div>
            <label>
              Search
              <input
                type="text"
                placeholder="Search company..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </label>
          </section>

          {showImporter ? (
            <section className="panel">
              <div className="panel-header">
                <h3>CSV Import</h3>
                <label className="button">
                  Choose File
                  <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: "none" }} />
                </label>
              </div>
              <p className="panel-help">
                {detectedCols
                  ? `Detected URL column: ${detectedCols.url}${detectedCols.company ? ` | Company column: ${detectedCols.company}` : ""}`
                  : "Upload a CSV with URL and optional company columns."}
              </p>

              {csvRows.length > 0 ? (
                <>
                  <div className="actions">
                    <button onClick={importCompanies} disabled={loading || selectedRows.length === 0}>
                      {loading ? "Importing..." : `Import (${selectedRows.length})`}
                    </button>
                    <button className="secondary" onClick={runBatch} disabled={loading || selectedRows.length === 0}>
                      {loading ? "Starting..." : `Run Batch (${selectedRows.length})`}
                    </button>
                  </div>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            <input type="checkbox" checked={csvRows.every((row) => row.selected)} onChange={toggleAll} />
                          </th>
                          <th>Company</th>
                          <th>URL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCsvRows.map((row, index) => {
                          const absoluteIndex = (csvPage - 1) * ITEMS_PER_PAGE + index;
                          return (
                            <tr key={`${row.url}-${absoluteIndex}`}>
                              <td>
                                <input type="checkbox" checked={row.selected} onChange={() => toggleRow(absoluteIndex)} />
                              </td>
                              <td>{row.company}</td>
                              <td>{row.url}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {csvRows.length > ITEMS_PER_PAGE ? (
                    <div className="actions">
                      <button className="secondary" disabled={csvPage === 1} onClick={() => setCsvPage((prev) => prev - 1)}>
                        Previous
                      </button>
                      <span>
                        Page {csvPage} / {Math.ceil(csvRows.length / ITEMS_PER_PAGE)}
                      </span>
                      <button
                        className="secondary"
                        disabled={csvPage === Math.ceil(csvRows.length / ITEMS_PER_PAGE)}
                        onClick={() => setCsvPage((prev) => prev + 1)}
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {batchJob ? (
            <section className="panel">
              <h3>
                Batch Status ({batchJob.progress.done}/{batchJob.progress.total})
              </h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Status / Score</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBatchRows.map((item, index) => (
                      <tr key={`${item.url}-${index}`}>
                        <td>
                          <strong>{item.company || "Unknown"}</strong>
                          <p className="panel-help">{item.url}</p>
                        </td>
                        <td>
                          {item.result ? (
                            <strong style={{ color: getScoreColor(item.result.analysis.matchScore) }}>
                              {item.result.analysis.matchScore}%
                            </strong>
                          ) : (
                            <span className="chip">{item.status}</span>
                          )}
                        </td>
                        <td>
                          {item.result ? (
                            <button
                              className="secondary"
                              onClick={() => {
                                setResult(item.result as JobAnalysisResult);
                                setActiveTab("match");
                              }}
                            >
                              View
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <h3>Saved Companies</h3>
            {historyLoading ? <p>Loading...</p> : null}
            {!historyLoading && targetCompanies.length === 0 ? <p>No companies found.</p> : null}

            <div className="application-list">
              {targetCompanies.map((company) => (
                <li key={company.id}>
                  <div>
                    <strong>{company.name}</strong>
                    <p>{company.url}</p>
                    <small>Added {new Date(company.createdAt).toLocaleDateString()}</small>
                  </div>
                  <div className="actions">
                    <button className="secondary" onClick={() => void handleAction("explore", company.url)} disabled={loading}>
                      Explore
                    </button>
                    <button onClick={() => void handleAction("analyze", company.url)} disabled={loading}>
                      Analyze
                    </button>
                  </div>
                </li>
              ))}
            </div>

            {totalPages > 1 ? (
              <div className="actions">
                <button className="secondary" disabled={page === 1} onClick={() => void loadHistory(page - 1, searchTerm.trim() || undefined)}>
                  Previous
                </button>
                <span>
                  Page {page} / {totalPages}
                </span>
                <button
                  className="secondary"
                  disabled={page === totalPages}
                  onClick={() => void loadHistory(page + 1, searchTerm.trim() || undefined)}
                >
                  Next
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {activeTab === "match" ? (
        <>
          <section className="panel">
            <h3>Analyze Job URL</h3>
            <div className="actions">
              <input
                type="url"
                placeholder="https://company.com/jobs/..."
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              <button onClick={() => void handleAction("analyze")} disabled={loading || !url.trim()}>
                {loading ? "Analyzing..." : "Analyze"}
              </button>
            </div>
          </section>

          <section className="panel">
            {!result ? <p>Paste a job URL and run analysis.</p> : null}
            {result ? (
              <>
                <h3 style={{ color: getScoreColor(result.analysis.matchScore) }}>{result.analysis.matchScore}% Match</h3>
                <p>{result.analysis.advice}</p>
                <h4>Strengths</h4>
                <div className="actions">
                  {result.analysis.strengths.map((item) => (
                    <span key={`strength-${item}`} className="chip">
                      {item}
                    </span>
                  ))}
                </div>
                <h4>Missing Skills</h4>
                <div className="actions">
                  {result.analysis.missingSkills.map((item) => (
                    <span key={`missing-${item}`} className="chip chip-rejected">
                      {item}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {activeTab === "discover" ? (
        <>
          <section className="panel">
            <h3>Find Jobs On Page</h3>
            <div className="actions">
              <input type="url" placeholder="https://company.com/careers" value={url} onChange={(event) => setUrl(event.target.value)} />
              <button className="secondary" onClick={() => void handleAction("explore")} disabled={loading || !url.trim()}>
                {loading ? "Searching..." : "Discover"}
              </button>
            </div>
          </section>

          <section className="panel">
            {!discoveredJobs ? <p>Paste a careers page URL to discover matching roles.</p> : null}
            {discoveredJobs && discoveredJobs.length === 0 ? <p>No matching jobs found.</p> : null}
            {discoveredJobs && discoveredJobs.length > 0 ? (
              <ul className="application-list">
                {discoveredJobs.map((job) => (
                  <li key={job.url}>
                    <div>
                      <strong>{job.title}</strong>
                      <p>{job.reasoning}</p>
                      <small>{job.url}</small>
                    </div>
                    <button onClick={() => void handleAction("analyze", job.url)} disabled={loading}>
                      Analyze
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
};
