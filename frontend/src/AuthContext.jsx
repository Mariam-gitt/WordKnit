// createContext/useContext = React's way to share a value with MANY components without passing props down through every level.
// useState = remember a value in a component; useEffect = run code when the component appears or something changes.
import { createContext, useContext, useEffect, useState } from "react";
// The shared axios instance (it sends the login cookie automatically).
import api from "./api";

// The "box" the login state lives in. Components read it with useAuth() below. null = "no provider above me" (a mistake we catch later).
const AuthContext = createContext(null);

// AuthProvider wraps the whole app (see App.js) and owns the login state.
// DATA FLOW: AuthProvider (parent) ──value──▶ every component that calls useAuth() (children, however deep).
// Children talk back UP by calling the functions signIn / signOut that the provider hands them.
export function AuthProvider({ children }) {
    // status is one of: "checking" (asking the server), "in" (logged in), "out" (not logged in).
    const [status, setStatus] = useState("checking");
    // The logged-in person's display name (from the server); null when logged out.
    const [user, setUser] = useState(null);

    // Runs ONCE when the app first loads: ask the server "does this browser have a valid login cookie?".
    // We have to ask because JavaScript can't see an httpOnly cookie, so localStorage-style peeking is impossible.
    useEffect(() => {
        let cancelled = false; // protects against updating state after this component has been removed
        api.get("/auth/me")
            .then((res) => { // 200 = the cookie is valid
                if (cancelled) return; // component is gone, do nothing
                setUser(res.data.user); // remember the name
                setStatus("in"); // we're logged in
            })
            .catch(() => { // 401 (or network error) = not logged in
                if (cancelled) return; // component is gone, do nothing
                setUser(null); // nobody is logged in
                setStatus("out"); // not logged in
            });
        return () => { cancelled = true; }; // cleanup when the provider unmounts
    }, []); // empty list = run only once, on first load

    // Listens for the "wk-session-expired" event that api.js fires when any private request gets a 401 (cookie expired).
    useEffect(() => {
        const onExpired = () => { setUser(null); setStatus("out"); }; // switch the whole app to "logged out"
        window.addEventListener("wk-session-expired", onExpired); // start listening
        return () => window.removeEventListener("wk-session-expired", onExpired); // stop listening on cleanup
    }, []); // set up once

    // Called by Login/Register (child → parent) right after the server accepted the login and set the cookie.
    const signIn = (name) => { setUser(name); setStatus("in"); };

    // Called by the Logout button and the delete-account flow (child → parent).
    const signOut = async () => {
        // Ask the server to clear the cookie (JavaScript is not allowed to delete an httpOnly cookie itself).
        try { await api.post("/auth/logout"); } catch { /* even if this fails, we still show the user as logged out locally */ }
        setUser(null); // forget the name
        setStatus("out"); // protected pages will now redirect to the login screen
    };

    // Everything the children are allowed to read or call.
    return <AuthContext.Provider value={{ status, user, signIn, signOut }}>{children}</AuthContext.Provider>;
}

// useAuth() = the one-line way for any component to get { status, user, signIn, signOut }.
export function useAuth() {
    const ctx = useContext(AuthContext); // look up the nearest AuthProvider above this component
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>"); // helpful error if someone forgets to wrap the app
    return ctx; // hand back the shared values
}
