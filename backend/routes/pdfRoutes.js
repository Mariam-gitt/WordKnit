const logger = require("../utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const protect  = require("../middleware/authMiddleware");
const Word     = require("../models/Word");
const Document = require("../models/Document");
const { readPdf } = require("../utils/pdfStorage"); // NEW: reads the PDF bytes from GridFS (or from the old base64 field)
const { validateParams } = require("../middleware/validate"); // checks that the :documentId in the URL looks like a real MongoDB id

// 20MB cap on raw PDF uploads here — generous for text-based academic PDFs,
// while still protecting the server from runaway memory use on huge scans.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }
});

/* ─────────────────────────────────────────────────────────
   POST /api/pdf/analyze-difficulty
   Extract hard vocabulary words from any text-based PDF.

   Algorithm:
    1. Parse PDF text with pdf-parse
    2. Tokenise into all words ≥ 4 chars, count frequencies
    3. Build EASY_WORDS set — skip the ~1 000 most common English words
    4. Score remaining words by:
         • Length                 (longer = harder)
         • Academic suffix match  (-tion, -ity, -ology …)
         • Academic prefix match  (inter-, micro-, pseudo- …)
         • Rarity in this doc     (appears only 1-2 times = less familiar)
    5. Exclude words already in the user's vocab
    6. Return top 50, sorted score-desc, with PDF meta-stats
────────────────────────────────────────────────────────── */

// ~1 000 most common English words — all considered "easy"
const EASY_WORDS = new Set([
  "about","above","across","after","again","against","almost","alone","along",
  "already","also","although","always","among","another","anyone","anything",
  "anyway","around","back","became","because","become","becomes","before",
  "being","below","between","beyond","both","bring","brought","called","came",
  "cannot","comes","could","didn","does","doing","done","down","during","each",
  "early","either","else","enough","even","every","example","except","fact",
  "felt","find","first","follows","found","from","gave","general","getting",
  "give","given","going","good","great","hand","hasn","have","having","help",
  "hence","here","high","himself","home","however","important","include",
  "into","itself","just","keep","kept","know","large","last","later","left",
  "less","light","like","likely","little","long","look","looked","made","make",
  "many","maybe","mean","might","more","most","move","much","must","myself",
  "near","need","never","next","note","often","once","only","open","other",
  "over","page","part","people","place","point","probably","put","quite",
  "rather","reach","real","really","right","said","same","seem","seen","self",
  "several","shall","show","should","since","small","some","soon","still",
  "such","sure","take","tell","than","that","their","them","then","there",
  "these","they","thing","think","this","those","though","three","through",
  "time","today","together","told","took","toward","under","until","upon",
  "used","using","very","want","well","went","were","what","when","where",
  "which","while","whose","will","with","within","without","word","work",
  "world","would","write","year","your","please","terms","title","table",
  "study","times","pages","volume","various","whether","therefore","following",
  "different","including","however","although","because","between","through",
  "might","could","should","would","these","those","their","where","which",
  "while","after","before","since","until","during","against","about","above",
  "below","under","over","into","onto","upon","from","with","without","within",
  "along","across","around","behind","beside","between","beyond","except",
  "inside","outside","toward","amongst","despite","except","regarding",
]);

const ACADEMIC_SUFFIXES = [
  "tion","sion","ment","ness","ity","ism","ist","ize","ise","ical","ive",
  "ous","ence","ance","ogy","phy","sis","tic","tude","ology","ography",
  "ometry","onomy","istic","ification","ization","isation","atorial",
  "aneous","escent","iferous","ivorous","omorphic","esque","itude","archy",
  "cracy","logue","mania","phobia","scopy","trophy","valent","morphic",
];

const ACADEMIC_PREFIXES = [
  "anti","auto","bio","chrono","circum","contra","counter","crypto","cyber",
  "demo","eco","epi","equi","ethno","geo","hetero","homo","hydro","hyper",
  "hypo","inter","intra","intro","iso","macro","micro","mono","morph","multi",
  "neo","neuro","non","omni","ortho","para","peri","photo","phys","poly",
  "post","pre","proto","pseudo","psycho","retro","semi","socio","stereo",
  "sub","super","supra","sym","syn","tele","theo","thermo","trans","ultra",
  "uni","vaso","ambi","dys","mal","pan","quasi","techno",
];

