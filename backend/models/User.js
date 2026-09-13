const mongoose = require("mongoose");

/**
 * User Schema
 * Stores user credentials for login system
 */
const userSchema = new mongoose.Schema({

    name: {
        type: String,
        required: true
    },

    email: {
        type: String,
        required: true,
        unique: true // no duplicate accounts
    },

    password: {
        type: String,
        required: true
    },

    // ── Speaking Practice preferences (added for the level/memory feature) ──

    // The IELTS-style difficulty level the coach should practice at by default — saved
    // once via Settings rather than re-picked at the start of every single conversation.
    speakingLevel: {
        type: String,
        enum: ["beginner", "intermediate", "advanced"],
        default: "intermediate"
    },

    // A SHORT rolling summary of this learner across past speaking sessions — a few bullet
    // points like "tends to drop articles ('a', 'the'); has used decoy and ubiquitous in
    // conversation" — NOT a full transcript archive. Regenerated (not just appended to)
    // after each ended session, so it stays small and useful instead of growing forever.
    // This is what lets the coach "remember" you across separate conversations without
    // re-sending your entire speaking history to the LLM every single turn.
    learnerSummary: {
        type: String,
        default: ""
    }

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
