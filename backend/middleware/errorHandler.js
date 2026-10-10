// multer = the library that receives uploaded files; it throws its own special error type (MulterError) when an upload breaks a rule.
const multer = require("multer");
// The central logger (levels + timestamps) instead of raw console.log.
const logger = require("../utils/logger");

// notFound = runs when NO route matched the URL. Before this, Express sent back a plain HTML "Cannot GET /xyz" page.
// Now every unknown URL gets the same JSON shape as every other error in this API: { message }.
const notFound = (req, res) => {
    // 404 = "Not Found": nothing lives at this address.
    res.status(404).json({ message: "Route not found" });
};

// errorHandler = the ONE place where every unexpected error ends up (a "central error handler").
// Express recognises an error handler by its FOUR parameters (err, req, res, next) — the first one is the error itself.
// It only runs when some earlier code threw an error or called next(error); Express 5 also forwards errors from async routes automatically.
const errorHandler = (err, req, res, next) => {
    // If the response has already started being sent, we can't send a second one; hand the error to Express's built-in handler.
    if (res.headersSent) return next(err);

    // The browser sent a request body that isn't valid JSON (e.g. a stray comma). That's the CLIENT's mistake: 400.
    if (err.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON in request body." });

    // The request body is bigger than express.json() allows (100kb by default): 413 = "Payload Too Large".
    if (err.type === "entity.too.large") return res.status(413).json({ message: "Request is too large." });

    // An upload broke a multer rule (too big, unexpected field name, ...).
    if (err instanceof multer.MulterError) {
        // LIMIT_FILE_SIZE is the "file too large" case; the other codes get a generic upload message. Either way it's the client's mistake: 400.
        const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large." : "Upload failed. Please check the file and try again.";
        return res.status(400).json({ message });
    }

    // Mongoose could not turn a value into an ObjectId (e.g. /api/words/abc). Another client mistake: 400.
    if (err.name === "CastError") return res.status(400).json({ message: "Invalid id." });

    // Mongoose rejected data because it broke a schema rule (e.g. a status outside the enum): 400.
    if (err.name === "ValidationError") return res.status(400).json({ message: "Invalid data." });

    // MongoDB's duplicate-key error code: the thing being created already exists (e.g. same email twice): 409 = "Conflict".
    if (err.code === 11000) return res.status(409).json({ message: "That record already exists." });

    // Anything else is an UNEXPECTED bug or outage. Log the full details on the server (for you), tell the user nothing sensitive.
    logger.error(`UNHANDLED ERROR on ${req.method} ${req.originalUrl}:`, err.stack || err);
    // 500 = "Internal Server Error": our fault, not theirs. The message is deliberately generic so no internals leak.
    res.status(500).json({ message: "Something went wrong. Please try again." });
};

// Export both so server.js can plug them in AFTER all the routes.
module.exports = { notFound, errorHandler };
