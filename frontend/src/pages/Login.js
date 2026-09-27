import { useState, useEffect } from "react";
import API from "../api";
import { useNavigate } from "react-router-dom";
import YarnBallLogo from "../components/YarnBallLogo";
import { applyTheme } from "../hooks/useTheme";

// Same "looks like a real email" pattern used on the backend (authController.js) —
// duplicated here on purpose so the FRONTEND can reject an obviously bad email
// instantly, without even waiting on a network round-trip to the server.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
    const navigate = useNavigate();
    const [email, setEmail]       = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState("");

    useEffect(() => {
        applyTheme(localStorage.getItem("wk-theme") || "gazette");
    }, []);

    const handleLogin = async () => {
        setError(""); // clear any previous error message before re-checking

        // ── Client-side validation (before hitting the network at all) ──
        const trimmedEmail = email.trim(); // drop accidental leading/trailing spaces

        if (!trimmedEmail || !password) {
            // One or both fields are empty — no point calling the API yet.
            setError("Please enter both your email and password.");
            return;
        }
        if (!EMAIL_REGEX.test(trimmedEmail)) {
            // Catches obvious typos like "mariam@gmail" (missing the ".com" part).
            setError("Please enter a valid email address.");
            return;
        }

        setLoading(true);
        try {
            const res = await API.post("/auth/login", { email: trimmedEmail, password });
            localStorage.setItem("token", res.data.token);
            navigate("/dashboard");
        } catch (err) {
            // Prefer the specific message the backend sends (e.g. "User not found")
            // over a generic one, so the user knows exactly what went wrong.
            setError(err.response?.data?.message || "Invalid email or password.");
        }
        finally { setLoading(false); }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-brand">
                    <div className="auth-brand-logo">
                        <YarnBallLogo size={36} />
                    </div>
                    <div className="auth-brand-name">WordKnit.</div>
                    <div className="auth-brand-sub">Read · Learn · Retain</div>
                </div>

                <div className="input-group">
                    <label className="input-label">Email</label>
                    <input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)}/>
                </div>
                <div className="input-group">
                    <label className="input-label">Password</label>
                    <input type="password" placeholder="••••••••" value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleLogin()}/>
                </div>

                {error && <p className="auth-error">{error}</p>}

                <button className="btn btn-primary" onClick={handleLogin} disabled={loading}>
                    {loading ? "Signing in…" : "Sign In"}
                </button>

                <p className="auth-link">
                    New here? <span onClick={() => navigate("/register")}>Create an account</span>
                </p>
            </div>
        </div>
    );
}
