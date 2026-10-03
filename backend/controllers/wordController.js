const Word = require("../models/Word"); // per-user saved words (their personal list)
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
        console.log(`[Dictionary API] Failed for "${word}":`, err.response?.status || err.message); // log why, to help debugging
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
        console.log(`[Groq meaning] Failed for "${word}":`, err.response?.data || err.message); // log why
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
        console.log(`[Cache] Failed to save "${word}":`, err.message);
    }
};

// Exported so other files (currently ocrRoutes.js) can reuse the exact same lookup
// chain — cache, then dictionary API, then Groq — instead of duplicating it.
exports.getMeaning = getMeaning;


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

        // Normalize once and reuse everywhere below — trim() drops stray spaces,
        // toLowerCase() means "Gauche", "gauche" and "GAUCHE" are all treated as
        // the exact same saved word instead of three separate entries.
        const normalizedWord = word.trim().toLowerCase();

        // ── Duplicate check ──
        // Look for a word this SAME user already has saved (userId + word together)
        // before doing any dictionary lookup or creating a new document. Without this,
        // clicking "Add" twice — or re-adding a word already in the list — silently
        // created a second, identical row instead of telling the user it's already there.
        const alreadySaved = await Word.findOne({ userId, word: normalizedWord });
        if (alreadySaved) {
            // 409 Conflict is the standard HTTP status for "this already exists" —
            // the frontend uses this specific code to show a friendly inline message
            // instead of treating it like a generic failure.
            return res.status(409).json({
                message: `"${normalizedWord}" is already in your word list.`,
                word: alreadySaved // send the existing entry back in case the frontend wants to show/link to it
            });
        }

        const { meaning, partOfSpeech, exampleSentence, synonyms } = await getMeaning(normalizedWord); // NEW: also take partOfSpeech from the lookup

        const newWord = await Word.create({
            userId,
            word: normalizedWord,
            meaning,
            partOfSpeech, // NEW: noun / verb / adjective ... saved with the word
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
        // .lean() skips building full Mongoose documents (with all their extra tracking
        // methods) and just returns plain JS objects — noticeably faster for a read-only
        // list like this, since we never call .save() on these results.
        const words = await Word.find({ userId: req.user }).sort({ createdAt: -1 }).lean();
        res.status(200).json(words);
    } catch (error) {
        console.log("GET WORDS ERROR:", error.message);
        res.status(500).json({ message: "Failed to fetch words" });
    }
};


/**
 * PREVIEW A MEANING — for the voice assistant.
 * Looks a word up (cache → dictionary API → Groq, same chain addWord uses)
 * but does NOT save it to the user's word list. This lets the voice
 * assistant speak a definition aloud first, and only call addWord()
 * afterwards if the user actually asks (by voice) to save it — "hearing"
 * a word and "adding" it are two separate, deliberate steps.
 */
exports.previewMeaning = async (req, res) => {
    try {
        // req.params.word comes from the URL, e.g. GET /api/words/preview/ubiquitous
        const word = req.params.word.trim().toLowerCase(); // normalize the same way addWord() does, so the cache is shared between preview and add
        if (!word) {
            return res.status(400).json({ message: "Word is required" });
        }

        // reuse the exact same lookup chain addWord() uses — one source of truth
        const { meaning, partOfSpeech, exampleSentence, synonyms, source } = await getMeaning(word); // NEW: include partOfSpeech

        res.status(200).json({ word, meaning, partOfSpeech, exampleSentence, synonyms, source }); // NEW: send partOfSpeech to the browser too
    } catch (error) {
        console.log("PREVIEW MEANING ERROR:", error.message);
        res.status(500).json({ message: "Failed to look up word" });
    }
};


/**
 * Ask Groq for 3 plausible-but-wrong meanings of `word`, written in the
 * same style/length as a real dictionary definition, each with a short
 * reason why it's wrong. Falls back to null on any failure so the caller
 * can use the old same-vocab-list method instead.
 */
