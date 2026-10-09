import { useState } from "react"; // local state for the form
import { useNavigate } from "react-router-dom"; // go to another page
import API from "../api"; // shared axios instance
import AuthCard from "../components/AuthCard"; // the shared white card
import { Button } from "../components/ui"; // shared button
import { useAuth } from "../AuthContext"; // NEW: lets this page tell the whole app "the user is now logged in"

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // a simple "looks like an email" check

// The sign-in page.
export default function Login() {
    const navigate = useNavigate();
    const { signIn } = useAuth(); // NEW: child → parent: call signIn(name) after the server accepts the login
    const [email, setEmail] = useState("");       // email typed so far
    const [password, setPassword] = useState(""); // password typed so far
    const [loading, setLoading] = useState(false);// true while signing in
    const [error, setError] = useState("");       // message under the form

    const handleLogin = async () => {
        setError(""); // clear an old message
        const trimmedEmail = email.trim(); // drop accidental spaces
        if (!trimmedEmail || !password) { setError("Please enter both your email and password."); return; }
        if (!EMAIL_REGEX.test(trimmedEmail)) { setError("Please enter a valid email address."); return; }
        setLoading(true);
        try {
            const res = await API.post("/auth/login", { email: trimmedEmail, password });
            signIn(res.data.user); // NEW: the server already stored the login in an httpOnly cookie; we only tell the app who logged in (no token touches JavaScript)
            navigate("/dashboard");
        } catch (err) {
            setError(err.response?.data?.message || "Invalid email or password.");
        } finally { setLoading(false); }
    };

    return (
        <AuthCard tagline="Read · Learn · Retain">
            <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" type="password" placeholder="Your password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
            </div>
            {error && <p className="form-error">{error}</p>}
            <Button variant="primary" block onClick={handleLogin} disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
            <p className="auth-link">New here? <button type="button" className="link-btn" onClick={() => navigate("/register")}>Create an account</button></p>
        </AuthCard>
    );
}
