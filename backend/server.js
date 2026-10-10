const logger = require("./utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const express = require("express");
const cors = require("cors");
const helmet = require("helmet"); // adds protective security headers to every response
const cookieParser = require("cookie-parser"); // reads the Cookie header the browser sends and puts the values in req.cookies
const { notFound, errorHandler } = require("./middleware/errorHandler"); // NEW: one central place for "no such route" and "something crashed" answers
const { requireAllowedOrigin } = require("./middleware/originCheck"); // CSRF defence: blocks state-changing requests that come from other websites
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const { aiLimiter } = require("./middleware/rateLimiters"); // SECURITY: limits how often the paid-AI routes can be called

dotenv.config({ quiet: process.env.NODE_ENV === "test" }); // "quiet" hides dotenv's start-up banner while automated tests run

const app = express();

// SECURITY: this app sits behind a proxy (Vercel in production, nginx in Docker). "trust proxy" = 1 tells Express to
// believe the proxy about the visitor's real IP address. Without it every visitor would look like the same IP,
// and the rate limiter would count all users together instead of each person separately.
app.set("trust proxy", 1);

// helmet = one line that adds a bundle of protective HTTP response headers (e.g. stop browsers guessing file types, block the page being put in an iframe).
// crossOriginResourcePolicy "cross-origin" is set because this is an API that a frontend on ANOTHER domain must be allowed to call.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS = the browser rule "a web page may only call an API on another domain if that API says it's allowed".
// SECURITY: before, origin was "*" (ANY website could call this API from a visitor's browser). Now only the origins listed in the
// FRONTEND_URL environment variable are allowed. Several can be given, separated by commas, e.g. "https://wordknit.vercel.app,http://localhost:5173".
// If FRONTEND_URL isn't set we fall back to the local Vite dev server so `npm run dev` still works on your laptop.
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")                 // turn "a,b" into ["a", "b"]
    .map((url) => url.trim().replace(/\/$/, "")) // remove spaces and a trailing "/" — browsers send origins WITHOUT a trailing slash
    .filter(Boolean);           // drop empty entries (e.g. from an accidental trailing comma)

// If this is the live server and FRONTEND_URL was forgotten, the deployed frontend would be blocked — warn loudly in the logs.
if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
    logger.warn("WARNING: FRONTEND_URL is not set — the deployed frontend will be blocked by CORS.");
}

const corsOptions = {
    // origin can be a function: the browser's Origin header comes in, and we answer yes or no.
    origin: (origin, callback) => {
        // No Origin header = not a browser cross-site call (curl, Postman, server-to-server, same-origin requests). CORS doesn't apply to those.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        // Not on the list: answer "no" WITHOUT throwing — the browser then blocks the response, and the server doesn't log a scary error.
        return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], // the HTTP methods the frontend is allowed to use
    allowedHeaders: ["Content-Type"], // the only header the frontend sends now (the login token travels in a cookie, so "Authorization" is no longer needed)
    credentials: true // NEW: lets the browser send/receive cookies on cross-site calls. Safe ONLY because origin above is a specific list, never "*" (browsers refuse that combo).
};

app.use(cors(corsOptions));

app.use(express.json());

// NEW: fills req.cookies from the Cookie header, so the `protect` middleware can read the login cookie.
app.use(cookieParser());

// NEW (SECURITY): with cookie login, an evil website could make a visitor's browser send POST/PATCH/DELETE requests to this API.
// This check rejects any such request whose Origin is not one of our own frontends (the same FRONTEND_URL list as CORS).
app.use(requireAllowedOrigin(allowedOrigins));

// Connect to MongoDB before handling each request. This looks wasteful, but it's actually
// cheap and necessary: on Vercel, each request may hit a fresh serverless instance with no
// existing DB connection, and connectDB() (see config/db.js) reuses the connection instead
// of reconnecting when one is already open, so this is a near-instant no-op most of the time.
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        // If the DB is genuinely unreachable, respond with a normal error instead of letting
        // the request hang or crash the whole function (see the connectDB() comment for why
        // this matters — it used to call process.exit(1), which is worse in serverless).
        res.status(503).json({ message: "Database temporarily unavailable, please try again" });
    }
});

// Routes
app.get("/", (req, res) => res.send("Vocabulary App Backend is running 🚀"));
// Temporary test route: visit this URL directly in a browser to check the HubSpot
// integration without needing to check server logs. Safe to delete once confirmed working.
// Note: calls the HubSpot API directly here (rather than reusing syncContactToHubspot),
// because that function intentionally swallows its own errors so it never breaks real
// signups — which means it wouldn't show us a failure here either.
// SECURITY: this debug route creates a real HubSpot contact and has no login check, so it is only registered
// outside production (NODE_ENV !== "production"). On a deployed server it simply doesn't exist (404).
if (process.env.NODE_ENV !== "production") app.get("/api/test-hubspot", async (req, res) => {
    const axios = require("axios");
    // Check first whether the token even exists in this environment — this alone tells us
    // if the Vercel env var actually reached the running app.
    if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
        return res.status(500).json({ ok: false, reason: "HUBSPOT_PRIVATE_APP_TOKEN is not set in this environment" });
    }
    try {
        const response = await axios.post(
            "https://api.hubapi.com/crm/v3/objects/contacts",
            {
                properties: {
                    email: `test-route-${Date.now()}@example.com`,
                    firstname: "Test",
                    lastname: "Route"
                }
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );
        res.json({ ok: true, hubspotContactId: response.data.id, message: "Success — check your HubSpot Contacts tab" });
    } catch (err) {
        res.status(500).json({
            ok: false,
            status: err.response?.status,
            hubspotError: err.response?.data || err.message
        });
    }
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/words", require("./routes/wordRoutes"));
app.use("/api/pdf", require("./routes/pdfRoutes"));
app.use("/api/contextual", aiLimiter, require("./routes/contextualRoutes")); // SECURITY: aiLimiter = max 150 AI calls / 15 min / IP
app.use("/api/speaking", aiLimiter, require("./routes/speakingRoutes")); // speaking-practice: STT -> Groq LLM -> TTS conversation loop
// OCR is parked for now (works on your Hugging Face Space, but not reliable yet) — set
// OCR_SERVICE_URL and uncomment this line whenever you're ready to bring it back live.
// app.use("/api/ocr", require("./routes/ocrRoutes"));
app.use("/api/profile", require("./routes/wordProfileRoutes"));
app.use("/api/documents", require("./routes/documentRoutes"));
app.use("/api/bookmarks", require("./routes/bookmarkRoutes"));

// NEW: these two MUST come after every route. If no route matched → notFound (404). If any route threw an error → errorHandler (one place, one JSON shape).
app.use(notFound);
app.use(errorHandler);

// NEW: require.main === module is true ONLY when you start this file directly (node server.js, npm start, Docker).
// It is false when another file imports server.js — which is what Vercel does, and what the automated tests do — so the server doesn't start listening twice.
// (Before, the check was NODE_ENV !== "production", which meant the Docker backend — it sets NODE_ENV=production — never started listening at all.)
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));
}

module.exports = app;

