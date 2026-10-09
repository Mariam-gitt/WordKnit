// axios = the library the app uses to send HTTP requests (GET, POST, ...) to the backend.
import axios from "axios";

// The backend address now comes from the VITE_API_URL environment variable (Vite exposes variables that start with VITE_ as import.meta.env.<NAME>).
// If it isn't set we fall back to your deployed Vercel backend, so nothing changes unless you choose to set it.
// Local development: create frontend/.env containing  VITE_API_URL=http://localhost:5000/api
// Docker already sets VITE_API_URL=/api (see frontend/Dockerfile), which this line now actually respects.
const baseURL = import.meta.env.VITE_API_URL || "https://my-mern-project-backend.vercel.app/api";

// Create ONE reusable axios instance; every page imports this same object, so these settings apply to every request in the app.
const api = axios.create({
    baseURL, // every request path like "/words" is added to this address
    withCredentials: true // NEW: tells the browser to send and accept COOKIES on these requests. Without it the browser silently ignores the login cookie.
});

// BEFORE this file had a request interceptor that read the token from localStorage and added an "Authorization: Bearer ..." header by hand.
// It is gone: the browser now attaches the httpOnly login cookie by itself, and JavaScript never touches the token at all.

// Paths where a 401 ("not logged in") is a NORMAL answer, not a sign that a session just expired.
// /auth/me is asked on every page load, and a visitor who hasn't signed in yet will (correctly) get a 401 there.
const NORMAL_401_PATHS = ["/auth/me", "/auth/login", "/auth/register"];

// A response interceptor = a function that sees EVERY response (and every error) before the page that asked for it does.
api.interceptors.response.use(
    // Successful responses just pass through untouched.
    (response) => response,
    // Failed responses come here first.
    (error) => {
        // error.config.url is the path that was requested, e.g. "/words" or "/auth/me".
        const url = error.config?.url || "";
        // 401 on a normal private request means the cookie expired or is invalid: the session is over.
        if (error.response?.status === 401 && !NORMAL_401_PATHS.includes(url)) {
            // We can't use React here (this file knows nothing about components), so we shout an event that AuthContext listens for.
            // That makes the whole app switch to "logged out" and the protected pages send the user to the login screen.
            window.dispatchEvent(new Event("wk-session-expired"));
        }
        // Still pass the error on, so the page that made the request can show its own message as before.
        return Promise.reject(error);
    }
);

// Export the instance; pages write: import api from "../api".
export default api;