const generateSimilarDecoys = async (word, correctMeaning, partOfSpeech = "") => { // NEW: partOfSpeech (optional) lets wrong options match the right answer's type of word
    if (!process.env.GROQ_API_KEY) return null;

    const prompt = `You are building a vocabulary quiz. The word is "${word}" and its correct meaning is:
"${correctMeaning}"

Write 3 INCORRECT but PLAUSIBLE dictionary-style definitions for "${word}" — the kind of wrong answers that would actually trick someone who half-remembers the word. Match the length and tone of the correct meaning.${partOfSpeech ? ` Every wrong option must also describe a ${partOfSpeech}, just like the correct meaning.` : ""} Do not just negate the correct meaning; invent a different, believable concept.

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
        // .lean() here too — this data is only read to build quiz questions, never saved back.
        const words = await Word.find({ userId: req.user }).sort({ createdAt: -1 }).lean();

        if (words.length < 4) {
            return res.status(400).json({ message: "Add at least 4 words to start the quiz!" });
        }

        // ── NEW (no-repeat fix): read the list of word ids the browser has already asked ──
        const excludeText = req.query.exclude || "";                      // req.query = the part after "?" in the URL, e.g. /quiz?exclude=id1,id2 (empty text if missing)
        const excludeIds = excludeText.split(",").filter(Boolean);        // turn "id1,id2" into ["id1","id2"]; filter(Boolean) drops empty pieces so "" becomes []
        const excludeSet = new Set(excludeIds);                           // a Set = a list that can answer "is this id in here?" very quickly

        // ── NEW: keep only the words that have NOT been asked yet this round ──
        const freshWords = words.filter(w => !excludeSet.has(w._id.toString())); // _id is a MongoDB ObjectId, .toString() turns it into plain text so we can compare

        // ── NEW: every word has been asked once, so tell the browser the round is finished ──
        if (freshWords.length === 0) {                                    // nothing left to ask
            return res.json({ roundComplete: true, totalWords: words.length }); // send a "finished" signal (as JSON) instead of a question, then stop
        }

        const randomIndex = Math.floor(Math.random() * freshWords.length); // random position, but now ONLY among unasked words (was words.length)
        const correctWord = freshWords[randomIndex];                      // the word we ask about (was words[randomIndex])
        const correctAnswer = correctWord.meaning;

        // ── Try AI-generated similar-meaning decoys first ──
        const aiDecoys = await generateSimilarDecoys(correctWord.word, correctAnswer, correctWord.partOfSpeech); // NEW: pass the part of speech along

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
            wordId: correctWord._id,                                      // NEW: this word's id, so the browser can cross it off its "asked" list
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


/**
 * REGENERATE A MEANING — the "↻ Regenerate" button.
 * Rebuilds the meaning of ONE of the user's saved words from scratch, ignoring the shared cache,
 * then saves the new meaning on the user's word (and getMeaning refreshes the shared cache too).
 */
exports.regenerateMeaning = async (req, res) => {                      // runs when the browser calls PATCH /api/words/:id/regenerate
    try {                                                              // try/catch so any crash becomes a clean error message
        const saved = await Word.findOne({ _id: req.params.id, userId: req.user }); // find the word by id, but ONLY if it belongs to this user (data isolation)
        if (!saved) {                                                  // no such word for this user
            return res.status(404).json({ message: "Word not found" }); // 404 = not found
        }

        const fresh = await getMeaning(saved.word, { forceRefresh: true }); // rebuild the meaning, skipping the cache

        if (!/AI/.test(fresh.source)) {                                // only accept results the AI helped write ("Dictionary + AI" or "AI Generated")
            return res.status(502).json({                              // 502 = a service we depend on (the AI) didn't answer properly
                message: "Couldn't regenerate the meaning right now — please try again in a moment."
            });                                                        // the old meaning stays untouched
        }

        saved.meaning = fresh.meaning;                                 // replace the old meaning with the new one
        saved.partOfSpeech = fresh.partOfSpeech;                       // update the part of speech too
        saved.exampleSentence = fresh.exampleSentence;                 // update the example sentence
        saved.synonyms = fresh.synonyms;                               // update the synonyms
        await saved.save();                                            // write the changes to MongoDB

        res.status(200).json(saved);                                   // send the updated word back to the browser
    } catch (error) {                                                  // anything unexpected
        console.log("REGENERATE MEANING ERROR:", error.message);       // log it for debugging
        res.status(500).json({ message: "Failed to regenerate meaning" }); // 500 = server error
    }
};


// LEARNED_AFTER = how many right answers IN A ROW turn a word into "learned".
// Change this one number to make the rule easier (2) or stricter (5).
const LEARNED_AFTER = 3;

/**
 * RECORD A REVIEW — saves the result of ONE quiz answer (or flashcard rating) on the word's scorecard.
 * Browser sends: { mode: "quiz", selected: "<the option the user picked>" }
 *            or: { mode: "flashcard", known: true | false }
 * The SERVER decides if a quiz answer is correct (it compares with the saved meaning),
 * so the saved results can't be faked by the browser.
 */
exports.recordReview = async (req, res) => {                           // runs when the browser calls POST /api/words/:id/review
    try {                                                              // try/catch so any crash becomes a clean error message
        const { mode, selected, known } = req.body;                    // pull the three possible fields out of the request body (the JSON the browser sent)

        if (mode !== "quiz" && mode !== "flashcard") {                 // we only understand these two modes
            return res.status(400).json({ message: "mode must be 'quiz' or 'flashcard'" }); // 400 = bad request
        }

        const word = await Word.findOne({ _id: req.params.id, userId: req.user }); // find the word by id, but ONLY if it belongs to this user (data isolation)
        if (!word) {                                                   // no such word for this user
            return res.status(404).json({ message: "Word not found" }); // 404 = not found
        }

        let correct;                                                   // will become true (right) or false (wrong)
        if (mode === "quiz") {                                         // quiz: the browser tells us WHICH option was picked
            if (typeof selected !== "string") {                        // the picked option must be text
                return res.status(400).json({ message: "selected is required for quiz answers" });
            }
            correct = selected === word.meaning;                       // the server decides: right only if the pick equals the saved meaning
        } else {                                                       // flashcard: the user honestly says whether they knew it
            if (typeof known !== "boolean") {                          // must be exactly true or false
                return res.status(400).json({ message: "known (true/false) is required for flashcards" });
            }
            correct = known;                                           // "I knew it" = right, "still learning" = wrong
        }

        const wasLearned = word.status === "learned";                  // remember the old status so we can tell the browser if it changed

        word.lastReviewed = new Date();                                // stamp "practised just now"
        if (correct) {                                                 // RIGHT answer
            word.correctCount += 1;                                    // total right answers goes up
            word.correctStreak += 1;                                   // right answers in a row goes up
            if (word.correctStreak >= LEARNED_AFTER) {                 // enough in a row?
                word.status = "learned";                               // the word is now learned
            }
        } else {                                                       // WRONG answer
            word.wrongCount += 1;                                      // total wrong answers goes up
            word.correctStreak = 0;                                    // the streak starts again from zero
            word.status = "review";                                    // back to "review" (even if the user had marked it learned by hand)
        }
        await word.save();                                             // write the updated scorecard to MongoDB

        res.status(200).json({                                         // tell the browser what happened (server → browser)
            correct,                                                   // was it right?
            status: word.status,                                       // "learned" or "review"
            correctStreak: word.correctStreak,                         // right answers in a row now
            correctCount: word.correctCount,                           // total right answers
            wrongCount: word.wrongCount,                               // total wrong answers
            becameLearned: !wasLearned && word.status === "learned",   // true only if this answer just made it learned
            backToReview: wasLearned && word.status === "review"       // true only if this answer just sent it back to review
        });
    } catch (error) {                                                  // anything unexpected
        console.log("RECORD REVIEW ERROR:", error.message);            // log it for debugging
        res.status(500).json({ message: "Failed to record review" });  // 500 = server error
    }
};
