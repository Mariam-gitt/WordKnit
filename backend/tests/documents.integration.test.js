// An "integration test" checks several pieces working TOGETHER — here: the real routes + the real database + GridFS file storage.
// It only runs when the environment variable TEST_MONGO_URI points at a throw-away MongoDB (GitHub Actions provides one).
// Without it the whole file is skipped, so `npm test` still works on a laptop with no database.
//   Example:  TEST_MONGO_URI=mongodb://127.0.0.1:27017/wordknit_test npm test

// Read the test-database address from the environment (undefined when not provided).
const TEST_URI = process.env.TEST_MONGO_URI;
// describe.skip = "register these tests but don't run them"; so without a database they show up as skipped, not failed.
const maybe = TEST_URI ? describe : describe.skip;

// Settings the app reads when it loads (must come BEFORE requiring the app).
process.env.MONGO_URI = TEST_URI || ""; // the app's own connectDB() will use this address
process.env.JWT_SECRET = "test-secret"; // secret for the test login tokens
process.env.MAX_PDF_MB = "1"; // pretend the upload limit is 1 MB so we can test "too large" cheaply
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || "silent"; // quiet output (set TEST_LOG_LEVEL=error to see server errors while debugging)

// Some stand-in databases used for local experiments (like FerretDB) don't support one MongoDB feature that the "save reading position"
// route uses (findOneAndUpdate with a field projection). Real MongoDB does. Set TEST_DB_LIMITED=1 to skip just that check locally; CI runs it.
const itUnlessLimited = process.env.TEST_DB_LIMITED === "1" ? it.skip : it;

// The difficult-words analyzer calls the "pdf-parse" library to turn a PDF into text. These tests are about whether the right BYTES reach the analyzer,
// so we replace pdf-parse with a stand-in that simply treats the bytes as text. (jest.mock is hoisted: it takes effect before the app loads.)
jest.mock("pdf-parse", () => jest.fn(async (buffer) => ({ text: buffer.toString("utf8"), numpages: 1 })));

// Tools.
const request = require("supertest"); // fake HTTP requests
const jwt = require("jsonwebtoken"); // logs test users in
const mongoose = require("mongoose"); // direct database access for checking what was stored
// The real app and models.
const app = require("../server");
const Document = require("../models/Document");
const User = require("../models/User");
// The migration function (the same one the command-line script runs).
const { migrate } = require("../scripts/migrate-pdfs-to-gridfs");

// A login cookie for any user id.
const loginAs = (userId) => ({ Cookie: `token=${jwt.sign({ id: String(userId) }, "test-secret")}` });
// A fake PDF: it starts with "%PDF" (what the server checks) and is 600 KB so GridFS must split it into several 255 KB chunks.
const makePdf = (kilobytes = 600) => Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(kilobytes * 1024, "x")]);
// A helper that collects a binary response into one Buffer (supertest doesn't do it for application/pdf by itself).
const binary = (res, callback) => { const parts = []; res.on("data", (c) => parts.push(c)); res.on("end", () => callback(null, Buffer.concat(parts))); };
// How many files / chunks are currently stored in GridFS.
const gridFiles = () => mongoose.connection.db.collection("pdfs.files").countDocuments();
const gridChunks = () => mongoose.connection.db.collection("pdfs.chunks").countDocuments();
// Upload a PDF as a given user and return the response.
const upload = (userId, buffer = makePdf(), name = "book.pdf") =>
    request(app).post("/api/documents").set(loginAs(userId)).field("pageCount", "12").attach("pdf", buffer, name);

