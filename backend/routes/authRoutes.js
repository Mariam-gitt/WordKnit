const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiters"); // SECURITY: max 10 register/login attempts per 15 min per IP
const { register, login, deleteAccount, testEmail, me, logout } = require("../controllers/authController"); // me + logout are NEW (cookie login)
const { validateBody } = require("../middleware/validate"); // runs a zod schema against req.body and stops bad requests with a 400
const { registerSchema, loginSchema } = require("../validators/authSchemas"); // the rules for what register/login data must look like

router.post("/register", authLimiter, validateBody(registerSchema), register); // SECURITY: rate-limited against fake-account spam
router.post("/login", authLimiter, validateBody(loginSchema), login);          // SECURITY: rate-limited against password guessing
router.get("/me", protect, me);          // NEW: "am I still logged in?" — the frontend calls this when the app loads
router.post("/logout", logout);          // NEW: clears the login cookie (JavaScript can't do that itself)
router.delete("/account", protect, deleteAccount);
// SECURITY: debug route that sends a real email and has no login check, so it is only registered outside production.
if (process.env.NODE_ENV !== "production") {
    router.get("/test-email", testEmail);   // debug only (development)
}

module.exports = router;