// These HTTP methods only READ data, so a forged request can't change anything. We let them through without checks.
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// requireAllowedOrigin(allowedOrigins) builds a middleware that defends against CSRF.
// CSRF (cross-site request forgery) = an evil website makes YOUR browser send a request to OUR API, and because cookies are
// attached automatically, the request arrives "logged in as you". With cookie login this attack becomes possible, so we block it.
const requireAllowedOrigin = (allowedOrigins) => (req, res, next) => {
    // Reading requests are harmless, so skip the check for them.
    if (SAFE_METHODS.includes(req.method)) return next();
    // Browsers ALWAYS add an "Origin" header (which website the request came from) to cross-site POST/PATCH/PUT/DELETE requests, and a web page can't fake it.
    const origin = req.get("Origin");
    // No Origin header = not a browser page (Postman, curl, another server). Those don't carry a victim's cookie, so let them through.
    if (!origin) return next();
    // The request comes from one of OUR frontends (the FRONTEND_URL list): allowed.
    if (allowedOrigins.includes(origin)) return next();
    // 403 = "Forbidden": we understood the request but refuse it. A page on some other website tried to use the user's login.
    return res.status(403).json({ message: "Request blocked: origin not allowed." });
};

// Export it so server.js can plug it in after the allowed-origins list has been built.
module.exports = { requireAllowedOrigin };
