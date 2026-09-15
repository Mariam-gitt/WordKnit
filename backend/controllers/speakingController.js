// axios: makes the outgoing HTTP requests to Groq's three separate endpoints
const axios = require("axios");
// form-data: builds a real multipart/form-data request body — the format file uploads
// need. Node doesn't have a built-in equivalent that axios can reliably send, so this
// package (very standard, used all over the Node ecosystem) fills that gap.
const FormData = require("form-data");
// Word: read a handful of the user's own saved vocabulary, to weave into the conversation
const Word = require("../models/Word");
// User: read/save the learner's level preference and rolling cross-session memory
const User = require("../models/User");
// SpeakingSession: persists each conversation to the database, replacing the old
// browser-only localStorage history — this is what powers the sidebar and cross-device sync.
const SpeakingSession = require("../models/SpeakingSession");

// Every Groq endpoint we use lives under this same base URL — defined once so a future
// change (unlikely, but possible) only needs editing in one place.
const GROQ_BASE = "https://api.groq.com/openai/v1";

// Groq's Orpheus TTS models have a HARD limit of 200 characters per request — anything
// longer is rejected outright with a 400 error (see their docs: "The input text length
// is limited to 200 characters"). This was the root cause of an earlier bug where the
// coach almost never started successfully. Defined once here so both the prompt
// instruction and the code-level safety net (in truncateForSpeech, further down) always
// agree on the exact same number.
const ORPHEUS_MAX_CHARS = 200;

// ── Level definitions ──
// Each level maps loosely to an IELTS Speaking band RANGE (not an exact score — this app
// is a vocab-learning tool, not an official test), and controls how simple or advanced the
// coach's own vocabulary and sentence structure should be.
const LEVEL_DESCRIPTIONS = {
    beginner: "Speak simply, like IELTS Band 4-5: short sentences, everyday common words, "
        + "stick to concrete familiar topics (daily routine, family, food, hobbies).",
    intermediate: "Speak like IELTS Band 6-7: a mix of everyday and moderately advanced "
        + "vocabulary, can ask for opinions, slightly more complex sentence structures.",
    advanced: "Speak like IELTS Band 8-9: sophisticated vocabulary, idiomatic expressions, "
        + "nuanced follow-up questions, comfortable with abstract or analytical topics."
};

/**
 * Decides which "phase" of an IELTS-style Speaking test the conversation should be
 * acting like, based on how many exchanges have happened so far. This borrows IELTS
 * Speaking's actual 3-part structure (small talk → sustained monologue → abstract
 * discussion) — genuinely good teaching pedagogy — but keeps every topic tied to the
 * learner's own saved vocabulary instead of a generic exam question bank.
 *
 * exchangeCount = how many full user-then-coach exchanges have already happened.
 */
const buildPhaseInstruction = (exchangeCount, vocabWords) => {
    const sampleWord = vocabWords && vocabWords.length > 0 ? vocabWords[0] : null;

    if (exchangeCount <= 2) {
        // Part 1 style: easy warm-up, like the real test's opening small talk.
        return "You're in the WARM-UP phase (like IELTS Speaking Part 1): ask easy, "
            + "everyday questions — hobbies, daily routine, likes and dislikes.";
    }
    if (exchangeCount <= 5) {
        // Part 2 style: one sustained topic, ideally seeded from a saved word.
        const topicHint = sampleWord
            ? ` Base the topic on the word "${sampleWord}" if it fits naturally (e.g. "tell `
                + `me about something ${sampleWord} in your daily life").`
            : "";
        return "You're moving into the MAIN TOPIC phase (like IELTS Speaking Part 2): give "
            + "the user ONE clear topic and ask them to talk about it for a minute or two "
            + "without much interruption from you — keep YOUR OWN replies brief encouragement "
            + `only, don't take over the talking.${topicHint}`;
    }
    // Part 3 style: abstract, analytical discussion building on whatever came up in Part 2.
    return "You're in the DISCUSSION phase (like IELTS Speaking Part 3): ask more abstract, "
        + "opinion-based follow-up questions related to what they just talked about, gently "
        + "pushing them to explain WHY, not just what.";
};

/**
 * Builds the "personality" instructions sent to the LLM before every reply.
 * This is what turns a generic chat model into a specific character (a patient
 * speaking-practice coach, teaching at a specific level, aware of what this
 * particular learner tends to struggle with) instead of a plain assistant.
 */
