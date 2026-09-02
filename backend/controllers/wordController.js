const Word = require("../models/Word");
const axios = require("axios");

/**
 * Try RAG service first, fallback to free dictionary API
 */
const getMeaning = async (word) => {

    // ── Try RAG (Paul Nation book) first ──
    try {
        const ragRes = await axios.post(
            "http://localhost:5002/lookup",
            { word },
            { timeout: 2000 }
        );
        if (ragRes.data && ragRes.data.meaning) {
            console.log(`[RAG] Found "${word}" in dictionary`);
            return {
                meaning: ragRes.data.meaning,
                exampleSentence: ragRes.data.exampleSentence || "No example available",
                synonyms: [],
                source: ragRes.data.source || "Custom Dictionary"
            };
        }
    } catch (err) {
        console.log(`[RAG] Not found or unavailable — falling back to API`);
    }

    // ── Fallback: Free Dictionary API ──
    const response = await axios.get(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`
    );
    const data = response.data?.[0];
    return {
        meaning: data?.meanings?.[0]?.definitions?.[0]?.definition || "No meaning found",
        exampleSentence: data?.meanings?.[0]?.definitions?.[0]?.example || "No example available",
        synonyms: data?.meanings?.[0]?.definitions?.[0]?.synonyms || [],
        source: "Free Dictionary API"
    };
};


/**
 * ADD WORD
 */
exports.addWord = async (req, res) => {
    try {
        const userId = req.user;
        console.log("ADD WORD - userId:", userId);

        const { word } = req.body;

        if (!word || word.trim() === "") {
            return res.status(400).json({ message: "Word is required" });
        }

        const { meaning, exampleSentence, synonyms } = await getMeaning(word.trim().toLowerCase());

        const newWord = await Word.create({
            userId,
            word: word.trim().toLowerCase(),
            meaning,
            exampleSentence,
            synonyms,
            status: "review"
        });

        res.status(201).json(newWord);

    } catch (error) {
        console.log("ADD WORD ERROR:", error.response?.data || error.message);
        // res.status(500).json({ message: "Failed to add word" });
        res.status(500).json({
    message: "Failed to add word",
    error: error.response?.data || error.message
});
    }
};


/**
 * GET ALL WORDS
 */
exports.getWords = async (req, res) => {
    try {
        console.log("GET WORDS - userId from token:", req.user);
        const words = await Word.find({ userId: req.user }).sort({ createdAt: -1 });
        console.log("GET WORDS - found:", words.length);
        res.status(200).json(words);
    } catch (error) {
        console.log("GET WORDS ERROR:", error.message);
        res.status(500).json({ message: "Failed to fetch words" });
    }
};


/**
 * Ask Groq for 3 plausible-but-wrong meanings of `word`, written in the
 * same style/length as a real dictionary definition, each with a short
 * reason why it's wrong. Falls back to null on any failure so the caller
 * can use the old same-vocab-list method instead.
 */
const generateSimilarDecoys = async (word, correctMeaning) => {
    if (!process.env.GROQ_API_KEY) return null;

    const prompt = `You are building a vocabulary quiz. The word is "${word}" and its correct meaning is:
"${correctMeaning}"

Write 3 INCORRECT but PLAUSIBLE dictionary-style definitions for "${word}" — the kind of wrong answers that would actually trick someone who half-remembers the word. Match the length and tone of the correct meaning. Do not just negate the correct meaning; invent a different, believable concept.

For each wrong option, also give a short reason (max 16 words) explaining why it's wrong — ideally by naming what real word or concept that wrong meaning actually belongs to.

Respond in this exact JSON format, nothing else:
{
  "wrongOptions": [
    { "meaning": "...", "reason": "..." },
    { "meaning": "...", "reason": "..." },
    { "meaning": "...", "reason": "..." }
  ]
}`;

    try {
        const groqRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.8,
                max_tokens: 400
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 12000
            }
        );

        const content = groqRes.data.choices[0].message.content.trim();
        const cleaned = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed.wrongOptions) || parsed.wrongOptions.length < 3) return null;
        return parsed.wrongOptions.slice(0, 3);

    } catch (err) {
        console.log("QUIZ DECOY GENERATION FAILED:", err.response?.data || err.message);
        return null;
    }
};

/**
 * GENERATE QUIZ
 */
exports.getQuiz = async (req, res) => {
    try {
        const words = await Word.find({ userId: req.user }).sort({ createdAt: -1 });

        if (words.length < 4) {
            return res.status(400).json({ message: "Add at least 4 words to start the quiz!" });
        }

        const randomIndex = Math.floor(Math.random() * words.length);
        const correctWord = words[randomIndex];
        const correctAnswer = correctWord.meaning;

        // ── Try AI-generated similar-meaning decoys first ──
        const aiDecoys = await generateSimilarDecoys(correctWord.word, correctAnswer);

        let options, reasons;

        if (aiDecoys) {
            options = [correctAnswer, ...aiDecoys.map(d => d.meaning)];
            reasons = {};
            aiDecoys.forEach(d => { reasons[d.meaning] = d.reason; });
        } else {
            // ── Fallback: random other words from the user's own vocab ──
            const others = words.filter(w => w._id.toString() !== correctWord._id.toString());
            const shuffled = others.sort(() => Math.random() - 0.5).slice(0, 3);
            options = [correctAnswer, ...shuffled.map(w => w.meaning)];
            reasons = {};
            shuffled.forEach(w => {
                reasons[w.meaning] = `This is actually the meaning of "${w.word}", not "${correctWord.word}".`;
            });
        }

        // Shuffle final option order so correct answer isn't always first
        const shuffledOptions = options
            .map(opt => ({ opt, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(o => o.opt);

        res.json({
            word: correctWord.word,
            correctAnswer,
            options: shuffledOptions,
            reasons,          // { wrongMeaning: "why it's wrong" } — correctAnswer has no entry
            source: aiDecoys ? "ai" : "vocab"
        });

    } catch (error) {
        console.log("QUIZ ERROR:", error.message);
        res.status(500).json({ message: "Failed to generate quiz" });
    }
};


/**
 * UPDATE WORD STATUS (learned / review)
 */
exports.updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const word = await Word.findOneAndUpdate(
            { _id: id, userId: req.user },
            { status },
            { new: true }
        );

        if (!word) return res.status(404).json({ message: "Word not found" });
        res.json(word);
    } catch (error) {
        res.status(500).json({ message: "Failed to update status" });
    }
};

/**
 * UPDATE NOTE
 */
exports.updateNote = async (req, res) => {
    try {
        const { id } = req.params;
        const { note } = req.body;

        const word = await Word.findOneAndUpdate(
            { _id: id, userId: req.user },
            { note: (note || "").slice(0, 500) },
            { new: true }
        );

        if (!word) return res.status(404).json({ message: "Word not found" });
        res.json(word);
    } catch (error) {
        res.status(500).json({ message: "Failed to update note" });
    }
};
