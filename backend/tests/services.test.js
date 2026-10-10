// These tests check the "brain" of the app (the services) with plain data — no database, no internet, no web server.
// jest.mock("axios") replaces the real HTTP library with a fake one, so the tests never call dictionaryapi.dev or Groq.
jest.mock("axios");
// The fake axios (we can tell it what to return).
const axios = require("axios");
// Services under test.
const { ticketsFor, pickWeightedWord, generateSimilarDecoys } = require("../services/quizService");
const { applyAnswer, LEARNED_AFTER } = require("../services/reviewService");
const { fetchDictionarySenses } = require("../services/meaningService");

// Keep the log output quiet while testing.
process.env.LOG_LEVEL = "silent";

describe("reviewService.applyAnswer (streak and learned rules)", () => {
    // A helper that makes a fresh "saved word" scorecard as a plain object.
    const newWord = (extra = {}) => ({ correctCount: 0, correctStreak: 0, wrongCount: 0, status: "review", ...extra });

    it("needs 3 right answers IN A ROW to become learned", () => {
        // LEARNED_AFTER is the threshold constant.
        expect(LEARNED_AFTER).toBe(3);
        const word = newWord();
        // Two right answers: still being reviewed.
        applyAnswer(word, true); applyAnswer(word, true);
        expect(word.status).toBe("review");
        // The third right answer in a row tips it over.
        applyAnswer(word, true);
        expect(word.status).toBe("learned");
        // Totals were counted along the way.
        expect(word.correctCount).toBe(3);
        expect(word.correctStreak).toBe(3);
    });

    it("a wrong answer resets the streak and sends a learned word back to review", () => {
        // A word that was already learned with a streak of 5.
        const word = newWord({ status: "learned", correctStreak: 5, correctCount: 5 });
        applyAnswer(word, false);
        // Back to review, streak starts again from 0, the mistake is counted.
        expect(word.status).toBe("review");
        expect(word.correctStreak).toBe(0);
        expect(word.wrongCount).toBe(1);
        // Past right answers are not erased.
        expect(word.correctCount).toBe(5);
    });

    it("stamps lastReviewed with the current time", () => {
        const word = newWord();
        applyAnswer(word, true);
        // A Date object was set.
        expect(word.lastReviewed).toBeInstanceOf(Date);
    });
});

describe("quizService.ticketsFor (how likely a word is to be asked)", () => {
    it("gives a brand-new word 3 tickets", () => {
        expect(ticketsFor({ status: "review" })).toBe(3);
    });
    it("gives a learned word with no mistakes just 1 ticket", () => {
        expect(ticketsFor({ status: "learned", wrongCount: 0, correctStreak: 0 })).toBe(1);
    });
    it("adds a ticket per mistake (max 4): failed 4+ times and 0 right since = 7", () => {
        expect(ticketsFor({ status: "review", wrongCount: 9, correctStreak: 0 })).toBe(7);
    });
    it("takes tickets back for each right answer in a row", () => {
        // 4 mistakes but 3 right in a row since: bonus = 4 - 3 = 1, so 3 + 1 = 4.
        expect(ticketsFor({ status: "review", wrongCount: 4, correctStreak: 3 })).toBe(4);
    });
});

describe("quizService.pickWeightedWord (the raffle)", () => {
    // Words: "easy" has 1 ticket (learned), "hard" has 3 tickets (review). Total drum = 4 tickets.
    const list = [{ word: "easy", status: "learned" }, { word: "hard", status: "review" }];
    // After each test, put the real Math.random back.
    afterEach(() => jest.restoreAllMocks());

    it("picks the first word when the random draw lands in its single ticket", () => {
        // 0.1 * 4 tickets = 0.4, which is inside the first word's 1 ticket.
        jest.spyOn(Math, "random").mockReturnValue(0.1);
        expect(pickWeightedWord(list).word).toBe("easy");
    });
    it("picks the second word when the draw lands in its 3 tickets", () => {
        // 0.5 * 4 = 2.0, past the first ticket, inside the second word's range.
        jest.spyOn(Math, "random").mockReturnValue(0.5);
        expect(pickWeightedWord(list).word).toBe("hard");
    });
    it("falls back to the last word if rounding pushes the draw past the end", () => {
        jest.spyOn(Math, "random").mockReturnValue(0.99999999);
        expect(pickWeightedWord(list).word).toBe("hard");
    });
});

describe("meaningService.fetchDictionarySenses", () => {
    it("turns the dictionary API's answer into a flat list of senses", async () => {
        // Pretend dictionaryapi.dev answered with one entry that has one noun meaning.
        axios.get.mockResolvedValue({ data: [{ meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "a financial institution", example: "I went to the bank" }] }] }] });
        const senses = await fetchDictionarySenses("bank");
        // The result is flattened and has default empty synonyms.
        expect(senses).toEqual([{ partOfSpeech: "noun", definition: "a financial institution", example: "I went to the bank", synonyms: [] }]);
    });
    it("keeps only 3 definitions per part of speech and 8 senses overall", async () => {
        // 4 definitions in each of 4 parts of speech = 16 available senses.
        const block = (pos) => ({ partOfSpeech: pos, definitions: [1, 2, 3, 4].map((n) => ({ definition: `${pos} ${n}` })) });
        axios.get.mockResolvedValue({ data: [{ meanings: [block("noun"), block("verb"), block("adjective"), block("adverb")] }] });
        const senses = await fetchDictionarySenses("run");
        // 3 per block x 4 blocks = 12, trimmed to 8.
        expect(senses).toHaveLength(8);
    });
    it("returns an empty list (instead of crashing) when the dictionary is down", async () => {
        // Make the fake request fail like a 404 / timeout.
        axios.get.mockRejectedValue(Object.assign(new Error("Not found"), { response: { status: 404 } }));
        expect(await fetchDictionarySenses("zzzzqq")).toEqual([]);
    });
});

describe("quizService.generateSimilarDecoys", () => {
    it("returns null when there is no GROQ_API_KEY (caller then uses its fallback)", async () => {
        // Make sure the key is absent for this test.
        delete process.env.GROQ_API_KEY;
        expect(await generateSimilarDecoys("bank", "a financial institution")).toBeNull();
    });
});
