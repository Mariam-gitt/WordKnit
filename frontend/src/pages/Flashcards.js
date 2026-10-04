import { useEffect, useState } from "react"; // state for the deck and a load-on-open effect
import { TbCards, TbChevronLeft, TbChevronRight } from "react-icons/tb"; // icons
import api from "../api"; // shared axios instance
import AppLayout from "../components/AppLayout"; // the page frame
import { PageHeader, Button, IconButton, EmptyState } from "../components/ui"; // shared UI kit

// Flip-card practice. After flipping, you rate yourself; the rating is saved on the word's scorecard.
function Flashcards() {
    const [words, setWords] = useState([]);          // the deck
    const [index, setIndex] = useState(0);           // which card is showing
    const [flipped, setFlipped] = useState(false);   // is the card showing its back?
    const [saving, setSaving] = useState(false);     // true while a rating is being sent (prevents double counting)
    const [statusNote, setStatusNote] = useState(""); // e.g. "now marked as learned"

    useEffect(() => { api.get("/words").then((res) => setWords(res.data)).catch(console.log); }, []); // load the deck once

    if (words.length === 0) return (
        <AppLayout>
            <div className="page page--narrow">
                <PageHeader title="Flashcards" subtitle="Flip each card, then rate how well you knew it." />
                <EmptyState icon={<TbCards size={28} />}>Add some words first to start reviewing.</EmptyState>
            </div>
        </AppLayout>
    );

    const word = words[index]; // the current card's word

    // Flip back first, then change card after the flip animation (150 ms) so the new answer is never glimpsed.
    const go = (step) => { setFlipped(false); setTimeout(() => setIndex((p) => (p + step + words.length) % words.length), 150); };

    // "I knew it" (known = true) or "Still learning" (known = false): browser → server, then on to the next card.
    const rateCard = async (known) => {
        if (saving) return; // ignore double clicks
        setSaving(true);
        try {
            const res = await api.post(`/words/${word._id}/review`, { mode: "flashcard", known });
            if (res.data.becameLearned) setStatusNote(`"${word.word}" is now marked as learned.`);
            else if (res.data.backToReview) setStatusNote(`"${word.word}" moved back to Review.`);
            else setStatusNote("");
        } catch (err) { console.log("Could not save flashcard result:", err.message); }
        finally { setSaving(false); }
        go(1); // next card automatically
    };

    return (
        <AppLayout>
            <div className="page page--narrow">
                <PageHeader title="Flashcards" subtitle="Flip each card, then rate how well you knew it." />

                <div className="flashcard" onClick={() => { setFlipped(!flipped); setStatusNote(""); }}>
                    <div className={`flashcard-inner${flipped ? " is-flipped" : ""}`}>
                        <div className="flashcard-face">
                            <h2>{word.word}</h2>
                            <p className="note">Click to reveal the meaning</p>
                        </div>
                        <div className="flashcard-face flashcard-back">
                            <p className="flashcard-meaning">{word.meaning}</p>
                            {word.exampleSentence && word.exampleSentence !== "No example available" && (
                                <p className="word-example">"{word.exampleSentence}"</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Rating buttons appear only after flipping, so you rate yourself AFTER seeing the meaning */}
                <div className="rate-row">
                    {flipped && (
                        <>
                            <Button onClick={() => rateCard(false)} disabled={saving}>Still learning</Button>
                            <Button variant="primary" onClick={() => rateCard(true)} disabled={saving}>I knew it</Button>
                        </>
                    )}
                </div>

                <div className="deck-nav">
                    <IconButton label="Previous card" onClick={() => go(-1)}><TbChevronLeft size={20} /></IconButton>
                    <span className="note">{index + 1} / {words.length}</span>
                    <IconButton label="Next card" onClick={() => go(1)}><TbChevronRight size={20} /></IconButton>
                </div>

                {statusNote && <p className="note deck-note">{statusNote}</p>}
            </div>
        </AppLayout>
    );
}

export default Flashcards;
