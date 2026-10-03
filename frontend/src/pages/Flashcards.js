import { useEffect, useState } from "react";
import api from "../api";
import AppLayout from "../components/AppLayout";

function Flashcards() {
    const [words, setWords] = useState([]);
    const [index, setIndex] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [saving, setSaving] = useState(false);                  // NEW: true while a rating is being sent, so a double click can't count twice
    const [statusNote, setStatusNote] = useState("");             // NEW: small message after rating, e.g. "now marked as learned" (empty = nothing to say)

    useEffect(() => {
        api.get("/words").then(res => setWords(res.data)).catch(console.log);
    }, []);

    if (words.length === 0) return (
        <AppLayout>
                <div className="page-container">
                    <div className="page-header"><h1>Flashcards</h1></div>
                    <div className="empty-state">
                        <div className="emoji">▣</div>
                        <p>Add some words first to start reviewing.</p>
                    </div>
                </div>
        </AppLayout>
    );

    const word = words[index];

    const nextCard = () => { setFlipped(false); setTimeout(() => setIndex(p => (p + 1) % words.length), 150); };
    const prevCard = () => { setFlipped(false); setTimeout(() => setIndex(p => (p - 1 + words.length) % words.length), 150); };

    // NEW: runs when the user taps "I knew it" (known = true) or "Still learning" (known = false)
    const rateCard = async (known) => {                            // known is a boolean: true or false
        if (saving) return;                                        // already sending a rating, ignore extra clicks
        setSaving(true);                                           // lock the buttons while we save
        try {                                                      // try/catch so a failed save never blocks the user
            const res = await api.post(`/words/${word._id}/review`, { // browser → server: POST = send data; word._id = which word this card is
                mode: "flashcard",                                 // tells the server this is a flashcard rating (not a quiz answer)
                known                                              // shorthand for known: known — the user's honest answer
            });
            if (res.data.becameLearned) {                          // server → browser: this rating just made the word "learned"
                setStatusNote(`🎉 "${word.word}" is now marked as learned!`);
            } else if (res.data.backToReview) {                    // server → browser: "still learning" sent a learned word back to review
                setStatusNote(`"${word.word}" moved back to Review.`);
            } else {                                               // nothing special happened
                setStatusNote("");                                 // clear any older message
            }
        } catch (err) {                                            // saving failed (network, expired login, ...)
            console.log("Could not save flashcard result:", err.message); // just log it; the user keeps studying
        } finally {                                                // runs whether the save worked or failed
            setSaving(false);                                      // unlock the buttons again
        }
        nextCard();                                                // move on to the next card automatically
    };

    return (
        <AppLayout>
                <div className="flashcard-page">
                    <div className="page-header" style={{ textAlign: "center", borderBottom: "2px solid var(--black)", marginBottom: "32px" }}>
                        <h2>Flashcards</h2>
                        <p className="subtitle">Click card to reveal meaning</p>
                    </div>

                    <div className="flashcard" onClick={() => { setFlipped(!flipped); setStatusNote(""); }}> {/* NEW: flipping a card also clears the old status message */}
                        <div className={`flashcard-inner ${flipped ? "flipped" : ""}`}>
                            <div className="flashcard-front">
                                <h1>{word.word}</h1>
                                <p className="hint">Click to reveal</p>
                            </div>
                            <div className="flashcard-back">
                                <p className="meaning">{word.meaning}</p>
                                {word.exampleSentence && word.exampleSentence !== "No example available" && (
                                    <p className="example">"{word.exampleSentence}"</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* NEW: rating buttons — only shown after the card is flipped, so you rate yourself AFTER seeing the meaning */}
                    {flipped && (                                              // false (hidden) until the card shows its back
                        <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginBottom: "20px" }}>
                            <button
                                className="btn btn-ghost"                      // existing outline button style
                                style={{ width: "auto" }}                      // don't stretch full width
                                disabled={saving}                              // greyed out while saving
                                onClick={() => rateCard(false)}                // "Still learning" = not known
                            >
                                ✗ Still learning
                            </button>
                            <button
                                className="btn btn-primary"                    // existing solid button style
                                style={{ width: "auto" }}
                                disabled={saving}
                                onClick={() => rateCard(true)}                 // "I knew it" = known
                            >
                                ✓ I knew it
                            </button>
                        </div>
                    )}

                    <div className="flashcard-controls">
                        <button className="btn btn-ghost" onClick={prevCard}>← Prev</button>
                        <span className="card-counter">{index + 1} / {words.length}</span>
                        <button className="btn btn-primary" onClick={nextCard} style={{ width: "auto" }}>Next →</button>
                    </div>

                    {statusNote && (                                           /* NEW: shows the "learned" / "back to review" message */
                        <p style={{ textAlign: "center", marginTop: "16px", fontSize: "0.85rem", color: "var(--text-2)" }}>
                            {statusNote}
                        </p>
                    )}
                </div>
        </AppLayout>
    );
}

export default Flashcards;
