import React, { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { setSessionToken, setActiveUserEmail } from "../lib/api";

export const LoginSuccessPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    const email = searchParams.get("email");

    if (token && email) {
      console.log("Login success, setting credentials and navigating...");
      setSessionToken(token);
      setActiveUserEmail(email);
      navigate("/dashboard", { replace: true });
    } else {
      navigate("/login?error=missing_credentials", { replace: true });
    }
  }, [searchParams, navigate]);

  return (
    <div className="login-success-page">
      <div className="loader-container">
        <div className="spinner"></div>
        <p>Completing secure sign-in...</p>
      </div>

      <style>{`
        .login-success-page {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: #0f0c29;
          color: white;
        }
        .loader-container {
          text-align: center;
        }
        .spinner {
          width: 50px;
          height: 50px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-top: 3px solid #646cff;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 1.5rem;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        p {
          font-size: 1.1rem;
          color: rgba(255, 255, 255, 0.7);
        }
      `}</style>
    </div>
  );
};
