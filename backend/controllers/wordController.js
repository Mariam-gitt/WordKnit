const logger = require("../utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const Word = require("../models/Word"); // per-user saved words (their personal list)
const { getMeaning } = require("../services/meaningService"); // NEW: dictionary / cache / Groq logic moved to a service
const { generateSimilarDecoys, pickWeightedWord } = require("../services/quizService"); // NEW: quiz decoys + weighted word pick moved to a service
const { applyAnswer } = require("../services/reviewService"); // NEW: streak / learned scoring rules moved to a service

// Exported so other files (currently ocrRoutes.js) can reuse the exact same lookup
// chain — cache, then dictionary API, then Groq — instead of duplicating it.
exports.getMeaning = getMeaning;


/**
 * ADD WORD
 */
exports.addWord = async (req, res) => {
    try {
        const userId = req.user;
        logger.debug("ADD WORD - userId:", userId);

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
        logger.error("ADD WORD ERROR:", error.response?.data || error.message);
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
        logger.error("GET WORDS ERROR:", error.message);
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
        logger.error("PREVIEW MEANING ERROR:", error.message);
        res.status(500).json({ message: "Failed to look up word" });
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

        const correctWord = pickWeightedWord(freshWords);                 // NEW: raffle among unasked words — weak words hold more tickets, so they tend to come up earlier (was a plain random pick)
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
        logger.error("QUIZ ERROR:", error.message);
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
        logger.error("REGENERATE MEANING ERROR:", error.message);       // log it for debugging
        res.status(500).json({ message: "Failed to regenerate meaning" }); // 500 = server error
    }
};



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

        applyAnswer(word, correct);                                    // NEW: the scoring rules now live in services/reviewService.js (stamp date, streaks, learned / back to review)

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
        logger.error("RECORD REVIEW ERROR:", error.message);            // log it for debugging
        res.status(500).json({ message: "Failed to record review" });  // 500 = server error
    }
};
