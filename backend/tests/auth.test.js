// These tests check the whole login system (cookie, middleware, CSRF origin check, CORS) by sending fake HTTP requests to the real app.
// The database is replaced by fakes, so no MongoDB is needed.

// Settings the app reads when it starts. They MUST be set before the app is loaded below.
process.env.JWT_SECRET = "test-secret"; // the secret used to sign login tokens in these tests
process.env.FRONTEND_URL = "https://wordknit.example.com/,http://localhost:5173"; // the websites allowed to call the API (note the trailing slash on the first: the app must cope)
process.env.LOG_LEVEL = "silent"; // keep test output clean

// jest.mock replaces a module with a fake BEFORE the app loads it.
// The database connection step does nothing in tests.
jest.mock("../config/db", () => jest.fn().mockResolvedValue(undefined));
// The User model becomes four fake functions that each test can program.
jest.mock("../models/User", () => ({ findOne: jest.fn(), create: jest.fn(), findById: jest.fn(), findByIdAndDelete: jest.fn() }));

// supertest sends fake requests; jsonwebtoken makes/forges tokens; bcryptjs hashes passwords like the real login does.
const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
// The fake User model (the same object the app will use).
const User = require("../models/User");
// The real Express app (server.js exports it without starting to listen, thanks to the require.main check).
const app = require("../server");

// Constants used in many tests.
const GOOD_ORIGIN = "https://wordknit.example.com"; // an allowed frontend
const EVIL_ORIGIN = "https://evil.example.org"; // a website that must be blocked
const USER_ID = "665f1c2a9b1e8a0012345678"; // a pretend user id

// signToken makes a valid login token for USER_ID.
const signToken = (options = {}, secret = "test-secret") => jwt.sign({ id: USER_ID }, secret, options);
// cookieFor builds the Cookie header value a browser would send.
const cookieFor = (token) => `token=${token}`;

// Before each test, wipe what the fakes remember so tests don't affect each other.
beforeEach(() => {
    // Default: finding a user returns nothing, creating returns the data plus an _id, finding by id returns a user named Mariam.
    User.findOne.mockResolvedValue(null);
    User.create.mockImplementation(async (data) => ({ _id: USER_ID, ...data }));
    User.findById.mockReturnValue({ select: async () => ({ _id: USER_ID, name: "Mariam" }) });
});

// After each test restore the environment name (some tests pretend to be in production).
const originalEnv = process.env.NODE_ENV;
afterEach(() => { process.env.NODE_ENV = originalEnv; delete process.env.COOKIE_SAMESITE; });

describe("register", () => {
    it("sets an httpOnly cookie and does NOT put the token in the JSON body", async () => {
        // Send a valid registration (with messy spacing/capitals that the schema should clean up).
        const res = await request(app).post("/api/auth/register").set("Origin", GOOD_ORIGIN)
            .send({ name: "  Mariam ", email: "  M@X.co ", password: "12345678" });
        // Success.
        expect(res.status).toBe(200);
        // The body has the name but never the token.
        expect(res.body.user).toBe("Mariam");
        expect(res.body.token).toBeUndefined();
        // The cleaned values (not the messy ones) were saved.
        expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Mariam", email: "m@x.co" }));
        // The login cookie exists and has the protective flags.
        const cookie = res.headers["set-cookie"][0];
        expect(cookie).toMatch(/^token=/);
        expect(cookie).toMatch(/HttpOnly/i);
        expect(cookie).toMatch(/Max-Age=2592000/); // 30 days in seconds
        expect(cookie).toMatch(/Path=\//);
    });

    it("in production the cookie is Secure and SameSite=None (frontend and backend on different domains)", async () => {
        process.env.NODE_ENV = "production";
        const res = await request(app).post("/api/auth/register").send({ name: "M", email: "a@b.co", password: "12345678" });
        const cookie = res.headers["set-cookie"][0];
        expect(cookie).toMatch(/;\s*Secure/i);
        expect(cookie).toMatch(/SameSite=None/i);
    });

    it("in development the cookie is SameSite=Lax and not Secure", async () => {
        const res = await request(app).post("/api/auth/register").send({ name: "M", email: "a@b.co", password: "12345678" });
        const cookie = res.headers["set-cookie"][0];
        expect(cookie).toMatch(/SameSite=Lax/i);
        expect(cookie).not.toMatch(/;\s*Secure/i);
    });

    it("COOKIE_SAMESITE can override the default", async () => {
        process.env.NODE_ENV = "production";
        process.env.COOKIE_SAMESITE = "lax";
        const res = await request(app).post("/api/auth/register").send({ name: "M", email: "a@b.co", password: "12345678" });
        expect(res.headers["set-cookie"][0]).toMatch(/SameSite=Lax/i);
    });

    it("hides internal errors: a database crash becomes a generic 500", async () => {
        // Make the fake database blow up with a revealing message.
        User.create.mockRejectedValue(new Error("secret db host failure"));
        const res = await request(app).post("/api/auth/register").send({ name: "M", email: "a@b.co", password: "12345678" });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain("secret db host");
    });

    it("answers a duplicate-signup race (error code 11000) with 'User already exists'", async () => {
        User.create.mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 }));
        const res = await request(app).post("/api/auth/register").send({ name: "M", email: "a@b.co", password: "12345678" });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe("User already exists");
    });
});

