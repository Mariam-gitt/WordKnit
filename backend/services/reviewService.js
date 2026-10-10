// reviewService = the scoring rules for practising a word (streaks, learned / back to review).
// The rule used to be written inline inside recordReview(); now it is ONE small function that works on any object with the
// right fields, so it can be unit-tested with plain objects (no database needed).

// LEARNED_AFTER = how many right answers IN A ROW turn a word into "learned".
// Change this one number to make the rule easier (2) or stricter (5).
const LEARNED_AFTER = 3;

// applyAnswer(word, correct) updates the word's scorecard in memory. It does NOT save — the controller calls word.save() afterwards.
// word = a saved word (Mongoose document or plain object with correctCount, correctStreak, wrongCount, status); correct = true/false.
const applyAnswer = (word, correct) => {
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
};

module.exports = { LEARNED_AFTER, applyAnswer }; // everything other files may use
