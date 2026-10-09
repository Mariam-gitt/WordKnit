const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const protect  = require("../middleware/authMiddleware");
const Document = require("../models/Document");
const Bookmark = require("../models/Bookmark");
const mongoose = require("mongoose"); // imported ONCE at the top (it used to be require()d inline inside a route, which is hard to read)
const { validateBody, validateParams } = require("../middleware/validate"); // validateBody checks req.body, validateParams checks URL ids
const { updateLastPageSchema } = require("../validators/documentSchemas"); // the rule for the lastPage body

// 20MB limit — MongoDB documents cap at 16MB, base64 adds ~33% overhead,
// so keep the raw PDF comfortably under that.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 11 * 1024 * 1024 }
});

/* ─────────────────────────────────────────────────────────
   POST /api/documents
   Upload and save a new PDF for the logged-in user
────────────────────────────────────────────────────────── */
router.post("/", protect, upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No PDF file uploaded" });

        const magic = req.file.buffer.slice(0, 4).toString("ascii");
        if (magic !== "%PDF") {
            return res.status(400).json({ message: "That doesn't look like a PDF file." });
        }

        const pageCount = parseInt(req.body.pageCount, 10) || 0;

        const doc = await Document.create({
            userId: req.user,
            fileName: req.file.originalname || "Untitled.pdf",
            fileData: req.file.buffer.toString("base64"),
            fileSize: req.file.size,
            pageCount,
            lastPage: 1,
            lastOpenedAt: new Date()
        });

        // Don't echo the full base64 back — the list view doesn't need it
        const { fileData, ...meta } = doc.toObject();
        res.status(201).json(meta);

    } catch (error) {
        console.log("DOCUMENT UPLOAD ERROR:", error.message);
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: "PDF is too large. Please upload a file under 11MB." });
        }
        res.status(500).json({ message: "Failed to save PDF" });
    }
});

/* ─────────────────────────────────────────────────────────
   GET /api/documents
   List all of the user's saved PDFs (metadata only, no file bytes)
────────────────────────────────────────────────────────── */
router.get("/", protect, async (req, res) => {
    try {
        const docs = await Document.find({ userId: req.user })
            .select("-fileData")
            .sort({ lastOpenedAt: -1 });

        // Attach bookmark counts per document
        const counts = await Bookmark.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(req.user) } },
            { $group: { _id: "$documentId", count: { $sum: 1 } } }
        ]);
        const countMap = {};
        counts.forEach(c => { countMap[c._id.toString()] = c.count; });

        const withCounts = docs.map(d => ({
            ...d.toObject(),
            bookmarkCount: countMap[d._id.toString()] || 0
        }));

        res.json(withCounts);
    } catch (error) {
        console.log("DOCUMENT LIST ERROR:", error.message);
        res.status(500).json({ message: "Failed to load saved PDFs" });
    }
});

/* ─────────────────────────────────────────────────────────
   GET /api/documents/:id
   Fetch a single PDF including its file bytes, to reopen it
────────────────────────────────────────────────────────── */
router.get("/:id", protect, validateParams("id"), async (req, res) => {
    try {
        const doc = await Document.findOne({ _id: req.params.id, userId: req.user });
        if (!doc) return res.status(404).json({ message: "PDF not found" });
        res.json(doc);
    } catch (error) {
        console.log("DOCUMENT FETCH ERROR:", error.message);
        res.status(500).json({ message: "Failed to load PDF" });
    }
});

/* ─────────────────────────────────────────────────────────
   PATCH /api/documents/:id
   Update last-read page (called whenever the user changes page)
────────────────────────────────────────────────────────── */
router.patch("/:id", protect, validateParams("id"), validateBody(updateLastPageSchema), async (req, res) => {
    try {
        const { lastPage } = req.body;
        const doc = await Document.findOneAndUpdate(
            { _id: req.params.id, userId: req.user },
            { lastPage, lastOpenedAt: new Date() },
            { new: true, select: "-fileData" }
        );
        if (!doc) return res.status(404).json({ message: "PDF not found" });
        res.json(doc);
    } catch (error) {
        res.status(500).json({ message: "Failed to update PDF" });
    }
});

/* ─────────────────────────────────────────────────────────
   DELETE /api/documents/:id
   Remove a saved PDF and its bookmarks
────────────────────────────────────────────────────────── */
router.delete("/:id", protect, validateParams("id"), async (req, res) => {
    try {
        const doc = await Document.findOneAndDelete({ _id: req.params.id, userId: req.user });
        if (!doc) return res.status(404).json({ message: "PDF not found" });

        await Bookmark.deleteMany({ documentId: req.params.id, userId: req.user });

        res.json({ message: "PDF deleted" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete PDF" });
    }
});

module.exports = router;
