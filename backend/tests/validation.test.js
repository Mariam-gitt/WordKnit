// These tests prove the server REJECTS bad data (and accepts the exact shapes your frontend sends) BEFORE any database work happens.
// Setup is the same as auth.test.js: fake database, real app.
process.env.JWT_SECRET = "test-secret"; // secret for the test tokens
process.env.LOG_LEVEL = "silent"; // quiet output

// The database connection does nothing in tests.
jest.mock("../config/db", () => jest.fn().mockResolvedValue(undefined));

// Tools: supertest (fake requests) + jsonwebtoken (to log in).
const request = require("supertest");
const jwt = require("jsonwebtoken");
// The real app.
const app = require("../server");
// The schemas, for direct "does this payload pass?" checks.
const { addWordSchema, updateStatusSchema, updateNoteSchema, reviewSchema } = require("../validators/wordSchemas");
const { createBookmarkSchema, updateLastPageSchema } = require("../validators/documentSchemas");
const { registerSchema, loginSchema } = require("../validators/authSchemas");

// A valid MongoDB-style id and a logged-in cookie.
const ID = "665f1c2a9b1e8a0012345678";
const auth = { Cookie: `token=${jwt.sign({ id: ID }, "test-secret")}` };

// Each row: [test name, HTTP method, URL, body, expected message]. Every one must come back as a 400 with that message.
const BAD_REQUESTS = [
    ["register: empty body", "post", "/api/auth/register", {}, "Name is required."],
    ["register: bad email", "post", "/api/auth/register", { name: "M", email: "nope", password: "12345678" }, "Please enter a valid email address."],
    ["register: 7-character password", "post", "/api/auth/register", { name: "M", email: "a@b.co", password: "1234567" }, "Password must be at least 8 characters long."],
    ["register: 73-character password", "post", "/api/auth/register", { name: "M", email: "a@b.co", password: "x".repeat(73) }, "Password must be 72 characters or fewer."],
    ["login: missing password", "post", "/api/auth/login", { email: "a@b.co" }, "Password is required."],
    ["status: not in the allowed list", "patch", `/api/words/${ID}/status`, { status: "banana" }, "status must be 'review' or 'learned'"],
    ["status: an object (injection attempt)", "patch", `/api/words/${ID}/status`, { status: { $ne: "x" } }, "status must be 'review' or 'learned'"],
    ["status: malformed id in the URL", "patch", "/api/words/not-an-id/status", { status: "learned" }, "Invalid id."],
    ["note: not text", "patch", `/api/words/${ID}/note`, { note: 123 }, "note must be text"],
    ["delete word: malformed id", "delete", "/api/words/xyz", undefined, "Invalid id."],
    ["add word: only spaces", "post", "/api/words", { word: "   " }, "Word is required"],
    ["add word: 500 characters", "post", "/api/words", { word: "a".repeat(500) }, "Word must be 100 characters or fewer."],
    ["review: unknown mode", "post", `/api/words/${ID}/review`, { mode: "hack" }, "mode must be 'quiz' or 'flashcard'"],
    ["document page: negative", "patch", `/api/documents/${ID}`, { lastPage: -3 }, "lastPage must be at least 1"],
    ["document page: text instead of number", "patch", `/api/documents/${ID}`, { lastPage: "5" }, "lastPage must be a number"],
    ["document: malformed id", "get", "/api/documents/zzz", undefined, "Invalid id."],
    ["document file: malformed id", "get", "/api/documents/zzz/file", undefined, "Invalid id."],
    ["analyze saved PDF: malformed id", "get", "/api/pdf/analyze-difficulty/zzz", undefined, "Invalid id."],
    ["bookmark: missing fields", "post", "/api/bookmarks", { text: "hi" }, "documentId, text, and page are required"],
    ["bookmark: bad documentId", "post", "/api/bookmarks", { documentId: "bad", text: "hi", page: 1 }, "Invalid documentId"],
    ["bookmark list: malformed id", "get", "/api/bookmarks/bad", undefined, "Invalid id."]
];

describe("bad requests are rejected with a clear 400", () => {
    // test.each runs the same test body once per row of the table above.
    test.each(BAD_REQUESTS)("%s", async (_name, method, url, body, message) => {
        // Build the request, attach the login cookie, send the body (if any).
        const res = await request(app)[method](url).set(auth).send(body);
        // 400 + the exact friendly message.
        expect(res.status).toBe(400);
        expect(res.body.message).toBe(message);
    });

    it("an unauthenticated request gets 401 first (it never learns our data rules)", async () => {
        const res = await request(app).patch(`/api/words/${ID}/status`).send({ status: "banana" });
        expect(res.status).toBe(401);
    });
});

describe("the exact payloads the frontend sends pass validation", () => {
    // A tiny helper: does the schema accept this data?
    const ok = (schema, data) => schema.safeParse(data).success;

    it("words", () => {
        expect(ok(addWordSchema, { word: "ubiquitous" })).toBe(true); // Add Word page
        expect(ok(addWordSchema, { word: "  Gauche ", meaning: "x", exampleSentence: "y", source: "Contextual" })).toBe(true); // extra fields are tolerated and dropped
        expect(addWordSchema.parse({ word: "  Gauche ", meaning: "x" })).toEqual({ word: "Gauche" }); // cleaned: trimmed, extras removed
        expect(ok(updateStatusSchema, { status: "learned" })).toBe(true); // Word list
        expect(ok(updateNoteSchema, { note: "" })).toBe(true); // an empty note clears it
        expect(ok(reviewSchema, { mode: "quiz", selected: "a meaning" })).toBe(true); // Quiz
        expect(ok(reviewSchema, { mode: "flashcard", known: false })).toBe(true); // Flashcards
    });
    it("documents and bookmarks", () => {
        expect(ok(createBookmarkSchema, { documentId: ID, text: "some text", page: 3 })).toBe(true); // PDF reader bookmark
        expect(ok(updateLastPageSchema, { lastPage: 7 })).toBe(true); // PDF reader page turn
    });
    it("auth: emails are cleaned the same way for register and login", () => {
        expect(registerSchema.parse({ name: " Mariam ", email: " M@X.CO ", password: "12345678" })).toEqual({ name: "Mariam", email: "m@x.co", password: "12345678" });
        expect(loginSchema.parse({ email: " M@X.CO ", password: "123456" }).email).toBe("m@x.co");
    });
});
