// axios: makes the outgoing HTTP requests to Groq's three separate endpoints
const axios = require("axios");
// form-data: builds a real multipart/form-data request body — the format file uploads
// need. Node doesn't have a built-in equivalent that axios can reliably send, so this
// package (very standard, used all over the Node ecosystem) fills that gap.
const FormData = require("form-data");
// Word: read a handful of the user's own saved vocabulary, to weave into the conversation
const Word = require("../models/Word");

// Every Groq endpoint we use lives under this same base URL — defined once so a future
// change (unlikely, but possible) only needs editing in one place.
const GROQ_BASE = "https://api.groq.com/openai/v1";

// Groq's Orpheus TTS models have a HARD limit of 200 characters per request — anything
// longer is rejected outright with a 400 error (see their docs: "The input text length
// is limited to 200 characters"). This is the ROOT CAUSE of "the coach never starts":
// the LLM was being asked for "1 to 3 sentences", which very often comes out well over
// 200 characters, so synthesizeSpeech() below kept failing on almost every single reply.
// Defined once here so both the prompt instruction and the code-level safety net (in
// truncateForSpeech, further down) always agree on the exact same number.
const ORPHEUS_MAX_CHARS = 200;

/**
 * Builds the "personality" instructions sent to the LLM before every reply.
 * This is what turns a generic chat model into a specific character (a patient
 * speaking-practice coach) instead of a plain assistant.
 */
const buildSystemPrompt = (vocabWords) => {
    let prompt = "You are Knit, a friendly, patient English-speaking practice partner "
        + "inside a vocabulary learning app. Keep every reply VERY SHORT — a single short "
        // This sentence is the actual bug fix: the model was previously allowed up to 3
        // sentences, which reliably produced replies longer than Orpheus's 200-character
        // limit. Telling it the EXACT character budget (rather than a vague "be short")
        // makes the model far more likely to actually stay under it on its own.
        + `sentence, no more than about ${ORPHEUS_MAX_CHARS - 20} characters — this is a hard `
        + "technical limit, not just a style preference, so treat it as a strict rule. "
        + "Sound like a real spoken conversation, never a lecture. If the user's last "
        + "message had a grammar mistake, don't call it out directly or say \"you made a "
        + "mistake\" — just naturally reply using the correct phrasing yourself, the way a "
        + "friend would model it without embarrassing them. End your reply with a short "
        + "follow-up question, so the conversation keeps going.";

    // Only mention vocab words if the user actually has some saved — an empty list would
    // otherwise produce a confusing instruction like "encourage using: " (nothing after it).
    if (vocabWords && vocabWords.length > 0) {
        prompt += ` When it fits naturally into the conversation, gently encourage the user `
            + `to try using one of these words in their next reply: ${vocabWords.join(", ")}. `
            + `Don't force one into every single message — only when it actually fits.`;
    }
    return prompt;
};

/**
 * SAFETY NET for the 200-character Orpheus limit explained above. Even with the prompt
 * instruction above, LLMs don't always obey character-count instructions precisely — so
 * this function is the thing that GUARANTEES synthesizeSpeech() never receives text that's
 * too long, no matter what the model actually returns. Without this, a single unusually
 * long reply would still crash that turn of the conversation the exact same way.
 *
 * Cuts the text down to fit, trying to end on a clean sentence or word boundary rather
 * than slicing a word in half — much more natural to listen to if a trim is ever needed.
 */
const truncateForSpeech = (text, maxChars = ORPHEUS_MAX_CHARS) => {
    if (text.length <= maxChars) return text; // the common case — nothing to do

    // Look for the LAST sentence-ending punctuation (. ! or ?) that still fits within the
    // limit, so a trim (if one is needed at all) lands on a natural pause rather than
    // mid-sentence. slice(0, maxChars) first shrinks our search window to just the part
    // that's actually allowed through.
    const window = text.slice(0, maxChars);
    const lastSentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));

    if (lastSentenceEnd > 40) {
        // Found a decent sentence boundary well into the text (not right at the start) —
        // cut there, keeping the punctuation itself (+1) but not the trailing space.
        return window.slice(0, lastSentenceEnd + 1);
    }

    // No good sentence boundary found (e.g. it's all one long sentence) — fall back to
    // cutting at the last whole WORD instead of slicing a word in half mid-letter.
    const lastSpace = window.lastIndexOf(" ");
    return lastSpace > 40 ? window.slice(0, lastSpace) : window; // last-resort: just hard-cut if even this fails
};

