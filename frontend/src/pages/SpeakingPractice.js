// // useState/useRef/useEffect: same React tools used throughout this app
// import { useState, useRef, useEffect } from "react";
// import api from "../api"; // shared axios instance (attaches the login token automatically)
// import AppLayout from "../components/AppLayout";

// function SpeakingPractice() {
//     const [conversation, setConversation] = useState([]); // the full chat log shown on screen: [{ role: "user"|"assistant", content: "..." }]
//     const [isRecording, setIsRecording] = useState(false);  // is the mic actively capturing audio right now?
//     const [isProcessing, setIsProcessing] = useState(false); // waiting on the backend (Whisper -> LLM -> Orpheus chain)
//     const [hasStarted, setHasStarted] = useState(false);     // has the conversation actually begun yet?
//     const [errorMsg, setErrorMsg] = useState("");
//     const [vocabWords, setVocabWords] = useState([]);        // the words the coach was told to try weaving in — shown on screen as a hint

//     // Unlike VoiceAssistant.js, this page has NO background state machine — every action
//     // here (start, record, stop) is triggered directly by a button tap, so there's no risk
//     // of a "stale closure" reading old state: each click handler runs with whatever the
//     // component's state is AT THE MOMENT you click, which is always current. Simpler by design.

//     const mediaRecorderRef = useRef(null); // the active MediaRecorder instance, if recording
//     const audioChunksRef = useRef([]);     // pieces of audio data collected while recording, combined into one file when you stop
//     const streamRef = useRef(null);        // the raw microphone stream, so we can properly release it (turn off the browser's "mic in use" indicator) when done

//     // The exact conversation history object the backend expects back on the next turn —
//     // kept separate from `conversation` (which is just for display) because the backend's
//     // history format doesn't need to match the screen's display format one-for-one.
//     const historyRef = useRef([]);

//     // Plays a base64-encoded WAV clip the backend sent back (Orpheus's spoken reply).
//     const playAudio = (base64Wav) => {
//         const audio = new Audio(`data:audio/wav;base64,${base64Wav}`); // a "data URL" — the audio bytes encoded directly into the URL string itself, no separate file needed
//         audio.play().catch(() => {}); // autoplay can be blocked by the browser in rare cases — fail silently rather than crash the page over it
//     };

//     // ── Starts a brand new conversation: asks the backend for an opening line ──
//     const startConversation = async () => {
//         setErrorMsg("");
//         setIsProcessing(true);
//         try {
//             const res = await api.get("/speaking/start");
//             setConversation([{ role: "assistant", content: res.data.replyText }]);
//             setVocabWords(res.data.vocabWords || []);
//             setHasStarted(true);
//             playAudio(res.data.replyAudioBase64);
//             // Stash the full history object the backend gave us — NOT just the display text —
//             // since the next /turn call needs the exact same shape back. Kept in a ref instead
//             // of state because it's never rendered directly, only read/sent.
//             historyRef.current = res.data.history;
//         } catch (err) {
//             setErrorMsg(err.response?.data?.message || "Couldn't start the conversation.");
//         } finally {
//             setIsProcessing(false);
//         }
//     };

//     // Small helper purely so the recorder's callback below doesn't get too long —
//     // pushes one chunk of recorded audio into the ref array.
//     const pushAudioChunk = (chunk) => {
//         audioChunksRef.current.push(chunk);
//     };

//     // ── Begins recording your microphone ──
//     const startRecording = async () => {
//         setErrorMsg("");
//         try {
//             // getUserMedia is what actually triggers the browser's "allow microphone access?"
//             // permission prompt (only on the very first use) and hands back a live audio stream.
//             const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
//             streamRef.current = stream;

//             // MediaRecorder captures that raw stream into a compressed audio file as you talk —
//             // this is different from VoiceAssistant's SpeechRecognition, which transcribes
//             // in-browser instead of giving us the actual audio. Here we WANT the raw audio,
//             // since it's Groq's Whisper model (not the browser) doing the transcription.
//             const recorder = new MediaRecorder(stream);
//             audioChunksRef.current = []; // clear out any leftover data from a previous recording

//             // Fires periodically (and at least once, at the end) with a piece of the recording.
//             recorder.ondataavailable = (event) => {
//                 if (event.data.size > 0) pushAudioChunk(event.data);
//             };

