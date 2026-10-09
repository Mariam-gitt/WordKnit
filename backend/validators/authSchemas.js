// zod = the library we use to describe "what valid data looks like" (see middleware/validate.js for how it is applied).
const { z } = require("zod");

// A simple, widely-used pattern for "looks like an email": something, an @, something, a dot, something.
// (Moved here from authController.js so the rule lives in ONE place.)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The email rule is shared by register AND login, so we define it once and reuse it below.
const emailField = z
    // { error: "..." } is the message shown when the field is missing completely or is not text.
    .string({ error: "Email is required." })
    // trim() removes stray spaces at the start/end; toLowerCase() makes "Mariam@Gmail.com" and "mariam@gmail.com" the same account.
    .trim().toLowerCase()
    // After trimming, an empty string means the user typed nothing (or only spaces).
    .min(1, "Email is required.")
    // 254 characters is the real maximum length of an email address — this stops absurdly long input.
    .max(254, "Email is too long.")
    // Must look like an email (catches typos like "mariam@gmail" or "mariamgmail.com").
    .regex(EMAIL_REGEX, "Please enter a valid email address.");

// The rules for the REGISTER request body: { name, email, password }.
const registerSchema = z.object({
    // Name: required text, trimmed, between 1 and 60 characters.
    name: z.string({ error: "Name is required." }).trim().min(1, "Name is required.").max(60, "Name must be 60 characters or fewer."),
    // Email: the shared rule from above.
    email: emailField,
    // Password: required, at least 8 characters (was 6 — too easy to guess), at most 72.
    // 72 because bcrypt (the hashing algorithm) only reads the first 72 bytes — anything longer would be silently ignored.
    password: z.string({ error: "Password is required." })
        // An empty password gets the "required" message instead of the "too short" one.
        .min(1, "Password is required.")
        // The new minimum length. Note: this is only on REGISTER, so old accounts with 6-character passwords can still log in.
        .min(8, "Password must be at least 8 characters long.")
        // The upper limit explained above.
        .max(72, "Password must be 72 characters or fewer.")
});

// The rules for the LOGIN request body: { email, password }.
const loginSchema = z.object({
    // Email: the same shared rule, so login normalizes the email exactly like register does.
    email: emailField,
    // Password: only "must be present" — we do NOT enforce the 8-character rule here, so existing users are never locked out.
    password: z.string({ error: "Password is required." }).min(1, "Password is required.")
});

// Export both schemas so authRoutes.js can attach them to the routes.
module.exports = { registerSchema, loginSchema };
