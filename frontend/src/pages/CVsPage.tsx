import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { apiClient, type CvDto } from "../lib/api.ts";

export const CVsPage = () => {
  const [cvs, setCvs] = useState<CvDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.fetchCvs();
      setCvs(data);
    } catch {
      setError("Failed to load CVs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      setError(null);
      await apiClient.uploadCv(file);
      await loadData();
    } catch {
      setError("Upload failed. If analysis is still running, refresh in a minute.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this CV?")) return;
    try {
      setError(null);
      await apiClient.deleteCv(id);
      await loadData();
    } catch {
      setError("Failed to delete CV.");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      setError(null);
      await apiClient.setDefaultCv(id);
      await loadData();
    } catch {
      setError("Failed to set default CV.");
    }
  };

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-header">
          <h2>My CVs</h2>
          <label className="button">
            {uploading ? "Uploading..." : "Upload CV"}
            <input type="file" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} accept=".pdf,.docx,.txt" />
          </label>
        </div>
        <p className="panel-help">Your default CV is used by the matcher and analysis flows.</p>

        {error ? <p className="error-text">{error}</p> : null}
        {loading ? <p>Loading CVs...</p> : null}

        {!loading ? (
          <div className="cv-grid">
            {cvs.map((cv) => {
              const skills = (cv.skills || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean);

              return (
                <article key={cv.id} className="status-card">
                  <div className="panel-header">
                    <div>
                      <strong>{cv.filename}</strong>
                      <p>{dayjs(cv.createdAt).format("YYYY-MM-DD")}</p>
                    </div>
                    {cv.isDefault ? <span className="chip chip-received">Default</span> : null}
                  </div>

                  <p className="panel-help">
                    {cv.rolePrimary ? `${cv.rolePrimary}${cv.experienceYears ? ` | ${cv.experienceYears}` : ""}` : "Role not detected yet"}
                  </p>
                  <p>{cv.summary || "No summary extracted yet."}</p>

                  {skills.length > 0 ? (
                    <div className="actions">
                      {skills.slice(0, 8).map((skill) => (
                        <span key={`${cv.id}-${skill}`} className="chip">
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="actions" style={{ marginTop: "0.8rem" }}>
                    {!cv.isDefault ? (
                      <button className="secondary" onClick={() => void handleSetDefault(cv.id)}>
                        Set Default
                      </button>
                    ) : null}
                    <button className="danger" onClick={() => void handleDelete(cv.id)}>
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {!loading && cvs.length === 0 ? <p>No CVs uploaded yet.</p> : null}
      </section>
    </div>
  );
};
