const logger = require("../utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const express = require("express");
const router = express.Router();
const multer = require("multer");
const axios = require("axios");
const protect = require("../middleware/authMiddleware");

const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/rag/ingest
 * Upload a dictionary PDF to the RAG service
 */
router.post("/ingest", protect, upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No PDF uploaded" });

        const ragRes = await axios.post(
            "http://localhost:5002/ingest",
            req.file.buffer,
            {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": req.file.buffer.length
                },
                maxBodyLength: Infinity,
                timeout: 60000 // PDF parsing can take a moment
            }
        );

        res.json(ragRes.data);

    } catch (error) {
        logger.error("RAG INGEST ERROR:", error.message);
        if (error.code === "ECONNREFUSED") {
            return res.status(500).json({ message: "RAG service not running. Start with: python rag_service.py" });
        }
        res.status(500).json({ message: "Failed to ingest dictionary" });
    }
});

/**
 * GET /api/rag/status
 */
router.get("/status", protect, async (req, res) => {
    try {
        const ragRes = await axios.get("http://localhost:5002/status", { timeout: 2000 });
        res.json(ragRes.data);
    } catch {
        res.json({ status: "offline", words_loaded: 0 });
    }
});

module.exports = router;
