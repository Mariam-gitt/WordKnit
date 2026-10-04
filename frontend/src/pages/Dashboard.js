import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import AppLayout from "../components/AppLayout";
import AddWord from "../components/AddWord";
import { TbMicrophone, TbFileSearch } from "react-icons/tb"; // line icons for the two action tiles
import { PageHeader, Stat, Button, Modal, Chip } from "../components/ui"; // shared UI kit

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

    const [diffOpen, setDiffOpen]           = useState(false); // is the difficult-words pop-up open? (results open in a pop-up so the page never grows)

    const diffRef = useRef();

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
            if (found.length) setDiffOpen(true);                  // show the results in the pop-up
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

    const learnedCount = words.filter((w) => w.status === "learned").length; // how many words are learned
    const latest = words[0]; // the backend sends newest first, so the first word is the latest one

    return (
        <AppLayout statusCount={words.length}>
            <div className="page page--wide-ish">
                <PageHeader title="Dashboard" subtitle="Your vocabulary at a glance." />

                <div className="stats">
                    <Stat label="Total words" value={words.length} />
                    <Stat label="Learned" value={learnedCount} tone="green" />
                    <Stat label="To review" value={words.length - learnedCount} />
                </div>

                {/* One row for the things you do most. AddWord (child) tells this page (parent) about a new word through onWordAdded. */}
                <div className="actions-row">
                    <AddWord onWordAdded={handleWordAdded} />
                    <button type="button" className="tile" onClick={() => navigate("/speaking")}>
                        <span className="tile-icon"><TbMicrophone size={18} /></span>
                        <span>
                            <span className="tile-title">Speaking</span>
                            <span className="tile-sub">Talk to the coach</span>
                        </span>
                    </button>
                    <button type="button" className="tile" onClick={() => diffRef.current.click()} disabled={diffAnalyzing}>
                        <span className="tile-icon"><TbFileSearch size={18} /></span>
                        <span>
                            <span className="tile-title">Difficult words</span>
                            <span className="tile-sub">{diffAnalyzing ? "Analysing…" : "Scan a PDF"}</span>
                        </span>
                    </button>
                </div>
                <input ref={diffRef} type="file" accept=".pdf" hidden onChange={handleDifficultyAnalyze} />
                {diffMsg && <p className="note dash-note">{diffMsg}</p>}

                {/* Recently added: just the single latest word */}
                {latest && (
                    <section>
                        <div className="section-head">
                            <h2>Recently added</h2>
                            {words.length > 1 && (
                                <button type="button" className="link-btn" onClick={() => navigate("/vocabulary")}>View all {words.length} words</button>
                            )}
                        </div>
                        <article className="word-row">
                            <div className="word-row-head">
                                <h3 className="word-title" onClick={() => navigate(`/profile/${encodeURIComponent(latest.word)}`)}>{latest.word}</h3>
                                {latest.partOfSpeech && <span className="word-pos">{latest.partOfSpeech}</span>}
                                <span className="grow" />
                                <Chip tone={latest.status === "learned" ? "learned" : "default"}>{latest.status === "learned" ? "✓ Learned" : "Review"}</Chip>
                            </div>
                            <p className="word-meaning">{latest.meaning}</p>
                            {latest.exampleSentence && latest.exampleSentence !== "No example available" && (
                                <p className="word-example">"{latest.exampleSentence}"</p>
                            )}
                        </article>
                    </section>
                )}
            </div>

            {/* Difficult words results: a pop-up (Radix Dialog) so the page never grows. */}
            <Modal
                open={diffOpen && diffWords.length > 0}
                onOpenChange={setDiffOpen}
                title={`${diffWords.length} difficult words found`}
                subtitle={diffStats ? `${diffStats.pages > 0 ? `${diffStats.pages} pages · ` : ""}${diffStats.totalTokens?.toLocaleString()} words scanned${diffTruncated ? ` · only the first ${diffStats.pagesAnalyzed} pages analysed` : ""}` : undefined}
                actions={<Button size="sm" variant="primary" onClick={addAllDiffWords}>Add all</Button>}
            >
                <p className="note chip-help">Ranked by difficulty. Click a word to add it to your vocabulary.</p>
                <div className="chip-cloud">
                    {diffWords.map((w) => (
                        <Chip key={w} tone={diffAdded.has(w) ? "learned" : "yellow"} onClick={() => !diffAdded.has(w) && addDifficultWord(w)}>
                            {w}{diffAdded.has(w) ? " ✓" : " +"}
                        </Chip>
                    ))}
                </div>
            </Modal>

            {/* The new word's quick profile preview, also a pop-up. */}
            <Modal
                open={loadingProfile || !!newWordProfile}
                onOpenChange={(open) => { if (!open && !loadingProfile) setNewWordProfile(null); }}
                title={newWordProfile ? newWordProfile.word : "Building word profile…"}
                subtitle={newWordProfile ? [newWordProfile.partOfSpeech, newWordProfile.pronunciation].filter(Boolean).join(" · ") : undefined}
                actions={newWordProfile ? <Button size="sm" variant="secondary" onClick={() => navigate(`/profile/${encodeURIComponent(newWordProfile.word)}`)}>Full profile</Button> : undefined}
            >
                {loadingProfile && <div className="loading"><span /><span /><span /></div>}
                {newWordProfile && !loadingProfile && (
                    <div>
                        {newWordProfile.definitions?.[0] && <p className="profile-def">{newWordProfile.definitions[0].definition}</p>}
                        {newWordProfile.memoryHook && <p className="hook">{newWordProfile.memoryHook}</p>}
                    </div>
                )}
            </Modal>
        </AppLayout>
    );
}

export default Dashboard;
