// meaningService = everything about "how do we get the meaning of a word": shared cache → dictionary API → Groq AI.
// It used to live at the top of controllers/wordController.js. It was MOVED here unchanged, so the controller can stay thin
// (a controller should only receive the request and send the response; the real work belongs in a "service").
const logger = require("../utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const WordCache = require("../models/WordCache"); // shared global cache of meanings — one row per unique word, reused by every user
const axios = require("axios"); // library used to make HTTP requests to dictionaryapi.dev and Groq

// MEANING_VERSION = the "version number" of our recipe for writing meanings.
// Cached meanings saved by an OLDER recipe have a lower (or missing) number, so getMeaning() treats them as out-of-date and rebuilds them with the new recipe.
// Bump this number whenever you improve the recipe again and want old cached meanings refreshed.
const MEANING_VERSION = 2;

/**
 * Get the real dictionary senses (meanings) of a word from dictionaryapi.dev.
 * A "sense" = one specific meaning of a word (e.g. "bank" has the money sense and the river sense).
 * Returns a list of senses, or an empty list if the dictionary is down / doesn't know the word.
 */
const fetchDictionarySenses = async (word) => {                       // async = this function waits for the internet; "word" is the lowercase word to look up
    try {                                                              // try/catch = if the request fails, jump to catch instead of crashing the server
        const response = await axios.get(                              // axios.get = ask another website for data (browser-style GET request)
            `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, // encodeURIComponent makes the word safe inside a URL (handles spaces/symbols)
            { timeout: 5000 }                                          // give up after 5 seconds because this free API can be slow
        );
        const senses = [];                                             // we will collect every sense we find in this list
        for (const entry of response.data || []) {                     // the API returns a list of "entries" (one per word form); loop over each one
            for (const block of entry.meanings || []) {                // each entry has "meanings" blocks, one per part of speech (noun, verb, ...)
                for (const def of (block.definitions || []).slice(0, 3)) { // each block has definitions; keep only the first 3 per part of speech so the list stays short
                    if (def.definition) {                              // skip any empty definition
                        senses.push({                                  // add one sense to our list as a small object
                            partOfSpeech: block.partOfSpeech || "",    // noun / verb / adjective ... (empty text if missing)
                            definition: def.definition,                // the dictionary's own wording
                            example: def.example || "",                // the dictionary's example sentence, if it has one
                            synonyms: def.synonyms || []               // the dictionary's synonyms, if it has any
                        });
                    }
                }
            }
        }
        return senses.slice(0, 8);                                     // keep at most 8 senses overall so the AI prompt doesn't get too long
    } catch (err) {                                                    // covers: word not found (404), API down, timeout, rate limit
        logger.error(`[Dictionary API] Failed for "${word}":`, err.response?.status || err.message); // log why, to help debugging
        return [];                                                     // an empty list means "the dictionary couldn't help"
    }
};

/**
 * Ask Groq (an AI service) to WRITE the meaning of a word in one simple style.
 * If we have real dictionary senses, the AI must choose from THEM (so it can't make things up).
 * If the dictionary gave us nothing, the AI writes the meaning on its own.
 * Returns null on any failure so the caller can use a fallback.
 */
const generateMeaningWithGroq = async (word, senses = []) => {        // senses = the list from fetchDictionarySenses (can be empty)
    if (!process.env.GROQ_API_KEY) return null;                        // no API key set = we can't call Groq, so stop here

    const senseText = senses                                           // turn the senses list into numbered lines of text for the prompt
        .map((s, i) => `${i + 1}. (${s.partOfSpeech || "?"}) ${s.definition}`) // e.g. "1. (noun) a financial institution"
        .join("\n");                                                   // put each sense on its own line

    const rules = `Your job:
- Choose the MOST COMMON everyday sense of the word (the one a learner is most likely to meet).
- Write its meaning as ONE simple sentence (maximum 20 words) in plain English. Do not use the word itself inside the meaning.
- Give the part of speech of that sense (noun, verb, adjective, adverb, ...).
- Give ONE natural example sentence that uses the word in that same sense.
- Give up to 3 synonyms.`;                                            // the same instructions are used whether or not we have dictionary senses

    const prompt = senses.length                                       // choose the prompt: with dictionary senses, or without
        ? `You are writing the meaning of an English word for a vocabulary-learning app.

Word: "${word}"

Real dictionary senses (use ONLY these as your source of truth, do not invent a new meaning):
${senseText}

${rules}

Reply with JSON only, in exactly this shape:
{ "meaning": "...", "partOfSpeech": "...", "exampleSentence": "...", "synonyms": ["...", "...", "..."] }
If "${word}" is not a real English word, reply: { "meaning": null }`
        : `You are writing the meaning of an English word for a vocabulary-learning app.

Word: "${word}"

${rules}

Reply with JSON only, in exactly this shape:
{ "meaning": "...", "partOfSpeech": "...", "exampleSentence": "...", "synonyms": ["...", "...", "..."] }
If "${word}" is not a real English word (for example a typo), reply: { "meaning": null }`;

    try {                                                              // try/catch so a Groq failure returns null instead of crashing
        const groqRes = await axios.post(                              // axios.post = send data to another website
            "https://api.groq.com/openai/v1/chat/completions",         // Groq's chat endpoint
            {
                model: "openai/gpt-oss-120b",                          // the AI model used everywhere else in this app
                messages: [{ role: "user", content: prompt }],         // our prompt, sent as the user's message
                temperature: 0.3,                                      // low temperature = steady, less "creative" answers (good for definitions)
                max_tokens: 600                                        // room for the answer (a bit higher than before, since the prompt is longer)
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, // proves we're allowed to use Groq (key lives in .env, never in code)
                    "Content-Type": "application/json"                 // tells Groq we're sending JSON
                },
                timeout: 10000                                         // give up after 10 seconds
            }
        );

        const content = groqRes.data.choices[0].message.content.trim(); // the AI's reply text, with spaces trimmed off
        const cleaned = content.replace(/```json|```/g, "").trim();    // remove ```json fences if the AI added them, so JSON.parse can read it
        const parsed = JSON.parse(cleaned);                            // JSON = text format for data; JSON.parse turns the text into a real JS object

        if (typeof parsed.meaning !== "string" || parsed.meaning.trim() === "") return null; // null / empty meaning = "not a real word" (or a bad reply), so report failure
        return {                                                       // the clean result we hand back to getMeaning
            meaning: parsed.meaning.trim(),                            // the simple one-sentence meaning
            partOfSpeech: (parsed.partOfSpeech || "").toString().trim().toLowerCase(), // noun / verb / ... in lowercase, empty text if missing
            exampleSentence: parsed.exampleSentence || "No example available", // example sentence, with the same placeholder the app already uses
            synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms.slice(0, 3) : [], // keep only a real list, at most 3
            source: senses.length ? "Dictionary + AI" : "AI Generated" // remember where this meaning came from
        };
    } catch (err) {                                                    // network error, timeout, or the AI sent text that isn't valid JSON
        logger.error(`[Groq meaning] Failed for "${word}":`, err.response?.data || err.message); // log why
        return null;                                                   // tell the caller "this step failed"
    }
};

/**
 * Find the meaning of a word. The order of steps:
 *   0. our shared cache (only if it was made with the CURRENT recipe)
 *   1. real dictionary senses  →  2. AI picks the most common sense and rewrites it simply
 *   3. if the AI fails: an older cached meaning, or the dictionary's first sense
 *   4. nothing worked: "No meaning found"
 * options.forceRefresh = true skips the cache so the meaning is rebuilt from scratch (used by "Regenerate").
 */
const getMeaning = async (word, options = {}) => {                     // options = optional extra settings; {} means "none given" (so old callers like ocrRoutes still work)
    const forceRefresh = options.forceRefresh === true;                // true only when the caller explicitly asks for a rebuild
    let staleCache = null;                                             // will hold an older cached meaning, kept as a safety net

    // ── Step 0: our own shared cache ──
    if (!forceRefresh) {                                               // normal lookups use the cache; "Regenerate" skips it
        const cached = await WordCache.findOne({ word }).lean();       // one DB read: is this word already cached? (.lean() = plain object, read-only)
        if (cached && cached.meaningVersion === MEANING_VERSION) {     // cached AND made with the current recipe = good enough to use
            return {                                                   // hand back the cached meaning straight away
                meaning: cached.meaning,
                partOfSpeech: cached.partOfSpeech || "",
                exampleSentence: cached.exampleSentence,
                synonyms: cached.synonyms,
                source: cached.source
            };
        }
        staleCache = cached || null;                                   // an out-of-date entry (or null): keep it in case everything else fails
    }

    // ── Step 1: get ALL real dictionary senses (not just the first one) ──
    const senses = await fetchDictionarySenses(word);                  // may be an empty list if the dictionary is down

    // ── Step 2: let the AI choose the most common sense and rewrite it simply ──
    const aiMeaning = await generateMeaningWithGroq(word, senses);     // works with or without senses
    if (aiMeaning) {                                                   // the AI gave a good answer
        await cacheMeaning(word, aiMeaning);                           // save it for every user (this also replaces any old cached entry)
        return aiMeaning;                                              // done
    }

    // ── Step 3: the AI failed, so use the best safety net we have ──
    if (staleCache) {                                                  // an older cached meaning exists
        return {                                                       // better than nothing, and we do NOT re-save it as "current"
            meaning: staleCache.meaning,
            partOfSpeech: staleCache.partOfSpeech || "",
            exampleSentence: staleCache.exampleSentence,
            synonyms: staleCache.synonyms,
            source: staleCache.source
        };
    }
    if (senses.length) {                                               // the dictionary worked, only the AI failed
        return {                                                       // use the dictionary's first sense (the old behaviour); NOT cached, so next time we retry the AI
            meaning: senses[0].definition,
            partOfSpeech: senses[0].partOfSpeech || "",
            exampleSentence: senses[0].example || "No example available",
            synonyms: senses[0].synonyms || [],
            source: "Free Dictionary API"
        };
    }

    // ── Step 4: nothing worked ──
    return {                                                           // deliberately NOT cached, so we try again next time
        meaning: "No meaning found — try checking the spelling or add your own note.",
        partOfSpeech: "",
        exampleSentence: "No example available",
        synonyms: [],
        source: "Not found"
    };
};

/**
 * Saves a successfully-found meaning into the shared cache so every future
 * lookup of this word — by ANY user — is an instant DB read instead of a
 * fresh network call. Swallows its own errors on purpose: if the cache
 * write fails for some reason, the user should still get their definition:
 * we don't want a caching bug to break the actual feature.
 */
const cacheMeaning = async (word, result) => {
    try {
        // upsert: true means "create it if it doesn't exist yet" — safe even if two
        // requests for the same brand-new word land at almost the same time
        await WordCache.findOneAndUpdate(
            { word },
            { word, ...result, meaningVersion: MEANING_VERSION }, // NEW: stamp the entry with the current recipe version so old entries are recognised as stale
            { upsert: true }
        );
    } catch (err) {
        logger.error(`[Cache] Failed to save "${word}":`, err.message);
    }
};

module.exports = { MEANING_VERSION, fetchDictionarySenses, generateMeaningWithGroq, getMeaning, cacheMeaning }; // everything other files may use
