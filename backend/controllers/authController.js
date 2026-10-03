// const User = require("../models/User");
// const bcrypt = require("bcryptjs");
// const jwt = require("jsonwebtoken");
// const axios = require("axios");

// const signToken = (userId) => jwt.sign(
//     { id: userId },
//     process.env.JWT_SECRET,
//     { expiresIn: "1d" }
// );

// /**
//  * Send a welcome email via Resend. Fire-and-forget: registration must
//  * succeed even if this fails (missing API key, Resend outage, etc.) —
//  * email is a nice-to-have, not a requirement for account creation.
//  */
// const sendWelcomeEmail = async (name, email) => {
//     if (!process.env.RESEND_API_KEY) {
//         console.log("[Email] RESEND_API_KEY not set — skipping welcome email");
//         return;
//     }
//     try {
//         await axios.post(
//             "https://api.resend.com/emails",
//             {
//                 from: process.env.RESEND_FROM_EMAIL || "WordKnit <onboarding@resend.dev>",
//                 to: email,
//                 subject: "Welcome to WordKnit 💛",
//                 html: `
//                     <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
//                         <h2 style="color: #9b2335;">Welcome to WordKnit, ${name}!</h2>
//                         <p>Your account is ready. Start building your vocabulary by reading PDFs,
//                         saving words, and quizzing yourself — WordKnit will help the words stick.</p>
//                         <p style="color: #888; font-size: 13px; margin-top: 32px;">
//                             If you didn't create this account, you can safely ignore this email.
//                         </p>
//                     </div>
//                 `
//             },
//             {
//                 headers: {
//                     "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
//                     "Content-Type": "application/json"
//                 },
//                 timeout: 8000
//             }
//         );
//         console.log(`[Email] Welcome email sent to ${email}`);
//     } catch (err) {
//         console.log("[Email] Failed to send welcome email:", err.response?.data || err.message);
//     }
// };

// /**
//  * REGISTER USER
//  */
// exports.register = async (req, res) => {

//     const { name, email, password } = req.body;

//     try {
//         // check if user exists
//         const exists = await User.findOne({ email });
//         if (exists) {
//             return res.status(400).json({ message: "User already exists" });
//         }

//         // hash password (security)
//         const hashedPassword = await bcrypt.hash(password, 10);

//         // create user
//         const user = await User.create({
//             name,
//             email,
//             password: hashedPassword
//         });

//         // Issue a token immediately so the frontend can auto-login —
//         // no need to make the user re-enter credentials on the login page.
//         const token = signToken(user._id);

//         // Don't await — email sending shouldn't delay or risk the response.
//         sendWelcomeEmail(name, email);

//         res.json({
//             message: "User registered successfully 💛",
//             token,
//             user: user.name
//         });

//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// };

// /**
//  * LOGIN USER
//  */
// exports.login = async (req, res) => {

//     const { email, password } = req.body;

//     try {
//         const user = await User.findOne({ email });
//         if (!user) return res.status(400).json({ message: "User not found" });

//         const isMatch = await bcrypt.compare(password, user.password);
//         if (!isMatch) return res.status(400).json({ message: "Invalid password" });

//         const token = signToken(user._id);
//         res.json({ token, user: user.name });

//     } catch (error) {
//         res.status(500).json({ message: error.message });
//     }
// };

// /**
//  * DELETE ACCOUNT
//  * Removes the user + all their associated data
//  */
// exports.deleteAccount = async (req, res) => {
//     try {
//         const userId = req.user;

//         const Word     = require("../models/Word");
//         const Document = require("../models/Document");
//         const Bookmark = require("../models/Bookmark");

//         // Delete all user data in parallel
//         await Promise.all([
//             Word.deleteMany({ userId }),
//             Bookmark.deleteMany({ userId }),
//             Document.deleteMany({ userId }),
//             User.findByIdAndDelete(userId)
//         ]);

//         res.json({ message: "Account deleted" });

//     } catch (error) {
//         console.log("DELETE ACCOUNT ERROR:", error.message);
//         res.status(500).json({ message: "Failed to delete account" });
//     }
// };

