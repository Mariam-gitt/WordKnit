
const express = require("express");
const router = express.Router();
const axios = require("axios");
const protect = require("../middleware/authMiddleware");

// Academic/technical word indicators
const ACADEMIC_INDICATORS = [
    "ology", "ism", "ity", "tion", "sis", "phy", "ics",
    "ment", "ence", "ance", "ness", "ture", "ure"
];

const ACADEMIC_DOMAINS = [
    "psychology", "philosophy", "economics", "biology", "chemistry",
    "physics", "sociology", "anthropology", "linguistics", "mathematics",
    "statistics", "medicine", "law", "politics", "theology", "ethics",
    "rhetoric", "epistemology", "ontology", "metaphysics", "phenomenology"
];

function isLikelyAcademic(word, definitions) {
    const w = word.toLowerCase();
    // Check if word itself looks academic (long, has academic suffix)
    if (w.length > 8) return true;
    if (ACADEMIC_INDICATORS.some(s => w.endsWith(s))) return true;
    // Check if definition mentions academic fields
    const defText = (definitions || []).map(d => d.definition || "").join(" ").toLowerCase();
    if (ACADEMIC_DOMAINS.some(d => defText.includes(d))) return true;
    return false;
}

router.get("/:word", protect, async (req, res) => {
    const { word } = req.params;

    try {
        const profile = {
            word,
            pronunciation: null,
            audio: null,
            partOfSpeech: null,
            definitions: [],
            examples: [],
            quotes: [],
            synonymNuances: null,
            memoryHook: null,
            academicSources: [],
            relatedWords: []
        };

        // ── 1. Free Dictionary API ──
        try {
            const dictRes = await axios.get(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
                { timeout: 6000 }
            );
            const entry = dictRes.data?.[0];
            if (entry) {
                profile.pronunciation = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || null;
                const audioPhonetic = entry.phonetics?.find(p => p.audio && p.audio.length > 0);
                profile.audio = audioPhonetic?.audio || null;

                for (const meaning of entry.meanings || []) {
                    if (!profile.partOfSpeech) profile.partOfSpeech = meaning.partOfSpeech;

                    for (const def of meaning.definitions?.slice(0, 3) || []) {
                        profile.definitions.push({
                            partOfSpeech: meaning.partOfSpeech,
                            definition: def.definition,
                            example: def.example || null,
                            synonyms: def.synonyms?.slice(0, 8) || []
                        });
                        if (def.example) profile.examples.push(def.example);
                    }

                    // Collect all synonyms from meanings level too
                    profile.relatedWords.push(...(meaning.synonyms?.slice(0, 6) || []));
                }

                profile.relatedWords = [...new Set(profile.relatedWords)].slice(0, 10);
            }
        } catch (err) {
            console.log(`[Profile] Dictionary API failed:`, err.message);
        }

        // ── 2. Wikipedia — smarter academic source detection ──
        const academic = isLikelyAcademic(word, profile.definitions);

        // Try direct Wikipedia lookup
        try {
            const wikiRes = await axios.get(
                `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`,
                { timeout: 5000 }
            );
            if (wikiRes.data?.extract && wikiRes.data.extract.length > 80
                && wikiRes.data.type !== "disambiguation") {
                profile.academicSources.push({
                    title: wikiRes.data.title,
                    summary: wikiRes.data.extract.substring(0, 250) + "...",
                    url: wikiRes.data.content_urls?.desktop?.page,
                    type: "wikipedia"
                });
            }
        } catch {}

        // If no direct hit and word looks academic, try Wikipedia search
        if (profile.academicSources.length === 0 && academic) {
            try {
                const searchRes = await axios.get(
                    `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(word)}&limit=3&format=json&origin=*`,
                    { timeout: 5000 }
                );
                const titles = searchRes.data[1];
                const urls = searchRes.data[3];

                if (titles?.length > 0) {
                    // Fetch summary for first result
                    try {
                        const summaryRes = await axios.get(
                            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titles[0])}`,
                            { timeout: 5000 }
                        );
                        if (summaryRes.data?.extract && summaryRes.data.extract.length > 80) {
                            profile.academicSources.push({
                                title: summaryRes.data.title,
                                summary: summaryRes.data.extract.substring(0, 250) + "...",
                                url: urls[0],
                                type: "wikipedia"
                            });
                        }
                    } catch {}
                }
            } catch {}
        }

        // ── 3. Groq — rich synonyms + memory hook + examples ──
        if (process.env.GROQ_API_KEY) {
            try {
                const isAcademic = academic || profile.academicSources.length > 0;

                const prompt = `You are a vocabulary expert. Deeply analyze the word "${word}".

Provide ALL of the following:

1. "synonymNuances": Give 4-5 words similar to "${word}" with PRECISE differences. For each, explain exactly WHEN and WHY you'd use it instead of "${word}". Be specific and practical.

2. "memoryHook": A vivid, creative memory technique to remember "${word}" forever. Use etymology, visual imagery, wordplay, or a mini-story. Make it memorable and specific.

3. "usageExamples": Write 4 rich, natural example sentences for "${word}" in different real-life contexts (academic, casual, professional, literary). Make each sentence genuinely illustrative.

4. "synonymsList": A flat list of 8-12 good synonyms for "${word}" as an array of strings.

${isAcademic ? `5. "academicNote": Since "${word}" has academic/technical usage, briefly explain its significance in its field(s) of study in 1-2 sentences.` : ''}

Respond ONLY in this exact JSON format:
{
  "synonymNuances": [
    {"word": "synonym", "nuance": "precise explanation of difference and when to use"},
    {"word": "synonym2", "nuance": "..."}
  ],
  "memoryHook": "...",
  "usageExamples": ["sentence1", "sentence2", "sentence3", "sentence4"],
  "synonymsList": ["word1", "word2", "word3"],
  ${isAcademic ? '"academicNote": "...",' : ''}
  "placeholder": true
}`;

                const groqRes = await axios.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    {
                        // llama-3.3-70b-versatile was shut down by Groq on Aug 16 2026 — switched
                        // to its recommended replacement to match the rest of the codebase.
                        model: "openai/gpt-oss-120b",
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.5,
                        max_tokens: 900
                    },
                    {
                        headers: {
                            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                            "Content-Type": "application/json"
                        },
                        timeout: 20000
                    }
                );

                const content = groqRes.data.choices[0].message.content.trim();
                const cleaned = content.replace(/```json|```/g, "").trim();
                const parsed = JSON.parse(cleaned);

                profile.synonymNuances = parsed.synonymNuances || [];
                profile.memoryHook = parsed.memoryHook || null;

                // Merge Groq examples with dictionary examples
                if (parsed.usageExamples?.length) {
                    profile.examples = [...profile.examples, ...parsed.usageExamples].slice(0, 6);
                }

                // Merge synonym lists
                if (parsed.synonymsList?.length) {
                    profile.relatedWords = [...new Set([...profile.relatedWords, ...parsed.synonymsList])].slice(0, 14);
                }

                // Add academic note to sources if available
                if (parsed.academicNote && profile.academicSources.length === 0) {
                    profile.academicSources.push({
                        title: `${word} — Academic Context`,
                        summary: parsed.academicNote,
                        url: `https://scholar.google.com/scholar?q=${encodeURIComponent(word)}`,
                        type: "groq"
                    });
                }

            } catch (err) {
                console.log(`[Profile] Groq failed:`, err.message);
            }
        }

        res.json(profile);

    } catch (err) {
        console.log("PROFILE ERROR:", err.message);
        res.status(500).json({ message: "Failed to load word profile" });
    }
});

module.exports = router;