describe("login", () => {
    it("wrong password: 400 and NO cookie", async () => {
        // A stored user whose password hash is for "12345678".
        User.findOne.mockResolvedValue({ _id: USER_ID, name: "Mariam", email: "m@x.co", password: await bcrypt.hash("12345678", 4) });
        const res = await request(app).post("/api/auth/login").send({ email: "m@x.co", password: "wrong-password" });
        expect(res.status).toBe(400);
        expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("right password: cookie set, email cleaned, token not in the body", async () => {
        User.findOne.mockResolvedValue({ _id: USER_ID, name: "Mariam", email: "m@x.co", password: await bcrypt.hash("12345678", 4) });
        // The email is typed with spaces and capitals.
        const res = await request(app).post("/api/auth/login").send({ email: " M@X.co ", password: "12345678" });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeUndefined();
        expect(res.headers["set-cookie"][0]).toMatch(/^token=/);
        // The lookup used the cleaned email.
        expect(User.findOne).toHaveBeenCalledWith({ email: "m@x.co" });
    });

    it("old accounts with a 6-character password can still log in (the 8-character rule is for register only)", async () => {
        User.findOne.mockResolvedValue({ _id: USER_ID, name: "Old", email: "o@x.co", password: await bcrypt.hash("123456", 4) });
        const res = await request(app).post("/api/auth/login").send({ email: "o@x.co", password: "123456" });
        expect(res.status).toBe(200);
    });
});

describe("protect (reads the cookie)", () => {
    it("GET /me with a valid cookie returns the name", async () => {
        const res = await request(app).get("/api/auth/me").set("Cookie", cookieFor(signToken()));
        expect(res.status).toBe(200);
        expect(res.body.user).toBe("Mariam");
    });
    it("rejects a request with no cookie", async () => {
        expect((await request(app).get("/api/auth/me")).status).toBe(401);
    });
    it("rejects a garbage cookie", async () => {
        const res = await request(app).get("/api/auth/me").set("Cookie", "token=garbage");
        expect(res.status).toBe(401);
        expect(res.body.message).toBe("Token invalid");
    });
    it("no longer accepts the old Authorization header", async () => {
        const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${signToken()}`);
        expect(res.status).toBe(401);
    });
    it("rejects an expired token", async () => {
        // expiresIn: -10 means "expired 10 seconds ago".
        const res = await request(app).get("/api/auth/me").set("Cookie", cookieFor(signToken({ expiresIn: -10 })));
        expect(res.status).toBe(401);
    });
    it("rejects a token signed with a different secret", async () => {
        const res = await request(app).get("/api/auth/me").set("Cookie", cookieFor(signToken({}, "some-other-secret")));
        expect(res.status).toBe(401);
    });
    it("rejects a forged token that claims 'alg: none' (no signature at all)", async () => {
        // base64url-encode the two parts by hand and leave the signature empty.
        const part = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
        const forged = `${part({ alg: "none", typ: "JWT" })}.${part({ id: USER_ID })}.`;
        expect((await request(app).get("/api/auth/me").set("Cookie", cookieFor(forged))).status).toBe(401);
    });
    it("a valid token for a user that no longer exists gets 401 and the cookie is cleared", async () => {
        User.findById.mockReturnValue({ select: async () => null });
        const res = await request(app).get("/api/auth/me").set("Cookie", cookieFor(signToken()));
        expect(res.status).toBe(401);
        expect(res.headers["set-cookie"][0]).toMatch(/^token=;/);
    });
});

describe("logout", () => {
    it("clears the cookie (empty value + expiry in the past) and keeps matching flags", async () => {
        process.env.NODE_ENV = "production";
        const res = await request(app).post("/api/auth/logout").set("Origin", GOOD_ORIGIN);
        expect(res.status).toBe(200);
        const cookie = res.headers["set-cookie"][0];
        expect(cookie).toMatch(/^token=;/);
        expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
        // The flags must match the ones used when it was set, or the browser keeps the original.
        expect(cookie).toMatch(/SameSite=None/i);
        expect(cookie).toMatch(/;\s*Secure/i);
    });
});

describe("CSRF origin check", () => {
    it("blocks a write request coming from another website (POST, PATCH, DELETE)", async () => {
        const cookie = cookieFor(signToken());
        // Each of these would have been "logged in" because the browser attaches the cookie automatically — the origin check stops them.
        expect((await request(app).post("/api/auth/logout").set("Origin", EVIL_ORIGIN).set("Cookie", cookie)).status).toBe(403);
        expect((await request(app).patch(`/api/words/${USER_ID}/status`).set("Origin", EVIL_ORIGIN).set("Cookie", cookie).send({ status: "learned" })).status).toBe(403);
        expect((await request(app).delete("/api/auth/account").set("Origin", EVIL_ORIGIN).set("Cookie", cookie)).status).toBe(403);
    });
    it("blocks the special Origin value 'null' (sandboxed pages)", async () => {
        expect((await request(app).post("/api/auth/logout").set("Origin", "null")).status).toBe(403);
    });
    it("allows our own frontends and non-browser clients (no Origin header)", async () => {
        expect((await request(app).post("/api/auth/logout").set("Origin", GOOD_ORIGIN)).status).toBe(200);
        expect((await request(app).post("/api/auth/logout").set("Origin", "http://localhost:5173")).status).toBe(200);
        expect((await request(app).post("/api/auth/logout")).status).toBe(200);
    });
});

describe("CORS and security headers", () => {
    it("echoes an allowed origin exactly and allows credentials (never '*')", async () => {
        const res = await request(app).get("/api/auth/me").set("Origin", GOOD_ORIGIN).set("Cookie", cookieFor(signToken()));
        expect(res.headers["access-control-allow-origin"]).toBe(GOOD_ORIGIN);
        expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
    it("gives an unknown origin no permission headers at all", async () => {
        const res = await request(app).get("/").set("Origin", EVIL_ORIGIN);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
    it("answers the browser's preflight question for PATCH + content-type", async () => {
        const res = await request(app).options(`/api/words/${USER_ID}/status`).set("Origin", GOOD_ORIGIN)
            .set("Access-Control-Request-Method", "PATCH").set("Access-Control-Request-Headers", "content-type");
        expect(res.status).toBe(204);
        expect(res.headers["access-control-allow-methods"]).toMatch(/PATCH/);
    });
    it("helmet adds protective headers and hides the Express signature", async () => {
        const res = await request(app).get("/");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-powered-by"]).toBeUndefined();
    });
    it("answers unknown URLs with the JSON 404 from the central handler", async () => {
        const res = await request(app).get("/api/does-not-exist");
        expect(res.status).toBe(404);
        expect(res.body.message).toBe("Route not found");
    });
});