const buildSystemPrompt = ({ vocabWords, level, exchangeCount, learnerSummary }) => {
    let prompt = "You are Knit, a friendly, patient English-speaking practice partner and "
        + "teacher inside a vocabulary-learning app. Keep every reply VERY SHORT — a single "
        // This sentence is the fix for an earlier bug: the model was previously allowed up to
        // 3 sentences, which reliably produced replies longer than Orpheus's 200-character
        // limit. Telling it the EXACT character budget (rather than a vague "be short") makes
        // the model far more likely to actually stay under it on its own. This rule applies
        // to YOUR OWN spoken lines only — during the main-topic phase below, the USER is the
        // one who should be talking at length, not you.
        + `short sentence, no more than about ${ORPHEUS_MAX_CHARS - 20} characters — this is a `
        + "hard technical limit, not just a style preference, so treat it as a strict rule. "
        + "Sound like a real spoken conversation, never a lecture. If the user's last message "
        + "had a grammar mistake, don't call it out directly or say \"you made a mistake\" — "
        + "just naturally reply using the correct phrasing yourself, the way a good teacher "
        + "models correct speech without embarrassing a student. End your reply with a short "
        + "follow-up question, so the conversation keeps going.\n\n";

    prompt += `LEVEL: ${LEVEL_DESCRIPTIONS[level] || LEVEL_DESCRIPTIONS.intermediate}\n\n`;
    prompt += buildPhaseInstruction(exchangeCount, vocabWords) + "\n\n";

    // Only mention vocab words if the user actually has some saved — an empty list would
    // otherwise produce a confusing instruction like "encourage using: " (nothing after it).
    if (vocabWords && vocabWords.length > 0) {
        prompt += `When it fits naturally, gently encourage the user to try using one of `
            + `these saved words in their next reply: ${vocabWords.join(", ")}. Don't force `
            + `one into every single message — only when it actually fits.\n\n`;
    }

    // The rolling cross-session memory — a few bullet points, NOT a full transcript archive.
    // This is what lets the coach feel like it "remembers" the learner across separate
    // conversations without re-sending their entire speaking history every single turn.
    if (learnerSummary) {
        prompt += `WHAT YOU KNOW ABOUT THIS LEARNER FROM PAST SESSIONS (use this to quietly `
            + `personalize your teaching — don't recite it back to them word for word): `
            + `${learnerSummary}`;
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
const getCoachReply = async (history, promptContext) => {
    // The "system" message (persona + level + phase + memory instructions) always goes
    // first, followed by the actual back-and-forth so far.
    const messages = [{ role: "system", content: buildSystemPrompt(promptContext) }, ...history];

    const response = await axios.post(`${GROQ_BASE}/chat/completions`, {
        model: "openai/gpt-oss-120b",
        messages,
        temperature: 0.7, // a bit of natural variety in phrasing, without going off-topic
        // "openai/gpt-oss-120b" is a REASONING model — before writing its actual visible
        // reply, it first spends some of its token budget on internal chain-of-thought
        // ("thinking") that never gets shown to the user. That invisible thinking counts
        // against max_tokens just like the real reply does. An earlier bug here: with a
        // small max_tokens and no reasoning_effort set, a more complex exchange could burn
        // the ENTIRE token budget on thinking alone, leaving nothing left to write the
        // actual reply — Groq returns content: "" in that case (not an error), which then
        // crashed the text-to-speech step with "input is required".
        reasoning_effort: "low", // asks the model to think LESS before answering — plenty for a short, casual conversational reply, and leaves far more of the token budget free for the actual visible content
        max_tokens: 400          // extra headroom so even "low" reasoning plus a full reply comfortably fits without running out mid-thought
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
            response_format: "wav" // Orpheus specifically only accepts "wav" — confirmed the hard way: Groq's error is literally "response_format must be one of [wav]". The mp3/flac/ogg options that appear in some third-party Groq SDK wrapper docs are for OTHER Groq TTS models generically, not Orpheus specifically — don't change this again without testing against a real Orpheus request first.
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
        // "<Buffer 7b 22 65 72 72 6f 72 22 3a ...>". Here, we catch that raw-bytes error,
        // turn it back into a normal readable string (and parse it as JSON if it is one),
        // and THEN re-throw — so whichever function called us sees a normal readable message.
        if (Buffer.isBuffer(error.response?.data)) {
            const decodedText = error.response.data.toString("utf-8"); // bytes → readable string
            try {
                error.response.data = JSON.parse(decodedText); // usually Groq's errors ARE valid JSON — parse it back into a normal object
            } catch {
                error.response.data = decodedText; // wasn't JSON after all — a plain readable string is still a huge improvement over a Buffer dump
            }
        }
        throw error; // re-throw so the calling function's existing try/catch still handles it exactly as before — we only fixed what it LOOKS like in the logs
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

// Marker line used to split the reflection LLM call's output into its two parts (see
// endSession below). A literal string like this is far more robust to parse than trying
// to force valid JSON out of a model that's already balancing several instructions at once.
const REFLECTION_SPLIT_MARKER = "---LEARNER SUMMARY---";

/**
 * Generates the end-of-session teacher-style feedback AND the updated rolling learner
 * summary, in a single LLM call (one call is cheaper and faster than two, and the model
 * benefits from writing both while the whole transcript is fresh in its context).
 */
const generateReflection = async (transcript, previousSummary) => {
    // Format the transcript as plain readable lines — simpler and more token-efficient for
    // this one-off analytical call than replaying it as a real back-and-forth message list.
    const transcriptText = transcript
        .map((turn) => `${turn.role === "user" ? "Learner" : "Coach"}: ${turn.content}`)
        .join("\n");

    const systemPrompt = "You are an encouraging, specific English-speaking teacher writing "
        + "END-OF-SESSION FEEDBACK for a learner, based on the transcript of a practice "
        + "conversation they just had. Write two things, in this exact format:\n\n"
        + "1. A short (3-5 sentence) constructive reflection, written directly TO the learner "
        + "(\"you\"), touching on fluency, vocabulary use, grammar, and coherence — mention "
        + "SPECIFIC words or moments from the transcript rather than generic praise. If they "
        + "used any vocabulary words naturally, name which ones. Be warm, not clinical.\n\n"
        + `2. On a new line, write exactly "${REFLECTION_SPLIT_MARKER}", then a SHORT rolling `
        + "summary (2-4 bullet points, each under 15 words) of this learner for a future "
        + "session to reference — recurring grammar mistakes, words they've successfully "
        + "used in speech, and their approximate comfort level. Merge this with what was "
        + "already known about them rather than replacing it outright, unless something has "
        + `clearly changed.\n\nWhat was already known about this learner: ${previousSummary || "Nothing yet — this is their first session."}`;

    const response = await axios.post(`${GROQ_BASE}/chat/completions`, {
        model: "openai/gpt-oss-120b",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Here is the full conversation:\n\n${transcriptText}` }
        ],
        temperature: 0.6,
        reasoning_effort: "low", // same reasoning as getCoachReply above — keep thinking light so the visible output isn't starved of tokens
        max_tokens: 700          // this call writes more than a one-line reply, so it gets a larger budget than the main conversational turns
    }, {
        headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
        },
        timeout: 20000
    });

    const raw = response.data.choices[0].message.content.trim();
    const splitIndex = raw.indexOf(REFLECTION_SPLIT_MARKER);

    if (splitIndex === -1) {
        // The model didn't follow the format for some reason — treat the whole thing as the
        // reflection and just keep whatever summary already existed rather than losing it.
        return { reflection: raw || "Good effort in this session! Keep practicing.", updatedSummary: previousSummary || "" };
    }

    const reflection = raw.slice(0, splitIndex).trim();
    const updatedSummary = raw.slice(splitIndex + REFLECTION_SPLIT_MARKER.length).trim();
    return { reflection, updatedSummary };
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

        // Pull the learner's saved level + rolling memory, and their current vocab pool, all
        // up front — every one of these feeds into the very first system prompt below.
        const user = await User.findById(req.user).select("speakingLevel learnerSummary").lean();
        const level = user?.speakingLevel || "intermediate";
        const learnerSummary = user?.learnerSummary || "";
        const vocabWords = await pickVocabWords(req.user);

        // A fake "opening move" so the LLM has something to respond to — this never gets
        // shown to the user or saved to the database, it just kicks the conversation into
        // motion. exchangeCount is 0 here since nothing has actually happened yet.
        const openingHistory = [{ role: "user", content: "Let's start a conversation to practice my English." }];
        const rawReplyText = await getCoachReply(openingHistory, { vocabWords, level, exchangeCount: 0, learnerSummary });
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

        // Create the database record for this session NOW, so a "turn" call has somewhere
        // to append to even if this is the only exchange that ever happens. The transcript
        // saved here mirrors what's actually shown on screen — NOT the fake opening line
        // above, which is an internal implementation detail, not something the learner said.
        const session = await SpeakingSession.create({
            userId: req.user,
            level,
            transcript: [{ role: "assistant", content: replyText }]
        });

        res.status(200).json({
            replyText,
            replyAudioBase64: audioBuffer.toString("base64"), // base64 so it can travel inside a normal JSON response, no separate file/URL needed
            vocabWords,
            history,
            sessionId: session._id, // the frontend needs this on every later call — /turn to keep appending, /end to close it out
            level
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
 *   - "audio":     the recorded clip (whatever format MediaRecorder produced)
 *   - "history":   a JSON string of the conversation so far (exactly what a
 *                  previous call to /start or /turn returned as "history")
 *   - "sessionId": the database id returned by /start, so this turn gets appended
 *                  to the right saved session instead of being lost
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
        const sessionId = req.body.sessionId;

        // Whisper heard nothing usable (silence, background noise) — ask the user to
        // repeat themselves instead of sending an empty message to the LLM.
        if (!userText) {
            const retryText = "I didn't quite catch that — could you say it again?";
            const retryAudio = await synthesizeSpeech(retryText);
            return res.status(200).json({
                userText: "",
                replyText: retryText,
                replyAudioBase64: retryAudio.toString("base64"),
                history // unchanged — this "turn" never really happened, so it isn't saved to the database either
            });
        }

        history.push({ role: "user", content: userText });

        // Only the most recent messages are sent to the LLM (keeps token usage and
        // latency down as a session gets long) — but the FULL history is still returned
        // to the frontend below, so the on-screen transcript never loses anything.
        const recentHistory = history.slice(-20);

        // How many full exchanges have happened BEFORE this one — used to decide which
        // IELTS-style phase (warm-up / main topic / discussion) the coach should be acting
        // like right now. Divided by 2 because each exchange is one user + one assistant line.
        const exchangeCount = Math.floor((history.length - 1) / 2);

        const user = await User.findById(req.user).select("speakingLevel learnerSummary").lean();
        const level = user?.speakingLevel || "intermediate";
        const learnerSummary = user?.learnerSummary || "";
        const vocabWords = await pickVocabWords(req.user);

        // Same reasoning as in startConversation above: truncate FIRST, then use that one
        // truncated string for the on-screen text, the spoken audio, and the saved history —
        // never speak a different (shorter) version of what's displayed.
        const rawReplyText = await getCoachReply(recentHistory, { vocabWords, level, exchangeCount, learnerSummary });
        // Same fallback as in startConversation above — never let an empty LLM reply
        // reach synthesizeSpeech() and fail the whole turn with "input is required".
        const replyText = truncateForSpeech(rawReplyText || FALLBACK_COACH_REPLY);
        const audioBuffer = await synthesizeSpeech(replyText);

        history.push({ role: "assistant", content: replyText });

        // Append this exchange to the saved session. Wrapped in its own try/catch so a
        // database hiccup here degrades gracefully (the conversation still works for the
        // user right now) instead of failing the whole turn over something that only
        // affects history/sidebar viewing later.
        if (sessionId) {
            try {
                await SpeakingSession.findOneAndUpdate(
                    { _id: sessionId, userId: req.user }, // scoped to this user — can't append to someone else's session
                    { $push: { transcript: { $each: [{ role: "user", content: userText }, { role: "assistant", content: replyText }] } } }
                );
            } catch (dbError) {
                console.log("SPEAKING TURN — session save failed (turn itself still succeeded):", dbError.message);
            }
        }

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

/**
 * POST /api/speaking/end
 * Closes out a session: generates the teacher-style reflection + updates the learner's
 * rolling cross-session summary, saves both, and returns the reflection to show on screen.
 * Reads the transcript straight from the DATABASE (not from whatever the frontend sends)
 * so this is always based on what was actually saved turn-by-turn, not something that
 * could be tampered with or out of sync client-side.
 */
exports.endSession = async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (!sessionId) return res.status(400).json({ message: "sessionId is required" });

        const session = await SpeakingSession.findOne({ _id: sessionId, userId: req.user });
        if (!session) return res.status(404).json({ message: "Session not found" });

        if (session.transcript.length === 0) {
            return res.status(400).json({ message: "Nothing to reflect on yet — have at least one exchange first" });
        }

        const user = await User.findById(req.user).select("learnerSummary");
        const { reflection, updatedSummary } = await generateReflection(session.transcript, user?.learnerSummary || "");

        session.reflection = reflection;
        session.endedAt = new Date();
        await session.save();

        if (user) {
            user.learnerSummary = updatedSummary;
            await user.save();
        }

        res.status(200).json({ reflection });
    } catch (error) {
        console.log("END SESSION ERROR:", error.response?.data || error.message);
        res.status(500).json({ message: "Couldn't generate feedback for this session — try again" });
    }
};

/**
 * GET /api/speaking/sessions
 * Lightweight list for the sidebar — deliberately excludes the full transcript text
 * (that's only fetched when a specific session is actually opened, via getSessionById
 * below) so this stays fast even once someone has dozens of saved sessions.
 */
exports.getSessions = async (req, res) => {
    try {
        const sessions = await SpeakingSession.find({ userId: req.user })
            .sort({ createdAt: -1 })
            .limit(50) // a sensible cap — nobody's scrolling through hundreds of past chats in a sidebar
            .select("level reflection endedAt createdAt transcript")
            .lean();

        res.status(200).json(sessions.map((s) => ({
            id: s._id,
            level: s.level,
            startedAt: s.createdAt,
            endedAt: s.endedAt,
            messageCount: s.transcript.length,
            hasReflection: !!s.reflection,
            // A short preview so the sidebar can show a hint of what the conversation was about
            // without sending the whole transcript for every single item in the list.
            preview: s.transcript[0]?.content?.slice(0, 80) || ""
        })));
    } catch (error) {
        console.log("GET SESSIONS ERROR:", error.message);
        res.status(500).json({ message: "Couldn't load your speaking history" });
    }
};

/**
 * GET /api/speaking/sessions/:id
 * The full detail view for one session — actual transcript + reflection — fetched only
 * when the user taps into a specific past conversation from the sidebar.
 */
exports.getSessionById = async (req, res) => {
    try {
        const session = await SpeakingSession.findOne({ _id: req.params.id, userId: req.user }).lean();
        if (!session) return res.status(404).json({ message: "Session not found" });

        res.status(200).json({
            id: session._id,
            level: session.level,
            startedAt: session.createdAt,
            endedAt: session.endedAt,
            transcript: session.transcript,
            reflection: session.reflection
        });
    } catch (error) {
        console.log("GET SESSION BY ID ERROR:", error.message);
        res.status(500).json({ message: "Couldn't load that session" });
    }
};

/**
 * DELETE /api/speaking/sessions/:id — remove one saved conversation.
 */
exports.deleteSession = async (req, res) => {
    try {
        const deleted = await SpeakingSession.findOneAndDelete({ _id: req.params.id, userId: req.user });
        if (!deleted) return res.status(404).json({ message: "Session not found" });
        res.status(200).json({ message: "Session deleted" });
    } catch (error) {
        console.log("DELETE SESSION ERROR:", error.message);
        res.status(500).json({ message: "Couldn't delete that session" });
    }
};

/**
 * DELETE /api/speaking/sessions — clear ALL of this user's saved conversations at once
 * (the "Clear" button next to the History panel).
 */
exports.deleteAllSessions = async (req, res) => {
    try {
        await SpeakingSession.deleteMany({ userId: req.user });
        res.status(200).json({ message: "All sessions deleted" });
    } catch (error) {
        console.log("DELETE ALL SESSIONS ERROR:", error.message);
        res.status(500).json({ message: "Couldn't clear your speaking history" });
    }
};

/**
 * GET /api/speaking/level — read the learner's saved difficulty level, for Settings
 * to show the currently-selected option when the page loads.
 */
exports.getLevel = async (req, res) => {
    try {
        const user = await User.findById(req.user).select("speakingLevel").lean();
        res.status(200).json({ level: user?.speakingLevel || "intermediate" });
    } catch (error) {
        console.log("GET LEVEL ERROR:", error.message);
        res.status(500).json({ message: "Couldn't load your level setting" });
    }
};

/**
 * PUT /api/speaking/level — save a new difficulty level choice.
 */
exports.setLevel = async (req, res) => {
    try {
        const { level } = req.body;
        if (!["beginner", "intermediate", "advanced"].includes(level)) {
            return res.status(400).json({ message: "level must be beginner, intermediate, or advanced" });
        }
        await User.findByIdAndUpdate(req.user, { speakingLevel: level });
        res.status(200).json({ level });
    } catch (error) {
        console.log("SET LEVEL ERROR:", error.message);
        res.status(500).json({ message: "Couldn't save your level setting" });
    }
};
