const express = require("express");
const router = express.Router();
const axios = require("axios");
const protect = require("../middleware/authMiddleware");

/**
 * POST /api/contextual/explain
 * Sends paragraph + word to Groq, returns contextual explanation
 */
router.post("/explain", protect, async (req, res) => {
    const { paragraph, word } = req.body;

    if (!paragraph || !word) {
        return res.status(400).json({ message: "Paragraph and word are required" });
    }

    const prompt = `You are a vocabulary assistant. A user is reading a text and doesn't understand a specific word in context.

Paragraph they are reading:
"${paragraph}"

Word they don't understand: "${word}"

Please provide:
1. A clear, simple explanation of what "${word}" means SPECIFICALLY in this paragraph's context (2-3 sentences max)
2. A simpler way to think about it / an analogy (1-2 sentences)
3. Up to 3 related words (just the words, comma separated)

Respond in this exact JSON format:
{
  "explanation": "...",
  "example": "...",
  "relatedWords": ["word1", "word2", "word3"]
}

Only respond with the JSON, nothing else.`;

    try {
        const groqRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "openai/gpt-oss-120b",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.4,
                max_tokens: 400
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

        // Parse JSON response
        const cleaned = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        res.json(parsed);

    } catch (err) {
        console.log("GROQ ERROR:", err.response?.data || err.message);

        if (err.response?.status === 401) {
            return res.status(401).json({ message: "Invalid Groq API key. Check your .env file." });
        }

        res.status(500).json({ message: "Failed to get explanation. Try again." });
    }
});

module.exports = router;
