const express = require("express");
const router = express.Router();
const protect = require("../middleware/authMiddleware");
const { authLimiter } = require("../middleware/rateLimiters"); // SECURITY: max 10 register/login attempts per 15 min per IP
const { register, login, deleteAccount, testEmail } = require("../controllers/authController");

router.post("/register", authLimiter, register); // SECURITY: rate-limited against fake-account spam
router.post("/login", authLimiter, login);          // SECURITY: rate-limited against password guessing
router.delete("/account", protect, deleteAccount);
// SECURITY: debug route that sends a real email and has no login check, so it is only registered outside production.
if (process.env.NODE_ENV !== "production") {
    router.get("/test-email", testEmail);   // debug only (development)
}

module.exports = router;