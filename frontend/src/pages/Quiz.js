import { useEffect, useState } from "react"; // state for the question and score, and a load-on-open effect
import { TbListCheck, TbTrophy } from "react-icons/tb"; // icons for the empty and finished states
import api from "../api"; // shared axios instance
import AppLayout from "../components/AppLayout"; // the page frame
import { PageHeader, Stat, Button, EmptyState } from "../components/ui"; // shared UI kit

// The multiple-choice quiz. Each answer is sent to the server, which decides if it was right
// and updates that word's scorecard (right/wrong counts, streak, learned status).
function Quiz() {
    const [quiz, setQuiz] = useState(null);                 // the current question from the server
    const [score, setScore] = useState(0);                  // right answers this round
    const [done, setDone] = useState(0);                    // answers given this round
    const [streak, setStreak] = useState(0);                // right answers in a row
    const [answered, setAnswered] = useState(false);        // has the current question been answered?
    const [selected, setSelected] = useState(null);         // the option the user picked
    const [error, setError] = useState("");                 // message when a question can't be loaded
    const [askedIds, setAskedIds] = useState([]);           // ids of words already asked this round (so none repeat)
    const [roundComplete, setRoundComplete] = useState(false); // true once every word was asked
    const [statusNote, setStatusNote] = useState("");       // e.g. "now marked as learned"

    useEffect(() => { loadQuiz([]); }, []); // first question: nothing asked yet

    // Ask the server for the next question, sending the ids already asked (browser → server).
    const loadQuiz = async (excludeIds) => {
        try {
            setError(""); setQuiz(null); setAnswered(false); setSelected(null); setStatusNote(""); // reset the screen
            const res = await api.get("/words/quiz", { params: { exclude: excludeIds.join(",") } }); // /words/quiz?exclude=a,b
            if (res.data.roundComplete) { setRoundComplete(true); return; } // server → browser: no words left to ask
            setQuiz(res.data); // show the question
            setAskedIds((prev) => [...prev, res.data.wordId]); // cross this word off for the rest of the round
        } catch (err) {
            setError(err.response?.data?.message || "Not enough words yet. Add at least 4 words to start quizzing.");
        }
    };

    // The user clicked an option: colour it right away, then save the result on the server.
    const checkAnswer = (opt) => {
        if (answered) return; // one answer per question
        setSelected(opt);
        setDone((d) => d + 1);
        if (opt === quiz.correctAnswer) { setScore((s) => s + 1); setStreak((s) => s + 1); } else { setStreak(0); }
        setAnswered(true);
        saveResult(opt);
    };

    // browser → server: the SERVER decides if the pick was right and updates the word's scorecard.
    const saveResult = async (opt) => {
        try {
            const res = await api.post(`/words/${quiz.wordId}/review`, { mode: "quiz", selected: opt });
            if (res.data.becameLearned) setStatusNote(`"${quiz.word}" is now marked as learned.`);       // 3 right in a row
            else if (res.data.backToReview) setStatusNote(`"${quiz.word}" moved back to Review.`);       // a wrong answer
        } catch (err) { console.log("Could not save quiz result:", err.message); } // never break the quiz
    };

    const restart = () => { // "Start again": a fresh round with a fresh score
        setAskedIds([]); setRoundComplete(false); setScore(0); setDone(0); setStreak(0);
        loadQuiz([]);
    };

    const optionClass = (opt) => { // colour the options after answering
        if (!answered) return "option";
        if (opt === quiz.correctAnswer) return "option option--correct";
        if (opt === selected) return "option option--wrong";
        return "option";
    };
    const wasRight = selected === quiz?.correctAnswer;

    return (
        <AppLayout>
            <div className="page page--narrow">
                <PageHeader title="Quiz" subtitle="Pick the right meaning for each word." />

                <div className="stats">
                    <Stat label="Correct" value={score} tone="green" />
                    <Stat label="Wrong" value={done - score} />
                    <Stat label="Streak" value={streak} />
                    <Stat label="Accuracy" value={done ? `${Math.round((score / done) * 100)}%` : "—"} />
                </div>

                <div className="stack-gap">
                    {error && (
                        <EmptyState icon={<TbListCheck size={28} />} action={<Button onClick={() => loadQuiz(askedIds)}>Try again</Button>}>{error}</EmptyState>
                    )}

                    {roundComplete && (
                        <EmptyState icon={<TbTrophy size={28} />} action={<Button variant="primary" onClick={restart}>Start again</Button>}>
                            You went through all {askedIds.length} of your words and got {score} right.
                        </EmptyState>
                    )}

                    {!error && !quiz && !roundComplete && <div className="loading"><span /><span /><span /></div>}

                    {quiz && (
                        <>
                            <div className="card quiz-card">
                                <p className="note">What does this word mean?</p>
                                <div className="quiz-word">{quiz.word}</div>
                            </div>

                            <div className="options">
                                {quiz.options.map((opt, i) => (
                                    <div key={i}>
                                        <button className={optionClass(opt)} onClick={() => checkAnswer(opt)} disabled={answered}>
                                            <span className="option-letter">{["A", "B", "C", "D"][i]}</span>
                                            {opt}
                                        </button>
                                        {answered && opt !== quiz.correctAnswer && quiz.reasons?.[opt] && (
                                            <p className="option-reason">{quiz.reasons[opt]}</p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {answered && (
                                <div className={`feedback ${wasRight ? "feedback--right" : "feedback--wrong"}`}>
                                    <div className="grow">
                                        <strong>{wasRight ? "Correct" : "Not quite"}</strong>
                                        {!wasRight && <p>The right meaning: {quiz.correctAnswer}</p>}
                                        {wasRight && streak > 1 && <p>{streak} in a row</p>}
                                        {statusNote && <p>{statusNote}</p>}
                                    </div>
                                    <Button variant="primary" onClick={() => loadQuiz(askedIds)}>Next</Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </AppLayout>
    );
}

export default Quiz;
