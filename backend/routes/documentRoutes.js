const logger = require("../utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const protect  = require("../middleware/authMiddleware");
const Document = require("../models/Document");
const Bookmark = require("../models/Bookmark");
const mongoose = require("mongoose"); // imported ONCE at the top (it used to be require()d inline inside a route, which is hard to read)
const { validateBody, validateParams } = require("../middleware/validate"); // validateBody checks req.body, validateParams checks URL ids
const { updateLastPageSchema } = require("../validators/documentSchemas"); // the rule for the lastPage body
const { savePdf, streamPdf, deletePdf } = require("../utils/pdfStorage"); // NEW: PDF bytes live in GridFS now (see utils/pdfStorage.js)

// 20MB limit — MongoDB documents cap at 16MB, base64 adds ~33% overhead,
// so keep the raw PDF comfortably under that.
// NEW: the upload size limit is now a setting. Default 4 MB because Vercel rejects any request body over 4.5 MB BEFORE our code runs;
// when self-hosting (Docker) you can raise it with MAX_PDF_MB=11 (or more).
const MAX_PDF_MB = Number(process.env.MAX_PDF_MB) || 4;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_MB * 1024 * 1024 }
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

        // NEW: store the raw bytes in GridFS (no base64, no 16 MB document limit) and keep only the file's id in the row.
        const fileName = req.file.originalname || "Untitled.pdf";
        const fileId = await savePdf(req.file.buffer, fileName, req.user);

        let doc;
        try {
            doc = await Document.create({
                userId: req.user,
                fileName,
                fileId,
                fileSize: req.file.size,
                pageCount,
                lastPage: 1,
                lastOpenedAt: new Date()
            });
        } catch (createError) {
            // If saving the row failed, remove the file we just stored so no orphan bytes are left behind.
            await deletePdf(fileId);
            throw createError;
        }

        // NEW: never send the internal fileId to the browser — it only needs the document's own _id.
        const { fileId: _hidden, ...meta } = doc.toObject();
        res.status(201).json(meta);

    } catch (error) {
        logger.error("DOCUMENT UPLOAD ERROR:", error.message);
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ message: `PDF is too large. Please upload a file under ${MAX_PDF_MB}MB.` });
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
            .select("-fileData -fileId")
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
        logger.error("DOCUMENT LIST ERROR:", error.message);
        res.status(500).json({ message: "Failed to load saved PDFs" });
    }
});

/* ─────────────────────────────────────────────────────────
   GET /api/documents/:id
   NEW: returns only the PDF's INFO (name, lastPage, pageCount ...), never its bytes.
   The bytes come from GET /api/documents/:id/file below.
────────────────────────────────────────────────────────── */
router.get("/:id", protect, validateParams("id"), async (req, res) => {
    try {
        const doc = await Document.findOne({ _id: req.params.id, userId: req.user }).select("-fileData -fileId");
        if (!doc) return res.status(404).json({ message: "PDF not found" });
        res.json(doc);
    } catch (error) {
        logger.error("DOCUMENT FETCH ERROR:", error.message);
        res.status(500).json({ message: "Failed to load PDF" });
    }
});

/* ─────────────────────────────────────────────────────────
   GET /api/documents/:id/file   (NEW)
   Streams the PDF itself as raw bytes (Content-Type: application/pdf).
   Works for new GridFS documents AND for old base64 documents.
   Ownership is enforced: the query includes userId, so nobody can download someone else's PDF.
────────────────────────────────────────────────────────── */
router.get("/:id/file", protect, validateParams("id"), async (req, res) => {
    try {
        // "+fileData" asks Mongoose to include the hidden legacy field (only old documents have it filled).
        const doc = await Document.findOne({ _id: req.params.id, userId: req.user }).select("+fileData");
        if (!doc) return res.status(404).json({ message: "PDF not found" });
        await streamPdf(doc, res);
    } catch (error) {
        logger.error("DOCUMENT FILE ERROR:", error.message);
        // If bytes were already flowing we can't send JSON any more — just cut the connection.
        if (res.headersSent) return res.destroy();
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
            { new: true, select: "-fileData -fileId" }
        );
        if (!doc) return res.status(404).json({ message: "PDF not found" });
        res.json(doc);
    } catch (error) {
        logger.error("DOCUMENT UPDATE ERROR:", error.message);
        res.status(500).json({ message: "Failed to update PDF" });
    }
});

/* ─────────────────────────────────────────────────────────
   DELETE /api/documents/:id
   Remove a saved PDF and its bookmarks
────────────────────────────────────────────────────────── */
router.delete("/:id", protect, validateParams("id"), async (req, res) => {
    try {
        // NEW: find first (we need the fileId), then delete. The userId in the query means you can only ever delete YOUR OWN PDFs.
        const doc = await Document.findOne({ _id: req.params.id, userId: req.user }).select("fileId");
        if (!doc) return res.status(404).json({ message: "PDF not found" });

        await deletePdf(doc.fileId); // NEW: also remove the stored bytes from GridFS (does nothing for old base64 documents)
        await Document.deleteOne({ _id: doc._id }); // remove the row itself
        await Bookmark.deleteMany({ documentId: req.params.id, userId: req.user });

        res.json({ message: "PDF deleted" });
    } catch (error) {
        logger.error("DOCUMENT DELETE ERROR:", error.message);
        res.status(500).json({ message: "Failed to delete PDF" });
    }
});

// NEW: multer reports "file too big" as an error BEFORE our route's try/catch can see it, so it needs its own handler here
// (otherwise the user would only see a generic error). Anything else is passed on to the central errorHandler in server.js.
router.use((err, req, res, next) => {
    // LIMIT_FILE_SIZE = the upload was bigger than MAX_PDF_MB.
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        // 400 = the client's mistake; the message tells them the actual limit.
        return res.status(400).json({ message: `PDF is too large. Please upload a file under ${MAX_PDF_MB}MB.` });
    }
    // Not ours: hand it on.
    next(err);
});

module.exports = router;
