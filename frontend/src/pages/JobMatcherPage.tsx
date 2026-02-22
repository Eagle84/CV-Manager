import { useState } from "react";
import { apiClient, type JobAnalysisResult } from "../lib/api.ts";

export const JobMatcherPage = () => {
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<JobAnalysisResult | null>(null);
    const [discoveredJobs, setDiscoveredJobs] = useState<{ title: string; url: string; reasoning: string }[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleAction = async (mode: 'analyze' | 'explore') => {
        if (!url) return;
        try {
            setLoading(true);
            setError(null);
            setResult(null);
            setDiscoveredJobs(null);

            if (mode === 'analyze') {
                const data = await apiClient.analyzeJobUrl(url);
                setResult(data);
            } else {
                const data = await apiClient.exploreJobsOnPage(url);
                setDiscoveredJobs(data);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to process the URL.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page-grid">
            <section className="panel">
                <h2>Job Matcher & Discovery Agent</h2>
                <p className="panel-help">
                    Paste a careers page URL or a specific job link. Our agent will help you find the best matches.
                </p>

                <div style={{ marginTop: '1.5rem' }}>
                    <input
                        type="url"
                        placeholder="https://company.com/careers"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        required
                        style={{ width: '100%', marginBottom: '1rem' }}
                    />
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            onClick={() => handleAction('analyze')}
                            disabled={loading || !url}
                            style={{ flex: 1 }}
                        >
                            🚀 Analyze Specific Job
                        </button>
                        <button
                            onClick={() => handleAction('explore')}
                            disabled={loading || !url}
                            className="button-secondary"
                            style={{ flex: 1 }}
                        >
                            🔍 Explore Page for Matches
                        </button>
                    </div>
                </div>

                {error && <p className="error-text" style={{ marginTop: '1rem' }}>{error}</p>}
            </section>

            {discoveredJobs && Array.isArray(discoveredJobs) && (
                <section className="panel">
                    <h2>Discovered Opportunities</h2>
                    <p className="panel-help">The agent found these jobs on the page that match your profile.</p>
                    <div className="cv-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginTop: '1rem' }}>
                        {discoveredJobs.map((job) => (
                            <article key={job.url} className="panel highlighted" style={{ margin: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <h3>{job.title}</h3>
                                    <button className="button-secondary" onClick={() => { setUrl(job.url); handleAction('analyze'); }}>Analyze This</button>
                                </div>
                                <p className="panel-help" style={{ color: 'var(--text-primary)', marginTop: '0.5rem' }}>{job.reasoning}</p>
                                <a href={job.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '1rem' }}>View Job Posting ↗</a>
                            </article>
                        ))}
                        {discoveredJobs.length === 0 && <p>No specific job links identified. Try the 'Analyze Specific Job' button if this is a direct job posting.</p>}
                    </div>
                </section>
            )}

            {discoveredJobs && !Array.isArray(discoveredJobs) && (
                <section className="panel">
                    <h2>Agent Feedback</h2>
                    <p>The agent returned a message instead of a job list:</p>
                    <pre className="panel-help" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(discoveredJobs, null, 2)}</pre>
                </section>
            )}

            {result && (
                <>
                    <section className="panel highlight-panel" style={{ borderTop: '4px solid var(--accent-color)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h2>Match Score: {result.analysis.matchScore}%</h2>
                                <div style={{ width: '200px', height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden', marginTop: '0.5rem' }}>
                                    <div style={{ width: `${result.analysis.matchScore}%`, height: '100%', background: result.analysis.matchScore > 70 ? '#10b981' : '#f59e0b' }}></div>
                                </div>
                            </div>
                            <a href={result.url} target="_blank" rel="noreferrer" className="button-secondary">Open Original Job</a>
                        </div>

                        <div style={{ marginTop: '2rem' }}>
                            <h3>Agent's Advice</h3>
                            <p className="panel-help" style={{ color: 'var(--text-primary)', fontStyle: 'italic', fontSize: '1.1rem' }}>
                                "{result.analysis.advice}"
                            </p>
                        </div>
                    </section>

                    <div className="stats-highlight-grid">
                        <article className="panel">
                            <h3 style={{ borderBottom: '2px solid #10b981', paddingBottom: '0.5rem' }}>Matching Skills</h3>
                            <ul className="task-list" style={{ marginTop: '1rem' }}>
                                {result.analysis.matchingSkills.map(skill => (
                                    <li key={skill}>✅ {skill}</li>
                                ))}
                            </ul>
                        </article>

                        <article className="panel">
                            <h3 style={{ borderBottom: '2px solid #ef4444', paddingBottom: '0.5rem' }}>Missing Experience/Skills</h3>
                            <ul className="task-list" style={{ marginTop: '1rem' }}>
                                {result.analysis.missingSkills.map(skill => (
                                    <li key={skill}>⚠️ {skill}</li>
                                ))}
                                {result.analysis.missingSkills.length === 0 && <li>You have everything for this role!</li>}
                            </ul>
                        </article>
                    </div>

                    <section className="panel">
                        <h3>Scraped Context</h3>
                        <p className="panel-help" style={{ fontSize: '0.8rem', maxHeight: '200px', overflowY: 'auto' }}>
                            {result.jdSnippet}
                        </p>
                    </section>
                </>
            )}
        </div>
    );
};
