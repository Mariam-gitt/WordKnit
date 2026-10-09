// zod = the library we use to describe "what valid data looks like".
const { z } = require("zod");

// Rules for POST /api/words — the browser sends { word: "ubiquitous" } (extra fields it may send are removed automatically).
const addWordSchema = z.object({
    // The word: must be text, trimmed, not empty, and at most 100 characters.
    // The 100-character cap matters because this text is sent to a PAID AI service — nobody should be able to send a giant text.
    word: z.string({ error: "Word is required" }).trim().min(1, "Word is required").max(100, "Word must be 100 characters or fewer.")
});

// Rules for PATCH /api/words/:id/status — the browser sends { status: "learned" }.
const updateStatusSchema = z.object({
    // z.enum = "the value must be exactly one of these". Anything else (like "banana") is rejected before it can reach the database.
    status: z.enum(["review", "learned"], { error: "status must be 'review' or 'learned'" })
});

// Rules for PATCH /api/words/:id/note — the browser sends { note: "my personal note" }.
const updateNoteSchema = z.object({
    // The note must be text. (The controller still cuts it to 500 characters, so we only check the TYPE here.)
    note: z.string({ error: "note must be text" })
});

// Rules for POST /api/words/:id/review — { mode: "quiz", selected } OR { mode: "flashcard", known }.
const reviewSchema = z.object({
    // mode must be exactly "quiz" or "flashcard".
    mode: z.enum(["quiz", "flashcard"], { error: "mode must be 'quiz' or 'flashcard'" }),
    // selected = the quiz option the user picked. optional() because flashcard answers don't have it.
    selected: z.string().optional(),
    // known = true/false for flashcards. optional() because quiz answers don't have it. (The controller checks the right one exists for the mode.)
    known: z.boolean().optional()
});

// Export all four so wordRoutes.js can attach them to the routes.
module.exports = { addWordSchema, updateStatusSchema, updateNoteSchema, reviewSchema };
