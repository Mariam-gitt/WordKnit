// These tests check the INSTRUCTIONS we send to the AI coach, and the safety net that keeps replies short enough for the voice.
// We can't test "is the AI's answer good?" automatically, but we CAN make sure the rules that make it good are always in the prompt.
// The functions are exposed through speakingController's _internals so tests don't need a database or the Groq service.
const { _internals } = require("../controllers/speakingController");
// Pull out the four things under test.
const { buildSystemPrompt, buildReflectionSystemPrompt, truncateForSpeech, ORPHEUS_MAX_CHARS } = _internals;

// Silence logging while testing.
process.env.LOG_LEVEL = "silent";

describe("coach conversation prompt", () => {
    // A typical set of inputs, reused by several tests.
    const base = { vocabWords: [], level: "intermediate", exchangeCount: 1, learnerSummary: "" };

    it("states the exact character budget (the voice can only read about 200 characters)", () => {
        // The prompt tells the AI a budget 20 characters below the voice's hard limit, for safety.
        expect(buildSystemPrompt(base)).toContain(`no more than about ${ORPHEUS_MAX_CHARS - 20} characters`);
    });

    it("asks for a quick reaction and exactly ONE question", () => {
        const prompt = buildSystemPrompt(base);
        expect(prompt).toContain("a quick reaction, then one question");
        expect(prompt).toContain("exactly ONE question");
    });

    it("writes for the ear: no lists, markdown or emojis, and never mentions being an AI", () => {
        const prompt = buildSystemPrompt(base);
        expect(prompt).toContain("no lists, no markdown, no emojis");
        expect(prompt).toContain("Never mention that you are an AI");
    });

    it("asks the coach to vary its openers and to invite more when answers are very short", () => {
        const prompt = buildSystemPrompt(base);
        expect(prompt).toContain("Vary how you start");
        expect(prompt).toContain("very short");
    });

    it("mentions saved vocabulary words only when the learner has some", () => {
        expect(buildSystemPrompt(base)).not.toContain("saved words");
        expect(buildSystemPrompt({ ...base, vocabWords: ["ubiquitous", "gauche"] })).toContain("ubiquitous, gauche");
    });

    it("includes what the coach remembers about the learner, when there is something", () => {
        expect(buildSystemPrompt({ ...base, learnerSummary: "- mixes up past tenses" })).toContain("mixes up past tenses");
    });
});

describe("end-of-session feedback prompt", () => {
    it("keeps the marker that generateReflection() uses to split feedback from the learner summary", () => {
        // If this marker ever disappears from the prompt, the app can no longer separate the two parts of the AI's answer.
        expect(buildReflectionSystemPrompt("")).toContain("---LEARNER SUMMARY---");
    });

    it("asks for the useful shape: one strength, one real example correction, one thing to try", () => {
        const prompt = buildReflectionSystemPrompt("");
        expect(prompt).toContain("ONE specific thing they did well");
        expect(prompt).toContain("You said ..., a more natural way is ...");
        expect(prompt).toContain("never invent one"); // the AI must not make up mistakes
        expect(prompt).toContain("ONE small, concrete thing to try next time");
    });

    it("asks for plain spoken sentences, because the feedback is read aloud", () => {
        expect(buildReflectionSystemPrompt("")).toContain("READ ALOUD");
    });

    it("includes the previous summary, or says it's the first session", () => {
        expect(buildReflectionSystemPrompt("- fluent but short answers")).toContain("fluent but short answers");
        expect(buildReflectionSystemPrompt("")).toContain("this is their first session");
    });
});

describe("truncateForSpeech (the safety net for the voice's character limit)", () => {
    it("leaves a short reply untouched", () => {
        expect(truncateForSpeech("Nice! What did you eat there?")).toBe("Nice! What did you eat there?");
    });

    it("trims a long reply to fit, ending on a complete sentence when it can", () => {
        // Two full sentences, the second one pushing the total past the limit.
        const first = "That sounds like a wonderful weekend with your family and friends.";
        const long = `${first} ${"And then tell me everything about the food you ate there. ".repeat(6)}`;
        const result = truncateForSpeech(long);
        // It fits inside the voice's limit...
        expect(result.length).toBeLessThanOrEqual(ORPHEUS_MAX_CHARS);
        // ...and ends with sentence punctuation instead of a half-cut word.
        expect(result).toMatch(/[.!?]$/);
    });

    it("falls back to a whole-word cut when there is no sentence end to use", () => {
        // One endless sentence of 60 words, no punctuation inside.
        const result = truncateForSpeech("word ".repeat(60).trim());
        expect(result.length).toBeLessThanOrEqual(ORPHEUS_MAX_CHARS);
        // It stops at a space boundary, so it ends with a complete "word".
        expect(result.endsWith("word")).toBe(true);
    });
});
