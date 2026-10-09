// zod = the library we use to describe "what valid data looks like".
const { z } = require("zod");
// Reuse the exact same "24 hex characters" MongoDB id pattern from the middleware file.
const { OBJECT_ID_PATTERN } = require("../middleware/validate");

// Rules for PATCH /api/documents/:id — the reader sends { lastPage: 12 } every time the user turns a page.
const updateLastPageSchema = z.object({
    // lastPage must be a real number, a whole number (no 3.5), and at least 1 — a page number can't be 0 or negative.
    lastPage: z.number({ error: "lastPage must be a number" })
        // int() = whole numbers only.
        .int("lastPage must be a whole number")
        // Pages start at 1.
        .min(1, "lastPage must be at least 1")
        // A sane upper limit so absurd values can't be stored.
        .max(100000, "lastPage is too large")
});

// Rules for POST /api/bookmarks — the reader sends { documentId, text, page } (and optionally note).
const createBookmarkSchema = z.object({
    // documentId: must be text that looks like a MongoDB id.
    documentId: z.string({ error: "documentId, text, and page are required" }).regex(OBJECT_ID_PATTERN, "Invalid documentId"),
    // text: the highlighted snippet — must be non-empty text after trimming.
    text: z.string({ error: "documentId, text, and page are required" }).trim().min(1, "documentId, text, and page are required"),
    // page: a whole number of at least 1.
    page: z.number({ error: "documentId, text, and page are required" }).int("page must be a whole number").min(1, "page must be at least 1"),
    // note: optional short text. nullish() allows it to be missing OR null without failing.
    note: z.string().nullish()
});

// Export both so documentRoutes.js and bookmarkRoutes.js can attach them.
module.exports = { updateLastPageSchema, createBookmarkSchema };
