// quizService = the quiz "brain": asking the AI for wrong answers (decoys) and raffle-picking which word to ask next.
// MOVED here unchanged from controllers/wordController.js so it can be tested without a database or a web request.
const logger = require("../utils/logger"); // central logger (levels + timestamps) instead of raw console.log
const axios = require("axios"); // library used to make HTTP requests to the Groq AI service

/**
 * Ask Groq for 3 plausible-but-wrong meanings of `word`, written in the
 * same style/length as a real dictionary definition, each with a short
 * reason why it's wrong. Falls back to null on any failure so the caller
 * can use the old same-vocab-list method instead.
 */
const generateSimilarDecoys = async (word, correctMeaning, partOfSpeech = "") => { // NEW: partOfSpeech (optional) lets wrong options match the right answer's type of word
    if (!process.env.GROQ_API_KEY) return null;

    const prompt = `You are building a vocabulary quiz. The word is "${word}" and its correct meaning is:
"${correctMeaning}"

Write 3 INCORRECT but PLAUSIBLE dictionary-style definitions for "${word}" — the kind of wrong answers that would actually trick someone who half-remembers the word. Match the length and tone of the correct meaning.${partOfSpeech ? ` Every wrong option must also describe a ${partOfSpeech}, just like the correct meaning.` : ""} Do not just negate the correct meaning; invent a different, believable concept.

For each wrong option, also give a short reason (max 16 words) explaining why it's wrong — ideally by naming what real word or concept that wrong meaning actually belongs to.

Respond in this exact JSON format, nothing else:
{
  "wrongOptions": [
    { "meaning": "...", "reason": "..." },
    { "meaning": "...", "reason": "..." },
    { "meaning": "...", "reason": "..." }
  ]
}`;

    try {
        const groqRes = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                // llama-3.3-70b-versatile was shut down by Groq on Aug 16 2026 — switched
                // to its recommended replacement to match the rest of the codebase.
                model: "openai/gpt-oss-120b",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.8,
                max_tokens: 400
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 12000
            }
        );

        const content = groqRes.data.choices[0].message.content.trim();
        const cleaned = content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        if (!Array.isArray(parsed.wrongOptions) || parsed.wrongOptions.length < 3) return null;
        return parsed.wrongOptions.slice(0, 3);

    } catch (err) {
        logger.error("QUIZ DECOY GENERATION FAILED:", err.response?.data || err.message);
        return null;
    }
};


/**
 * How many raffle tickets a word gets when the quiz picks the next question.
 * More tickets = more likely to be picked sooner. In plain words:
 *   - a word you are still learning gets 3 tickets, a "learned" word only 1
 *   - each past mistake adds 1 ticket (at most 4)...
 *   - ...but each right answer in a row takes 1 ticket back, so a word you fixed stops being "weak"
 * Examples: brand-new word = 3 | failed 4 times, 0 right since = 7 | learned, no recent mistakes = 1
 */
const ticketsFor = (w) => {                                           // w = one saved word (a plain object, because getQuiz uses .lean())
    const wrong = w.wrongCount || 0;                                   // .lean() skips schema defaults, so a missing number must be treated as 0
    const streak = w.correctStreak || 0;                               // right answers in a row (0 if the word was never practised)
    const base = w.status === "learned" ? 1 : 3;                       // learned words need less practice than words still in "review"
    const weakBonus = Math.max(0, Math.min(wrong, 4) - streak);        // each mistake adds a ticket (max 4), each right-in-a-row removes one, never below 0
    return base + weakBonus;                                           // total tickets for this word
};

/**
 * Pick ONE word from the list using the raffle: every ticket has the same chance,
 * so a word with 7 tickets is 7 times as likely as a word with 1 ticket.
 */
const pickWeightedWord = (list) => {                                  // list = the words still allowed to be asked
    const tickets = list.map(ticketsFor);                              // one ticket count per word, in the same order as the list
    const totalTickets = tickets.reduce((sum, t) => sum + t, 0);       // add them all up = the size of the raffle drum
    let draw = Math.random() * totalTickets;                           // a random point inside the drum (0 up to totalTickets)
    for (let i = 0; i < list.length; i++) {                            // walk through the words one by one
        draw -= tickets[i];                                            // use up this word's tickets
        if (draw < 0) return list[i];                                  // the draw landed inside this word's tickets, so this is the winner
    }
    return list[list.length - 1];                                      // safety net (only reached through tiny rounding), pick the last word
};

module.exports = { generateSimilarDecoys, ticketsFor, pickWeightedWord }; // everything other files may use
