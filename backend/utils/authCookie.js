// This file is the ONE place that knows how the login cookie is built, set and removed.
// Keeping it here means the controller, the middleware and the tests can never disagree about the cookie's rules.

// The cookie's name. A cookie is a small "name = value" note the browser stores for a website. Ours is called "token".
const COOKIE_NAME = "token";

// How many days a login lasts. The JWT's expiry (in authController.js) and the cookie's lifetime BOTH use this number,
// so the cookie never outlives the token inside it (or the other way round).
const SESSION_DAYS = 30;

// Works out the cookie's safety flags. It is a function (not a constant) so it reads the environment each time it runs.
const getCookieOptions = () => {
    // true when the app runs on the real server (Vercel sets NODE_ENV to "production").
    const isProd = process.env.NODE_ENV === "production";
    // SameSite controls when the browser may attach the cookie to a request that comes from ANOTHER website.
    // "none" = always (needed when the frontend and backend live on different domains, like your two vercel.app addresses).
    // "lax"  = only for normal same-site use (the safe default for local development).
    // You can override it with the COOKIE_SAMESITE environment variable.
    const requested = (process.env.COOKIE_SAMESITE || (isProd ? "none" : "lax")).toLowerCase();
    // Only these three values exist; anything else (a typo) falls back to the safe choice "lax".
    const sameSite = ["lax", "strict", "none"].includes(requested) ? requested : "lax";
    // Secure = "the browser only sends this cookie over https". On in production; COOKIE_SECURE=true/false can override it.
    let secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProd;
    // Browsers REJECT a SameSite=None cookie that is not Secure, so in that case we force Secure on.
    if (sameSite === "none") secure = true;
    // The finished list of flags that goes into the Set-Cookie header.
    return {
        httpOnly: true, // JavaScript on the page can NOT read this cookie (this is the whole point: XSS can't steal it)
        secure,         // only over https when true
        sameSite,       // see above
        path: "/"       // the cookie applies to every URL of the backend
    };
};

// setAuthCookie(res, token): puts the login token into the response as a Set-Cookie header; the browser then stores it.
const setAuthCookie = (res, token) => {
    // maxAge is in milliseconds: days x 24 hours x 60 minutes x 60 seconds x 1000 ms.
    res.cookie(COOKIE_NAME, token, { ...getCookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
};

// clearAuthCookie(res): tells the browser to delete the cookie.
// The flags (path, sameSite, secure) must match the ones used when it was set, otherwise the browser treats it as a DIFFERENT cookie and keeps the original.
const clearAuthCookie = (res) => {
    // clearCookie sends the same cookie back with an expiry date in the past, which makes the browser remove it.
    res.clearCookie(COOKIE_NAME, getCookieOptions());
};

// Export everything other files need.
module.exports = { COOKIE_NAME, SESSION_DAYS, setAuthCookie, clearAuthCookie };
