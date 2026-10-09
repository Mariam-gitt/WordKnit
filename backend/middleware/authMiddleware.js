// jsonwebtoken = the library that creates ("signs") and checks ("verifies") JWTs (JSON Web Tokens).
const jwt = require("jsonwebtoken");
// The cookie's name lives in one shared file so the name here always matches the name used when logging in.
const { COOKIE_NAME } = require("../utils/authCookie");

// protect = the "login required" check that sits in front of every private route.
const protect = (req, res, next) => {
    // BEFORE: the token came from the "Authorization: Bearer ..." header that the frontend attached by hand.
    // NOW: the browser sends the cookie by itself, and cookie-parser (set up in server.js) turns the Cookie header into req.cookies.
    // The "?." (optional chaining) means "if req.cookies doesn't exist, give undefined instead of crashing".
    const token = req.cookies?.[COOKIE_NAME];

    // No cookie = the person isn't logged in (or the cookie expired / was cleared).
    if (!token) {
        // 401 = "Unauthorized" (really: "not authenticated"). The frontend uses this status to know the session is over.
        return res.status(401).json({ message: "No token, authorization denied" });
    }

    // try/catch because jwt.verify THROWS an error when the token is fake, tampered with, or expired.
    try {
        // verify() checks the signature with our secret AND the expiry date. Pinning algorithms to HS256 means a forged token can't pick a weaker algorithm.
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
        // Save the user's id on the request so every controller after this can say "this request belongs to user X".
        req.user = decoded.id;
        // Everything is fine: move on to the next function in the chain (the controller).
        next();
    } catch (error) {
        // Fake or expired token: same 401, so the frontend treats it as "logged out".
        return res.status(401).json({ message: "Token invalid" });
    }
};

// Export it so route files can write: router.get("/", protect, controller).
module.exports = protect;
