import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { apiClient } from "./lib/api.ts";
import { ApplicationsPage } from "./pages/ApplicationsPage.tsx";
import { CompanyOverviewPage } from "./pages/CompanyOverviewPage.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { CVsPage } from "./pages/CVsPage.tsx";
import { JobMatcherPage } from "./pages/JobMatcherPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { LoginSuccessPage } from "./pages/LoginSuccessPage.tsx";
import { getSessionToken } from "./lib/api.ts";

const links = [
  { to: "/dashboard", label: "Dashboard", hint: "Pipeline at a glance", icon: "📊" },
  { to: "/applications", label: "Applications", hint: "Review & update", icon: "📋" },
  { to: "/cvs", label: "My CVs", hint: "Upload & scan", icon: "📄" },
  { to: "/matcher", label: "Job Matcher", hint: "Analyze job URLs", icon: "🎯" },
  { to: "/settings", label: "Settings", hint: "Gmail & schedule", icon: "⚙️" },
];

function App() {
  const location = useLocation();
  const [auth, setAuth] = useState<{ connected: boolean; email: string | null }>({
    connected: false,
    email: null,
  });
  const [statusCheckDegraded, setStatusCheckDegraded] = useState(false);
  const [tokenSnapshot, setTokenSnapshot] = useState<string | null>(getSessionToken());

  useEffect(() => {
    const handleStorage = () => setTokenSnapshot(getSessionToken());
    window.addEventListener("storage", handleStorage);
    const tInt = setInterval(() => {
      const current = getSessionToken();
      if (current !== tokenSnapshot) setTokenSnapshot(current);
    }, 100); // Check every 100ms instead of 1s
    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(tInt);
    };
  }, [tokenSnapshot]);

  const token = getSessionToken();

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      if (!token && location.pathname !== "/login" && location.pathname !== "/login-success") {
        return;
      }

      try {
        const status = await apiClient.getAuthStatus();
        if (active) {
          setAuth(status);
          setStatusCheckDegraded(false);
        }
      } catch {
        if (active) setStatusCheckDegraded(true);
      }
    };

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 15000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [token]);

  const isAuthPage = location.pathname === "/login" || location.pathname === "/login-success";

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login-success" element={<LoginSuccessPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="header-content">
          <div className="header-info">
            <p className="eyebrow">CV Manager</p>
            <h1>CV Application Tracker</h1>
            <p className="subtitle">Your personal job search companion — track applications, stay on top of follow-ups, and land that offer.</p>
            <p className={`connection-status ${auth.connected ? "connected" : "disconnected"}`}>
              Gmail: {auth.connected ? auth.email : "Not connected"}
              {statusCheckDegraded ? " | status check retrying..." : ""}
            </p>
          </div>
          <div className="header-actions">
            <button className="btn-secondary signout-btn" onClick={() => apiClient.logout()}>
              Sign Out
            </button>
          </div>
        </div>
        <nav className="app-nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
            >
              <span>{link.icon} {link.label}</span>
              <small>{link.hint}</small>
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login-success" element={<LoginSuccessPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/companies/:companyDomain" element={<CompanyOverviewPage />} />
          <Route path="/cvs" element={<CVsPage />} />
          <Route path="/matcher" element={<JobMatcherPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      <footer className="app-footer">
        <p>
          Created by <strong>Igal Boguslavsky</strong> | <a href="mailto:igal.bogu@gmail.com">igal.bogu@gmail.com</a>
        </p>
        <div className="legal-links">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">Terms of Service</a>
        </div>
      </footer>

      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {links.map((link) => (
          <NavLink
            key={`mobile-${link.to}`}
            to={link.to}
            className={({ isActive }) => (isActive ? "mobile-bottom-link active" : "mobile-bottom-link")}
          >
            <div style={{ fontSize: "1.2rem", lineHeight: 1 }}>{link.icon}</div>
            <div>{link.label}</div>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default App;