// /**
//  * TEST EMAIL  (debug only — remove in production)
//  * Hit GET /api/auth/test-email to verify Resend config is working
//  */
// exports.testEmail = async (req, res) => {
//     if (!process.env.RESEND_API_KEY) {
//         return res.status(500).json({ error: "RESEND_API_KEY is not set in .env" });
//     }
//     try {
//         const resp = await axios.post(
//             "https://api.resend.com/emails",
//             {
//                 from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
//                 to: process.env.RESEND_TEST_TO || req.query.to || "delivered@resend.dev",
//                 subject: "WordKnit email test",
//                 html: "<p>Email is working ✓</p>"
//             },
//             {
//                 headers: {
//                     "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
//                     "Content-Type": "application/json"
//                 },
//                 timeout: 8000
//             }
//         );
//         res.json({ ok: true, resend: resp.data });
//     } catch (err) {
//         res.status(500).json({
//             ok: false,
//             error: err.response?.data || err.message,
//             hint: "Check RESEND_API_KEY value and that RESEND_FROM_EMAIL has no wrapping quotes"
//         });
//     }
// };



const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { syncContactToHubspot } = require("../utils/hubspotService");
// New: pulls in our HubSpot sync function so we can call it during registration below.

// signToken(): bundles a user's Mongo _id into a signed JWT (JSON Web Token) — a
// tamper-proof string the frontend stores and sends back on every request so the
// server knows who's asking without re-checking the password each time.
// expiresIn was previously "1d" (one day), which is why people kept getting logged
// out overnight even though nothing was wrong — the token itself was expiring, not
// a real bug in the login flow. Bumped to "30d" so a login sticks around for a
// month of inactivity, which is what "stay logged in" normally means to a user.
const signToken = (userId) => jwt.sign(
    { id: userId }, // payload: only the user's id is embedded, nothing sensitive
    process.env.JWT_SECRET, // secret key used to sign + later verify the token
    { expiresIn: "30d" } // token (and therefore the logged-in session) now lasts 30 days
);

// ── Shared validation helpers (used by both register and login below) ──

// A simple, widely-used pattern for "looks like an email": something, an @, something,
// a dot, something. Not a full RFC-5322 validator (those are notoriously overkill) —
// just enough to catch obvious typos like "mariam@gmail" or "mariamgmail.com".
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Centralizes the register/login input checks so both routes give the same,
// predictable error messages instead of duplicating the same if-checks twice.
// Returns a string describing the FIRST problem found, or null if everything's fine.
const validateCredentials = ({ name, email, password, isRegister }) => {
    // isRegister is true only on the register route — login doesn't need a name.
    if (isRegister && (!name || !name.trim())) {
        return "Name is required.";
    }
    if (!email || !email.trim()) {
        return "Email is required.";
    }
    if (!EMAIL_REGEX.test(email.trim())) {
        return "Please enter a valid email address.";
    }
    if (!password) {
        return "Password is required.";
    }
    // Only enforce a minimum length on register — an existing account created before
    // this rule shouldn't suddenly be told its (already-set) password is "too short"
    // just to log in.
    if (isRegister && password.length < 6) {
        return "Password must be at least 6 characters long.";
    }
    return null; // no problems found
};

/**
 * Send a welcome email via Resend. Fire-and-forget: registration must
 * succeed even if this fails (missing API key, Resend outage, etc.) —
 * email is a nice-to-have, not a requirement for account creation.
 */
const sendWelcomeEmail = async (name, email) => {
    if (!process.env.RESEND_API_KEY) {
        console.log("[Email] RESEND_API_KEY not set — skipping welcome email");
        return;
    }
    try {
        await axios.post(
            "https://api.resend.com/emails",
            {
                from: process.env.RESEND_FROM_EMAIL || "WordKnit <onboarding@resend.dev>",
                to: email,
                subject: "Welcome to WordKnit 💛",
                html: `
                    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                        <h2 style="color: #9b2335;">Welcome to WordKnit, ${name}!</h2>
                        <p>Your account is ready. Start building your vocabulary by reading PDFs,
                        saving words, and quizzing yourself — WordKnit will help the words stick.</p>
                        <p style="color: #888; font-size: 13px; margin-top: 32px;">
                            If you didn't create this account, you can safely ignore this email.
                        </p>
                    </div>
                `
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 8000
            }
        );
        console.log(`[Email] Welcome email sent to ${email}`);
    } catch (err) {
        console.log("[Email] Failed to send welcome email:", err.response?.data || err.message);
    }
};

/**
 * REGISTER USER
 */
