const Word = require("../models/Word");
const axios = require("axios");

/**
 * Ask Groq to write a real dictionary-style definition for a word neither
 * the RAG service nor the free Dictionary API could find. Same JSON-prompt
 * pattern as generateSimilarDecoys() below. Returns null on any failure so
 * the caller can fall back to the plain placeholder message.
 */
const generateMeaningWithGroq = async (word) => {
    if (!process.env.GROQ_API_KEY) return null;

    const prompt = `Give a dictionary-style definition for the English word "${word}".

Respond in this exact JSON format, nothing else:
{
  "meaning": "a concise one-sentence definition",
  "exampleSentence": "one natural example sentence using the word",
  "synonyms": ["synonym1", "synonym2", "synonym3"]
}

If "${word}" is not a real English word (e.g. a typo or made-up string), respond with:
{ "meaning": null, "exampleSentence": null, "synonyms": [] }`;

    try {
        const groqRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                model: "openai/gpt-oss-120b",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.3,
                max_tokens: 300
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            }
        );

        const content = groqRes.data.choices[0].message.content.trim();
        const cleaned = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!parsed.meaning) return null;
        return {
            meaning: parsed.meaning,
            exampleSentence: parsed.exampleSentence || "No example available",
            synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms : [],
            source: "AI Generated"
        };
    } catch (err) {
        console.log(`[Groq meaning] Failed for "${word}":`, err.response?.data || err.message);
        return null;
    }
};

/**
 * Try RAG service first, then the free dictionary API, then Groq as a last
 * resort. dictionaryapi.dev is a small donation-funded project that's often
 * slow, missing common words, or fully down (confirmed: it returned a
 * Cloudflare 522 outage on 2026-09-04) — so it can't be the only real
 * source. Groq is already used elsewhere in this app and reliably up, so it
 * gives a genuine definition instead of the placeholder in most cases.
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

    // ── Try: Free Dictionary API ──
    // Wrapped in try/catch — dictionaryapi.dev can throw for a 404 (word not
    // found), a timeout, or an outright outage (seen: Cloudflare 522). Any of
    // those used to crash the whole addWord request with an uncaught error;
    // now they just fall through to the Groq fallback below instead.
    try {
        const response = await axios.get(
            `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
            { timeout: 5000 }
        );
        const data = response.data?.[0];
        const definition = data?.meanings?.[0]?.definitions?.[0]?.definition;
        if (definition) {
            return {
                meaning: definition,
                exampleSentence: data?.meanings?.[0]?.definitions?.[0]?.example || "No example available",
                synonyms: data?.meanings?.[0]?.definitions?.[0]?.synonyms || [],
                source: "Free Dictionary API"
            };
        }
    } catch (err) {
        // Covers: word not found (404), API down, timeout, rate limit, etc.
        console.log(`[Dictionary API] Failed for "${word}":`, err.response?.status || err.message);
    }

    // ── Last resort: ask Groq to write a definition ──
    const groqMeaning = await generateMeaningWithGroq(word);
    if (groqMeaning) return groqMeaning;

    // Only reached if RAG, the dictionary API, AND Groq all failed/found nothing —
    // e.g. GROQ_API_KEY isn't set, or the word genuinely isn't a real word.
    return {
        meaning: "No meaning found — try checking the spelling or add your own note.",
        exampleSentence: "No example available",
        synonyms: [],
        source: "Not found"
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
                // llama-3.3-70b-versatile was shut down by Groq on Aug 16 2026 — switched
                // to its recommended replacement to match the rest of the codebase.
                model: "openai/gpt-oss-120b",
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