/**
 * Strip common inflections (plurals, -ed, -ing, -ly) so that e.g. "houses",
 * "walked", "running", "quickly" map back to a base form before checking
 * against EASY_WORDS — this stops everyday inflected words from slipping
 * through as "difficult" just because their exact surface form isn't listed.
 */
function lemmatize(word) {
    let w = word;
    if (w.length > 6 && w.endsWith("ies"))      w = w.slice(0, -3) + "y";
    else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 5 && w.endsWith("ied")) w = w.slice(0, -3) + "y";
    else if (w.length > 4 && w.endsWith("ed"))  w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith("es"))  w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith("ly"))  w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    return w;
}

function scoreDifficulty(word, freq, totalTokens) {
    let s = 0;
    const len = word.length;

    // Length score — still rewards long words, but no longer the only path to qualifying
    if (len >= 6)  s += 1;
    if (len >= 8)  s += 2;
    if (len >= 10) s += 3;
    if (len >= 13) s += 2;

    // Academic suffix — strongest signal, works even on short words (e.g. "tacit", "wry" won't
    // match this, but "terse", "inert", "fervid" style words get caught via rarity instead)
    if (ACADEMIC_SUFFIXES.some(sx => word.endsWith(sx))) s += 5;

    // Academic prefix — good signal
    if (ACADEMIC_PREFIXES.some(px => word.startsWith(px))) s += 3;

    // Rarity bonus (infrequent in this specific text → less familiar).
    // This is what lets genuinely hard SHORT words (no length/affix signal)
    // still qualify as difficult, since rarity alone can push them over the bar.
    const relFreq = freq / totalTokens;
    if (relFreq < 0.0002) s += 4;
    else if (relFreq < 0.001) s += 2;
    else if (relFreq < 0.003) s += 1;

    // Consonant cluster bonus — words with unusual consonant clustering
    // (rhythm, glyph, sphinx) tend to be harder regardless of length
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(word)) s += 1;

    return s;
}

/**
 * Core difficulty-analysis pipeline. Takes a raw PDF buffer + the user's
 * known-word set, returns the same shape both routes below respond with.
 * Shared so the multipart upload route and the saved-document route don't
 * duplicate the scoring logic.
 */
async function analyzeBuffer(buf, knownSet) {
    const magic = buf.slice(0, 4).toString("ascii");
    if (magic !== "%PDF") {
        return { error: "That doesn't look like a PDF file. Please upload a .pdf document." };
    }

    let pdfParse;
    try { pdfParse = require("pdf-parse"); }
    catch { return { error: "pdf-parse not installed. Run: cd backend && npm install pdf-parse" }; }

    // Cap how many pages get parsed for very large documents — keeps the
    // request fast and avoids spiking memory on huge scanned-text PDFs.
    const MAX_PAGES = 150;

    let pdfData;
    try { pdfData = await pdfParse(buf, { max: MAX_PAGES }); }
    catch (e) {
        logger.error("pdf-parse error:", e.message);
        return { error: "Could not parse this PDF. It may be password-protected or corrupted." };
    }

    const rawText = pdfData.text || "";
    if (rawText.trim().length < 100) {
        return { error: "This PDF has no extractable text — it may be a scanned image. Try a PDF with selectable text." };
    }

    const truncatedByPages = (pdfData.numpages || 0) > MAX_PAGES;

    // Tokenise — capture all lowercase words ≥ 4 chars
    let allTokens = rawText.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];

    // Backstop token cap — protects against pathological cases (e.g. a
    // single page packed with dense text) even when the page cap above
    // doesn't kick in. ~120k tokens is comfortably more than a 150-page
    // academic PDF would realistically produce.
    const MAX_TOKENS = 120000;
    const truncatedByTokens = allTokens.length > MAX_TOKENS;
    if (truncatedByTokens) allTokens = allTokens.slice(0, MAX_TOKENS);

    const totalTokens = allTokens.length;
    const truncated = truncatedByPages || truncatedByTokens;

    if (totalTokens < 30) {
        return { error: "Not enough text found in this PDF to analyse." };
    }

    // Build frequency map
    const freqMap = {};
    for (const tok of allTokens) {
        freqMap[tok] = (freqMap[tok] || 0) + 1;
    }

    // Score and rank — uses the lemmatized form to check against EASY_WORDS/known
    // vocab (so "houses" is recognised as "house"), but keeps the original surface
    // form for scoring/display, since the inflected form is what the reader saw.
    const scored = Object.entries(freqMap)
        .filter(([word]) => {
            const lemma = lemmatize(word);
            return word.length >= 4              &&   // at least 4 chars (was 5 — short hard words now count)
                   !EASY_WORDS.has(word)          &&   // not a common easy word (surface form)
                   !EASY_WORDS.has(lemma)         &&   // ...or its base form
                   !knownSet.has(lemma)           &&   // not already in user's vocab
                   /^[a-z]+$/.test(word);                // pure alpha only (no numbers/hyphens)
        })
        .map(([word, freq]) => ({
            word,
            freq,
            score: scoreDifficulty(word, freq, totalTokens)
        }))
        .filter(w => w.score >= 4)        // minimum difficulty bar
        .sort((a, b) => b.score - a.score || a.freq - b.freq)
        .slice(0, 50);

    const words = scored.map(w => w.word);

    logger.info(`[Difficulty] ${totalTokens} tokens → ${Object.keys(freqMap).length} unique → ${words.length} difficult${truncated ? " (truncated)" : ""}`);

    return {
        words,
        total: words.length,
        truncated,
        pdfStats: {
            pages: pdfData.numpages || 0,
            pagesAnalyzed: truncatedByPages ? MAX_PAGES : (pdfData.numpages || 0),
            totalTokens,
            uniqueWords: Object.keys(freqMap).length,
        }
    };
}

