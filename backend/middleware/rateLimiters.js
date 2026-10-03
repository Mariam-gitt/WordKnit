// express-rate-limit = a small library that counts how many requests each visitor (by IP address) makes
// in a time window, and answers "429 Too Many Requests" once they go over the limit.
const rateLimit = require("express-rate-limit");

// authLimiter: protects register + login from password-guessing (brute force) and fake-account spam.
// Real people rarely need more than a few tries, so 10 attempts per 15 minutes per IP is generous.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,                                         // the time window: 15 minutes, written in milliseconds
    limit: 10,                                                        // max requests per IP inside that window
    standardHeaders: "draft-8",                                       // tell the browser how many tries are left (RateLimit-* headers)
    legacyHeaders: false,                                             // don't also send the old X-RateLimit-* headers
    message: { message: "Too many attempts. Please wait a few minutes and try again." } // JSON body, same shape as every other error in this API
});

// aiLimiter: protects the routes that call a paid AI service (Groq, speech) so nobody can run up the bill.
// 150 per 15 minutes = about 10 per minute, which is more than a person can use while studying.
const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,                                         // 15-minute window
    limit: 150,                                                       // max AI-backed requests per IP inside the window
    standardHeaders: "draft-8",                                       // send remaining-tries headers
    legacyHeaders: false,                                             // skip the old headers
    message: { message: "You're going a bit fast! Please wait a few minutes and try again." } // friendly JSON error
});

module.exports = { authLimiter, aiLimiter };                          // export both so routes can import { authLimiter, aiLimiter }
