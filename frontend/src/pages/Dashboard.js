import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import AppLayout from "../components/AppLayout";
import AddWord from "../components/AddWord";
import { TbMicrophone, TbFileSearch, TbX } from "react-icons/tb"; // NEW: clean line icons used on the action tiles and the close buttons

function Dashboard() {
    const navigate = useNavigate();
    const [words, setWords]                   = useState([]);
    const [newWordProfile, setNewWordProfile] = useState(null);
    const [loadingProfile, setLoadingProfile] = useState(false);
    const [diffWords, setDiffWords]           = useState([]);
    const [diffAnalyzing, setDiffAnalyzing]   = useState(false);
    const [diffAdded, setDiffAdded]           = useState(new Set());
    const [diffMsg, setDiffMsg]               = useState("");
    const [diffStats, setDiffStats]           = useState(null);
    const [diffTruncated, setDiffTruncated]   = useState(false);

    const [diffOpen, setDiffOpen]           = useState(false); // NEW: is the "difficult words" pop-up open? (results open in a pop-up so the page never grows taller)

    const diffRef = useRef();

    // NEW: pressing Escape closes whichever pop-up is open (a standard expectation for pop-ups)
    useEffect(() => {
        const onKey = (e) => {                                   // runs on every key press while this page is open
            if (e.key !== "Escape") return;                      // ignore every key except Escape
            setDiffOpen(false);                                  // close the difficult-words pop-up
            if (!loadingProfile) setNewWordProfile(null);        // close the word-profile pop-up (but not while it is still loading)
        };
        window.addEventListener("keydown", onKey);               // start listening
        return () => window.removeEventListener("keydown", onKey); // stop listening when leaving the page (clean-up)
    }, [loadingProfile]);

    const fetchWords = async () => { try { const r = await api.get("/words"); setWords(r.data); } catch {} };
    useEffect(() => { fetchWords(); }, []);

    const handleWordAdded = async (word) => {
        fetchWords();
        setLoadingProfile(true); setNewWordProfile(null);
        try { const r = await api.get(`/profile/${word}`); setNewWordProfile(r.data); }
        catch {} finally { setLoadingProfile(false); }
    };

    const handleDifficultyAnalyze = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 20 * 1024 * 1024) {
            setDiffMsg("PDF is too large. Please upload a file under 20MB.");
            diffRef.current.value = "";
            return;
        }
        setDiffAnalyzing(true);
        setDiffWords([]); setDiffAdded(new Set());
        setDiffMsg(""); setDiffStats(null); setDiffTruncated(false);
        const fd = new FormData(); fd.append("pdf", file);
        try {
            const r = await api.post("/pdf/analyze-difficulty", fd, {
                headers: { "Content-Type": "multipart/form-data" }
            });
            const found = r.data.words || [];
            setDiffWords(found);
            setDiffStats(r.data.pdfStats || null);
            setDiffTruncated(!!r.data.truncated);
            if (found.length) setDiffOpen(true);                  // NEW: show the results in the pop-up
            if (!found.length) setDiffMsg("No difficult words found — try a longer academic PDF.");
        } catch (err) {
            setDiffMsg(err.response?.data?.message || "Analysis failed. Make sure the PDF has selectable text (not a scanned image).");
        } finally {
            setDiffAnalyzing(false);
            diffRef.current.value = "";
        }
    };

    const addDifficultWord = async (word) => {
        if (diffAdded.has(word)) return;
        try {
            await api.post("/words", { word });
            setDiffAdded(prev => new Set([...prev, word]));
            fetchWords();
        } catch { alert(`Could not add "${word}"`); }
    };

    const addAllDiffWords = async () => {
        for (const w of diffWords) {
            if (!diffAdded.has(w)) await addDifficultWord(w);
        }
    };

    const learnedCount = words.filter(w => w.status === "learned").length;

    return (
        // showBrand: asks the layout to show the WordKnit name at the top of this page, not only in the sidebar (parent → child prop)
        <AppLayout statusCount={words.length} showBrand>
                <div className="page-container page-container--compact">

                    <div className="page-header">
                        <h1>Dashboard</h1>
                        <p>Your vocabulary at a glance.</p>
                    </div>

                    {/* Stats */}
                    <div className="stats-row">
                        <div className="stat-card">
                            <div className="stat-number">{words.length}</div>
                            <div className="stat-label">Total words</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-number" style={{ color: "var(--green)" }}>{learnedCount}</div>
                            <div className="stat-label">Learned</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-number">{words.length - learnedCount}</div>
                            <div className="stat-label">To review</div>
                        </div>
                    </div>

                    {/* NEW: one row with everything you do most — add a word, speaking practice, difficult words.
                        AddWord (child) tells this page (parent) about a new word through the onWordAdded callback (child → parent). */}
                    <div className="dashboard-actions">
                        <AddWord onWordAdded={handleWordAdded} />
                        <button className="action-tile" onClick={() => navigate("/speaking")}>
                            <span className="action-tile-icon"><TbMicrophone size={18} /></span>
                            <span>
                                <span className="action-tile-title">Speaking</span>
                                <span className="action-tile-sub">Talk to the coach</span>
                            </span>
                        </button>
                        <button
                            className="action-tile"
                            onClick={() => diffRef.current.click()}   // opens the hidden file picker below
                            disabled={diffAnalyzing}                  // greyed out while a PDF is being analysed
                        >
                            <span className="action-tile-icon"><TbFileSearch size={18} /></span>
                            <span>
                                <span className="action-tile-title">Difficult words</span>
                                <span className="action-tile-sub">{diffAnalyzing ? "Analysing…" : "Scan a PDF"}</span>
                            </span>
                        </button>
                    </div>
                    <input
                        ref={diffRef}
                        type="file"
                        accept=".pdf"
                        style={{ display: "none" }}
                        onChange={handleDifficultyAnalyze}
                    />

                    {/* Short message after a scan (for example "No difficult words found") */}
                    {diffMsg && <p className="dashboard-note">{diffMsg}</p>}

                    {/* Recently added — just the single latest word, so the dashboard stays a quick glance. */}
                    {words.length > 0 && (
                        <div>
                            <div className="dashboard-recent-header">
                                <p className="section-title">Recently added</p>
                                {words.length > 1 && (
                                    <button className="dashboard-link" onClick={() => navigate("/vocabulary")}>
                                        View all {words.length} words
                                    </button>
                                )}
                            </div>
                            <div className="word-list">
                                {words.slice(0, 1).map(w => (
                                    <div key={w._id} className="word-card">
                                        <div className="word-card-top">
                                            <h3
                                                className="word-card-word-link"
                                                onClick={() => navigate(`/profile/${encodeURIComponent(w.word)}`)}
                                            >
                                                {w.word}
                                            </h3>
                                            <span className={`status-btn ${w.status === "learned" ? "learned" : "review"}`}>
                                                {w.status === "learned" ? "✓ Learned" : "Review"}
                                            </span>
                                        </div>
                                        <p className="meaning">{w.partOfSpeech && <em>({w.partOfSpeech}) </em>}{w.meaning}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>

                {/* NEW: Difficult words results — a pop-up over the page instead of a panel that pushes everything down. */}
                {diffOpen && diffWords.length > 0 && (
                    <div className="modal-backdrop" onClick={() => setDiffOpen(false)}>
                        <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Difficult words">
                            <div className="modal-header">
                                <div>
                                    <h3>{diffWords.length} difficult words found</h3>
                                    {diffStats && (
                                        <p className="modal-sub">
                                            {diffStats.pages > 0 ? `${diffStats.pages} pages · ` : ""}
                                            {diffStats.totalTokens?.toLocaleString()} tokens · {diffStats.uniqueWords?.toLocaleString()} unique words scanned
                                        </p>
                                    )}
                                    {diffTruncated && diffStats && (
                                        <p className="modal-sub" style={{ color: "var(--accent)" }}>
                                            Large PDF — only analysed the first {diffStats.pagesAnalyzed} of {diffStats.pages} pages
                                        </p>
                                    )}
                                </div>
                                <div className="modal-header-actions">
                                    <button className="btn btn-primary btn-sm" style={{ width: "auto" }} onClick={addAllDiffWords}>
                                        Add all
                                    </button>
                                    <button className="modal-close" aria-label="Close" onClick={() => setDiffOpen(false)}><TbX size={16} /></button>
                                </div>
                            </div>
                            <div className="modal-body">
                                <p className="modal-sub" style={{ marginBottom: "12px" }}>
                                    Ranked by difficulty — length, academic patterns, rarity in this document.
                                    Click a word to add it to your vocabulary.
                                </p>
                                {diffWords.map(w => (
                                    <span
                                        key={w}
                                        className={`difficult-word-chip ${diffAdded.has(w) ? "added" : ""}`}
                                        onClick={() => !diffAdded.has(w) && addDifficultWord(w)}
                                    >
                                        {w}
                                        <span className="chip-badge">
                                            {diffAdded.has(w) ? "✓" : "+ Add"}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* NEW: the new word's profile preview — also a pop-up now (it used to appear inside the page and push the dashboard down). */}
                {(loadingProfile || newWordProfile) && (
                    <div className="modal-backdrop" onClick={() => !loadingProfile && setNewWordProfile(null)}>
                        <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Word profile">
                            {loadingProfile && (
                                <div className="modal-body" style={{ textAlign: "center", padding: "36px 20px" }}>
                                    <div className="loading-dots"><span/><span/><span/></div>
                                    <p style={{ color: "var(--text-2)", marginTop: "10px", fontSize: "0.85rem" }}>
                                        Building word profile…
                                    </p>
                                </div>
                            )}
                            {newWordProfile && !loadingProfile && (
                                <>
                                    <div className="modal-header">
                                        <h3>{newWordProfile.word}</h3>
                                        <button className="modal-close" aria-label="Close" onClick={() => setNewWordProfile(null)}><TbX size={16} /></button>
                                    </div>
                                    <div className="modal-body">
                                        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "13px", flexWrap: "wrap" }}>
                                            {newWordProfile.partOfSpeech && <span className="profile-pos">{newWordProfile.partOfSpeech}</span>}
                                            {newWordProfile.pronunciation && <span className="profile-phonetic">{newWordProfile.pronunciation}</span>}
                                            {newWordProfile.audio && (
                                                <button className="profile-audio-btn" onClick={() => new Audio(newWordProfile.audio).play()}>▶ Listen</button>
                                            )}
                                        </div>
                                        {newWordProfile.definitions?.[0] && (
                                            <div className="profile-main-def" style={{ marginBottom: "14px" }}>
                                                {newWordProfile.definitions[0].definition}
                                            </div>
                                        )}
                                        {newWordProfile.memoryHook && (
                                            <div style={{
                                                borderLeft: "4px solid var(--accent)", padding: "10px 14px",
                                                background: "var(--surface)", fontStyle: "italic",
                                                fontSize: "0.87rem", lineHeight: "1.65"
                                            }}>
                                                🧠 {newWordProfile.memoryHook}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
        </AppLayout>
    );
}

export default Dashboard;
