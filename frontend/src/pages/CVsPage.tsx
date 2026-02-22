import { useEffect, useState } from "react";
import { apiClient, type CvDto } from "../lib/api.ts";
import dayjs from "dayjs";

export const CVsPage = () => {
    const [cvs, setCvs] = useState<CvDto[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await apiClient.fetchCvs();
            setCvs(data);
        } catch (err) {
            setError("Failed to load CVs");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, []);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setUploading(true);
            setError(null);
            await apiClient.uploadCv(file);
            await loadData();
        } catch (err) {
            setError("Failed to upload CV. Make sure it is a PDF or Docx.");
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Delete this CV?")) return;
        try {
            await apiClient.deleteCv(id);
            await loadData();
        } catch (err) {
            setError("Failed to delete CV");
        }
    };

    const handleSetDefault = async (id: string) => {
        try {
            await apiClient.setDefaultCv(id);
            await loadData();
        } catch (err) {
            setError("Failed to set default CV");
        }
    };

    return (
        <div className="page-grid">
            <section className="panel">
                <div className="panel-header">
                    <h2>My CVs</h2>
                    <label className="button">
                        {uploading ? "Uploading..." : "Upload New CV"}
                        <input
                            type="file"
                            onChange={handleUpload}
                            disabled={uploading}
                            style={{ display: "none" }}
                            accept=".pdf,.docx,.txt"
                        />
                    </label>
                </div>
                <p className="panel-help">
                    Manage your resumes. The default CV is used by the AI Agent to match job descriptions.
                </p>

                {error && <p className="error-text">{error}</p>}

                {loading ? (
                    <p>Loading CVs...</p>
                ) : (
                    <div className="cv-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                        {cvs.map((cv) => (
                            <article key={cv.id} className={`panel ${cv.isDefault ? "highlighted" : ""}`} style={{ border: cv.isDefault ? '2px solid var(--accent-color)' : '1px solid var(--border-color)', margin: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <h3 style={{ margin: 0 }}>{cv.filename}</h3>
                                        <small>{dayjs(cv.createdAt).format("MMM D, YYYY")}</small>
                                    </div>
                                    {cv.isDefault && <span className="chip chip-received">Default</span>}
                                </div>

                                <div style={{ marginTop: '1rem' }}>
                                    <p><strong>Agent Summary:</strong></p>
                                    <p className="panel-help" style={{ marginBottom: '1rem' }}>{cv.summary || "No summary extracted."}</p>

                                    <p><strong>Skills:</strong></p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {cv.skills.split(",").map(skill => (
                                            skill.trim() && <span key={skill} className="chip" style={{ background: 'var(--bg-secondary)', fontSize: '0.75rem' }}>{skill.trim()}</span>
                                        ))}
                                    </div>
                                </div>

                                <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
                                    {!cv.isDefault && (
                                        <button onClick={() => handleSetDefault(cv.id)} className="button-secondary">Set Default</button>
                                    )}
                                    <button onClick={() => handleDelete(cv.id)} className="button-danger" style={{ marginLeft: 'auto' }}>Delete</button>
                                </div>
                            </article>
                        ))}
                        {cvs.length === 0 && <p>No CVs uploaded yet.</p>}
                    </div>
                )}
            </section>
        </div>
    );
};
