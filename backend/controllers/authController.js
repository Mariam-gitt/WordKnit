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
//                         <h2 style="color: #9b2335;">Welcome to WordKnit, ${escapeHtml(name)}!</h2>
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
const { SESSION_DAYS, setAuthCookie, clearAuthCookie } = require("../utils/authCookie"); // shared cookie rules: lifetime in days + helpers that set/clear the login cookie
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
    { expiresIn: `${SESSION_DAYS}d` } // token lifetime now comes from ONE shared number (utils/authCookie.js), so it always matches the cookie's lifetime
);

// NOTE: the old hand-written validateCredentials() + EMAIL_REGEX that lived here were MOVED to validators/authSchemas.js (zod).
// The routes now run validateBody(registerSchema / loginSchema) BEFORE these controllers, so req.body is already checked and cleaned here.

// escapeHtml(): turns the special HTML characters into harmless text so a user-typed name can't inject HTML into the welcome email.
// Example: a name like <b>hi</b> would otherwise be rendered as real bold text (or worse, a fake link) inside the email.
const escapeHtml = (text) => String(text)
    .replace(/&/g, "&amp;")   // & must be replaced FIRST, otherwise we would double-escape the & in the next lines
    .replace(/</g, "&lt;")    // < starts an HTML tag, so it becomes the harmless text &lt;
    .replace(/>/g, "&gt;")    // > ends an HTML tag, so it becomes &gt;
    .replace(/"/g, "&quot;")  // " could close an HTML attribute early, so it becomes &quot;
    .replace(/'/g, "&#39;");  // ' could do the same in single-quoted attributes, so it becomes &#39;

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

    // req.body was ALREADY validated and cleaned by validateBody(registerSchema) in authRoutes.js:
    // name is trimmed, email is trimmed + lowercase, password is 8-72 characters. So we can use the values directly.
    const { name, email, password } = req.body;

    try {
        // check if user exists (now checked against the normalized email)
        const exists = await User.findOne({ email });
        if (exists) {
            return res.status(400).json({ message: "User already exists" });
        }

        // hash password (security)
        const hashedPassword = await bcrypt.hash(password, 10);

        // create user
        const user = await User.create({
            name,
            email,
            password: hashedPassword
        });

        // Issue a token immediately so the frontend can auto-login —
        // no need to make the user re-enter credentials on the login page.
        const token = signToken(user._id);

        // NEW: the token now travels in an httpOnly COOKIE (a Set-Cookie header on this response) instead of in the JSON body.
        // The browser stores it and JavaScript can never read it, so a script injected into the page can't steal the login.
        setAuthCookie(res, token);

        // Don't await — email sending shouldn't delay or risk the response.
        sendWelcomeEmail(name, email);

        // New: sync this new user into HubSpot as a Contact.
        // Same fire-and-forget pattern as sendWelcomeEmail above — no "await" here,
        // so a slow or failed HubSpot call can never delay or break the user's registration response.
        syncContactToHubspot(name, email);

        res.json({
            message: "User registered successfully 💛",
            // NOTE: "token" is intentionally NOT in the body anymore — it is only in the httpOnly cookie set above.
            user: user.name
        });

    } catch (error) {
        // 11000 = MongoDB's "duplicate key" error code. It happens if two sign-ups with the same email arrive at the exact same moment
        // (both pass the findOne check above, but the unique index on email only lets ONE of them be saved).
        if (error.code === 11000) {
            // Same friendly message as the normal "already exists" check, instead of a scary server error.
            return res.status(400).json({ message: "User already exists" });
        }
        // SECURITY: log the REAL error on the server only (for you to debug)...
        console.log("REGISTER ERROR:", error.message);
        // ...and send the user a generic message, so internal details (database or library errors) never leak to the browser.
        res.status(500).json({ message: "Registration failed. Please try again." });
    }
};

/**
 * LOGIN USER
 */
exports.login = async (req, res) => {

    // req.body was ALREADY validated and cleaned by validateBody(loginSchema) in authRoutes.js (email is trimmed + lowercase).
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });

        // SECURITY: one identical message for "no such email" AND "wrong password". Two different messages
        // would let an attacker test which emails have accounts (called "user enumeration").
        const INVALID_LOGIN = "Invalid email or password.";
        if (!user) return res.status(400).json({ message: INVALID_LOGIN });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: INVALID_LOGIN });

        const token = signToken(user._id);
        setAuthCookie(res, token); // NEW: send the token as an httpOnly cookie (the browser keeps it; JavaScript can't read it)
        res.json({ user: user.name }); // NEW: the body no longer contains the token, only the display name

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

        clearAuthCookie(res); // NEW: the account is gone, so also tell the browser to throw away the login cookie
        res.json({ message: "Account deleted" });

    } catch (error) {
        console.log("DELETE ACCOUNT ERROR:", error.message);
        res.status(500).json({ message: "Failed to delete account" });
    }
};

/**
 * ME — "who am I?"  (NEW)
 * The frontend can no longer peek at a token in localStorage (the cookie is hidden from JavaScript),
 * so when the app loads it asks the server instead. The `protect` middleware has ALREADY checked the cookie by the time this runs.
 */
exports.me = async (req, res) => {
    try {
        // req.user was set by protect (the id inside the verified token). select("name") loads only the name, nothing else (never the password hash).
        const user = await User.findById(req.user).select("name");
        // The token was valid but the account no longer exists (e.g. deleted on another device): remove the stale cookie and say "not logged in".
        if (!user) {
            clearAuthCookie(res);
            return res.status(401).json({ message: "User not found" });
        }
        // Logged in: send back the display name so the frontend can show it if it wants to.
        res.json({ user: user.name });
    } catch (error) {
        // Log the real error on the server only; the user gets a generic message.
        console.log("ME ERROR:", error.message);
        res.status(500).json({ message: "Could not check your session" });
    }
};

/**
 * LOGOUT  (NEW)
 * JavaScript can't delete an httpOnly cookie, so logging out has to be a request to the server, which tells the browser to remove it.
 * No `protect` on this route on purpose: logging out when you're already logged out should just succeed quietly.
 */
exports.logout = (req, res) => {
    clearAuthCookie(res); // sends the cookie back with a past expiry date, so the browser deletes it
    res.json({ message: "Logged out" }); // simple confirmation for the frontend
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
