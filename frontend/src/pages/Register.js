import { useState, useEffect } from "react";
import API from "../api";
import { useNavigate } from "react-router-dom";
import YarnBallLogo from "../components/YarnBallLogo";
import { applyTheme } from "../hooks/useTheme";

// Same "looks like a real email" pattern used on the backend (authController.js) —
// duplicated here so the FRONTEND can reject an obviously bad email instantly,
// without waiting on a network round-trip just to find out it's malformed.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Register() {
    const navigate = useNavigate();
    useEffect(() => { applyTheme(localStorage.getItem("wk-theme") || "gazette"); }, []);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleRegister = async () => {
        setError(""); // clear any previous error before re-validating

        // ── Client-side validation (mirrors the backend's rules in authController.js,
        //    so the user sees the same feedback instantly instead of after a round-trip) ──
        const trimmedName  = name.trim();
        const trimmedEmail = email.trim();

        if (!trimmedName) {
            setError("Please enter your name.");
            return;
        }
        if (!trimmedEmail) {
            setError("Please enter your email address.");
            return;
        }
        if (!EMAIL_REGEX.test(trimmedEmail)) {
            // Catches obvious typos, e.g. "mariam@gmail" missing the ".com".
            setError("Please enter a valid email address.");
            return;
        }
        if (!password || password.length < 6) {
            // Matches the backend's minimum length so the message never contradicts
            // what the server would say anyway.
            setError("Password must be at least 6 characters long.");
            return;
        }

        setLoading(true);
        try {
            const res = await API.post("/auth/register", { name: trimmedName, email: trimmedEmail, password });
            // Backend now issues a token on register too — log straight in
            // instead of bouncing back to the login page.
            localStorage.setItem("token", res.data.token);
            navigate("/dashboard");
        } catch (err) {
            setError(err.response?.data?.message || "Registration failed. Please try again.");
        } finally { setLoading(false); }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-brand">
                    <div className="auth-brand-logo">
                        <YarnBallLogo size={36} />
                    </div>
                    <div className="auth-brand-name">WordKnit.</div>
                    <div className="auth-brand-sub">Create your vocabulary companion</div>
                </div>

                <div className="input-group">
                    <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)}/>
                    <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)}/>
                    <input type="password" placeholder="Password" value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleRegister()}/>
                </div>

                {error && <p className="auth-error">{error}</p>}

                <button className="btn btn-primary" onClick={handleRegister} disabled={loading}>
                    {loading ? "Creating..." : "Create Account"}
                </button>

                <p className="auth-link">
                    Already have an account? <span onClick={() => navigate("/")}>Sign in</span>
                </p>
            </div>
        </div>
    );
}
