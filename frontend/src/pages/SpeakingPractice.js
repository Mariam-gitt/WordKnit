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

// localStorage keys — this now ONLY holds local browser preferences (voice/rate/language
// for the "define"/"spell"/"synonyms" replies), NOT conversation history anymore. History
// moved to the database (see SESSIONS below being fetched from the API instead) so it
// syncs across devices and survives clearing your browser cache.
const SETTINGS_KEY = "wordknit_sp_settings";
const DEFAULT_SETTINGS = { rate: 1, voiceURI: null, recogLang: "en-US", wakeWordEnabled: false };

// Shown next to each level option in Settings, in plain terms rather than raw IELTS jargon.
const LEVEL_OPTIONS = [
    { value: "beginner", label: "Beginner (simple, everyday — like IELTS Band 4-5)" },
    { value: "intermediate", label: "Intermediate (everyday + opinions — like IELTS Band 6-7)" },
    { value: "advanced", label: "Advanced (nuanced, abstract — like IELTS Band 8-9)" }
];

function SpeakingPractice() {
    const [conversation, setConversation] = useState([]); // the full chat log shown on screen: [{ role: "user"|"assistant", content: "..." }]
    const [isRecording, setIsRecording] = useState(false);  // is the mic actively capturing audio right now?
    const [isProcessing, setIsProcessing] = useState(false); // waiting on the backend (Whisper -> LLM -> Orpheus chain)
    const [hasStarted, setHasStarted] = useState(false);     // has the conversation actually begun yet?
    const [errorMsg, setErrorMsg] = useState("");
    const [vocabWords, setVocabWords] = useState([]);        // the words the coach was told to try weaving in — shown on screen as a hint

    // ── PERSONALIZATION SETTINGS (local browser voice only — unrelated to the level below) ──
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

    // ── Speaking-practice LEVEL (saved server-side on the user's account, not just this browser) ──
    const [level, setLevel] = useState("intermediate"); // sensible default while the real saved value is still loading
    const [levelLoaded, setLevelLoaded] = useState(false); // avoids briefly flashing "intermediate" before the real saved value arrives

    // ── "define <word>" lookup result, shown on screen like a little dictionary card ──
    const [currentDefinition, setCurrentDefinition] = useState(null); // { word, meaning, exampleSentence, synonyms }

    // ── SESSION HISTORY (now fetched from the database via the API, not localStorage) ──
    const [sessions, setSessions] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [isLoadingSessions, setIsLoadingSessions] = useState(false);
    const [openSessionDetail, setOpenSessionDetail] = useState(null); // the full transcript+reflection of whichever past session was tapped, or null

    // ── End-of-session teacher feedback ──
    const [reflection, setReflection] = useState(null);
    const [isEndingSession, setIsEndingSession] = useState(false);

    const mediaRecorderRef = useRef(null); // the active MediaRecorder instance, if recording
    const audioChunksRef = useRef([]);     // pieces of audio data collected while recording, combined into one file when you stop
    const streamRef = useRef(null);        // the raw microphone stream, so we can properly release it (turn off the browser's "mic in use" indicator) when done

    const historyRef = useRef([]);
    const lastAudioRef = useRef(null);          // the last base64 reply clip the coach spoke — lets "repeat" replay it without a new backend call
    const lastDefinedWordRef = useRef(null);    // the word most recently looked up via "define X" — what "add it"/"spell"/"synonyms" act on
    const lastDefinedMeaningRef = useRef(null); // that word's full meaning object, so "add it" can save it without looking it up again
    // The database _id of the CURRENT conversation, returned by /speaking/start — every
    // /turn call and the final /end call need this so they know which saved session to
    // append to / close out. Replaces the old Date.now()-based local-only id.
    const sessionIdRef = useRef(null);

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

    const playAudio = (base64Wav) => {
        // audio/wav — reverted back from mp3 (see synthesizeSpeech in speakingController.js:
        // Orpheus only actually accepts "wav" as a response_format, despite mp3/flac/ogg
        // appearing as options in some generic Groq TTS wrapper docs).
        const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
        audio.play().catch(() => {});
    };

    // Speaks text using the BROWSER's own voice (free, instant, no backend round trip) —
    // used for command replies ("define X", "spell it", etc.) AND for the end-of-session
    // reflection, never for the coach's actual conversational turns, which come back from
    // the server as real Orpheus-generated audio already.
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

    // ── Load the learner's saved speaking level once, on page load ──
    useEffect(() => {
        api.get("/speaking/level")
            .then((res) => setLevel(res.data.level))
            .catch(() => { /* fall back silently to the "intermediate" default already set above */ })
            .finally(() => setLevelLoaded(true));
    }, []);

    // ── Saves a new level choice both to state (so the dropdown updates instantly) and
    // to the database (so it's remembered next time, and used by the backend prompt). ──
    const changeLevel = async (newLevel) => {
        setLevel(newLevel); // update the UI immediately — don't make the user wait on the network for the dropdown to reflect their choice
        try {
            await api.put("/speaking/level", { level: newLevel });
        } catch (err) {
            // Not critical enough to interrupt the user with an error banner — worst case,
            // the choice doesn't persist and they can just pick it again next visit.
        }
    };

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
        setReflection(null); // clear out any leftover feedback card from a previous session
        setIsProcessing(true);
        try {
            const res = await api.get("/speaking/start");
            sessionIdRef.current = res.data.sessionId; // the database id this whole conversation will be saved under
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
                // Lets the backend append this exchange to the right saved session — without
                // this, the turn would still work, it just wouldn't be recorded in history.
                formData.append("sessionId", sessionIdRef.current || "");
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
                    // history for this "turn" is discarded rather than adopted, and (since
                    // this isn't a real exchange) it was never saved to the database either.
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

    // ── Ends the current conversation: asks the backend for teacher-style feedback (which
    // also updates the learner's rolling cross-session memory server-side), shows it on
    // screen, speaks it locally, and resets back to the "Start Conversation" state. ──
    const endCurrentSession = async () => {
        if (!sessionIdRef.current) return;
        setErrorMsg("");
        setIsEndingSession(true);
        try {
            const res = await api.post("/speaking/end", { sessionId: sessionIdRef.current });
            setReflection(res.data.reflection);
            speakLocally(res.data.reflection);
        } catch (err) {
            setErrorMsg(err.response?.data?.message || "Couldn't generate feedback for this session.");
        } finally {
            setIsEndingSession(false);
            // Reset back to a clean slate regardless of whether feedback generation
            // succeeded — the conversation itself is already safely saved in the database.
            setHasStarted(false);
            setConversation([]);
            setVocabWords([]);
            setCurrentDefinition(null);
            historyRef.current = [];
            lastAudioRef.current = null;
            sessionIdRef.current = null;
        }
    };

    // ── History panel: fetch the sidebar list from the database ──
    const fetchSessions = async () => {
        setIsLoadingSessions(true);
        try {
            const res = await api.get("/speaking/sessions");
            setSessions(res.data);
        } catch (err) {
            // Quietly fail — the History panel will just show "no past conversations" rather
            // than blocking the rest of the page with an error banner over a non-critical feature.
        } finally {
            setIsLoadingSessions(false);
        }
    };

    const toggleHistory = () => {
        const next = !showHistory;
        setShowHistory(next);
        setOpenSessionDetail(null); // collapse any previously-opened detail view when toggling the panel
        if (next) fetchSessions(); // always refetch on open, so a just-ended session shows up immediately
    };

    // ── Opens one past session's full transcript + reflection inline in the panel ──
    const viewSessionDetail = async (id) => {
        try {
            const res = await api.get(`/speaking/sessions/${id}`);
            setOpenSessionDetail(res.data);
        } catch (err) {
            // failed to load this one session's detail — leave the list as-is, nothing to reset
        }
    };

    const deleteOneSession = async (id) => {
        try {
            await api.delete(`/speaking/sessions/${id}`);
            setSessions((prev) => prev.filter((s) => s.id !== id));
            if (openSessionDetail?.id === id) setOpenSessionDetail(null);
        } catch (err) {
            // leave the list as-is on failure — the user can just try the delete again
        }
    };

    const clearAllSessions = async () => {
        try {
            await api.delete("/speaking/sessions");
            setSessions([]);
            setOpenSessionDetail(null);
        } catch (err) {
            // leave the list as-is on failure
        }
    };

    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

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
                        <button className="btn btn-secondary" onClick={toggleHistory}>🕒 History</button>
                    </div>
                )}

                {showSettings && (
                    <div style={{ marginBottom: 16, padding: 16, border: "1px solid var(--border)", borderRadius: 8 }}>
                        <h4 style={{ marginTop: 0 }}>Settings</h4>

                        <label style={{ display: "block", marginBottom: 12 }}>
                            Speaking level
                            <select
                                value={levelLoaded ? level : ""}
                                onChange={(e) => changeLevel(e.target.value)}
                                style={{ width: "100%", padding: 8 }}
                                disabled={!levelLoaded}
                            >
                                {!levelLoaded && <option value="">Loading…</option>}
                                {LEVEL_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                            <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                                Changes take effect on your NEXT conversation, not the one already in progress.
                            </span>
                        </label>

                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <input
                                type="checkbox"
                                checked={settings.wakeWordEnabled}
                                onChange={(e) => setSettings((s) => ({ ...s, wakeWordEnabled: e.target.checked }))}
                            />
                            Listen for the wake word ("WordKnit") to start each turn hands-free
                        </label>

                        <p style={{ fontSize: 13, color: "var(--text-3)", marginTop: -6, marginBottom: 12 }}>
                            The settings below only affect the voice used for "define"/"spell"/"synonyms"/feedback
                            replies — your coach's own conversational voice is generated on the server and isn't
                            changed by these.
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
                            {sessions.length > 0 && <button className="btn btn-secondary" onClick={clearAllSessions}>Clear all</button>}
                        </div>

                        {isLoadingSessions && <p style={{ color: "var(--text-2)" }}>Loading…</p>}

                        {!isLoadingSessions && sessions.length === 0 && (
                            <p style={{ color: "var(--text-2)" }}>No past conversations yet.</p>
                        )}

                        {!isLoadingSessions && sessions.map((s) => (
                            <div key={s.id} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                    <div style={{ cursor: "pointer", flex: 1 }} onClick={() => viewSessionDetail(s.id)}>
                                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
                                            {new Date(s.startedAt).toLocaleString()} · {s.messageCount} messages · {s.level}
                                            {s.hasReflection && " · has feedback"}
                                        </p>
                                        <p style={{ margin: "4px 0 0", fontSize: 14 }}>{s.preview}…</p>
                                    </div>
                                    <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => deleteOneSession(s.id)}>Delete</button>
                                </div>

                                {openSessionDetail?.id === s.id && (
                                    <div style={{ marginTop: 8, marginLeft: 8, maxHeight: 200, overflowY: "auto" }}>
                                        {openSessionDetail.transcript.map((turn, i) => (
                                            <p key={i} style={{ margin: "4px 0", fontSize: 14 }}>
                                                <strong>{turn.role === "user" ? "You" : "Coach"}:</strong> {turn.content}
                                            </p>
                                        ))}
                                        {openSessionDetail.reflection && (
                                            <p style={{ marginTop: 8, fontSize: 14, fontStyle: "italic" }}>
                                                Feedback: {openSessionDetail.reflection}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
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

                {reflection && (
                    <div style={{ marginBottom: 16, padding: 16, border: "1px solid var(--accent)", borderRadius: 8, background: "var(--accent-bg)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <h4 style={{ margin: 0 }}>Session feedback</h4>
                            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setReflection(null)}>Dismiss</button>
                        </div>
                        <p style={{ marginBottom: 0 }}>{reflection}</p>
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

                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                            <button
                                className="btn btn-primary"
                                style={{ fontSize: 18, padding: "14px 28px" }}
                                onClick={isRecording ? stopRecording : startRecording}
                                disabled={isProcessing || isEndingSession}
                            >
                                {isProcessing ? "Thinking…" : isRecording ? "⏹ Stop & Send" : "🎤 Tap to Talk"}
                            </button>

                            <button
                                className="btn btn-secondary"
                                style={{ fontSize: 16, padding: "14px 20px" }}
                                onClick={endCurrentSession}
                                disabled={isProcessing || isRecording || isEndingSession}
                            >
                                {isEndingSession ? "Wrapping up…" : "End Session"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </AppLayout>
    );
}

export default SpeakingPractice;
