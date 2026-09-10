// mongoose is the library WordKnit uses to talk to MongoDB (it turns JS objects into DB documents)
const mongoose = require("mongoose");

// This schema is a GLOBAL dictionary, separate from the per-user "Word" model.
// Word.js stores what EACH user personally added to their own list (their progress, notes, quiz stats).
// WordCache stores the definition ONCE per unique English word, shared by every user.
// Why this matters for efficiency: today, if 50 users each add "ubiquitous" to their list,
// the app calls the dictionary API / Groq AI 50 separate times for the exact same word.
// With this cache, only the FIRST lookup ever hits the network — the other 49 are instant
// reads from our own database, which is faster and doesn't depend on a third-party API being up.
const wordCacheSchema = new mongoose.Schema({

    // the English word itself, always stored lowercase so "Ubiquitous" and "ubiquitous" share one row
    word: {
        type: String,
        required: true,
        unique: true, // MongoDB will reject a second row with the same word — enforces "one entry per word"
        lowercase: true,
        trim: true // removes accidental leading/trailing spaces before saving
    },

    // the definition text we found, from whichever source answered first
    meaning: {
        type: String,
        required: true
    },

    // an example sentence using the word, if the source provided one
    exampleSentence: {
        type: String,
        default: "No example available"
    },

    // any synonyms the source gave us (empty array if none)
    synonyms: {
        type: [String],
        default: []
    },

    // which source answered — "Free Dictionary API", "AI Generated" (Groq), etc.
    // useful for debugging which fallback is actually being used in production
    source: {
        type: String,
        default: "Unknown"
    }

}, {
    timestamps: true // adds createdAt / updatedAt automatically, so we can see when a word was first cached
});

// module.exports makes this model importable elsewhere with require("../models/WordCache")
module.exports = mongoose.model("WordCache", wordCacheSchema);
