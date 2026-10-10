// A "unit test" checks ONE small piece of code on its own. This file tests the central error handler (middleware/errorHandler.js).
// express builds a tiny throw-away web app just for these tests; supertest sends fake HTTP requests to it without opening a real port.
const express = require("express");
// supertest = the library that lets a test "call" an Express app and read the response.
const request = require("supertest");
// multer is needed to create a real MulterError (the error type the upload library throws).
const multer = require("multer");
// The two functions under test.
const { notFound, errorHandler } = require("../middleware/errorHandler");

// Silence the logger so a deliberate 500 doesn't print scary red text in the test output.
process.env.LOG_LEVEL = "silent";

// buildApp(makeError) creates a mini app with ONE route (/boom) that always throws the error we give it.
const buildApp = (makeError, jsonLimit = "100kb") => {
    // A fresh Express app for each test, so tests can't affect each other.
    const app = express();
    // Parse JSON bodies (with a size limit we can lower to trigger the "too large" error).
    app.use(express.json({ limit: jsonLimit }));
    // This route throws on purpose. Express 5 forwards the thrown error to the error handler automatically.
    app.post("/boom", () => { throw makeError(); });
    // The same two handlers server.js uses, in the same order: notFound first, errorHandler last.
    app.use(notFound);
    app.use(errorHandler);
    // Hand the finished app back to the test.
    return app;
};

// describe() groups related tests under one title.
describe("errorHandler", () => {
    // it() = one test. The text says what SHOULD happen.
    it("turns a Mongoose CastError (bad id) into a 400", async () => {
        // Build an error that looks like the one Mongoose throws for a malformed id.
        const res = await request(buildApp(() => Object.assign(new Error("Cast failed"), { name: "CastError" }))).post("/boom").send({});
        // 400 = the client's mistake, and the message is our friendly one (not Mongoose's).
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Invalid id.");
    });

    it("turns a Mongoose ValidationError into a 400 without leaking details", async () => {
        const res = await request(buildApp(() => Object.assign(new Error("Path `status` is not in enum"), { name: "ValidationError" }))).post("/boom").send({});
        expect(res.status).toBe(400);
        // The internal Mongoose wording must NOT reach the user.
        expect(res.body.message).toBe("Invalid data.");
    });

    it("turns a MongoDB duplicate-key error (code 11000) into a 409", async () => {
        const res = await request(buildApp(() => Object.assign(new Error("E11000 duplicate key"), { code: 11000 }))).post("/boom").send({});
        // 409 = "Conflict": the thing already exists.
        expect(res.status).toBe(409);
        expect(res.body.message).toBe("That record already exists.");
    });

    it("turns a multer 'file too large' error into a 400", async () => {
        const res = await request(buildApp(() => new multer.MulterError("LIMIT_FILE_SIZE"))).post("/boom").send({});
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("File is too large.");
    });

    it("answers broken JSON with a 400 JSON message (not an HTML error page)", async () => {
        // We send text that is NOT valid JSON but claim it is JSON.
        const res = await request(buildApp(() => new Error("never reached"))).post("/boom").set("Content-Type", "application/json").send("{ bad json");
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Invalid JSON in request body.");
    });

    it("answers an oversized body with a 413", async () => {
        // Allow only 10 bytes of JSON, then send more than that.
        const res = await request(buildApp(() => new Error("never reached"), "10b")).post("/boom").send({ text: "this is clearly longer than ten bytes" });
        expect(res.status).toBe(413);
    });

    it("hides unexpected errors behind a generic 500", async () => {
        // An unknown bug whose message contains a secret-looking detail.
        const res = await request(buildApp(() => new Error("connection string mongodb://user:pass@host failed"))).post("/boom").send({});
        // 500 = our fault.
        expect(res.status).toBe(500);
        // The secret detail must not be in the response.
        expect(JSON.stringify(res.body)).not.toContain("mongodb://");
        expect(res.body.message).toBe("Something went wrong. Please try again.");
    });

    it("answers unknown URLs with a JSON 404", async () => {
        // No route exists at /nothing-here, so notFound should answer.
        const res = await request(buildApp(() => new Error("x"))).get("/nothing-here");
        expect(res.status).toBe(404);
        expect(res.body.message).toBe("Route not found");
    });
});
