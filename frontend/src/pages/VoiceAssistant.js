// useState: React's way of storing values that, when changed, make the component re-render
// useRef: stores a value that PERSISTS across re-renders but does NOT trigger a re-render when changed —
//         we use this for the SpeechRecognition object itself, since recreating it every render would break it
// useEffect: lets us run code at specific times (here: once, when the page first loads)
import { useState, useRef, useEffect, useCallback } from "react";
import api from "../api"; // our shared axios instance — automatically attaches the login token to every request
import AppLayout from "../components/AppLayout"; // shared page frame (sidebar, theme) used by every page in the app

// ── SESSION STATES ──
// This page moves through a small number of named states, one at a time. Naming them like
// this (instead of a jumble of separate true/false flags) makes it much easier to reason
// about "what should the mic be doing right now?" at any given moment.
const STATE = {
    IDLE: "idle",                     // nothing happening, waiting for the user to press Start
    LISTENING_WORD: "listening_word", // mic is on, waiting for the user to say a word
    LOOKING_UP: "looking_up",         // word captured, waiting on the backend for its meaning
    SPEAKING: "speaking",             // the browser is reading the meaning out loud
    LISTENING_COMMAND: "listening_command" // mic is on again, waiting for "add it" / "skip" / "stop"
};

function VoiceAssistant() {
    // ── STATE VARIABLES (all owned by this component — nothing here is passed in as a prop,
    // since this is a single self-contained page rather than a parent/child pair) ──
    const [sessionState, setSessionState] = useState(STATE.IDLE); // which STATE (above) we're currently in
    const [currentWord, setCurrentWord] = useState(null);         // the word we most recently heard, e.g. "ubiquitous"
    const [currentMeaning, setCurrentMeaning] = useState(null);   // the full lookup result object for that word ({ meaning, exampleSentence, ... })
    const [transcriptLog, setTranscriptLog] = useState([]);       // a running visual log of what was heard/said, newest first — helpful for debugging and for anyone who can't rely on audio alone
    const [errorMsg, setErrorMsg] = useState("");                 // any error message to show on screen (mic denied, browser unsupported, etc.)
    const [browserSupported, setBrowserSupported] = useState(true); // set to false if this browser has no SpeechRecognition at all

    // useRef, not useState, for the recognition object: we need the SAME instance across
    // re-renders (so its event handlers stay attached to it), and changing it should never
    // by itself cause a re-render — only the STATE values above should do that.
    const recognitionRef = useRef(null);

    // WHY THIS REF EXISTS: the SpeechRecognition event handlers below are attached only
    // ONCE, when the page first loads (see the useEffect near the bottom with an empty
    // [] dependency array). If those handlers read `currentWord` directly, they'd be
    // stuck forever using whatever `currentWord` was AT THAT FIRST MOMENT (which is
    // `null`) — a classic React trap called a "stale closure". Mirroring the state into
    // a ref lets the always-up-to-date value be read from inside those old handlers.
    const currentWordRef = useRef(null);
    useEffect(() => {
        currentWordRef.current = currentWord;
    }, [currentWord]);

    // Adds one line to the on-screen transcript log (newest on top). Kept as its own small
    // helper since several places below need to log something.
    const logLine = (text) => {
        setTranscriptLog((prev) => [text, ...prev].slice(0, 12)); // keep only the most recent 12 lines so the list doesn't grow forever
    };

    // ── SPEAK: wraps the browser's built-in text-to-speech (SpeechSynthesis) ──
    // Takes the text to say and a callback to run once the browser finishes speaking it
    // (so we know exactly when it's safe to start listening again).
    const speak = useCallback((text, onDone) => {
        // SpeechSynthesisUtterance is the "thing to be spoken" object the quiz covered —
        // one utterance per phrase we want read aloud.
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;  // slightly slower than default (1.0) — easier to follow for a definition
        utterance.pitch = 1;    // normal pitch, no change
        utterance.onend = () => {
            if (onDone) onDone(); // runs after the browser has finished reading the text aloud
        };
        window.speechSynthesis.cancel(); // stop anything mid-sentence before starting a new utterance, so overlapping speech never happens
        window.speechSynthesis.speak(utterance); // hands the utterance to the browser's speech engine — this is what actually produces sound
        logLine(`🔊 WordKnit: "${text}"`);
    }, []);

    // ── Look up a word's meaning via our new preview endpoint (does NOT save it yet) ──
    const lookupWord = useCallback(async (word) => {
        setSessionState(STATE.LOOKING_UP);
        setCurrentWord(word);
        try {
            // encodeURIComponent guards against special characters breaking the URL
            const res = await api.get(`/words/preview/${encodeURIComponent(word)}`);
            setCurrentMeaning(res.data); // { word, meaning, exampleSentence, synonyms, source }

            const spokenLine = `${word}. ${res.data.meaning}. Say "add it" to save this word, or say the next word.`;
            setSessionState(STATE.SPEAKING);
            speak(spokenLine, () => startListening(STATE.LISTENING_COMMAND)); // once spoken, start listening for the follow-up command
        } catch (err) {
            const message = err.response?.data?.message || "Sorry, I couldn't look that word up.";
            setErrorMsg(message);
            setSessionState(STATE.SPEAKING);
            speak(message, () => startListening(STATE.LISTENING_WORD)); // give up on this word, go back to listening for a fresh one
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speak]);

    // ── Actually save the current word to the user's list (calls the existing addWord endpoint) ──
    const addCurrentWord = useCallback(async () => {
        // Read from the REF, not the `currentWord` state variable — see the comment above
        // currentWordRef's declaration for why. This is what makes it safe for this function
        // to have a stable identity (empty-ish dependency array) instead of being recreated
        // every time a new word is looked up.
        const word = currentWordRef.current;
        if (!word) return;
        try {
            // This is the SAME endpoint the regular "add word" button uses. Because we already
            // looked this word up via /preview above, it's sitting in the shared WordCache —
            // so this call reuses that cached meaning instead of hitting the network again.
            await api.post("/words", { word });
            speak(`Added "${word}" to your list.`, () => startListening(STATE.LISTENING_WORD));
        } catch (err) {
            speak("Sorry, something went wrong saving that word.", () => startListening(STATE.LISTENING_WORD));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speak]);

    // ── Handle whatever the user says once we're listening for a COMMAND (not a fresh word) ──
    const handleCommand = useCallback((transcript) => {
        const said = transcript.toLowerCase();

        if (said.includes("add") || said.includes("yes")) {
            setSessionState(STATE.LOOKING_UP); // reuse this state briefly as a generic "working..." indicator
            addCurrentWord();
        } else if (said.includes("stop") || said.includes("exit") || said.includes("end")) {
            stopSession();
        } else if (said.includes("skip") || said.includes("no") || said.includes("next")) {
            speak("Okay, skipping.", () => startListening(STATE.LISTENING_WORD));
        } else {
            // Anything else said during the "command" step is treated as the NEXT word to
            // look up — this lets the user just keep saying words back-to-back without
            // needing to explicitly say "skip" every time.
            lookupWord(said.trim());
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addCurrentWord, lookupWord, speak]);

    // ── Starts the mic listening for ONE utterance, then routes the result based on `forState` ──
    // forState tells us WHY we're listening right now: capturing a fresh word, or waiting for
    // a yes/no/add command — the result is handled differently depending on which one it is.
    const startListening = (forState) => {
        if (!recognitionRef.current) return; // safety check in case the browser doesn't support this at all
        setSessionState(forState);
        setErrorMsg("");
        try {
            recognitionRef.current.forState = forState; // stash this on the object so the onresult handler (defined once, below) knows what mode we're in
            recognitionRef.current.start(); // this is what actually turns the microphone on and begins listening
        } catch (err) {
            // .start() throws if recognition is already running — safe to ignore, it just means
            // a previous session is still winding down.
        }
    };

    const stopSession = () => {
        window.speechSynthesis.cancel(); // stop any speech in progress immediately
        if (recognitionRef.current) recognitionRef.current.stop(); // turns the mic off
        setSessionState(STATE.IDLE);
        setCurrentWord(null);
        setCurrentMeaning(null);
        logLine("— session ended —");
    };

    // ── ONE-TIME SETUP: create the SpeechRecognition object when this page first loads ──
    // The empty [] dependency array means this effect runs exactly once (on mount), not on
    // every re-render — we only ever want ONE recognition object for the whole page's life.
    useEffect(() => {
        // Different browsers exposed this under different names historically — Chrome/Edge
        // still use the "webkit"-prefixed version, so we check both and use whichever exists.
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognitionAPI) {
            setBrowserSupported(false); // no voice support in this browser at all (e.g. Firefox) — the UI below will show a message instead of the mic button
            return;
        }

        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = false;    // stop automatically after ONE spoken phrase, rather than staying open indefinitely
        recognition.interimResults = false; // only give us the FINAL transcript, not a live-updating guess while still speaking
        recognition.lang = "en-US";         // the language we're listening for

        // Fires when a transcript is ready (the user finished speaking a phrase).
        recognition.onresult = (event) => {
            // event.results is an array-like object; [0][0] is the top guess for the first phrase heard
            const transcript = event.results[0][0].transcript.trim();
            logLine(`🎤 You: "${transcript}"`);

            if (recognition.forState === STATE.LISTENING_COMMAND) {
                handleCommand(transcript);
            } else {
                // Recognition sometimes appends punctuation ("scare.") — strip anything that
                // isn't a letter, and just take the first word in case multiple were caught.
                const word = transcript.toLowerCase().replace(/[^a-z\s]/g, "").trim().split(/\s+/)[0];
                if (word) lookupWord(word);
            }
        };

        // Fires on any recognition failure — denied mic permission, no speech detected, etc.
        recognition.onerror = (event) => {
            if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                setErrorMsg("Microphone access was denied — allow it in your browser's site settings to use voice.");
                setSessionState(STATE.IDLE);
            } else if (event.error === "no-speech") {
                // Nothing heard — just quietly retry listening in the same mode, no need to alarm the user
                startListening(recognition.forState);
            } else {
                setErrorMsg(`Voice error: ${event.error}`);
                setSessionState(STATE.IDLE);
            }
        };

        recognitionRef.current = recognition;

        // Cleanup: if the user navigates away from this page, make sure the mic and any
        // speech in progress actually stop instead of running in the background.
        return () => {
            recognition.stop();
            window.speechSynthesis.cancel();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // empty array = run once on mount only

    // ── What the "Start"/"Stop" button does, depending on current state ──
    const handleMainButton = () => {
        if (sessionState === STATE.IDLE) {
            logLine("— session started —");
            startListening(STATE.LISTENING_WORD); // begin by listening for the first word
        } else {
            stopSession();
        }
    };

    // Small helper so the on-screen status text always matches what's actually happening
    const statusText = {
        [STATE.IDLE]: "Tap Start, then say a word",
        [STATE.LISTENING_WORD]: "Listening for a word…",
        [STATE.LOOKING_UP]: "Looking that up…",
        [STATE.SPEAKING]: "Speaking…",
        [STATE.LISTENING_COMMAND]: "Say \"add it\", a new word, or \"stop\""
    }[sessionState];

    return (
        <AppLayout>
            <div className="voice-assistant-page" style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
                <h1>Voice Assistant</h1>
                <p style={{ color: "var(--text-2)" }}>
                    Say a word out loud, hear its meaning, and say "add it" to save it —
                    hands-free, for when you're reading a physical book.
                </p>

                {!browserSupported && (
                    <div className="error-box" style={{ padding: 16, border: "1px solid var(--accent)", borderRadius: 8 }}>
                        Your browser doesn't support voice input. Please try Chrome or Edge.
                    </div>
                )}

                {browserSupported && (
                    <>
                        <button
                            className="btn btn-primary"
                            style={{ fontSize: 18, padding: "14px 28px" }}
                            onClick={handleMainButton}
                        >
                            {sessionState === STATE.IDLE ? "🎤 Start" : "⏹ Stop"}
                        </button>

                        <p style={{ marginTop: 12, fontWeight: 600 }}>{statusText}</p>

                        {errorMsg && (
                            <p style={{ color: "var(--accent)" }}>{errorMsg}</p>
                        )}

                        {currentWord && currentMeaning && (
                            <div className="word-card" style={{ marginTop: 20, padding: 16 }}>
                                <h3>{currentWord}</h3>
                                <p>{currentMeaning.meaning}</p>
                                {currentMeaning.exampleSentence && currentMeaning.exampleSentence !== "No example available" && (
                                    <p style={{ fontStyle: "italic", color: "var(--text-2)" }}>
                                        "{currentMeaning.exampleSentence}"
                                    </p>
                                )}
                            </div>
                        )}

                        <div style={{ marginTop: 24 }}>
                            <h4>Transcript</h4>
                            <ul style={{ listStyle: "none", padding: 0, color: "var(--text-2)", fontSize: 14 }}>
                                {transcriptLog.map((line, i) => <li key={i} style={{ marginBottom: 4 }}>{line}</li>)}
                            </ul>
                        </div>
                    </>
                )}
            </div>
        </AppLayout>
    );
}

export default VoiceAssistant;
