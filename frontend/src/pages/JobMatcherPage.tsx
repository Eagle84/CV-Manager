import { useState, useEffect, useRef } from "react";
import { apiClient, type JobAnalysisResult, type BatchJob } from "../lib/api.ts";

const STORAGE_KEYS = {
    URL: "job_matcher_url",
    RESULT: "job_matcher_result",
    DISCOVERED: "job_matcher_discovered"
};

const getScoreColor = (score: number) =>
    score >= 75 ? "var(--safe)" : score >= 50 ? "var(--accent-2)" : "var(--danger)";

const getScoreLabel = (score: number) =>
    score >= 75 ? "Strong Match" : score >= 50 ? "Fair Match" : "Low Match";

interface CsvRow {
    url: string;
    company: string;
    selected: boolean;
}

export const JobMatcherPage = () => {
    const [activeSubTab, setActiveSubTab] = useState<'match' | 'discover' | 'batch'>('match');

    // Single Analysis State
    const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEYS.URL) || "");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<JobAnalysisResult | null>(() => {
        const saved = localStorage.getItem(STORAGE_KEYS.RESULT);
        return saved ? JSON.parse(saved) : null;
    });
    const [discoveredJobs, setDiscoveredJobs] = useState<{ title: string; url: string; reasoning: string }[] | null>(() => {
        const saved = localStorage.getItem(STORAGE_KEYS.DISCOVERED);
        return saved ? JSON.parse(saved) : null;
    });
    const [error, setError] = useState<string | null>(null);

    // Batch Analysis State
    const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
    const [detectedCols, setDetectedCols] = useState<{ url: string; company: string | null } | null>(null);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
    const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
    const pollInterval = useRef<number | null>(null);

    // Persistence Effects
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.URL, url);
    }, [url]);

    useEffect(() => {
        if (result) localStorage.setItem(STORAGE_KEYS.RESULT, JSON.stringify(result));
        else localStorage.removeItem(STORAGE_KEYS.RESULT);
    }, [result]);

    useEffect(() => {
        if (discoveredJobs) localStorage.setItem(STORAGE_KEYS.DISCOVERED, JSON.stringify(discoveredJobs));
        else localStorage.removeItem(STORAGE_KEYS.DISCOVERED);
    }, [discoveredJobs]);

    // Polling Effect for Batch
    useEffect(() => {
        if (activeBatchId) {
            pollInterval.current = window.setInterval(async () => {
                try {
                    const status = await apiClient.getBatchStatus(activeBatchId);
                    setBatchJob(status);
                    if (status.status === "done") {
                        if (pollInterval.current) clearInterval(pollInterval.current);
                        pollInterval.current = null;
                    }
                } catch (err) {
                    console.error("Polling error:", err);
                }
            }, 3000);
        }
        return () => {
            if (pollInterval.current) clearInterval(pollInterval.current);
        };
    }, [activeBatchId]);

    const clearData = () => {
        setUrl("");
        setResult(null);
        setDiscoveredJobs(null);
        setError(null);
        setCsvRows([]);
        setDetectedCols(null);
        setActiveBatchId(null);
        setBatchJob(null);
        localStorage.removeItem(STORAGE_KEYS.URL);
        localStorage.removeItem(STORAGE_KEYS.RESULT);
        localStorage.removeItem(STORAGE_KEYS.DISCOVERED);
    };

    const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            if (!text) return;

            const lines = text.split(/\r?\n/).filter(line => line.trim());
            if (lines.length < 1) return;

            const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));

            // Column Detection
            let urlIdx = -1;
            let companyIdx = -1;

            const urlKeywords = ["url", "link", "careers", "career_page", "website"];
            const compKeywords = ["company", "name", "organization", "employer"];

            headers.forEach((h, i) => {
                const lh = h.toLowerCase();
                if (urlIdx === -1 && urlKeywords.some(k => lh.includes(k))) urlIdx = i;
                if (companyIdx === -1 && compKeywords.some(k => lh.includes(k))) companyIdx = i;
            });

            if (urlIdx === -1) {
                setError("Could not detect a URL/Link column. Please ensure your CSV has a header like 'URL' or 'Link'.");
                return;
            }

            setDetectedCols({
                url: headers[urlIdx],
                company: companyIdx !== -1 ? headers[companyIdx] : null
            });

            const rows: CsvRow[] = lines.slice(1).map(line => {
                // Simple CSV splitter (doesn't handle commas in quotes perfectly, but sufficient for URLs)
                const cells = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
                return {
                    url: cells[urlIdx] || "",
                    company: companyIdx !== -1 ? cells[companyIdx] || "Unknown" : "Unknown",
                    selected: !!cells[urlIdx]
                };
            }).filter(r => r.url.startsWith("http"));

            setCsvRows(rows);
            setError(null);
        };
        reader.readAsText(file);
    };

    const toggleRow = (idx: number) => {
        const updated = [...csvRows];
        updated[idx].selected = !updated[idx].selected;
        setCsvRows(updated);
    };

    const toggleAll = () => {
        const allSelected = csvRows.every(r => r.selected);
        setCsvRows(csvRows.map(r => ({ ...r, selected: !allSelected })));
    };

    const startBatch = async () => {
        const selectedItems = csvRows.filter(r => r.selected).map(r => ({ url: r.url, company: r.company }));
        if (selectedItems.length === 0) return;

        try {
            setLoading(true);
            setError(null);
            const { batchId } = await apiClient.startBatchAnalysis(selectedItems);
            setActiveBatchId(batchId);
            setBatchJob(null);
        } catch (err: any) {
            setError(err.message || "Failed to start batch analysis");
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (mode: 'analyze' | 'explore') => {
        if (!url) return;
        try {
            setLoading(true);
            setError(null);
            if (mode === 'analyze') {
                const data = await apiClient.analyzeJobUrl(url);
                setResult(data);
                setActiveSubTab('match');
            } else {
                const data = await apiClient.exploreJobsOnPage(url);
                setDiscoveredJobs(data);
                setActiveSubTab('discover');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to process the URL.");
        } finally {
            setLoading(false);
        }
    };

    const selectedCount = csvRows.filter(r => r.selected).length;

    return (
        <div className="page-grid">
            {/* ── Top Control Panel ── */}
            <section className="panel" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', background: 'var(--stroke)', padding: '0.3rem', borderRadius: '14px' }}>
                        {[
                            { id: 'match', label: '🚀 Match Analysis', icon: '🎯' },
                            { id: 'discover', label: '🔍 Opportunity Finder', icon: '🔎' },
                            { id: 'batch', label: '📊 CSV Batch', icon: '📁' }
                        ].map(t => (
                            <button
                                key={t.id}
                                className={activeSubTab === t.id ? 'button' : 'button-secondary'}
                                style={{ border: 'none', borderRadius: '11px', padding: '0.5rem 1.2rem' }}
                                onClick={() => setActiveSubTab(t.id as any)}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {(result || discoveredJobs || url || csvRows.length > 0 || batchJob) && (
                        <button onClick={clearData} className="button-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                            🧹 Reset Agent State
                        </button>
                    )}
                </div>

                {activeSubTab === 'match' && (
                    <div>
                        <p className="panel-help" style={{ marginBottom: '1rem' }}>
                            Paste a specific job URL to get a detailed match analysis against your profile.
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <input
                                type="url"
                                placeholder="https://company.com/careers/software-engineer"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                style={{ flex: 1, minWidth: '300px' }}
                            />
                            <button onClick={() => handleAction('analyze')} disabled={loading || !url}>
                                {loading ? "Analyzing..." : "🚀 Analyze Job"}
                            </button>
                        </div>
                    </div>
                )}

                {activeSubTab === 'discover' && (
                    <div>
                        <p className="panel-help" style={{ marginBottom: '1rem' }}>
                            Paste a careers portal URL. The agent will discover and highlight the best active roles for you.
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <input
                                type="url"
                                placeholder="https://google.com/careers"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                style={{ flex: 1, minWidth: '300px' }}
                            />
                            <button onClick={() => handleAction('explore')} disabled={loading || !url} className="button-secondary">
                                {loading ? "Discovering..." : "🔍 Find Matches"}
                            </button>
                        </div>
                    </div>
                )}

                {activeSubTab === 'batch' && (
                    <div>
                        <p className="panel-help" style={{ marginBottom: '1rem' }}>
                            Process multiple job links at once by uploading a CSV file.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <label className="button-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                                📁 Choose CSV File
                                <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} />
                            </label>
                            {detectedCols ? (
                                <span style={{ fontSize: '0.85rem', color: 'var(--safe)' }}>
                                    ✅ Detected "{detectedCols.url}" column
                                </span>
                            ) : (
                                <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>Supports: url, link, careers...</span>
                            )}
                        </div>
                    </div>
                )}
                {error && <p className="error-text" style={{ marginTop: '1rem' }}>{error}</p>}
            </section>

            {/* ── Tab Contents ── */}
            {activeSubTab === 'match' && (
                <>
                    {/* Single Analysis Result */}
                    {result ? (
                        <>
                            <section id="full-result" className="panel highlighted" style={{ borderTop: `4px solid ${getScoreColor(result.analysis.matchScore)}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <p className="eyebrow" style={{ color: getScoreColor(result.analysis.matchScore) }}>{getScoreLabel(result.analysis.matchScore)}</p>
                                        <h2 style={{ margin: 0, fontSize: '2rem' }}>{result.analysis.matchScore}% Match</h2>
                                    </div>
                                    <a href={result.url} target="_blank" rel="noreferrer" className="button-secondary">Open Posting</a>
                                </div>
                                <div style={{ marginTop: '1.5rem', padding: '1rem', borderLeft: '4px solid var(--accent)', background: 'var(--stroke)', borderRadius: '0 8px 8px 0' }}>
                                    <p style={{ margin: 0, lineHeight: 1.6 }}>{result.analysis.advice}</p>
                                </div>
                            </section>

                            <article className="panel">
                                <h3>💪 Key Strengths</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
                                    {(result.analysis.strengths?.length > 0
                                        ? result.analysis.strengths
                                        : result.analysis.matchingSkills.slice(0, 5)
                                    ).map(s => (
                                        <span key={s} className="chip">{s}</span>
                                    ))}
                                    {(result.analysis.strengths?.length === 0 && result.analysis.matchingSkills.length === 0) && <p className="panel-help">No specific strengths identified.</p>}
                                </div>
                            </article>

                            <article className="panel">
                                <h3>⭐ Over-Qualifications</h3>
                                {result.analysis.overqualifiedSkills?.length > 0 ? (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
                                        {result.analysis.overqualifiedSkills.map(s => (
                                            <span key={s} className="chip" style={{ color: '#3b82f6' }}>{s}</span>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="panel-help">Matched exactly for all critical requirements.</p>
                                )}
                            </article>

                            <article className="panel">
                                <h3>⚠️ Knowledge Gaps</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1rem' }}>
                                    {result.analysis.missingSkills.map(s => (
                                        <span key={s} className="chip" style={{ color: 'var(--danger)' }}>{s}</span>
                                    ))}
                                    {result.analysis.missingSkills.length === 0 && <p>Full match! You have all requested skills.</p>}
                                </div>
                            </article>

                            <section className="panel" style={{ gridColumn: '1 / -1' }}>
                                <details>
                                    <summary style={{ cursor: 'pointer', opacity: 0.6 }}>View Scraped Text</summary>
                                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', marginTop: '1rem', maxHeight: '300px', overflowY: 'auto' }}>{result.jdSnippet}</pre>
                                </details>
                            </section>
                        </>
                    ) : (
                        <p style={{ textAlign: 'center', gridColumn: '1 / -1', opacity: 0.5, marginTop: '2rem' }}>No analysis performed yet. Paste a link above to begin.</p>
                    )}
                </>
            )}

            {activeSubTab === 'discover' && (
                <>
                    {/* Discovered List */}
                    {discoveredJobs ? (
                        Array.isArray(discoveredJobs) ? (
                            <section className="panel" style={{ gridColumn: '1 / -1' }}>
                                <h2>Discovered Opportunities</h2>
                                <div className="stats-highlight-grid" style={{ gridTemplateColumns: '1fr', marginTop: '1rem' }}>
                                    {discoveredJobs.map((job) => (
                                        <article key={job.url} className="panel highlighted" style={{ margin: 0 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{job.title}</h3>
                                                <button className="button-secondary" style={{ padding: '0.3rem 0.6rem' }} onClick={() => { setUrl(job.url); handleAction('analyze'); }}>Analyze</button>
                                            </div>
                                            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.8 }}>{job.reasoning}</p>
                                            <a href={job.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', marginTop: '0.5rem', display: 'block' }}>View Posting ↗</a>
                                        </article>
                                    ))}
                                    {discoveredJobs.length === 0 && <p>No specific jobs found. Is this a direct job posting? Use 'Match Analysis' instead.</p>}
                                </div>
                            </section>
                        ) : (
                            <section className="panel" style={{ gridColumn: '1 / -1' }}>
                                <h2>Agent Feedback</h2>
                                <p>The agent returned a message instead of a job list:</p>
                                <pre className="panel-help" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(discoveredJobs, null, 2)}</pre>
                            </section>
                        )
                    ) : (
                        <p style={{ textAlign: 'center', gridColumn: '1 / -1', opacity: 0.5, marginTop: '2rem' }}>No discovery exploration performed yet. Use the explorer above.</p>
                    )}
                </>
            )}

            {activeSubTab === 'batch' && (
                <>
                    {/* CSV Table or Active Batch */}
                    {csvRows.length > 0 && (
                        <section className="panel" style={{ gridColumn: '1 / -1' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <h2>CSV Selection ({selectedCount} items)</h2>
                                <button className="button" disabled={selectedCount === 0 || loading} onClick={startBatch}>
                                    {loading ? "Starting..." : `🚀 Run Batch Analysis`}
                                </button>
                            </div>
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px' }}><input type="checkbox" checked={csvRows.length > 0 && csvRows.every(r => r.selected)} onChange={toggleAll} /></th>
                                            <th>Company</th>
                                            <th>URL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {csvRows.map((row, idx) => (
                                            <tr key={idx}>
                                                <td><input type="checkbox" checked={row.selected} onChange={() => toggleRow(idx)} /></td>
                                                <td>{row.company}</td>
                                                <td style={{ fontSize: '0.85rem', opacity: 0.7 }}>{row.url}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {(activeBatchId || batchJob) && (
                        <section className="panel highlighted" style={{ gridColumn: '1 / -1' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                                <div>
                                    <h2 style={{ margin: 0 }}>Batch Results Processing</h2>
                                    <p className="panel-help">Progress: {batchJob?.progress.done} / {batchJob?.progress.total}</p>
                                </div>
                                {batchJob?.status === "running" ? <div className="spinner"></div> : <span className="chip chip-received">Finished</span>}
                            </div>

                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Company / Link</th>
                                            <th style={{ textAlign: 'center' }}>Score</th>
                                            <th style={{ textAlign: 'center' }}>Status</th>
                                            <th style={{ textAlign: 'right' }}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...(batchJob?.items || [])].sort((a, b) => (b.result?.analysis?.matchScore || 0) - (a.result?.analysis?.matchScore || 0)).map((item, idx) => (
                                            <tr key={idx}>
                                                <td style={{ fontWeight: 600 }}>{item.company} <br /><small style={{ opacity: 0.5, fontWeight: 400 }}>{item.url.slice(0, 50)}...</small></td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.result?.analysis ? (
                                                        <strong style={{ color: getScoreColor(item.result.analysis.matchScore) }}>{item.result.analysis.matchScore}%</strong>
                                                    ) : "—"}
                                                </td>
                                                <td style={{ textAlign: 'center' }}><span className={`chip ${item.status}`}>{item.status}</span></td>
                                                <td style={{ textAlign: 'right' }}>
                                                    {item.result && (
                                                        <button className="button-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }} onClick={() => { setResult(item.result!); setActiveSubTab('match'); }}>View</button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {csvRows.length === 0 && !activeBatchId && !batchJob && (
                        <p style={{ textAlign: 'center', gridColumn: '1 / -1', opacity: 0.5, marginTop: '2rem' }}>Upload a CSV file to begin batch analysis.</p>
                    )}
                </>
            )}
        </div>
    );
};
