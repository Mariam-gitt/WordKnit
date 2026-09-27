

import axios from "axios";

/**
 * Create a reusable axios instance
 */
// const api = axios.create({
//     baseURL: "http://localhost:5000/api"
// });

const api = axios.create({
    // Replace this string with your actual live Vercel URL
    baseURL: "https://my-mern-project-backend.vercel.app/api"
});

/**
 * AUTO-ATTACH TOKEN TO EVERY REQUEST
 */
api.interceptors.request.use(
    (config) => {

        // Get token from localStorage
        const token = localStorage.getItem("token");

        // If token exists, attach it
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }

        return config;
    },

    (error) => {
        return Promise.reject(error);
    }
);

/**
 * AUTO-HANDLE EXPIRED / INVALID TOKENS
 *
 * Before this, if a token expired (or was otherwise rejected by the backend's
 * `protect` middleware), the app didn't actually "log the user out" — it just kept
 * showing whatever page they were on while every single API call quietly failed in
 * the background with a 401. To the user that looked exactly like "I got logged
 * out for no reason", when really the token had simply gone stale.
 *
 * This response interceptor runs on every API response. When the backend replies
 * with 401 Unauthorized (the status `protect` sends for a missing/invalid/expired
 * token), it clears the stale token and sends the user back to the login page —
 * a real, visible logout — instead of leaving them stuck on a broken page.
 */
api.interceptors.response.use(
    // Any successful (non-error) response is passed straight through unchanged.
    (response) => response,

    (error) => {
        // error.response is undefined for network failures (no internet, server
        // down, etc.) — those aren't an auth problem, so we only act on an actual
        // 401 status coming back from the server.
        if (error.response?.status === 401) {
            // Remove the now-invalid token so ProtectedRoute (in App.js) won't
            // think the user is still logged in on the next navigation.
            localStorage.removeItem("token");

            // Avoid an unnecessary redirect loop if the 401 happened to come from
            // a request made while already sitting on the login page.
            if (window.location.pathname !== "/") {
                window.location.href = "/";
            }
        }
        // Re-throw so the calling code's own .catch()/try-catch still runs as before
        // (e.g. a page can still show its own error message alongside this redirect).
        return Promise.reject(error);
    }
);

export default api;