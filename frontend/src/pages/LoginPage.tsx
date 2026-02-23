import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { apiClient, getSessionToken } from "../lib/api";

export const LoginPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If a token appears while we are "connecting", push through
    if (getSessionToken()) {
      setLoading(false);
      navigate("/dashboard", { replace: true });
    }
  }, [navigate, loading]);

  useEffect(() => {
    const urlError = searchParams.get("error");
    if (urlError) {
      setError(decodeURIComponent(urlError));
      setLoading(false);
    }
  }, [searchParams]);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);

    // Safety timeout: if we don't redirect in 15 seconds, something is wrong
    const timeout = setTimeout(() => {
      setLoading(false);
      setError("Request timed out. Please check your connection and try again.");
    }, 15000);

    try {
      const url = await apiClient.getGoogleAuthUrl("login");
      clearTimeout(timeout);
      window.location.href = url;
    } catch (err) {
      clearTimeout(timeout);
      setError("Failed to initiate Google Login. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <p className="eyebrow">Welcome to CV Manager</p>
        <h1>Sign In</h1>
        <p className="login-description">
          Securely manage your job applications, track communications, and optimize your CV with AI.
        </p>

        {error && <div className="error-message">{error}</div>}

        <button
          className="google-login-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? (
            "Connecting..."
          ) : (
            <>
              <img src="/google-g.png" alt="Google" style={{ width: 20, marginRight: 12 }} />
              Continue with Google
            </>
          )}
        </button>

        <p className="login-footer text-muted">
          Only your Gmail read/send access is required for tracking and follow-ups.
        </p>

        <div style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
          <p style={{ marginBottom: '0.5rem' }}>Created by <strong>Igal Boguslavsky</strong></p>
          <a href="mailto:igal.bogu@gmail.com" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none' }}>igal.bogu@gmail.com</a>
          <div style={{ marginTop: '1rem' }}>
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{ color: '#2a9d8f', textDecoration: 'none', margin: '0 0.5rem' }}>Privacy Policy</a>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" style={{ color: '#2a9d8f', textDecoration: 'none', margin: '0 0.5rem' }}>Terms of Service</a>
          </div>
        </div>
      </div>

      <style>{`
        .login-page {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: radial-gradient(circle at top left, #1a1a2e, #0f0c29);
          padding: 2rem;
        }

        .login-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 24px;
          padding: 3rem;
          max-width: 440px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
        }

        .login-card h1 {
          font-size: 2.5rem;
          margin-bottom: 1rem;
          color: #fff;
        }

        .login-description {
          color: rgba(255, 255, 255, 0.7);
          line-height: 1.6;
          margin-bottom: 2.5rem;
        }

        .google-login-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.8rem;
          background: white;
          color: #333;
          border: none;
          border-radius: 12px;
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .google-login-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(255, 255, 255, 0.2);
        }

        .google-login-btn:active {
          transform: translateY(0);
        }

        .google-login-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .error-message {
          padding: 1rem;
          background: rgba(255, 82, 82, 0.1);
          color: #ff5252;
          border-radius: 12px;
          margin-bottom: 1.5rem;
          border: 1px solid rgba(255, 82, 82, 0.2);
        }

        .login-footer {
          margin-top: 2rem;
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.5);
        }
      `}</style>
    </div>
  );
};
