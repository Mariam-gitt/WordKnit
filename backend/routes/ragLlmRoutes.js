const express = require("express");
const router = express.Router();
const axios = require("axios");
const multer = require("multer");
const protect = require("../middleware/authMiddleware");

const upload = multer({ storage: multer.memoryStorage() });
const RAG_LLM_URL = "http://localhost:5004";


/**
 * POST /api/ragl/upload
 * Upload a PDF → send to Python for chunking + indexing
 */
router.post("/upload", protect, upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No PDF uploaded" });

        const userId = req.user;

        const ragRes = await axios.post(
            `${RAG_LLM_URL}/upload?userId=${userId}`,
            req.file.buffer,
            {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "Content-Length": req.file.buffer.length
                },
                maxBodyLength: Infinity,
                timeout: 60000
            }
        );

        res.json(ragRes.data);

    } catch (err) {
        console.log("RAG-LLM UPLOAD ERROR:", err.message);
        if (err.code === "ECONNREFUSED") {
            return res.status(500).json({ message: "RAG-LLM service not running. Start with: python rag_llm_service.py" });
        }
        res.status(500).json({ message: "Failed to index document" });
    }
});


/**
 * POST /api/ragl/ask
 * Ask a question → RAG retrieves chunks → Groq explains
 */
router.post("/ask", protect, async (req, res) => {
    const { question } = req.body;
    const userId = req.user;

    if (!question) return res.status(400).json({ message: "Question is required" });

    try {

        // Step 1 — Retrieve relevant chunks from document
        const searchRes = await axios.post(
            `${RAG_LLM_URL}/search?userId=${userId}`,
            { query: question },
            { timeout: 10000 }
        );

        const chunks = searchRes.data.chunks;

        if (!chunks || chunks.length === 0) {
            return res.status(200).json({
                answer: "I couldn't find relevant information about this in your document. Try rephrasing or check if your document covers this topic.",
                chunks: [],
                fromDocument: false
            });
        }

        // Step 2 — Build context from retrieved chunks
        const context = chunks
            .map((c, i) => `[Section ${i + 1}]:\n${c.text}`)
            .join("\n\n");

        // Step 3 — Send to Groq with retrieved context
        const prompt = `You are a helpful reading assistant. A user is reading a document and has a question.

Here are the most relevant sections from their document:

${context}

User's question: "${question}"

Based ONLY on the document sections above, provide:
1. A clear, simple answer (2-4 sentences)
2. If it's about a specific word/concept, explain it in the context of this document
3. Quote a short phrase from the document that supports your answer

If the document sections don't contain enough information, say so honestly.

Respond in this exact JSON format:
{
  "answer": "...",
  "quote": "...",
  "confidence": "high|medium|low"
}

Only respond with JSON, nothing else.`;

        const groqRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "openai/gpt-oss-120b",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 500
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 15000
            }
        );

        const content = groqRes.data.choices[0].message.content.trim();
        const cleaned = content.replace(/```json|```/g, "").trim();
        // const parsed = JSON.parse(cleaned); 
        const parsed = JSON.parse(cleaned);

        res.json({
            ...parsed,
            chunks: chunks.map(c => ({ text: c.text.substring(0, 200) + "...", score: c.score })),
            fromDocument: true
        });

    // } catch (err) {
    //     console.log("RAG-LLM ASK ERROR:", err.response?.data || err.message);
    //     if (err.code === "ECONNREFUSED") {
    //         return res.status(500).json({ message: "RAG-LLM service not running." });
    //     }
    //     res.status(500).json({ message: "Failed to get answer. Try again." });
    // }

    }catch (err) {
    console.log("RAG-LLM ASK ERROR:", err.response?.data || err.message);

    if (err.code === "ECONNREFUSED") {
        return res.status(500).json({
            message: "RAG-LLM service not running."
        });
    }

    // 🔥 IMPORTANT: handle Groq / JSON / other errors
    return res.status(500).json({
        message: "Failed to get answer from Groq API",
        error: err.response?.data || err.message
    });
}
});


/**
 * GET /api/ragl/status
 */
router.get("/status", protect, async (req, res) => {
    try {
        const ragRes = await axios.get(
            `${RAG_LLM_URL}/status?userId=${req.user}`,
            { timeout: 2000 }
        );
        res.json(ragRes.data);
    } catch {
        res.json({ status: "offline", hasDocument: false });
    }
});

module.exports = router;