//             recorder.start();
//             mediaRecorderRef.current = recorder;
//             setIsRecording(true);
//         } catch (err) {
//             setErrorMsg("Microphone access was denied or unavailable.");
//         }
//     };

//     // ── Stops recording, then sends the clip to the backend and plays the reply ──
//     const stopRecording = () => {
//         const recorder = mediaRecorderRef.current;
//         if (!recorder) return;

//         // onstop fires once all the recorded audio data has been collected — this is where
//         // we actually build the file and send it, not immediately after calling .stop().
//         recorder.onstop = async () => {
//             // Release the microphone properly — without this, the browser's "mic is
//             // recording" indicator (and the OS-level mic light on some laptops) stays on.
//             streamRef.current.getTracks().forEach((track) => track.stop());

//             // Combine every chunk collected during the recording into one audio file.
//             // MediaRecorder's default output format is webm — Groq's Whisper API accepts
//             // it directly, so no conversion step is needed here.
//             const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

//             setIsProcessing(true);
//             try {
//                 // FormData is the browser's way of building a multipart/form-data request —
//                 // required here because we're sending a binary file, not plain JSON.
//                 const formData = new FormData();
//                 formData.append("audio", audioBlob, "recording.webm");
//                 formData.append("history", JSON.stringify(historyRef.current));

//                 // NOTE: we deliberately don't set a Content-Type header ourselves — the
//                 // browser sets it automatically (including the required multipart boundary)
//                 // when it sees the body is a FormData object. Setting it by hand is a common
//                 // mistake that actually BREAKS the upload.
//                 const res = await api.post("/speaking/turn", formData);

//                 // Update the on-screen transcript with both sides of this exchange.
//                 setConversation((prev) => [
//                     ...prev,
//                     { role: "user", content: res.data.userText || "(didn't catch that)" },
//                     { role: "assistant", content: res.data.replyText }
//                 ]);
//                 historyRef.current = res.data.history; // ready for the NEXT turn
//                 playAudio(res.data.replyAudioBase64);
//             } catch (err) {
//                 setErrorMsg(err.response?.data?.message || "Something went wrong sending that.");
//             } finally {
//                 setIsProcessing(false);
//             }
//         };

//         recorder.stop();
//         setIsRecording(false);
//     };

//     // Safety net: if the user navigates away mid-recording, make sure the mic actually
//     // turns off instead of continuing to record in the background.
//     useEffect(() => {
//         return () => {
//             if (streamRef.current) {
//                 streamRef.current.getTracks().forEach((track) => track.stop());
//             }
//         };
//     }, []);

//     const micSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

//     return (
//         <AppLayout>
//             <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
//                 <h1>Speaking Practice</h1>
//                 <p style={{ color: "var(--text-2)" }}>
//                     Have an open conversation with an AI coach — it replies out loud, gently
//                     models correct grammar, and tries to work your saved words into the chat.
//                 </p>

//                 {!micSupported && (
//                     <div style={{ padding: 16, border: "1px solid var(--accent)", borderRadius: 8 }}>
//                         Your browser doesn't support audio recording. Try Chrome or Edge.
//                     </div>
//                 )}

//                 {micSupported && !hasStarted && (
//                     <button className="btn btn-primary" style={{ fontSize: 18, padding: "14px 28px" }} onClick={startConversation} disabled={isProcessing}>
//                         {isProcessing ? "Starting…" : "Start Conversation"}
//                     </button>
//                 )}

//                 {/* Rendered regardless of hasStarted, so a failed startConversation call
//                     (which never flips hasStarted to true) is actually visible instead of
//                     silently reverting the button back to "Start Conversation". */}
//                 {micSupported && errorMsg && !hasStarted && (
//                     <p style={{ color: "var(--accent)" }}>{errorMsg}</p>
//                 )}

//                 {micSupported && hasStarted && (
//                     <>
//                         {vocabWords.length > 0 && (
//                             <p style={{ fontSize: 13, color: "var(--text-3)" }}>
//                                 Words the coach may bring up: {vocabWords.join(", ")}
//                             </p>
//                         )}

//                         <div style={{ margin: "20px 0", maxHeight: 320, overflowY: "auto" }}>
//                             {conversation.map((turn, i) => (
//                                 <div key={i} style={{ marginBottom: 10, textAlign: turn.role === "user" ? "right" : "left" }}>
//                                     <span style={{
//                                         display: "inline-block",
//                                         padding: "8px 14px",
//                                         borderRadius: 12,
//                                         background: turn.role === "user" ? "var(--accent-bg)" : "var(--bg)",
//                                         border: "1px solid var(--text-3)"
//                                     }}>
//                                         {turn.content}
//                                     </span>
//                                 </div>
//                             ))}
//                         </div>

