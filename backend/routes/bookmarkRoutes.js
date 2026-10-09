const express  = require("express");
const router   = express.Router();
const protect  = require("../middleware/authMiddleware");
const Bookmark = require("../models/Bookmark");
const Document = require("../models/Document"); // NEW: used to check the PDF really belongs to the logged-in user
const { validateBody, validateParams } = require("../middleware/validate"); // validateBody checks req.body, validateParams checks URL ids
const { createBookmarkSchema } = require("../validators/documentSchemas"); // the rules for creating a bookmark (documentId, text, page, note)

/* ─────────────────────────────────────────────────────────
   POST /api/bookmarks
   Save a highlighted text selection as a bookmark
────────────────────────────────────────────────────────── */
router.post("/", protect, validateBody(createBookmarkSchema), async (req, res) => {
    try {
        const { documentId, text, page, note } = req.body;

        // documentId / text / page / note were ALREADY checked and cleaned by validateBody(createBookmarkSchema) above,
        // so the old manual if-checks that used to sit here are no longer needed.

        // NEW (SECURITY): only allow a bookmark on a document THIS user owns. Before, anyone could attach
        // bookmarks to any document id they could guess. Document.exists() answers yes/no without loading the PDF.
        const ownsDocument = await Document.exists({ _id: documentId, userId: req.user });
        if (!ownsDocument) {
            return res.status(404).json({ message: "Document not found" }); // 404 on purpose: don't reveal whether someone else's document exists
        }

        const bookmark = await Bookmark.create({
            userId: req.user,
            documentId,
            text: text.trim().slice(0, 1000),
            page,
            note: note?.trim().slice(0, 300) || ""
        });

        res.status(201).json(bookmark);
    } catch (error) {
        console.log("BOOKMARK CREATE ERROR:", error.message);
        res.status(500).json({ message: "Failed to save bookmark" });
    }
});

/* ─────────────────────────────────────────────────────────
   GET /api/bookmarks/:documentId
   List all bookmarks for a given PDF, oldest page first
────────────────────────────────────────────────────────── */
router.get("/:documentId", protect, validateParams("documentId"), async (req, res) => {
    try {
        const bookmarks = await Bookmark.find({
            documentId: req.params.documentId,
            userId: req.user
        }).sort({ page: 1, createdAt: 1 });

        res.json(bookmarks);
    } catch (error) {
        res.status(500).json({ message: "Failed to load bookmarks" });
    }
});

/* ─────────────────────────────────────────────────────────
   DELETE /api/bookmarks/:id
────────────────────────────────────────────────────────── */
router.delete("/:id", protect, validateParams("id"), async (req, res) => {
    try {
        const bookmark = await Bookmark.findOneAndDelete({ _id: req.params.id, userId: req.user });
        if (!bookmark) return res.status(404).json({ message: "Bookmark not found" });
        res.json({ message: "Bookmark deleted" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete bookmark" });
    }
});

module.exports = router;
