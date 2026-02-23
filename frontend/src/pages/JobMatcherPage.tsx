import { useState, useEffect, useRef } from "react";
import { apiClient, type JobAnalysisResult, type BatchJob, type TargetCompanyDto } from "../lib/api.ts";

const STORAGE_KEYS = {
    URL: "job_matcher_url",
    RESULT: "job_matcher_result",
    DISCOVERED: "job_matcher_discovered"
};

const getScoreColor = (score: number) =>
    score >= 75 ? "var(--safe)" : score >= 50 ? "var(--accent-2)" : "var(--danger)";

interface CsvRow {
    url: string;
    company: string;
    selected: boolean;
}

export const JobMatcherPage = () => {
    const [activeSubTab, setActiveSubTab] = useState<'batch' | 'match' | 'discover'>('batch');

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
    const [showImporter, setShowImporter] = useState(false);
    const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
    const [detectedCols, setDetectedCols] = useState<{ url: string; company: string | null } | null>(null);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
    const [batchJob, setBatchJob] = useState<BatchJob | null>(null);
    const [csvPage, setCsvPage] = useState(1);
    const [batchPage, setBatchPage] = useState(1);
    const ITEMS_PER_PAGE = 10;
    const pollInterval = useRef<number | null>(null);

    // History Pagination State
    const [targetCompanies, setTargetCompanies] = useState<TargetCompanyDto[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    const loadHistory = async (p: number, search?: string) => {
        setHistoryLoading(true);
        try {
            const resp = await apiClient.fetchTargetCompanies(p, ITEMS_PER_PAGE, search);
            setTargetCompanies(resp.items);
            setTotalPages(resp.totalPages);
            setPage(resp.page);
        } catch (err) {
            console.error("Failed to load history:", err);
        } finally {
            setHistoryLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            loadHistory(1, searchTerm.trim());
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm]);

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
                        loadHistory(1); // Refresh library after batch
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
        setCsvPage(1);
        setBatchPage(1);
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
                setError("Could not detect a URL column.");
                return;
            }

            setDetectedCols({ url: headers[urlIdx], company: companyIdx !== -1 ? headers[companyIdx] : null });

            const rows: CsvRow[] = lines.slice(1).map(line => {
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

    const importCompanies = async () => {
        const selectedItems = csvRows.filter(r => r.selected).map(r => ({ url: r.url, company: r.company }));
        if (selectedItems.length === 0) return;

        try {
            setLoading(true);
            setError(null);
            await apiClient.importTargetCompanies(selectedItems);
            setShowImporter(false);
            loadHistory(1); // Refresh library
        } catch (err: any) {
            setError(err.message || "Failed to import companies");
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (mode: 'analyze' | 'explore', targetUrl?: string) => {
        const finalUrl = targetUrl || url;
        if (!finalUrl) return;
        try {
            setLoading(true);
            setError(null);
            if (mode === 'analyze') {
                const data = await apiClient.analyzeJobUrl(finalUrl);
                setResult(data);
                setUrl(finalUrl);
                setActiveSubTab('match');
            } else {
                const data = await apiClient.exploreJobsOnPage(finalUrl);
                setDiscoveredJobs(data);
                setUrl(finalUrl);
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
                            { id: 'batch', label: '📂 Company Library' },
                            { id: 'match', label: '🚀 Match Analysis' },
                            { id: 'discover', label: '🔍 Opportunity Finder' },
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
                            Reset Agent
                        </button>
                    )}
                </div>

                {activeSubTab === 'batch' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Target Company Library</h2>
                            <p className="panel-help" style={{ margin: 0 }}>Browse your saved career portals.</p>
                        </div>
                        <button className="button" onClick={() => setShowImporter(!showImporter)}>
                            {showImporter ? "✖ Close Importer" : "📁 Import CSV"}
                        </button>
                    </div>
                )}

                {activeSubTab === 'match' && (
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <input type="url" placeholder="Paste job URL..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: '300px' }} />
                        <button onClick={() => handleAction('analyze')} disabled={loading || !url}>{loading ? "Analyzing..." : "🚀 Analyze Job"}</button>
                    </div>
                )}

                {activeSubTab === 'discover' && (
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <input type="url" placeholder="Paste careers portal URL..." value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: '300px' }} />
                        <button onClick={() => handleAction('explore')} disabled={loading || !url} className="button-secondary">{loading ? "Discovering..." : "🔍 Find Matches"}</button>
                    </div>
                )}

                {error && <p className="error-text" style={{ marginTop: '1rem' }}>{error}</p>}
            </section>

            {/* ── Main Workspace ── */}
            <main style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                {activeSubTab === 'batch' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <input
                                type="text"
                                placeholder="🔍 Search companies..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ flex: 1 }}
                            />
                        </div>

                        {showImporter && (
                            <section className="panel highlighted">
                                <h3>Step 1: Upload CSV</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
                                    <label className="button-secondary" style={{ cursor: 'pointer', margin: 0 }}>
                                        📁 Choose CSV File
                                        <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} />
                                    </label>
                                    {detectedCols && <span style={{ color: 'var(--safe)', fontSize: '0.9rem' }}>✅ Detected "{detectedCols.url}"</span>}
                                </div>

                                {csvRows.length > 0 && (
                                    <div style={{ marginTop: '1rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h4>Detected {csvRows.length} rows ({selectedCount} selected)</h4>
                                            <button className="button" disabled={selectedCount === 0 || loading} onClick={importCompanies}>{loading ? "Importing..." : "📁 Import"}</button>
                                        </div>
                                        <div className="table-wrap" style={{ maxHeight: '400px' }}>
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '40px' }}><input type="checkbox" checked={csvRows.length > 0 && csvRows.every(r => r.selected)} onChange={toggleAll} /></th>
                                                        <th>Company</th>
                                                        <th>URL</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {csvRows.slice((csvPage - 1) * ITEMS_PER_PAGE, csvPage * ITEMS_PER_PAGE).map((row, idx) => (
                                                        <tr key={idx}>
                                                            <td><input type="checkbox" checked={row.selected} onChange={() => toggleRow((csvPage - 1) * ITEMS_PER_PAGE + idx)} /></td>
                                                            <td>{row.company}</td>
                                                            <td style={{ opacity: 0.6, fontSize: '0.8rem' }}>{row.url}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {csvRows.length > ITEMS_PER_PAGE && (
                                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                                                <button className="button-secondary" disabled={csvPage === 1} onClick={() => setCsvPage(csvPage - 1)}>←</button>
                                                <span>{csvPage} / {Math.ceil(csvRows.length / ITEMS_PER_PAGE)}</span>
                                                <button className="button-secondary" disabled={csvPage === Math.ceil(csvRows.length / ITEMS_PER_PAGE)} onClick={() => setCsvPage(csvPage + 1)}>→</button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {(activeBatchId || batchJob) && (
                            <section className="panel highlighted">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                    <h3>Batch Status ({batchJob?.progress.done || 0} / {batchJob?.progress.total || 0})</h3>
                                </div>
                                <div className="table-wrap">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Company</th>
                                                <th style={{ textAlign: 'center' }}>Score</th>
                                                <th style={{ textAlign: 'right' }}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {batchJob?.items.slice((batchPage - 1) * ITEMS_PER_PAGE, batchPage * ITEMS_PER_PAGE).map((it, idx) => (
                                                <tr key={idx}>
                                                    <td>{it.company}<br /><small style={{ opacity: 0.5 }}>{it.url}</small></td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {it.result ? <strong style={{ color: getScoreColor(it.result.analysis.matchScore) }}>{it.result.analysis.matchScore}%</strong> : <span className={`chip ${it.status}`}>{it.status}</span>}
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        {it.result && <button className="button-secondary" onClick={() => { setResult(it.result!); setActiveSubTab('match'); }}>View</button>}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {batchJob && batchJob.items.length > ITEMS_PER_PAGE && (
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                                        <button className="button-secondary" disabled={batchPage === 1} onClick={() => setBatchPage(batchPage - 1)}>←</button>
                                        <span>{batchPage} / {Math.ceil(batchJob.items.length / ITEMS_PER_PAGE)}</span>
                                        <button className="button-secondary" disabled={batchPage === Math.ceil(batchJob.items.length / ITEMS_PER_PAGE)} onClick={() => setBatchPage(batchPage + 1)}>→</button>
                                    </div>
                                )}
                            </section>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                            {targetCompanies.length > 0 ? targetCompanies.map(c => (
                                <details key={c.id} className="panel" style={{ margin: 0, padding: '1rem', background: 'var(--stroke)', borderRadius: '16px' }}>
                                    <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <h3 style={{ margin: 0, fontSize: '1rem' }}>{c.name}</h3>
                                                {c.industry && (
                                                    <div style={{ marginTop: '0.4rem' }}>
                                                        <span style={{
                                                            fontSize: '0.75rem',
                                                            padding: '0.2rem 0.6rem',
                                                            background: 'var(--accent-1)',
                                                            color: 'var(--bg-main)',
                                                            borderRadius: '12px',
                                                            fontWeight: '700',
                                                            textTransform: 'uppercase'
                                                        }}>
                                                            💼 {c.industry}
                                                        </span>
                                                    </div>
                                                )}
                                                <p className="panel-help" style={{ margin: 0, fontSize: '0.75rem', opacity: 0.5 }}>Added {new Date(c.createdAt).toLocaleDateString()}</p>
                                            </div>
                                            <span>▼</span>
                                        </div>
                                    </summary>
                                    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                        <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: '0.8rem' }}>{c.url}</p>
                                        <div style={{ display: 'flex', gap: '0.6rem' }}>
                                            <button className="button" style={{ width: '100%' }} onClick={() => handleAction('explore', c.url)}>🔎 Explore Company</button>
                                        </div>
                                    </div>
                                </details>
                            )) : !historyLoading && (
                                <p style={{ gridColumn: '1 / -1', textAlign: 'center', opacity: 0.4, padding: '4rem' }}>Library is empty. Import a CSV to start.</p>
                            )}
                        </div>

                        {totalPages > 1 && (
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2rem', marginTop: '2rem' }}>
                                <button className="button-secondary" disabled={page === 1} onClick={() => loadHistory(page - 1, searchTerm)}>← Previous</button>
                                <span>{page} / {totalPages}</span>
                                <button className="button-secondary" disabled={page === totalPages} onClick={() => loadHistory(page + 1, searchTerm)}>Next →</button>
                            </div>
                        )}
                    </div>
                )}

                {activeSubTab === 'match' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {result ? (
                            <>
                                <section id="full-result" className="panel highlighted" style={{ borderTop: `4px solid ${getScoreColor(result.analysis.matchScore)}` }}>
                                    <h2>{result.analysis.matchScore}% Match</h2>
                                    <p>{result.analysis.advice}</p>
                                </section>
                                <article className="panel"><h3>💪 Strengths</h3><div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>{Array.from(new Set(result.analysis.strengths.map(s => s.trim()))).map(s => <span key={s} className="chip">{s}</span>)}</div></article>
                                <article className="panel"><h3>⚠️ Gaps</h3><div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>{Array.from(new Set(result.analysis.missingSkills.map(s => s.trim()))).map(s => <span key={s} className="chip" style={{ color: 'var(--danger)' }}>{s}</span>)}</div></article>
                            </>
                        ) : <p style={{ textAlign: 'center', opacity: 0.5 }}>Paste a link above.</p>}
                    </div>
                )}

                {activeSubTab === 'discover' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {discoveredJobs ? (
                            <section className="panel">
                                <h2>Opportunities</h2>
                                {discoveredJobs.length > 0 ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
                                        {discoveredJobs.map(job => (
                                            <article key={job.url} className="panel highlighted">
                                                <h4>{job.title}</h4>
                                                <p style={{ fontSize: '0.85rem', opacity: 0.7 }}>{job.reasoning}</p>
                                                <button className="button" style={{ width: '100%', marginTop: '1rem' }} onClick={() => handleAction('analyze', job.url)}>Analyze</button>
                                            </article>
                                        ))}
                                    </div>
                                ) : (
                                    <p style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>No matching opportunities found on this page. Try a more specific careers portal link.</p>
                                )}
                            </section>
                        ) : <p style={{ textAlign: 'center', opacity: 0.5 }}>Enter a careers URL.</p>}
                    </div>
                )}
            </main>
        </div>
    );
};
