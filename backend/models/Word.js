const mongoose = require("mongoose"); // library that maps this schema to a MongoDB collection

const wordSchema = new mongoose.Schema({

    // Which user this saved word belongs to.
    // index: true speeds up every query that filters by user (getWords, getQuiz) — without
    // it, MongoDB has to scan the entire Word collection on every request to find one
    // user's words; with it, that lookup goes straight to the matching documents.
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    word: {
        type: String,
        required: true
    },

    meaning: String,

    // NEW: noun / verb / adjective ... — the type of word this meaning is for
    partOfSpeech: {
        type: String,
        default: ""
    },

    exampleSentence: String,

    synonyms: [String],

    // review | learned
    status: {
        type: String,
        default: "review"
    },

    // Quiz tracking
    correctCount: {
        type: Number,
        default: 0
    },

    wrongCount: {
        type: Number,
        default: 0
    },

    // Flashcard review tracking
    lastReviewed: {
        type: Date
    },

    // User's personal note for this word
    note: {
        type: String,
        default: ""
    }

},
{
    timestamps: true
});

// Compound unique index: for any ONE user, the same "word" value can only appear
// once in this collection. This is a second, database-level safety net on top of
// the findOne() duplicate check in wordController.js — the controller check stops
// the normal "click Add twice" case, but this index guarantees it even if two
// requests somehow land at the exact same instant (a "race condition"), which a
// plain JS if-check running in Node can't fully protect against on its own.
wordSchema.index({ userId: 1, word: 1 }, { unique: true });

module.exports = mongoose.model("Word", wordSchema);