/**
 * STEP 1 of the pipeline: turns a recorded audio clip into text.
 * Calls Groq's hosted Whisper model — same account/key as everything else in this app.
 */
const transcribeAudio = async (buffer, mimetype) => {
    // FormData here represents the OUTGOING multipart body we're building to send TO Groq —
    // a different thing from multer, which only parses the INCOMING upload from the browser.
    const form = new FormData();
    // .append("file", ...) is the exact field name Groq's API expects the audio under.
    form.append("file", buffer, { filename: "recording.webm", contentType: mimetype || "audio/webm" });
    form.append("model", "whisper-large-v3-turbo"); // Groq's fastest Whisper variant — plenty accurate for short conversational clips

    const response = await axios.post(`${GROQ_BASE}/audio/transcriptions`, form, {
        headers: {
            ...form.getHeaders(), // sets the correct "Content-Type: multipart/form-data; boundary=..." header — must come from the form object itself, not written by hand
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        maxBodyLength: Infinity, // audio clips can exceed axios's low default body-size limit
        timeout: 30000
    });

    return response.data.text?.trim() || ""; // empty string if Whisper heard nothing at all
};

/**
 * STEP 2 of the pipeline: given the conversation so far, asks the LLM what the
 * coach should say next. This is the SAME Groq chat model already used elsewhere
 * in this app (quiz decoys, AI-generated meanings) — just a different system prompt.
 */
const getCoachReply = async (history, vocabWords) => {
    // The "system" message (persona instructions) always goes first, followed by the
    // actual back-and-forth so far. This is standard for every chat-style LLM API.
    const messages = [{ role: "system", content: buildSystemPrompt(vocabWords) }, ...history];

    const response = await axios.post(`${GROQ_BASE}/chat/completions`, {
        model: "openai/gpt-oss-120b",
        messages,
        temperature: 0.7, // a bit of natural variety in phrasing, without going off-topic
        // "openai/gpt-oss-120b" is a REASONING model — before writing its actual visible
        // reply, it first spends some of its token budget on internal chain-of-thought
        // ("thinking") that never gets shown to the user. That invisible thinking counts
        // against max_tokens just like the real reply does. THIS WAS THE BUG: with
        // max_tokens: 200 and no reasoning_effort set, a more complex exchange (like
        // discussing a word's meaning and building a sentence with it) could burn the
        // ENTIRE 200-token budget on thinking alone, leaving literally nothing left to
        // write the actual reply — Groq returns content: "" in that case (not an error),
        // and that empty string is what later crashed the text-to-speech step with
        // "input is required".
        reasoning_effort: "low", // asks the model to think LESS before answering — plenty for a short, casual conversational reply, and leaves far more of the token budget free for the actual visible content
        max_tokens: 400          // raised from 200 — extra headroom so even "low" reasoning plus a full reply comfortably fits without running out mid-thought
    }, {
        headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        timeout: 15000
    });

    return response.data.choices[0].message.content.trim();
};

// One last line of defense, used just below wherever we're about to hand text to
// synthesizeSpeech(). Even with reasoning_effort tuned down and more max_tokens headroom
// above, an LLM call can still — rarely — come back with nothing usable (a moderation
// block, a network hiccup mid-stream, or some future edge case we haven't hit yet). Rather
// than let that empty string reach Orpheus and fail the whole turn again with "input is
// required", we swap in this friendly fallback line so the conversation can always continue.
const FALLBACK_COACH_REPLY = "Sorry, could you say that again?";

/**
 * STEP 3 of the pipeline: turns the coach's reply text into spoken audio.
 * Returns raw WAV bytes as a Buffer — NOT a URL — since we're not storing these
 * clips anywhere; they get sent straight back to the browser and then discarded.
 */
const synthesizeSpeech = async (text) => {
    try {
        const response = await axios.post(`${GROQ_BASE}/audio/speech`, {
            model: "canopylabs/orpheus-v1-english",
            voice: "hannah", // one of Orpheus's built-in English voices — easy to swap for a different one later
            input: text,
            response_format: "wav"
        }, {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            responseType: "arraybuffer", // tells axios "this response is binary audio, not JSON" — otherwise it'd try (and fail) to parse the WAV bytes as text
            timeout: 30000
        });

        return Buffer.from(response.data); // raw WAV audio bytes
    } catch (error) {
        // WHY THIS CATCH EXISTS: because we told axios above that a SUCCESSFUL response is
        // raw binary (responseType: "arraybuffer"), axios applies that same setting to an
        // ERROR response too — so when Groq sends back a normal JSON error message like
        // {"error":{"message":"..."}}, it arrives here as raw bytes instead of readable
        // text. Left alone, console.log(error) would print an unreadable dump like
        // "<Buffer 7b 22 65 72 72 6f 72 22 3a ...>" — which is exactly what happened
        // before this fix, and had to be decoded by hand to find the real problem.
        // Here, we catch that raw-bytes error, turn it back into a normal readable
        // string (and parse it as JSON if it is one), and THEN re-throw — so whichever
        // function called us, and its own console.log(), sees a normal readable message.
        if (Buffer.isBuffer(error.response?.data)) {
            const decodedText = error.response.data.toString("utf-8"); // bytes → readable string
            try {
                error.response.data = JSON.parse(decodedText); // usually Groq's errors ARE valid JSON — parse it back into a normal object
            } catch {
                error.response.data = decodedText; // wasn't JSON after all — a plain readable string is still a huge improvement over a Buffer dump
            }
        }
        throw error; // re-throw so startConversation/handleTurn's existing try/catch still handles it exactly as before — we only fixed what it LOOKS like in the logs
    }
};

/**
 * Picks up to 4 of the user's own saved words at random, to hand to the LLM as
 * material it can weave into the conversation. Reused by both endpoints below.
 */
const pickVocabWords = async (userId) => {
    const words = await Word.find({ userId }).sort({ createdAt: -1 }).limit(20).lean();
    if (words.length === 0) return [];
    // Fisher-Yates-ish shuffle via sort — fine at this tiny scale (max 20 items)
    return words.sort(() => 0.5 - Math.random()).slice(0, 4).map((w) => w.word);
};

/**
 * GET /api/speaking/start
 * Kicks off a brand new conversation. There's no user audio yet on this first
 * call — we just want an opening line from the coach so the session starts with
 * something to react to, instead of silence.
 */
exports.startConversation = async (req, res) => {
    try {
        if (!process.env.GROQ_API_KEY) {
            return res.status(503).json({ message: "Speaking practice isn't configured yet (GROQ_API_KEY missing)" });
        }

        const vocabWords = await pickVocabWords(req.user);

        // A fake "opening move" so the LLM has something to respond to — this never gets
        // shown to the user, it just kicks the conversation into motion.
        const openingHistory = [{ role: "user", content: "Let's start a conversation to practice my English." }];
        // Truncate BEFORE doing anything else with it, so the text shown on screen, the
        // text spoken aloud, and the text saved into history are always exactly the same
        // string — otherwise you could end up reading one sentence while hearing a
        // different (cut-off) one. See truncateForSpeech above for why this exists at all:
        // it's the fix for Orpheus's hard 200-character-per-request limit.
        const rawReplyText = await getCoachReply(openingHistory, vocabWords);
        // Use the fallback line if the model somehow came back with nothing usable (see
        // FALLBACK_COACH_REPLY above for why this check exists at all) — guarantees
        // synthesizeSpeech() is NEVER called with an empty string.
        const replyText = truncateForSpeech(rawReplyText || FALLBACK_COACH_REPLY);
        const audioBuffer = await synthesizeSpeech(replyText);

        // The full history INCLUDING this opening exchange gets sent back — the frontend
        // just stores whatever "history" we return and sends it back unchanged on the next
        // turn. Keeping this contract on the backend means the frontend never needs to know
        // or duplicate the exact wording of the opening move.
        const history = [...openingHistory, { role: "assistant", content: replyText }];

        res.status(200).json({
            replyText,
            replyAudioBase64: audioBuffer.toString("base64"), // base64 so it can travel inside a normal JSON response, no separate file/URL needed
            vocabWords,
            history
        });
    } catch (error) {
        console.log("START CONVERSATION ERROR:", error.response?.data || error.message);
        res.status(500).json({ message: "Couldn't start the conversation — try again" });
    }
};

/**
 * POST /api/speaking/turn
 * One full round of the conversation: the user's recorded voice goes in, the
 * coach's spoken reply comes out. Expects multipart/form-data with:
 *   - "audio":   the recorded clip (whatever format MediaRecorder produced)
 *   - "history": a JSON string of the conversation so far (exactly what a
 *                previous call to /start or /turn returned as "history")
 *
 * Nothing here is saved to the database — the whole conversation lives only in
 * the browser's memory for the length of the session. Simple on purpose: if you
 * want conversations to persist across page reloads later, that's a deliberate
 * future upgrade, not an oversight.
 */
exports.handleTurn = async (req, res) => {
    try {
        if (!process.env.GROQ_API_KEY) {
            return res.status(503).json({ message: "Speaking practice isn't configured yet (GROQ_API_KEY missing)" });
        }
        if (!req.file) {
            return res.status(400).json({ message: "No audio received" });
        }

        // ── Step 1: what did the user actually say? ──
        const userText = await transcribeAudio(req.file.buffer, req.file.mimetype);

        // Parse the history the frontend sent along. Wrapped in its own try/catch —
        // malformed JSON here shouldn't crash the whole turn, just restart the context.
        let history = [];
        try {
            history = req.body.history ? JSON.parse(req.body.history) : [];
        } catch {
            history = [];
        }

        // Whisper heard nothing usable (silence, background noise) — ask the user to
        // repeat themselves instead of sending an empty message to the LLM.
        if (!userText) {
            const retryText = "I didn't quite catch that — could you say it again?";
            const retryAudio = await synthesizeSpeech(retryText);
            return res.status(200).json({
                userText: "",
                replyText: retryText,
                replyAudioBase64: retryAudio.toString("base64"),
                history // unchanged — this "turn" never really happened
            });
        }

        history.push({ role: "user", content: userText });

        // Only the most recent messages are sent to the LLM (keeps token usage and
        // latency down as a session gets long) — but the FULL history is still returned
        // to the frontend below, so the on-screen transcript never loses anything.
        const recentHistory = history.slice(-20);

        const vocabWords = await pickVocabWords(req.user);
        // Same reasoning as in startConversation above: truncate FIRST, then use that one
        // truncated string for the on-screen text, the spoken audio, and the saved history —
        // never speak a different (shorter) version of what's displayed.
        const rawReplyText = await getCoachReply(recentHistory, vocabWords);
        // Same fallback as in startConversation above — never let an empty LLM reply
        // reach synthesizeSpeech() and fail the whole turn with "input is required".
        const replyText = truncateForSpeech(rawReplyText || FALLBACK_COACH_REPLY);
        const audioBuffer = await synthesizeSpeech(replyText);

        history.push({ role: "assistant", content: replyText });

        res.status(200).json({
            userText,
            replyText,
            replyAudioBase64: audioBuffer.toString("base64"),
            history
        });
    } catch (error) {
        console.log("SPEAKING TURN ERROR:", error.response?.data || error.message);
        res.status(500).json({ message: "Something went wrong during that turn — try again" });
    }
};
