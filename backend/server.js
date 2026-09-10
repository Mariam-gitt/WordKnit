// const express = require("express");
// const cors = require("cors");
// const dotenv = require("dotenv");
// const connectDB = require("./config/db");

// dotenv.config();

// const app = express();

// // ✅ CORS first
// // const corsOptions = {
// //     origin: "https://my-mern-project-frontend-1.vercel.app",
// //     "http://localhost:3000",
// //   "http://localhost:3001",
// //     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
// //     allowedHeaders: ["Content-Type", "Authorization"],
// //     credentials: true
// // };
// const corsOptions = {
//     origin: "*",
//     methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//     credentials: true
// };

// app.use(cors(corsOptions));
// // app.options("*", cors(corsOptions)); // ✅ fixed wildcard

// app.use(express.json());

// // ✅ Connect DB on every request (safe due to readyState check in db.js)
// app.use(async (req, res, next) => {
//     await connectDB();
//     next();
// });

// // Routes
// app.get("/", (req, res) => res.send("Vocabulary App Backend is running 🚀"));
// // Temporary test route: visit this URL directly in a browser to check the HubSpot
// // integration without needing to check server logs. Safe to delete once confirmed working.
// // Note: calls the HubSpot API directly here (rather than reusing syncContactToHubspot),
// // because that function intentionally swallows its own errors so it never breaks real
// // signups — which means it wouldn't show us a failure here either.
// app.get("/api/test-hubspot", async (req, res) => {
//     const axios = require("axios");
//     // Check first whether the token even exists in this environment — this alone tells us
//     // if the Vercel env var actually reached the running app.
//     if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
//         return res.status(500).json({ ok: false, reason: "HUBSPOT_PRIVATE_APP_TOKEN is not set in this environment" });
//     }
//     try {
//         const response = await axios.post(
//             "https://api.hubapi.com/crm/v3/objects/contacts",
//             {
//                 properties: {
//                     email: `test-route-${Date.now()}@example.com`,
//                     firstname: "Test",
//                     lastname: "Route"
//                 }
//             },
//             {
//                 headers: {
//                     "Authorization": `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`,
//                     "Content-Type": "application/json"
//                 }
//             }
//         );
//         res.json({ ok: true, hubspotContactId: response.data.id, message: "Success — check your HubSpot Contacts tab" });
//     } catch (err) {
//         res.status(500).json({
//             ok: false,
//             status: err.response?.status,
//             hubspotError: err.response?.data || err.message
//         });
//     }
// });

// app.use("/api/auth", require("./routes/authRoutes"));
// app.use("/api/words", require("./routes/wordRoutes"));
// app.use("/api/quiz", require("./routes/quizRoutes"));
// app.use("/api/pdf", require("./routes/pdfRoutes"));
// app.use("/api/rag", require("./routes/ragRoutes"));
// app.use("/api/contextual", require("./routes/contextualRoutes"));
// app.use("/api/ragl", require("./routes/ragLlmRoutes"));
// // OCR temporarily disabled — uncomment to re-enable (ocrRoutes.js/ocr_service.py left intact)
// // app.use("/api/ocr", require("./routes/ocrRoutes"));
// app.use("/api/profile", require("./routes/wordProfileRoutes"));
// app.use("/api/documents", require("./routes/documentRoutes"));
// app.use("/api/bookmarks", require("./routes/bookmarkRoutes"));

// if (process.env.NODE_ENV !== "production") {
//     const PORT = process.env.PORT || 5000;
//     app.listen(PORT, () => console.log(`Local server running on port ${PORT}`));
// }

// module.exports = app;


const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

const app = express();

// CORS lets the deployed frontend (a different domain) call this API. "*" allows any
// origin — fine for now since there's no cookie-based auth, but tighten this to your
// actual frontend URL later if you want to restrict who can call the API directly.
const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
};

app.use(cors(corsOptions));

app.use(express.json());

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
app.get("/api/test-hubspot", async (req, res) => {
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
app.use("/api/quiz", require("./routes/quizRoutes"));
app.use("/api/pdf", require("./routes/pdfRoutes"));
app.use("/api/contextual", require("./routes/contextualRoutes"));
// OCR is parked for now (works on your Hugging Face Space, but not reliable yet) — set
// OCR_SERVICE_URL and uncomment this line whenever you're ready to bring it back live.
// app.use("/api/ocr", require("./routes/ocrRoutes"));
app.use("/api/profile", require("./routes/wordProfileRoutes"));
app.use("/api/documents", require("./routes/documentRoutes"));
app.use("/api/bookmarks", require("./routes/bookmarkRoutes"));

if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Local server running on port ${PORT}`));
}

module.exports = app;