//                         {errorMsg && <p style={{ color: "var(--accent)" }}>{errorMsg}</p>}

//                         <button
//                             className="btn btn-primary"
//                             style={{ fontSize: 18, padding: "14px 28px" }}
//                             onClick={isRecording ? stopRecording : startRecording}
//                             disabled={isProcessing}
//                         >
//                             {isProcessing ? "Thinking…" : isRecording ? "⏹ Stop & Send" : "🎤 Tap to Talk"}
//                         </button>
//                     </>
//                 )}
//             </div>
//         </AppLayout>
//     );
// }

// export default SpeakingPractice;



// useState/useRef/useEffect: same React tools used throughout this app
import { useState, useRef, useEffect } from "react";
import api from "../api"; // shared axios instance (attaches the login token automatically)
import AppLayout from "../components/AppLayout";

// The phrase that starts your turn hands-free, without tapping "Tap to Talk".
const WAKE_WORD = "wordknit";
// Speech recognition sometimes mangles this into two words or mishears the "kn" —
// checking for both the whole phrase and "word" + "knit" separately catches more of those.
function heardWakeWord(transcript) {
    const said = transcript.toLowerCase();
    return said.includes(WAKE_WORD) || (said.includes("word") && said.includes("knit"));
}

// Pulls the target word out of a "define X" or "what does X mean" voice command.
// Returns null if the transcript doesn't actually match either pattern.
function extractDefineTarget(transcript) {
    const said = transcript.toLowerCase().trim();
    let match = said.match(/^define(?: the word)? ([a-z']+)/);
    if (match) return match[1];
    match = said.match(/^what does ([a-z']+) mean/);
    if (match) return match[1];
    return null;
}

// localStorage keys — namespaced so they don't collide with VoiceAssistant's own settings/history.
const SETTINGS_KEY = "wordknit_sp_settings";
const SESSIONS_KEY = "wordknit_sp_sessions";
const DEFAULT_SETTINGS = { rate: 1, voiceURI: null, recogLang: "en-US", wakeWordEnabled: false };
const MAX_SESSIONS = 20; // cap how many past conversations we keep, so localStorage doesn't grow forever

function SpeakingPractice() {
    const [conversation, setConversation] = useState([]); // the full chat log shown on screen: [{ role: "user"|"assistant", content: "..." }]
    const [isRecording, setIsRecording] = useState(false);  // is the mic actively capturing audio right now?
    const [isProcessing, setIsProcessing] = useState(false); // waiting on the backend (Whisper -> LLM -> Orpheus chain)
    const [hasStarted, setHasStarted] = useState(false);     // has the conversation actually begun yet?
    const [errorMsg, setErrorMsg] = useState("");
    const [vocabWords, setVocabWords] = useState([]);        // the words the coach was told to try weaving in — shown on screen as a hint

    // ── PERSONALIZATION SETTINGS ──
    // These only affect the LOCAL browser voice used for "define"/"spell"/"synonyms" replies —
    // your coach's actual conversational voice is generated server-side (Orpheus) and is
    // untouched by any of this.
    const [settings, setSettings] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return { ...DEFAULT_SETTINGS, ...saved };
        } catch {
            return DEFAULT_SETTINGS;
        }
    });
    const [availableVoices, setAvailableVoices] = useState([]); // populated from the browser's speechSynthesis.getVoices()
    const [showSettings, setShowSettings] = useState(false);

    // ── "define <word>" lookup result, shown on screen like a little dictionary card ──
    const [currentDefinition, setCurrentDefinition] = useState(null); // { word, meaning, exampleSentence, synonyms }

    // ── PERSISTENT CONVERSATION HISTORY (past sessions, survives closing the tab) ──
    const [sessions, setSessions] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || [];
        } catch {
            return [];
        }
    });
    const [showHistory, setShowHistory] = useState(false);

    const mediaRecorderRef = useRef(null); // the active MediaRecorder instance, if recording
    const audioChunksRef = useRef([]);     // pieces of audio data collected while recording, combined into one file when you stop
    const streamRef = useRef(null);        // the raw microphone stream, so we can properly release it (turn off the browser's "mic in use" indicator) when done

    const historyRef = useRef([]);
    const lastAudioRef = useRef(null);          // the last base64 reply clip the coach spoke — lets "repeat" replay it without a new backend call
    const lastDefinedWordRef = useRef(null);    // the word most recently looked up via "define X" — what "add it"/"spell"/"synonyms" act on
    const lastDefinedMeaningRef = useRef(null); // that word's full meaning object, so "add it" can save it without looking it up again

    // Mirrors of state read inside handlers that are attached ONCE (the wake-word recognition
    // setup below) and would otherwise be stuck seeing whatever these values were at that
    // first moment — the same "stale closure" issue documented in VoiceAssistant.js.
    const settingsRef = useRef(settings);
    useEffect(() => {
        settingsRef.current = settings;
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch {
            // localStorage unavailable — settings just won't persist across reloads
        }
    }, [settings]);
    const hasStartedRef = useRef(hasStarted);
    useEffect(() => { hasStartedRef.current = hasStarted; }, [hasStarted]);
    const isRecordingRef = useRef(isRecording);
    useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
    const isProcessingRef = useRef(isProcessing);
    useEffect(() => { isProcessingRef.current = isProcessing; }, [isProcessing]);

    const voicesRef = useRef([]); // mirror of availableVoices, for the same reason as above
    const wakeRecognitionRef = useRef(null);
    const sessionIdRef = useRef(null); // identifies which saved session in `sessions` the current conversation belongs to

    const playAudio = (base64Wav) => {
        const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
        audio.play().catch(() => {});
    };

    // Speaks text using the BROWSER's own voice (free, instant, no backend round trip) —
    // used only for command replies ("define X", "spell it", etc.), never for the coach's
    // actual conversational turns, which come back from the server as real audio already.
    const speakLocally = (text) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = settingsRef.current.rate;
        if (settingsRef.current.voiceURI) {
            const chosen = voicesRef.current.find((v) => v.voiceURI === settingsRef.current.voiceURI);
            if (chosen) utterance.voice = chosen;
        }
        window.speechSynthesis.cancel(); // don't let two local replies overlap
        window.speechSynthesis.speak(utterance);
    };

    // ── Load the browser's available text-to-speech voices, for the Settings panel ──
    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            voicesRef.current = voices;
            setAvailableVoices(voices);
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
        return () => { window.speechSynthesis.onvoiceschanged = null; };
    }, []);

    // ── "define <word>" — looks a word up via the SAME endpoint VoiceAssistant.js uses, but
    // speaks the result locally instead of sending it through the LLM/Orpheus chain, since
    // it's a lookup, not something the coach needs to weigh in on. ──
    const lookupAndSpeakDefinition = async (word) => {
        try {
            const res = await api.get(`/words/preview/${encodeURIComponent(word)}`);
            lastDefinedWordRef.current = word;
            lastDefinedMeaningRef.current = res.data;
            setCurrentDefinition({ word, ...res.data });
            speakLocally(`${word}. ${res.data.meaning}. Say "add it" to save this word.`);
        } catch (err) {
            speakLocally(`Sorry, I couldn't find a definition for ${word}.`);
        }
    };

    // ── "add it" — saves whatever word was most recently defined ──
    const saveDefinedWord = async () => {
        const word = lastDefinedWordRef.current;
        const meaning = lastDefinedMeaningRef.current;
        if (!word) {
            speakLocally("Say \"define\" a word first, then \"add it\" to save it.");
            return;
        }
        try {
            // NOTE: same caveat as VoiceAssistant.js — if your /words route only reads
            // req.body.word today, the meaning/exampleSentence/synonyms fields below will be
            // silently ignored until the route/schema is updated to store them.
            await api.post("/words", {
                word,
                meaning: meaning?.meaning,
                exampleSentence: meaning?.exampleSentence,
                synonyms: meaning?.synonyms
            });
            speakLocally(`Added "${word}" to your list.`);
        } catch (err) {
            speakLocally("Sorry, something went wrong saving that word.");
        }
    };

    const startConversation = async () => {
        setErrorMsg("");
        setIsProcessing(true);
        try {
            const res = await api.get("/speaking/start");
            sessionIdRef.current = Date.now().toString(); // a fresh id for the session-history effect below to save under
            setConversation([{ role: "assistant", content: res.data.replyText }]);
            setVocabWords(res.data.vocabWords || []);
            setHasStarted(true);
            lastAudioRef.current = res.data.replyAudioBase64;
            playAudio(res.data.replyAudioBase64);
            historyRef.current = res.data.history;
        } catch (err) {
            setErrorMsg(err.response?.data?.message || "Couldn't start the conversation.");
        } finally {
            setIsProcessing(false);
        }
    };

    const pushAudioChunk = (chunk) => {
        audioChunksRef.current.push(chunk);
    };

    const startRecording = async () => {
        setErrorMsg("");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;
            const recorder = new MediaRecorder(stream);
            audioChunksRef.current = [];
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) pushAudioChunk(event.data);
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
            setIsRecording(true);
        } catch (err) {
            setErrorMsg("Microphone access was denied or unavailable.");
        }
    };

    const stopRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;
        recorder.onstop = async () => {
            streamRef.current.getTracks().forEach((track) => track.stop());
            const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            setIsProcessing(true);
            try {
                const formData = new FormData();
                formData.append("audio", audioBlob, "recording.webm");
                formData.append("history", JSON.stringify(historyRef.current));
                const res = await api.post("/speaking/turn", formData);

                // ── Command check ──
                // Transcription only happens server-side here (Whisper runs as part of this
                // same call), so commands can only be recognized AFTER this round trip
                // completes — unlike VoiceAssistant.js, which transcribes locally and can
                // react instantly. This does mean the LLM/Orpheus chain still ran (and cost
                // whatever it costs) even for something like "repeat" — but we can at least
                // keep it out of the coach's actual memory of the conversation, so it doesn't
                // show up as a strange non-sequitur turn later on.
                const heard = (res.data.userText || "").toLowerCase().trim();
                const defineTarget = extractDefineTarget(heard);

                if (heard.includes("repeat") || heard.includes("say that again")) {
                    if (lastAudioRef.current) playAudio(lastAudioRef.current);
                    else speakLocally("I haven't said anything yet.");
                    // historyRef.current is deliberately left as-is — the backend's updated
                    // history for this "turn" is discarded rather than adopted.
                } else if (defineTarget) {
                    await lookupAndSpeakDefinition(defineTarget);
                } else if (heard.includes("add it") || heard.includes("save that word")) {
                    await saveDefinedWord();
                } else if (heard.includes("spell") && lastDefinedWordRef.current) {
                    speakLocally(lastDefinedWordRef.current.split("").join(", "));
                } else if (heard.includes("synonym") && lastDefinedWordRef.current) {
                    const synonyms = lastDefinedMeaningRef.current?.synonyms;
                    speakLocally(synonyms && synonyms.length ? `Synonyms: ${synonyms.join(", ")}.` : "No synonyms found for this word.");
                } else {
                    // Not a command — a real conversational turn, handled exactly as before.
                    setConversation((prev) => [
                        ...prev,
                        { role: "user", content: res.data.userText || "(didn't catch that)" },
                        { role: "assistant", content: res.data.replyText }
                    ]);
                    historyRef.current = res.data.history;
                    lastAudioRef.current = res.data.replyAudioBase64;
                    playAudio(res.data.replyAudioBase64);
                }
            } catch (err) {
                setErrorMsg(err.response?.data?.message || "Something went wrong sending that.");
            } finally {
                setIsProcessing(false);
            }
        };
        recorder.stop();
        setIsRecording(false);
    };

    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    // ── Persist the current conversation as a session, updating it as new turns arrive ──
    // Runs on every change to `conversation`, so even closing the tab mid-chat leaves
    // whatever was said so far saved and viewable later in the History panel.
    useEffect(() => {
        if (!hasStarted || !sessionIdRef.current) return;
        setSessions((prev) => {
            const idx = prev.findIndex((s) => s.id === sessionIdRef.current);
            const updatedSession = { id: sessionIdRef.current, startedAt: prev[idx]?.startedAt || new Date().toISOString(), transcript: conversation };
            const next = idx === -1
                ? [updatedSession, ...prev].slice(0, MAX_SESSIONS)
                : prev.map((s, i) => (i === idx ? updatedSession : s));
            try {
                localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
            } catch {
                // storage full/unavailable — this update just won't persist
            }
            return next;
        });
    }, [conversation, hasStarted]);

    const clearSessionHistory = () => {
        setSessions([]);
        try { localStorage.removeItem(SESSIONS_KEY); } catch { /* nothing to clean up */ }
    };

    // ── WAKE WORD: a separate, always-listening recognition instance ──
    // Only runs while idle (conversation not yet started, or waiting between your turns) —
    // never at the same time as MediaRecorder is actively capturing your spoken answer.
    useEffect(() => {
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognitionAPI) return; // no voice support in this browser — Settings will simply have no effect

        const wakeRec = new SpeechRecognitionAPI();
        wakeRec.continuous = true;
        wakeRec.interimResults = true;
        wakeRec.lang = settingsRef.current.recogLang;

        wakeRec.onresult = (event) => {
            const latest = event.results[event.results.length - 1][0].transcript;
            if (!heardWakeWord(latest)) return;
            if (isRecordingRef.current || isProcessingRef.current) return; // don't interrupt an in-progress turn
            try { wakeRec.stop(); } catch { /* already stopping */ }
            if (!hasStartedRef.current) {
                startConversation(); // first time — begin the whole conversation
            } else {
                startRecording(); // mid-conversation — start this turn's recording, hands-free
            }
        };

        wakeRec.onerror = () => {
            // "no-speech"/"aborted" fire constantly for a continuous listener in silence —
            // expected, not worth surfacing. onend below handles restarting either way.
        };

        wakeRec.onend = () => {
            if (settingsRef.current.wakeWordEnabled && !isRecordingRef.current && !isProcessingRef.current) {
                try { wakeRec.start(); } catch { /* start/stop race — the next onend retries */ }
            }
        };

        wakeRecognitionRef.current = wakeRec;
        return () => {
            try { wakeRec.stop(); } catch { /* already stopped */ }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // set up once, like the recognition object in VoiceAssistant.js

    // Keeps the wake recognizer's language in sync with Settings (it's created once on mount).
    useEffect(() => {
        if (wakeRecognitionRef.current) wakeRecognitionRef.current.lang = settings.recogLang;
    }, [settings.recogLang]);

    // Turns the wake listener on/off: runs exactly when enabled AND nothing else has the mic.
    useEffect(() => {
        const wakeRec = wakeRecognitionRef.current;
        if (!wakeRec) return;
        if (settings.wakeWordEnabled && !isRecording && !isProcessing) {
            try { wakeRec.start(); } catch { /* already started — fine */ }
        } else {
            try { wakeRec.stop(); } catch { /* already stopped — fine */ }
        }
    }, [settings.wakeWordEnabled, isRecording, isProcessing]);

    const micSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    return (
        <AppLayout>
            <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
                <h1>Speaking Practice</h1>
                <p style={{ color: "var(--text-2)" }}>
                    Have an open conversation with an AI coach — it replies out loud, gently
                    models correct grammar, and tries to work your saved words into the chat.
                    {settings.wakeWordEnabled && " Just say \"WordKnit\" any time to start talking."}
                </p>

                {!micSupported && (
                    <div style={{ padding: 16, border: "1px solid var(--accent)", borderRadius: 8 }}>
                        Your browser doesn't support audio recording. Try Chrome or Edge.
                    </div>
                )}

                {micSupported && (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                        <button className="btn btn-secondary" onClick={() => setShowSettings((v) => !v)}>⚙️ Settings</button>
                        <button className="btn btn-secondary" onClick={() => setShowHistory((v) => !v)}>🕒 History</button>
                    </div>
                )}

                {showSettings && (
                    <div style={{ marginBottom: 16, padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
                        <h4 style={{ marginTop: 0 }}>Settings</h4>

                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <input
                                type="checkbox"
                                checked={settings.wakeWordEnabled}
                                onChange={(e) => setSettings((s) => ({ ...s, wakeWordEnabled: e.target.checked }))}
                            />
                            Listen for the wake word ("WordKnit") to start each turn hands-free
                        </label>

                        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: -6, marginBottom: 12 }}>
                            The settings below only affect the voice used for "define"/"spell"/"synonyms" replies —
                            your coach's own voice is generated on the server and isn't changed by these.
                        </p>

                        <label style={{ display: "block", marginBottom: 12 }}>
                            Local voice speed: {settings.rate.toFixed(2)}x
                            <input
                                type="range" min="0.5" max="1.5" step="0.05"
                                value={settings.rate}
                                onChange={(e) => setSettings((s) => ({ ...s, rate: parseFloat(e.target.value) }))}
                                style={{ width: "100%" }}
                            />
                        </label>

                        <label style={{ display: "block", marginBottom: 12 }}>
                            Local voice
                            <select
                                value={settings.voiceURI || ""}
                                onChange={(e) => setSettings((s) => ({ ...s, voiceURI: e.target.value || null }))}
                                style={{ width: "100%", padding: 8 }}
                            >
                                <option value="">Browser default</option>
                                {availableVoices.map((v) => (
                                    <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>
                                ))}
                            </select>
                        </label>

                        <label style={{ display: "block" }}>
                            Wake word / command recognition language
                            <select
                                value={settings.recogLang}
                                onChange={(e) => setSettings((s) => ({ ...s, recogLang: e.target.value }))}
                                style={{ width: "100%", padding: 8 }}
                            >
                                <option value="en-US">English (US)</option>
                                <option value="en-GB">English (UK)</option>
                                <option value="ur-PK">Urdu (Pakistan)</option>
                                <option value="es-ES">Spanish</option>
                                <option value="fr-FR">French</option>
                                <option value="de-DE">German</option>
                            </select>
                        </label>
                    </div>
                )}

                {showHistory && (
                    <div style={{ marginBottom: 16, padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h4 style={{ margin: 0 }}>Past conversations</h4>
                            {sessions.length > 0 && <button className="btn btn-secondary" onClick={clearSessionHistory}>Clear</button>}
                        </div>
                        {sessions.length === 0 ? (
                            <p style={{ color: "var(--text-2)" }}>No past conversations yet.</p>
                        ) : (
                            sessions.map((s) => (
                                <div key={s.id} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                                    <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
                                        {new Date(s.startedAt).toLocaleString()} · {s.transcript.length} messages
                                    </p>
                                    <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 6 }}>
                                        {s.transcript.map((turn, i) => (
                                            <p key={i} style={{ margin: "4px 0", fontSize: 14 }}>
                                                <strong>{turn.role === "user" ? "You" : "Coach"}:</strong> {turn.content}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {currentDefinition && (
                    <div style={{ marginBottom: 16, padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
                        <h3 style={{ margin: 0 }}>{currentDefinition.word}</h3>
                        <p>{currentDefinition.meaning}</p>
                        {currentDefinition.exampleSentence && currentDefinition.exampleSentence !== "No example available" && (
                            <p style={{ fontStyle: "italic", color: "var(--text-2)" }}>"{currentDefinition.exampleSentence}"</p>
                        )}
                    </div>
                )}

                {micSupported && !hasStarted && (
                    <button className="btn btn-primary" style={{ fontSize: 18, padding: "14px 28px" }} onClick={startConversation} disabled={isProcessing}>
                        {isProcessing ? "Starting…" : "Start Conversation"}
                    </button>
                )}

                {micSupported && errorMsg && !hasStarted && (
                    <p style={{ color: "var(--accent)" }}>{errorMsg}</p>
                )}

                {micSupported && hasStarted && (
                    <>
                        {vocabWords.length > 0 && (
                            <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                                Words the coach may bring up: {vocabWords.join(", ")}
                            </p>
                        )}

                        <p style={{ fontSize: 13, color: "var(--text-3)" }}>
                            Try saying "define &lt;word&gt;", "add it" to save one, "spell it", "synonyms", or "repeat".
                        </p>

                        <div style={{ margin: "20px 0", maxHeight: 320, overflowY: "auto" }}>
                            {conversation.map((turn, i) => (
                                <div key={i} style={{ marginBottom: 10, textAlign: turn.role === "user" ? "right" : "left" }}>
                                    <span style={{
                                        display: "inline-block",
                                        padding: "8px 14px",
                                        borderRadius: 12,
                                        background: turn.role === "user" ? "var(--accent-bg)" : "var(--bg)",
                                        border: "1px solid var(--text-3)"
                                    }}>
                                        {turn.content}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {errorMsg && <p style={{ color: "var(--accent)" }}>{errorMsg}</p>}

                        <button
                            className="btn btn-primary"
                            style={{ fontSize: 18, padding: "14px 28px" }}
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={isProcessing}
                        >
                            {isProcessing ? "Thinking…" : isRecording ? "⏹ Stop & Send" : "🎤 Tap to Talk"}
                        </button>
                    </>
                )}
            </div>
        </AppLayout>
    );
}

export default SpeakingPractice;

