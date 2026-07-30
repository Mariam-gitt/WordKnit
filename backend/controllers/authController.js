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

const signToken = (userId) => jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
);

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

    try {
        // check if user exists
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

        // Don't await — email sending shouldn't delay or risk the response.
        sendWelcomeEmail(name, email);

        // New: sync this new user into HubSpot as a Contact.
        // Same fire-and-forget pattern as sendWelcomeEmail above — no "await" here,
        // so a slow or failed HubSpot call can never delay or break the user's registration response.
        syncContactToHubspot(name, email);

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

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "User not found" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: "Invalid password" });

        const token = signToken(user._id);
        res.json({ token, user: user.name });

    } catch (error) {
        res.status(500).json({ message: error.message });
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

        // Delete all user data in parallel
        await Promise.all([
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