maybe("PDF storage in GridFS (real database)", () => {
    // Connect once before all tests, and start from an empty database.
    beforeAll(async () => { await mongoose.connect(TEST_URI); await mongoose.connection.dropDatabase(); });
    // Empty everything between tests so they can't affect each other.
    beforeEach(async () => { await mongoose.connection.dropDatabase(); });
    // Disconnect at the end so Jest can exit cleanly.
    afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

    // Two different users, to test that one can't touch the other's PDFs.
    const alice = new mongoose.Types.ObjectId();
    const bob = new mongoose.Types.ObjectId();

    it("uploads: bytes go to GridFS, the row keeps only a small fileId", async () => {
        const res = await upload(alice);
        // 201 = created. The response never exposes internals.
        expect(res.status).toBe(201);
        expect(res.body.fileName).toBe("book.pdf");
        expect(res.body.fileId).toBeUndefined();
        expect(res.body.fileData).toBeUndefined();
        // Look at what is REALLY stored (select("+fileData") also loads the normally-hidden old field).
        const row = await Document.findById(res.body._id).select("+fileData");
        expect(row.fileId).toBeTruthy(); // points at the GridFS file
        expect(row.fileData).toBeUndefined(); // no base64 blob in the row any more
        // GridFS holds one file split into several 255 KB chunks (600 KB / 255 KB = 3 chunks).
        expect(await gridFiles()).toBe(1);
        expect(await gridChunks()).toBeGreaterThanOrEqual(3);
    });

    it("downloads: GET /:id/file returns exactly the bytes that were uploaded", async () => {
        const original = makePdf();
        const { body: saved } = await upload(alice, original);
        const res = await request(app).get(`/api/documents/${saved._id}/file`).set(loginAs(alice)).buffer(true).parse(binary);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/application\/pdf/);
        // byte-for-byte identical
        expect(Buffer.compare(res.body, original)).toBe(0);
    });

    it("lists and describes documents without any file bytes or internal ids", async () => {
        const { body: saved } = await upload(alice);
        const list = await request(app).get("/api/documents").set(loginAs(alice));
        expect(list.body).toHaveLength(1);
        expect(list.body[0].fileId).toBeUndefined();
        expect(list.body[0].fileData).toBeUndefined();
        const one = await request(app).get(`/api/documents/${saved._id}`).set(loginAs(alice));
        expect(one.body.pageCount).toBe(12);
        expect(one.body.lastPage).toBe(1);
        expect(one.body.fileData).toBeUndefined();
    });

    itUnlessLimited("saves the reading position without leaking internal ids", async () => {
        const { body: saved } = await upload(alice);
        const patched = await request(app).patch(`/api/documents/${saved._id}`).set(loginAs(alice)).send({ lastPage: 5 });
        expect(patched.body.lastPage).toBe(5);
        expect(patched.body.fileId).toBeUndefined();
        expect(patched.body.fileData).toBeUndefined();
    });

    it("keeps PDFs private: another user gets 404 for both the info and the file", async () => {
        const { body: saved } = await upload(alice);
        expect((await request(app).get(`/api/documents/${saved._id}`).set(loginAs(bob))).status).toBe(404);
        expect((await request(app).get(`/api/documents/${saved._id}/file`).set(loginAs(bob))).status).toBe(404);
        expect((await request(app).delete(`/api/documents/${saved._id}`).set(loginAs(bob))).status).toBe(404);
        // ...and Alice's file is still there.
        expect(await gridFiles()).toBe(1);
    });

    it("still serves OLD documents that store base64 inside the row (backward compatible)", async () => {
        const original = makePdf(10);
        // Create an old-style row directly: bytes as base64 text in fileData, no fileId.
        const legacy = await Document.create({ userId: alice, fileName: "old.pdf", fileData: original.toString("base64"), fileSize: original.length, pageCount: 3 });
        const res = await request(app).get(`/api/documents/${legacy._id}/file`).set(loginAs(alice)).buffer(true).parse(binary);
        expect(res.status).toBe(200);
        expect(Buffer.compare(res.body, original)).toBe(0);
        // The info route works for it too, without exposing the base64.
        const info = await request(app).get(`/api/documents/${legacy._id}`).set(loginAs(alice));
        expect(info.body.fileData).toBeUndefined();
    });

    it("rejects files over the limit with a clear 400, and non-PDF files", async () => {
        // MAX_PDF_MB is 1 in this test file, so 2 MB is too big.
        const big = await upload(alice, makePdf(2048));
        expect(big.status).toBe(400);
        expect(big.body.message).toMatch(/under 1MB/);
        // A text file renamed to .pdf fails the "%PDF" magic-bytes check.
        const fake = await upload(alice, Buffer.from("hello, I am not a pdf"), "fake.pdf");
        expect(fake.status).toBe(400);
        // Nothing was stored for either.
        expect(await gridFiles()).toBe(0);
        expect(await Document.countDocuments()).toBe(0);
    });

    it("deleting a document also deletes its stored file and chunks", async () => {
        const { body: saved } = await upload(alice);
        expect(await gridFiles()).toBe(1);
        const res = await request(app).delete(`/api/documents/${saved._id}`).set(loginAs(alice));
        expect(res.status).toBe(200);
        expect(await Document.countDocuments()).toBe(0);
        expect(await gridFiles()).toBe(0);
        expect(await gridChunks()).toBe(0);
    });

    it("deleting an account removes all of that user's stored PDFs (and only theirs)", async () => {
        // A real user row, because deleteAccount deletes it too.
        const user = await User.create({ name: "Temp", email: "temp@x.co", password: "hashed" });
        await upload(user._id); await upload(user._id); await upload(bob);
        expect(await gridFiles()).toBe(3);
        const res = await request(app).delete("/api/auth/account").set(loginAs(user._id));
        expect(res.status).toBe(200);
        // Two files vanished, Bob's remains.
        expect(await gridFiles()).toBe(1);
        expect(await Document.countDocuments({ userId: user._id })).toBe(0);
        expect(await Document.countDocuments({ userId: bob })).toBe(1);
        // The login cookie is cleared too.
        expect(res.headers["set-cookie"][0]).toMatch(/^token=;/);
    });

    describe("difficult-words analyzer reads the PDF through the storage layer", () => {
        // A "PDF" whose bytes are real text with plenty of hard words (the stand-in pdf-parse returns those bytes as text).
        const hardWords = "ubiquitous photosynthesis sociolinguistic phenomenology epistemological bioluminescence ".repeat(8);
        const textPdf = Buffer.from("%PDF-1.4\n" + hardWords);

        it("works for a NEW (GridFS) document", async () => {
            const { body: saved } = await upload(alice, textPdf, "hard.pdf");
            const res = await request(app).get(`/api/pdf/analyze-difficulty/${saved._id}`).set(loginAs(alice));
            expect(res.status).toBe(200);
            // The analyzer found words that only exist inside the stored bytes — proof the right file was read.
            expect(res.body.words).toEqual(expect.arrayContaining(["ubiquitous", "photosynthesis"]));
        });

        it("works for an OLD (base64) document", async () => {
            const legacy = await Document.create({ userId: alice, fileName: "old.pdf", fileData: textPdf.toString("base64"), fileSize: textPdf.length });
            const res = await request(app).get(`/api/pdf/analyze-difficulty/${legacy._id}`).set(loginAs(alice));
            expect(res.status).toBe(200);
            expect(res.body.words).toEqual(expect.arrayContaining(["ubiquitous", "photosynthesis"]));
        });

        it("will not analyze someone else's PDF", async () => {
            const { body: saved } = await upload(alice, textPdf, "hard.pdf");
            const res = await request(app).get(`/api/pdf/analyze-difficulty/${saved._id}`).set(loginAs(bob));
            expect(res.status).toBe(404);
        });
    });

    describe("migration script (old base64 documents -> GridFS)", () => {
        // Make two old-style documents with different content.
        const makeLegacy = async () => {
            const a = makePdf(300), b = makePdf(50);
            const docs = [
                await Document.create({ userId: alice, fileName: "a.pdf", fileData: a.toString("base64"), fileSize: a.length }),
                await Document.create({ userId: alice, fileName: "b.pdf", fileData: b.toString("base64"), fileSize: b.length })
            ];
            return { docs, originals: [a, b] };
        };

        it("a dry run reports but changes nothing", async () => {
            await makeLegacy();
            const report = await migrate({ apply: false });
            expect(report.found).toBe(2);
            expect(report.migrated).toBe(0);
            expect(await gridFiles()).toBe(0);
            // The raw rows still hold their base64.
            expect(await Document.collection.countDocuments({ fileData: { $exists: true } })).toBe(2);
        });

        it("--apply moves the bytes, removes the base64, keeps the content identical, and is safe to repeat", async () => {
            const { docs, originals } = await makeLegacy();
            const report = await migrate({ apply: true });
            expect(report).toEqual({ found: 2, migrated: 2, skipped: 0, failed: 0 });
            expect(await gridFiles()).toBe(2);
            // No row has base64 text any more, and every row has a fileId.
            expect(await Document.collection.countDocuments({ fileData: { $exists: true } })).toBe(0);
            expect(await Document.collection.countDocuments({ fileId: { $exists: true } })).toBe(2);
            // Each document still downloads the exact same bytes as before.
            for (let i = 0; i < docs.length; i++) {
                const res = await request(app).get(`/api/documents/${docs[i]._id}/file`).set(loginAs(alice)).buffer(true).parse(binary);
                expect(Buffer.compare(res.body, originals[i])).toBe(0);
            }
            // Running it again finds nothing to do (idempotent) and creates no duplicates.
            const again = await migrate({ apply: true });
            expect(again.found).toBe(0);
            expect(await gridFiles()).toBe(2);
        });
    });
});
