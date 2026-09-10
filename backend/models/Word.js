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

module.exports = mongoose.model("Word", wordSchema);
