// zod = a library where you DESCRIBE what valid data looks like (a "schema"), then ask it to check real data against that description.
const { z } = require("zod");

// Every MongoDB _id is exactly 24 characters of hexadecimal (0-9, a-f). This pattern (a "regex") checks for that shape.
// We export it so the schema files can reuse the very same rule instead of re-typing it.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// validateBody(schema) is a "middleware factory": a function that BUILDS a middleware for the schema you give it.
// (A middleware = a small function that runs on the request BEFORE your controller; it can stop the request early.)
const validateBody = (schema) => (req, res, next) => {
    // safeParse = "check the data against the schema, but DON'T throw an error if it fails — just tell me the result".
    // req.body is the JSON the browser sent; in Express 5 it can be undefined when no body was sent, and zod handles that too.
    const result = schema.safeParse(req.body);
    // result.success is false when the data broke at least one rule in the schema.
    if (!result.success) {
        // 400 = "Bad Request" (the CLIENT sent something wrong). We send only the FIRST problem, in the same { message } shape as every other error in this API.
        return res.status(400).json({ message: result.error.issues[0].message });
    }
    // result.data is the CLEANED copy (trimmed text, lowercase email, unknown extra fields removed) — we replace req.body with it so controllers only ever see clean data.
    req.body = result.data;
    // next() = "this request is fine, move on to the next function in the chain" (the next middleware or the controller).
    next();
};

// validateParams("id") checks that the named URL parts (like the :id in /api/words/:id/status) look like real MongoDB ids.
// The "...names" syntax (called "rest parameters") lets you pass as many names as you want: validateParams("id", "documentId").
const validateParams = (...names) => {
    // We build the schema's shape dynamically: one rule per name, all using the same 24-hex-characters pattern.
    const shape = {};
    // Loop over each name that was passed in.
    for (const name of names) {
        // Each URL part must be a string that matches the ObjectId pattern, otherwise "Invalid id." is the message.
        shape[name] = z.string().regex(OBJECT_ID_PATTERN, "Invalid id.");
    }
    // z.object(shape) turns our list of rules into one schema describing the whole req.params object.
    const schema = z.object(shape);
    // Return the real middleware that Express will run for each request.
    return (req, res, next) => {
        // req.params = the dynamic pieces of the URL path, e.g. { id: "665f..." }.
        const result = schema.safeParse(req.params);
        // Without this check, Mongoose would throw a "CastError" on a bad id and the user would see a confusing 500 server error.
        if (!result.success) {
            // 400 = the client's mistake, not the server's, so a clear short message is correct here.
            return res.status(400).json({ message: result.error.issues[0].message });
        }
        // Valid — continue to the next function in the chain.
        next();
    };
};

// Export all three so schema files can reuse the pattern and routes can use the two middleware builders.
module.exports = { validateBody, validateParams, OBJECT_ID_PATTERN };
