import YarnBallLogo from "./YarnBallLogo"; // the yarn-ball brand mark
// The white card shared by the Sign in and Create account pages, so both look identical.
// tagline = the small line under the name; children = the form fields and buttons (parent → child).
export default function AuthCard({ tagline, children }) {
    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-brand">
                    <YarnBallLogo size={40} />
                    <div className="auth-name">WordKnit.</div>
                    <div className="auth-tagline">{tagline}</div>
                </div>
                {children}
            </div>
        </div>
    );
}
