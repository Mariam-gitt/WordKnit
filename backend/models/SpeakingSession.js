// mongoose: same ODM (Object-Document Mapper — maps JS objects to MongoDB documents)
// used by every other model in this app.
const mongoose = require("mongoose");

/**
 * SpeakingSession Schema
 * One document per speaking-practice conversation. Replaces the old approach of
 * saving sessions only in the browser's localStorage — this way, your history
 * survives clearing your browser cache and syncs across any device you log in on.
 */
const speakingSessionSchema = new mongoose.Schema({

    // Which user this session belongs to — every query below filters by this, so one
    // user can never see or delete another user's sessions.
    // index: true speeds up "get my sessions" queries, same reasoning as Word.js's userId field.
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    // The IELTS-style difficulty level THIS SPECIFIC session was practiced at — stored per
    // session (not just read from the user's current setting) so past sessions still show
    // the correct level even if you change your level preference later.
    level: {
        type: String,
        enum: ["beginner", "intermediate", "advanced"], // only these three values are allowed — anything else is rejected by MongoDB itself
        default: "intermediate"
    },

    // The full back-and-forth, in the order it happened. Mirrors exactly what's shown on
    // screen (NOT the internal "fake opening move" sent to the LLM to kick things off —
    // that's an implementation detail the user never sees, so it doesn't belong here either).
    transcript: [{
        role: {
            type: String,
            enum: ["user", "assistant"],
            required: true
        },
        content: {
            type: String,
            required: true
        }
    }],

    // The end-of-session teacher-style feedback (fluency/vocabulary/grammar/coherence,
    // referencing specific saved words used). Empty string until the session is actually
    // ended via "End Session" — a session closed by just navigating away will simply never
    // get one, which is fine, it's still saved with its transcript intact.
    reflection: {
        type: String,
        default: ""
    },

    // When "End Session" was tapped — undefined for a session that was just abandoned
    // mid-conversation instead of deliberately ended. Used by the sidebar to show whether
    // a past conversation has a reflection worth reopening.
    endedAt: {
        type: Date
    }

}, { timestamps: true }); // timestamps adds createdAt/updatedAt automatically — createdAt is what the sidebar shows as "started at"

module.exports = mongoose.model("SpeakingSession", speakingSessionSchema);
