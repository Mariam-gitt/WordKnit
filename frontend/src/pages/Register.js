import { useState } from "react"; // local state for the form
import { useNavigate } from "react-router-dom"; // go to another page
import API from "../api"; // shared axios instance
import AuthCard from "../components/AuthCard"; // the shared white card
import { Button } from "../components/ui"; // shared button

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // a simple "looks like an email" check

// The create-account page.
export default function Register() {
    const navigate = useNavigate();
    const [name, setName] = useState("");         // name typed so far
    const [email, setEmail] = useState("");       // email typed so far
    const [password, setPassword] = useState(""); // password typed so far
    const [loading, setLoading] = useState(false);// true while creating the account
    const [error, setError] = useState("");       // message under the form

    const handleRegister = async () => {
        setError(""); // clear an old message
        const trimmedName = name.trim();
        const trimmedEmail = email.trim();
        if (!trimmedName) { setError("Please enter your name."); return; }
        if (!trimmedEmail) { setError("Please enter your email address."); return; }
        if (!EMAIL_REGEX.test(trimmedEmail)) { setError("Please enter a valid email address."); return; }
        if (!password || password.length < 6) { setError("Password must be at least 6 characters long."); return; }
        setLoading(true);
        try {
            const res = await API.post("/auth/register", { name: trimmedName, email: trimmedEmail, password });
            localStorage.setItem("token", res.data.token); // remember the login
            navigate("/dashboard");
        } catch (err) {
            setError(err.response?.data?.message || "Registration failed. Please try again.");
        } finally { setLoading(false); }
    };

    return (
        <AuthCard tagline="Create your vocabulary companion">
            <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" placeholder="At least 6 characters" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRegister()} />
            </div>
            {error && <p className="form-error">{error}</p>}
            <Button variant="primary" block onClick={handleRegister} disabled={loading}>{loading ? "Creating…" : "Create account"}</Button>
            <p className="auth-link">Already have an account? <button type="button" className="link-btn" onClick={() => navigate("/")}>Sign in</button></p>
        </AuthCard>
    );
}