exports.register = async (req, res) => {

    const { name, email, password } = req.body;

    // Run the shared checks (name present, email looks real, password long enough)
    // BEFORE touching the database at all — fail fast with a clear message instead
    // of e.g. letting bcrypt or Mongo throw a confusing error on bad input.
    const validationError = validateCredentials({ name, email, password, isRegister: true });
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    // Normalize the email once here so "Mariam@Gmail.com" and "mariam@gmail.com"
    // are always treated as the exact same account — trim() drops stray leading/
    // trailing spaces, toLowerCase() removes case as a source of "duplicate" accounts.
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    try {
        // check if user exists (now checked against the normalized email)
        const exists = await User.findOne({ email: normalizedEmail });
        if (exists) {
            return res.status(400).json({ message: "User already exists" });
        }

        // hash password (security)
        const hashedPassword = await bcrypt.hash(password, 10);

        // create user
        const user = await User.create({
            name: trimmedName,
            email: normalizedEmail,
            password: hashedPassword
        });

        // Issue a token immediately so the frontend can auto-login —
        // no need to make the user re-enter credentials on the login page.
        const token = signToken(user._id);

        // Don't await — email sending shouldn't delay or risk the response.
        sendWelcomeEmail(trimmedName, normalizedEmail);

        // New: sync this new user into HubSpot as a Contact.
        // Same fire-and-forget pattern as sendWelcomeEmail above — no "await" here,
        // so a slow or failed HubSpot call can never delay or break the user's registration response.
        syncContactToHubspot(trimmedName, normalizedEmail);

        res.json({
            message: "User registered successfully 💛",
            token,
            user: user.name
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * LOGIN USER
 */
exports.login = async (req, res) => {

    const { email, password } = req.body;

    // Same shared checks as register (minus the name/min-length rule, since
    // isRegister defaults to falsy) — catches an empty or malformed email/password
    // before ever hitting the database.
    const validationError = validateCredentials({ email, password, isRegister: false });
    if (validationError) {
        return res.status(400).json({ message: validationError });
    }

    // Normalize the same way register does, so a user who typed their email in a
    // different case at signup can still log in without it being treated as "not found".
    const normalizedEmail = email.trim().toLowerCase();

    try {
        const user = await User.findOne({ email: normalizedEmail });

        // SECURITY: one identical message for "no such email" AND "wrong password". Two different messages
        // would let an attacker test which emails have accounts (called "user enumeration").
        const INVALID_LOGIN = "Invalid email or password.";
        if (!user) return res.status(400).json({ message: INVALID_LOGIN });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: INVALID_LOGIN });

        const token = signToken(user._id);
        res.json({ token, user: user.name });

    } catch (error) {
        // SECURITY: log the real reason on the server, but send the user a generic message so internal details never leak.
        console.log("LOGIN ERROR:", error.message);
        res.status(500).json({ message: "Login failed. Please try again." });
    }
};

/**
 * DELETE ACCOUNT
 * Removes the user + all their associated data
 */
exports.deleteAccount = async (req, res) => {
    try {
        const userId = req.user;

        const Word     = require("../models/Word");
        const Document = require("../models/Document");
        const Bookmark = require("../models/Bookmark");
        const SpeakingSession = require("../models/SpeakingSession"); // NEW: speaking sessions were being left behind after account deletion

        // Delete all user data in parallel
        await Promise.all([
            SpeakingSession.deleteMany({ userId }), // NEW: remove this user's speaking-practice history too
            Word.deleteMany({ userId }),
            Bookmark.deleteMany({ userId }),
            Document.deleteMany({ userId }),
            User.findByIdAndDelete(userId)
        ]);

        res.json({ message: "Account deleted" });

    } catch (error) {
        console.log("DELETE ACCOUNT ERROR:", error.message);
        res.status(500).json({ message: "Failed to delete account" });
    }
};

/**
 * TEST EMAIL  (debug only — remove in production)
 * Hit GET /api/auth/test-email to verify Resend config is working
 */
exports.testEmail = async (req, res) => {
    if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: "RESEND_API_KEY is not set in .env" });
    }
    try {
        const resp = await axios.post(
            "https://api.resend.com/emails",
            {
                from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
                to: process.env.RESEND_TEST_TO || req.query.to || "delivered@resend.dev",
                subject: "WordKnit email test",
                html: "<p>Email is working ✓</p>"
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 8000
            }
        );
        res.json({ ok: true, resend: resp.data });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.response?.data || err.message,
            hint: "Check RESEND_API_KEY value and that RESEND_FROM_EMAIL has no wrapping quotes"
        });
    }
};
