// useState/useRef/useEffect: same React tools used throughout this app
import { useState, useRef, useEffect } from "react";
import api from "../api"; // shared axios instance (attaches the login token automatically)
import AppLayout from "../components/AppLayout";

function SpeakingPractice() {
    const [conversation, setConversation] = useState([]); // the full chat log shown on screen: [{ role: "user"|"assistant", content: "..." }]
    const [isRecording, setIsRecording] = useState(false);  // is the mic actively capturing audio right now?
    const [isProcessing, setIsProcessing] = useState(false); // waiting on the backend (Whisper -> LLM -> Orpheus chain)
    const [hasStarted, setHasStarted] = useState(false);     // has the conversation actually begun yet?
    const [errorMsg, setErrorMsg] = useState("");
    const [vocabWords, setVocabWords] = useState([]);        // the words the coach was told to try weaving in — shown on screen as a hint

    // Unlike VoiceAssistant.js, this page has NO background state machine — every action
    // here (start, record, stop) is triggered directly by a button tap, so there's no risk
    // of a "stale closure" reading old state: each click handler runs with whatever the
    // component's state is AT THE MOMENT you click, which is always current. Simpler by design.

    const mediaRecorderRef = useRef(null); // the active MediaRecorder instance, if recording
    const audioChunksRef = useRef([]);     // pieces of audio data collected while recording, combined into one file when you stop
    const streamRef = useRef(null);        // the raw microphone stream, so we can properly release it (turn off the browser's "mic in use" indicator) when done

    // The exact conversation history object the backend expects back on the next turn —
    // kept separate from `conversation` (which is just for display) because the backend's
    // history format doesn't need to match the screen's display format one-for-one.
    const historyRef = useRef([]);

    // Plays a base64-encoded WAV clip the backend sent back (Orpheus's spoken reply).
    const playAudio = (base64Wav) => {
        const audio = new Audio(`data:audio/wav;base64,${base64Wav}`); // a "data URL" — the audio bytes encoded directly into the URL string itself, no separate file needed
        audio.play().catch(() => {}); // autoplay can be blocked by the browser in rare cases — fail silently rather than crash the page over it
    };

    // ── Starts a brand new conversation: asks the backend for an opening line ──
    const startConversation = async () => {
        setErrorMsg("");
        setIsProcessing(true);
        try {
            const res = await api.get("/speaking/start");
            setConversation([{ role: "assistant", content: res.data.replyText }]);
            setVocabWords(res.data.vocabWords || []);
            setHasStarted(true);
            playAudio(res.data.replyAudioBase64);
            // Stash the full history object the backend gave us — NOT just the display text —
            // since the next /turn call needs the exact same shape back. Kept in a ref instead
            // of state because it's never rendered directly, only read/sent.
            historyRef.current = res.data.history;
        } catch (err) {
            setErrorMsg(err.response?.data?.message || "Couldn't start the conversation.");
        } finally {
            setIsProcessing(false);
        }
    };

    // Small helper purely so the recorder's callback below doesn't get too long —
    // pushes one chunk of recorded audio into the ref array.
    const pushAudioChunk = (chunk) => {
        audioChunksRef.current.push(chunk);
    };

    // ── Begins recording your microphone ──
    const startRecording = async () => {
        setErrorMsg("");
        try {
            // getUserMedia is what actually triggers the browser's "allow microphone access?"
            // permission prompt (only on the very first use) and hands back a live audio stream.
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // MediaRecorder captures that raw stream into a compressed audio file as you talk —
            // this is different from VoiceAssistant's SpeechRecognition, which transcribes
            // in-browser instead of giving us the actual audio. Here we WANT the raw audio,
            // since it's Groq's Whisper model (not the browser) doing the transcription.
            const recorder = new MediaRecorder(stream);
            audioChunksRef.current = []; // clear out any leftover data from a previous recording

            // Fires periodically (and at least once, at the end) with a piece of the recording.
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

    // ── Stops recording, then sends the clip to the backend and plays the reply ──
    const stopRecording = () => {
        const recorder = mediaRecorderRef.current;
        if (!recorder) return;

        // onstop fires once all the recorded audio data has been collected — this is where
        // we actually build the file and send it, not immediately after calling .stop().
        recorder.onstop = async () => {
            // Release the microphone properly — without this, the browser's "mic is
            // recording" indicator (and the OS-level mic light on some laptops) stays on.
            streamRef.current.getTracks().forEach((track) => track.stop());

            // Combine every chunk collected during the recording into one audio file.
            // MediaRecorder's default output format is webm — Groq's Whisper API accepts
            // it directly, so no conversion step is needed here.
            const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

            setIsProcessing(true);
            try {
                // FormData is the browser's way of building a multipart/form-data request —
                // required here because we're sending a binary file, not plain JSON.
                const formData = new FormData();
                formData.append("audio", audioBlob, "recording.webm");
                formData.append("history", JSON.stringify(historyRef.current));

                // NOTE: we deliberately don't set a Content-Type header ourselves — the
                // browser sets it automatically (including the required multipart boundary)
                // when it sees the body is a FormData object. Setting it by hand is a common
                // mistake that actually BREAKS the upload.
                const res = await api.post("/speaking/turn", formData);

                // Update the on-screen transcript with both sides of this exchange.
                setConversation((prev) => [
                    ...prev,
                    { role: "user", content: res.data.userText || "(didn't catch that)" },
                    { role: "assistant", content: res.data.replyText }
                ]);
                historyRef.current = res.data.history; // ready for the NEXT turn
                playAudio(res.data.replyAudioBase64);
            } catch (err) {
                setErrorMsg(err.response?.data?.message || "Something went wrong sending that.");
            } finally {
                setIsProcessing(false);
            }
        };

        recorder.stop();
        setIsRecording(false);
    };

    // Safety net: if the user navigates away mid-recording, make sure the mic actually
    // turns off instead of continuing to record in the background.
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop());
            }
        };
    }, []);

    const micSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

    return (
        <AppLayout>
            <div style={{ maxWidth: 640, margin: "0 auto", padding: "24px 16px" }}>
                <h1>Speaking Practice</h1>
                <p style={{ color: "var(--text-2)" }}>
                    Have an open conversation with an AI coach — it replies out loud, gently
                    models correct grammar, and tries to work your saved words into the chat.
                </p>

                {!micSupported && (
                    <div style={{ padding: 16, border: "1px solid var(--accent)", borderRadius: 8 }}>
                        Your browser doesn't support audio recording. Try Chrome or Edge.
                    </div>
                )}

                {micSupported && !hasStarted && (
                    <button className="btn btn-primary" style={{ fontSize: 18, padding: "14px 28px" }} onClick={startConversation} disabled={isProcessing}>
                        {isProcessing ? "Starting…" : "Start Conversation"}
                    </button>
                )}

                {/* Rendered regardless of hasStarted, so a failed startConversation call
                    (which never flips hasStarted to true) is actually visible instead of
                    silently reverting the button back to "Start Conversation". */}
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
