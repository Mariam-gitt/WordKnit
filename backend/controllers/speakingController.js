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

/**
 * Builds the "personality" instructions sent to the LLM before every reply.
 * This is what turns a generic chat model into a specific character (a patient
 * speaking-practice coach) instead of a plain assistant.
 */
const buildSystemPrompt = (vocabWords) => {
    let prompt = "You are Knit, a friendly, patient English-speaking practice partner "
        + "inside a vocabulary learning app. Keep every reply SHORT — 1 to 3 sentences, "
        + "like a real spoken conversation, never a lecture. If the user's last message "
        + "had a grammar mistake, don't call it out directly or say \"you made a mistake\" — "
        + "just naturally reply using the correct phrasing yourself, the way a friend "
        + "would model it without embarrassing them. Always end your reply with a short "
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
        max_tokens: 200   // keeps replies short on purpose — a rambling wall of text is hard to listen to
    }, {
        headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        timeout: 15000
    });

    return response.data.choices[0].message.content.trim();
};

/**
 * STEP 3 of the pipeline: turns the coach's reply text into spoken audio.
 * Returns raw WAV bytes as a Buffer — NOT a URL — since we're not storing these
 * clips anywhere; they get sent straight back to the browser and then discarded.
 */
const synthesizeSpeech = async (text) => {
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
        const replyText = await getCoachReply(openingHistory, vocabWords);
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
        const replyText = await getCoachReply(recentHistory, vocabWords);
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