/* ─────────────────────────────────────────────────────────
   POST /api/pdf/analyze-difficulty
   Extract hard vocabulary words from an uploaded PDF file
   (used by the Dashboard's standalone "Upload PDF" button).
────────────────────────────────────────────────────────── */
router.post("/analyze-difficulty", protect, upload.single("pdf"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "No PDF file provided" });

        const existingWords = await Word.find({ userId: req.user }, "word").lean();
        const knownSet = new Set(existingWords.map(w => lemmatize(w.word.toLowerCase())));

        const result = await analyzeBuffer(req.file.buffer, knownSet);
        if (result.error) return res.status(400).json({ message: result.error });

        res.json(result);

    } catch (err) {
        logger.error("ANALYZE-DIFFICULTY ERROR:", err.message);
        res.status(500).json({ message: "Analysis failed. Please try again." }); // the real error is in the server log, not sent to the browser
    }
});

/* ─────────────────────────────────────────────────────────
   GET /api/pdf/analyze-difficulty/:documentId
   Same analysis, but run on a PDF already saved in the user's
   library — used by the PDF Reader sidebar so there's no need
   to re-upload the file you already have open.
────────────────────────────────────────────────────────── */
router.get("/analyze-difficulty/:documentId", protect, validateParams("documentId"), async (req, res) => {
    try {
        const doc = await Document.findOne({ _id: req.params.documentId, userId: req.user }).select("+fileData"); // "+fileData" = also load the hidden legacy base64 field (old documents)
        if (!doc) return res.status(404).json({ message: "PDF not found in your library" });

        const buf = await readPdf(doc); // NEW: works for both storage layouts

        const existingWords = await Word.find({ userId: req.user }, "word").lean();
        const knownSet = new Set(existingWords.map(w => lemmatize(w.word.toLowerCase())));

        const result = await analyzeBuffer(buf, knownSet);
        if (result.error) return res.status(400).json({ message: result.error });

        res.json(result);

    } catch (err) {
        logger.error("ANALYZE-DIFFICULTY (saved doc) ERROR:", err.message);
        res.status(500).json({ message: "Analysis failed. Please try again." }); // the real error is in the server log, not sent to the browser
    }
});

/* ─────────────────────────────────────────────────────────
   Multer error handler — catches "file too large" from either
   route above and returns a clear message instead of a generic
   500/crash. Must come after the routes that use `upload`.
────────────────────────────────────────────────────────── */
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "PDF is too large. Please upload a file under 20MB." });
    }
    next(err);
});

// ← single export, at the very end
module.exports = router;
