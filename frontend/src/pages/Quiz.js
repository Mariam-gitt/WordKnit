import { useEffect, useState } from "react";
import api from "../api";
import AppLayout from "../components/AppLayout";

function Quiz() {
    const [quiz, setQuiz]         = useState(null);
    const [score, setScore]       = useState(0);
    const [total, setTotal]       = useState(0);
    const [answered, setAnswered] = useState(false);
    const [selected, setSelected] = useState(null);
    const [error, setError]       = useState("");
    const [streak, setStreak]     = useState(0);
    const [askedIds, setAskedIds]           = useState([]);    // NEW: ids of words already asked this round (starts empty)
    const [roundComplete, setRoundComplete] = useState(false); // NEW: true once every word has been asked
    const [statusNote, setStatusNote] = useState("");           // NEW: small message after an answer, e.g. "now marked as learned" (empty = nothing to say)

    useEffect(() => { loadQuiz([]); }, []);                        // NEW: first load sends an empty list because nothing has been asked yet

    const loadQuiz = async (excludeIds) => {                       // NEW: excludeIds = already-asked word ids, passed in by whoever calls us
        try {                                                      // try/catch so a failed request shows a message instead of breaking the page
            setError(""); setQuiz(null); setAnswered(false); setSelected(null); setStatusNote(""); // reset the screen for the next question (NEW: also clear the status message)
            const res = await api.get("/words/quiz", {             // browser → server: ask for the next question
                params: { exclude: excludeIds.join(",") }          // NEW: params = what goes after "?" in the URL, so [a,b] becomes /words/quiz?exclude=a,b
            });
            if (res.data.roundComplete) {                          // NEW: server → browser: "no words left to ask"
                setRoundComplete(true);                            // NEW: switch to the "round finished" screen
                setTotal(t => t + 1);                              // NEW: keeps the existing "total - 1" accuracy maths right on the final screen
                return;                                            // NEW: stop here, there is no question to show
            }
            setQuiz(res.data);                                     // show the question
            setAskedIds(prev => [...prev, res.data.wordId]);       // NEW: add this word to the asked list ([...prev, x] = copy of the old list plus one new item)
            setTotal(t => t + 1);                                  // count the question
        } catch (err) {
            setError(err.response?.data?.message || "Not enough words yet — add at least 4 words to start quizzing.");
        }
    };

    const checkAnswer = (opt) => {
        if (answered) return;
        setSelected(opt);
        const correct = opt === quiz.correctAnswer;
        if (correct) { setScore(s => s + 1); setStreak(s => s + 1); }
        else { setStreak(0); }
        setAnswered(true);
        saveResult(opt);                                           // NEW: tell the server which option was picked so it can save the result
    };

    // NEW: browser → server: save this answer on the word's scorecard (right/wrong counts, streak, learned status)
    const saveResult = async (opt) => {                            // opt = the option text the user clicked
        try {                                                      // try/catch so a failed save never breaks the quiz
            const res = await api.post(`/words/${quiz.wordId}/review`, { // POST = send data; quiz.wordId = which word this question was about
                mode: "quiz",                                      // tells the server this is a quiz answer (not a flashcard)
                selected: opt                                      // the option the user picked; the SERVER decides if it was right
            });
            if (res.data.becameLearned) {                          // server → browser: this answer just made the word "learned"
                setStatusNote(`🎉 "${quiz.word}" is now marked as learned!`);
            } else if (res.data.backToReview) {                    // server → browser: a wrong answer sent a learned word back to review
                setStatusNote(`"${quiz.word}" moved back to Review.`);
            }
        } catch (err) {                                            // saving failed (network, expired login, ...)
            console.log("Could not save quiz result:", err.message); // just log it; the quiz itself keeps working
        }
    };

    const getClass = (opt) => {
        if (!answered) return "quiz-option";
        if (opt === quiz.correctAnswer) return "quiz-option correct";
        if (opt === selected) return "quiz-option wrong";
        return "quiz-option";
    };

    const pct = total > 1 ? Math.round((score / (total - 1)) * 100) : 0;

    return (
        <AppLayout>
                <div className="page-container" style={{ maxWidth: "620px" }}>

                    <div className="page-header">
                        <h1>Quiz</h1>
                        <p>Test your vocabulary knowledge.</p>
                    </div>

                    {/* Score row */}
                    <div className="stats-row" style={{ marginBottom: "28px" }}>
                        <div className="stat-card">
                            <div className="stat-number" style={{ color: "var(--green)" }}>{score}</div>
                            <div className="stat-label">Correct</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-number">
                                {total > 1 ? total - 1 - score : 0}
                            </div>
                            <div className="stat-label">Wrong</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-number">{streak}</div>
                            <div className="stat-label">Streak 🔥</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-number">{total > 1 ? `${pct}%` : "—"}</div>
                            <div className="stat-label">Accuracy</div>
                        </div>
                    </div>

                    {/* Error state */}
                    {error && (
                        <div style={{ textAlign: "center" }}>
                            <div className="empty-state">
                                <div className="emoji">◈</div>
                                <p style={{ marginBottom: "16px" }}>{error}</p>
                                <button className="btn btn-ghost" onClick={() => loadQuiz(askedIds)} style={{ width: "auto" }}>
                                    Try again
                                </button>
                            </div>
                        </div>
                    )}

                    {/* NEW: Round complete — shown when every word has been asked once */}
                    {roundComplete && (
                        <div className="empty-state" style={{ textAlign: "center" }}>
                            <div className="emoji">🎉</div>
                            <p style={{ marginBottom: "16px" }}>
                                You went through all {askedIds.length} of your words! You got {score} right.
                            </p>
                            <button
                                className="btn btn-primary"
                                style={{ width: "auto" }}
                                onClick={() => {                   // runs when "Start again" is clicked
                                    setAskedIds([]);               // clear the asked list = brand new round
                                    setRoundComplete(false);       // hide this screen
                                    setScore(0); setTotal(0); setStreak(0); // fresh score for the new round
                                    loadQuiz([]);                  // fetch the first question with an empty asked list
                                }}>
                                Start again
                            </button>
                        </div>
                    )}

                    {/* Loading */}
                    {!error && !quiz && !roundComplete && (
                        <div style={{ textAlign: "center", padding: "50px" }}>
                            <div className="loading-dots"><span/><span/><span/></div>
                        </div>
                    )}

                    {/* Quiz card */}
                    {quiz && (
                        <>
                            <div className="quiz-card">
                                <p className="quiz-instruction" style={{ marginBottom: "10px" }}>
                                    What does this word mean?
                                </p>
                                <div className="quiz-word">"{quiz.word}"</div>
                            </div>

                            <div className="quiz-options">
                                {quiz.options.map((opt, i) => (
                                    <div key={i}>
                                        <button
                                            className={getClass(opt)}
                                            onClick={() => checkAnswer(opt)}
                                            disabled={answered}>
                                            <span style={{
                                                display: "inline-block",
                                                width: "22px",
                                                fontWeight: 700,
                                                color: "var(--text-3)",
                                                flexShrink: 0
                                            }}>
                                                {["A", "B", "C", "D"][i]}.
                                            </span>
                                            {opt}
                                        </button>
                                        {answered && opt !== quiz.correctAnswer && quiz.reasons?.[opt] && (
                                            <p className="quiz-option-reason">
                                                ↳ {quiz.reasons[opt]}
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {answered && (
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    marginTop: "16px",
                                    padding: "14px 18px",
                                    border: `2px solid ${selected === quiz.correctAnswer ? "var(--green)" : "var(--accent)"}`,
                                    background: selected === quiz.correctAnswer ? "#e8f5e9" : "var(--accent-bg)"
                                }}>
                                    <span style={{
                                        fontSize: "1.3rem",
                                        flexShrink: 0
                                    }}>
                                        {selected === quiz.correctAnswer ? "✓" : "✗"}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <p style={{
                                            fontWeight: 700,
                                            fontSize: "0.85rem",
                                            color: selected === quiz.correctAnswer ? "var(--green)" : "var(--accent)",
                                            textTransform: "uppercase",
                                            letterSpacing: "0.07em"
                                        }}>
                                            {selected === quiz.correctAnswer ? "Correct!" : "Incorrect"}
                                        </p>
                                        {selected !== quiz.correctAnswer && (
                                            <p style={{ fontSize: "0.82rem", color: "var(--text-2)", marginTop: "3px" }}>
                                                Correct meaning: {quiz.correctAnswer}
                                            </p>
                                        )}
                                        {streak > 1 && selected === quiz.correctAnswer && (
                                            <p style={{ fontSize: "0.8rem", color: "var(--green)", marginTop: "3px" }}>
                                                {streak} in a row! 🔥
                                            </p>
                                        )}
                                        {statusNote && (                                           /* NEW: shows the "learned" / "back to review" message */
                                            <p style={{ fontSize: "0.8rem", color: "var(--text-2)", marginTop: "3px" }}>
                                                {statusNote}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => loadQuiz(askedIds)}
                                        style={{ width: "auto", flexShrink: 0 }}
                                    >
                                        Next →
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
        </AppLayout>
    );
}

export default Quiz;
