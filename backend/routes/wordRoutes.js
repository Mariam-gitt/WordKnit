// const express = require("express");
// const router = express.Router();
// const { getWords, addWord, getQuiz, updateStatus, updateNote } = require("../controllers/wordController");
// const protect = require("../middleware/authMiddleware");

// router.post("/", protect, addWord);
// router.get("/", protect, getWords);
// router.get("/quiz", protect, getQuiz);
// router.patch("/:id/status", protect, updateStatus);
// router.patch("/:id/note", protect, updateNote);

// module.exports = router;

// // DELETE word
// const deleteWord = async (req, res) => {
//     const Word = require("../models/Word");
//     try {
//         const { id } = req.params;
//         const word = await Word.findOneAndDelete({ _id: id, userId: req.user });
//         if (!word) return res.status(404).json({ message: "Word not found" });
//         res.json({ message: "Word deleted" });
//     } catch (err) {
//         res.status(500).json({ message: "Failed to delete word" });
//     }
// };

// router.delete("/:id", protect, deleteWord);


const express = require("express");
const router = express.Router();
const { getWords, addWord, getQuiz, updateStatus, updateNote, previewMeaning, regenerateMeaning, recordReview } = require("../controllers/wordController");
const protect = require("../middleware/authMiddleware");
const { validateBody, validateParams } = require("../middleware/validate"); // validateBody checks req.body, validateParams checks that URL ids look like real MongoDB ids
const { addWordSchema, updateStatusSchema, updateNoteSchema, reviewSchema } = require("../validators/wordSchemas"); // the rules for each request body
const { aiLimiter } = require("../middleware/rateLimiters"); // SECURITY: caps calls to routes that use the paid AI (150 / 15 min / IP)

router.post("/", protect, validateBody(addWordSchema), aiLimiter, addWord);          // SECURITY: adding a word may call the AI
router.get("/", protect, getWords);
router.get("/quiz", protect, aiLimiter, getQuiz);       // SECURITY: each quiz question calls the AI for wrong answers
// Voice assistant uses this to hear a meaning WITHOUT saving it to the word list.
// Placed above "/:id/..." routes isn't needed here since the path shape differs,
// but it must come before any future "/:something" catch-all route is added.
router.get("/preview/:word", protect, aiLimiter, previewMeaning); // SECURITY: a preview may call the AI
router.patch("/:id/status", protect, validateParams("id"), validateBody(updateStatusSchema), updateStatus); // check the id in the URL AND the status in the body
router.patch("/:id/note", protect, validateParams("id"), validateBody(updateNoteSchema), updateNote); // check the id AND the note
router.patch("/:id/regenerate", protect, validateParams("id"), aiLimiter, regenerateMeaning); // SECURITY: regenerating calls the AI // NEW: rebuild one word's meaning (the "↻ Regenerate" button)
router.post("/:id/review", protect, validateParams("id"), validateBody(reviewSchema), recordReview); // NEW: save one quiz answer / flashcard rating on the word (right/wrong counts, streak, learned status)

module.exports = router;

// DELETE word
const deleteWord = async (req, res) => {
    const Word = require("../models/Word");
    try {
        const { id } = req.params;
        const word = await Word.findOneAndDelete({ _id: id, userId: req.user });
        if (!word) return res.status(404).json({ message: "Word not found" });
        res.json({ message: "Word deleted" });
    } catch (err) {
        res.status(500).json({ message: "Failed to delete word" });
    }
};

router.delete("/:id", protect, validateParams("id"), deleteWord); // reject malformed ids before touching the database
