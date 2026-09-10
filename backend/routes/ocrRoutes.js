const express = require("express");
const router = express.Router();
const multer = require("multer");
const axios = require("axios");
const protect = require("../middleware/authMiddleware");
const Word = require("../models/Word");
const { getMeaning } = require("../controllers/wordController"); // reuse the same cache → dictionary API → Groq chain used by "add word", instead of duplicating it here

const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/ocr/extract
 * Send image → OCR detects highlighted/underlined words
 * → fetch meanings → save to vocab
 *
 * OCR_SERVICE_URL must be set to wherever the OCR model is actually running
 * (e.g. your Hugging Face Space URL) — this route is not mounted in server.js
 * yet, since the OCR model itself isn't reliable enough yet. Once it is,
 * set OCR_SERVICE_URL and uncomment the app.use("/api/ocr", ...) line there.
 */
router.post("/extract", protect, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No image uploaded" });
        if (!process.env.OCR_SERVICE_URL) {
            return res.status(503).json({ message: "OCR service isn't configured yet (OCR_SERVICE_URL is not set)" });
        }

        // Step 1 — Send image to OCR service
        const ocrRes = await axios.post(
            `${process.env.OCR_SERVICE_URL}/extract`,
            req.file.buffer,
            {
                headers: {
                    "Content-Type": req.file.mimetype,
                    "Content-Length": req.file.buffer.length
                },
                maxBodyLength: Infinity,
                timeout: 30000
            }
        );

        const { words, highlighted, underlined } = ocrRes.data;

        if (!words || words.length === 0) {
            return res.status(200).json({
                message: "No highlighted or underlined words found. Make sure words are clearly highlighted in yellow.",
                added: [],
                skipped: []
            });
        }

        // Step 2 — For each word, get meaning and save
        const added = [];
        const skipped = [];

        for (const word of words) {
            try {
                // Skip if already exists
                const exists = await Word.findOne({ userId: req.user, word });
                if (exists) {
                    skipped.push(word);
                    continue;
                }

                // Same lookup chain "add word" uses: shared cache → dictionary API → Groq.
                // getMeaning() never throws — it falls back to a placeholder meaning on
                // total failure — so no try/catch is needed around this call.
                const { meaning, exampleSentence, synonyms } = await getMeaning(word);

                const newWord = await Word.create({
                    userId: req.user,
                    word,
                    meaning,
                    exampleSentence,
                    synonyms,
                    status: "review"
                });

                added.push(newWord);

            } catch (err) {
                console.log(`OCR: failed to add "${word}":`, err.message);
                skipped.push(word);
            }
        }

        res.json({
            message: `Added ${added.length} words from image!`,
            added,
            skipped,
            highlighted,
            underlined,
            total: words.length
        });

    } catch (err) {
        console.log("OCR ROUTE ERROR:", err.message);
        if (err.code === "ECONNREFUSED") {
            return res.status(500).json({
                message: "Couldn't reach the OCR service — check that OCR_SERVICE_URL is correct and the service is running"
            });
        }
        res.status(500).json({ message: "Failed to process image" });
    }
});

module.exports = router;
