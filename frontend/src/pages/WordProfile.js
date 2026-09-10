
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api";
import AppLayout from "../components/AppLayout";

// ── In-memory profile cache to speed up re-visits ──
const profileCache = {};

function WordProfile() {
    const { word } = useParams();
    const navigate = useNavigate();
    const [profile, setProfile]       = useState(null);
    const [loading, setLoading]       = useState(true);
    const [error, setError]           = useState("");
    const [activeTab, setActiveTab]   = useState("overview");
    const [deleting, setDeleting]           = useState(false);
    const [deletingAccount, setDeletingAccount] = useState(false);
    const [wordInVocab, setWordInVocab] = useState(null);

    useEffect(() => { fetchAll(); }, [word]);

    const fetchAll = async () => {
        setLoading(true); setError(""); setActiveTab("overview");

        // If we have this word cached, show it immediately while we still check vocab
        if (profileCache[word]) {
            setProfile(profileCache[word]);
            setLoading(false);
        }

        // Fire profile + vocab fetch in parallel
        const [profileRes, vocabRes] = await Promise.allSettled([
            profileCache[word] ? Promise.resolve({ data: profileCache[word] }) : api.get(`/profile/${word}`),
            api.get("/words")
        ]);

        if (profileRes.status === "fulfilled") {
            const p = profileRes.value.data;
            profileCache[word] = p;   // cache it
            setProfile(p);
        } else {
            setError("Failed to load word profile.");
        }

        if (vocabRes.status === "fulfilled") {
            const match = vocabRes.value.data.find(w => w.word.toLowerCase() === word.toLowerCase());
            setWordInVocab(match || null);
        }

        setLoading(false);
    };

    const playAudio = () => {
        if (profile?.audio) new Audio(profile.audio).play().catch(() => {});
    };

    const handleDelete = async () => {
        if (!wordInVocab) return;
        if (!window.confirm(`Remove "${word}" from your vocabulary?`)) return;
        setDeleting(true);
        try {
            await api.delete(`/words/${wordInVocab._id}`);
            navigate("/vocabulary");
        } catch {
            alert("Failed to delete word.");
            setDeleting(false);
        }
    };

    const handleDeleteAccount = async () => {
        const confirmed = window.confirm(
            "⚠ Delete your account?\n\nThis will permanently remove your account, all saved words, all PDFs, and all bookmarks. This cannot be undone."
        );
        if (!confirmed) return;
        const doubleConfirm = window.confirm("Are you absolutely sure? All your data will be gone forever.");
        if (!doubleConfirm) return;

        setDeletingAccount(true);
        try {
            await api.delete("/auth/account");
            localStorage.removeItem("token");
            navigate("/");
        } catch {
            alert("Failed to delete account. Please try again.");
            setDeletingAccount(false);
        }
    };

    const handleAddToVocab = async () => {
        try {
            await api.post("/words", { word });
            const res = await api.get("/words");
            const match = res.data.find(w => w.word.toLowerCase() === word.toLowerCase());
            setWordInVocab(match || null);
        } catch { alert("Failed to add word."); }
    };

    // ── LOADING ──
    if (loading && !profile) return (
        <AppLayout>
                <div className="page-container">
                    <div className="profile-loading-state">
                        <div className="loading-dots"><span/><span/><span/></div>
                        <p style={{ marginTop: "16px", color: "var(--text-2)" }}>
                            Building profile for <strong>"{word}"</strong>…
                        </p>
                        <p style={{ fontSize: "0.76rem", color: "var(--text-3)", marginTop: "5px" }}>
                            Dictionary · Wikipedia · AI analysis
                        </p>
                    </div>
                </div>
        </AppLayout>
    );

    if (error) return (
        <AppLayout>
                <div className="page-container">
                    <div className="context-error">{error}</div>
                    <button className="btn btn-ghost" style={{ marginTop: "14px", width: "auto" }} onClick={() => navigate(-1)}>← Back</button>
                </div>
        </AppLayout>
    );

    if (!profile) return null;

    const tabs = [
        { id: "overview", label: "📖 Overview" },
        { id: "usage",    label: "✍️ Usage" },
        { id: "nuances",  label: "🔄 Nuances" },
        { id: "memory",   label: "🧠 Remember" },
        { id: "sources",  label: "🔗 Sources" },
    ];

    // Determine sources used
    const sourcesUsed = [];
    if (profile.definitions?.length > 0)
        sourcesUsed.push({ name: "Free Dictionary API", role: "Definitions, phonetics, audio, base synonyms", icon: "📖" });
    if (profile.academicSources?.some(s => s.type === "wikipedia"))
        sourcesUsed.push({ name: "Wikipedia", role: "Academic or contextual summary for notable words", icon: "🌐" });
    if (profile.synonymNuances?.length > 0 || profile.memoryHook)
        sourcesUsed.push({ name: "Groq AI — LLaMA 3.3 70B", role: "Synonym nuances, memory hook, rich usage examples", icon: "🤖" });
    if (profile.definitions?.some(d => d.source === "Custom Dictionary") || profile.definitions?.length === 0)
        sourcesUsed.push({ name: "RAG / Paul Nation Dictionary", role: "Academic word meanings from curated embedded dictionary", icon: "📚" });

    return (
        <AppLayout>
                <div className="page-container">

                    {/* Top bar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "22px" }}>
                        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ width: "auto" }}>
                            ← Back
                        </button>
                        <div style={{ display: "flex", gap: "8px" }}>
                            {wordInVocab ? (
                                <button className="btn btn-danger" onClick={handleDelete} disabled={deleting} style={{ width: "auto" }}>
                                    {deleting ? "Removing…" : "🗑 Remove"}
                                </button>
                            ) : (
                                <button className="btn btn-primary" onClick={handleAddToVocab} style={{ width: "auto" }}>
                                    + Add to Vocab
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Hero */}
                    <div className="profile-hero">
                        <h1 className="profile-word">{profile.word}</h1>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
                            {profile.partOfSpeech && <span className="profile-pos">{profile.partOfSpeech}</span>}
                            {profile.pronunciation && <span className="profile-phonetic">{profile.pronunciation}</span>}
                            {profile.audio && (
                                <button className="profile-audio-btn" onClick={playAudio}>🔊 Listen</button>
                            )}
                        </div>
                        <div style={{ marginTop: "12px", display: "flex", gap: "5px", flexWrap: "wrap" }}>
                            {sourcesUsed.map(s => (
                                <span key={s.name} className="source-badge" title={s.role}>
                                    {s.icon} {s.name}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Main definition */}
                    {profile.definitions[0] && (
                        <div className="profile-main-def">
                            {profile.definitions[0].definition}
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="profile-tabs">
                        {tabs.map(tab => (
                            <button key={tab.id}
                                className={`profile-tab ${activeTab === tab.id ? "active" : ""}`}
                                onClick={() => setActiveTab(tab.id)}>
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Tab content */}
                    <div className="profile-content">

                        {/* OVERVIEW */}
                        {activeTab === "overview" && (
                            <div>
                                {profile.definitions.map((def, i) => (
                                    <div key={i} className="profile-def-card">
                                        <span className="profile-pos-badge">{def.partOfSpeech}</span>
                                        <p className="profile-def-text">{def.definition}</p>
                                        {def.example && <p className="profile-def-example">"{def.example}"</p>}
                                        {def.synonyms?.length > 0 && (
                                            <div style={{ marginTop: "10px", display: "flex", gap: "5px", flexWrap: "wrap" }}>
                                                {def.synonyms.map(s => (
                                                    <span key={s} className="related-chip" onClick={() => navigate(`/profile/${s}`)}>{s}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* USAGE */}
                        {activeTab === "usage" && (
                            <div>
                                {profile.examples.length === 0 ? (
                                    <div className="empty-state"><p>No usage examples available.</p></div>
                                ) : (
                                    <div>
                                        {profile.examples.map((ex, i) => (
                                            <div key={i} className="profile-example-card">
                                                <span className="example-number">{i + 1}</span>
                                                <p dangerouslySetInnerHTML={{
                                                    __html: ex.replace(
                                                        new RegExp(`\\b(${profile.word}\\w*)\\b`, "gi"),
                                                        "<mark>$1</mark>"
                                                    )
                                                }} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* NUANCES */}
                        {activeTab === "nuances" && (
                            <div>
                                {!profile.synonymNuances?.length ? (
                                    <div className="empty-state"><p>No nuance data available.</p></div>
                                ) : (
                                    <div>
                                        <div className="nuance-card highlight-card">
                                            <div className="nuance-word">{profile.word} ★</div>
                                            <p className="nuance-def">{profile.definitions[0]?.definition}</p>
                                        </div>
                                        {profile.synonymNuances.map((s, i) => (
                                            <div key={i} className="nuance-card">
                                                <div className="nuance-word"
                                                    onClick={() => navigate(`/profile/${s.word}`)}
                                                    style={{ cursor: "pointer", textDecoration: "underline dotted" }}>
                                                    {s.word}
                                                </div>
                                                <p className="nuance-def">{s.nuance}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* MEMORY */}
                        {activeTab === "memory" && (
                            <div>
                                {!profile.memoryHook ? (
                                    <div className="empty-state"><p>No memory hook available.</p></div>
                                ) : (
                                    <div className="memory-card">
                                        <div style={{ fontSize: "2.2rem", marginBottom: "14px" }}>🧠</div>
                                        <h3 style={{ color: "#fff", marginBottom: "14px", fontSize: "1.2rem" }}>
                                            Remember "{profile.word}"
                                        </h3>
                                        <p className="memory-text">{profile.memoryHook}</p>
                                    </div>
                                )}
                                {profile.relatedWords?.length > 0 && (
                                    <div style={{ marginTop: "22px" }}>
                                        <p className="section-title">Related words</p>
                                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                            {profile.relatedWords.map(w => (
                                                <span key={w} className="related-chip" onClick={() => navigate(`/profile/${w}`)}>
                                                    {w} →
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SOURCES */}
                        {activeTab === "sources" && (
                            <div>
                                <div className="sources-info-box">
                                    <p className="section-title" style={{ marginBottom: "14px" }}>📡 How this profile was built</p>
                                    {sourcesUsed.length > 0 ? sourcesUsed.map(s => (
                                        <div key={s.name} className="source-pipeline-row">
                                            <span className="source-pipeline-icon">{s.icon}</span>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: "0.87rem" }}>{s.name}</div>
                                                <div style={{ fontSize: "0.79rem", color: "var(--text-2)", marginTop: "2px" }}>{s.role}</div>
                                            </div>
                                        </div>
                                    )) : <p style={{ fontSize: "0.85rem", color: "var(--text-2)" }}>Source data unavailable.</p>}
                                </div>

                                <div style={{ marginTop: "6px", marginBottom: "10px" }}>
                                    <p className="section-title" style={{ marginBottom: "4px" }}>💡 Source pipeline explained</p>
                                    <div style={{ fontSize: "0.82rem", color: "var(--text-2)", lineHeight: "1.7", padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)" }}>
                                        <strong>Step 1 — Free Dictionary API:</strong> First call for phonetics, audio, base definitions, and example sentences.<br/>
                                        <strong>Step 2 — Wikipedia API:</strong> If the word looks academic (long, complex suffix, or field-specific), Wikipedia is queried for a contextual summary.<br/>
                                        <strong>Step 3 — Groq AI:</strong> AI generates synonym nuances, a mnemonic memory hook, and richer usage examples in parallel.
                                    </div>
                                </div>

                                {profile.academicSources?.length > 0 && (
                                    <div style={{ marginTop: "16px" }}>
                                        <p className="section-title" style={{ marginBottom: "10px" }}>🌐 Reference content</p>
                                        {profile.academicSources.map((src, i) => (
                                            <div key={i} className="source-card">
                                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "7px", gap: "10px" }}>
                                                    <h3 style={{ fontSize: "0.97rem" }}>{src.title}</h3>
                                                    <span className="source-type-badge">{src.type === "wikipedia" ? "Wikipedia" : "AI"}</span>
                                                </div>
                                                <p style={{ fontSize: "0.85rem", color: "var(--text-2)", lineHeight: "1.65" }}>{src.summary}</p>
                                                {src.url && <a href={src.url} target="_blank" rel="noreferrer" className="source-read-link">Read full article →</a>}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="source-card" style={{ marginTop: "10px" }}>
                                    <p style={{ fontWeight: 600, marginBottom: "10px", fontSize: "0.85rem" }}>🔍 Search further</p>
                                    <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                                        {[
                                            { label: "Google Scholar", url: `https://scholar.google.com/scholar?q=${word}` },
                                            { label: "Merriam-Webster", url: `https://www.merriam-webster.com/dictionary/${word}` },
                                            { label: "Etymology", url: `https://www.etymonline.com/search?q=${word}` },
                                            { label: "Thesaurus", url: `https://www.thesaurus.com/browse/${word}` },
                                        ].map(link => (
                                            <a key={link.label} href={link.url} target="_blank" rel="noreferrer" className="source-link">
                                                {link.label} ↗
                                            </a>
                                        ))}
                                    </div>
                                </div>

                                <div className="danger-zone">
                                    <p className="danger-zone-title">⚠ Danger Zone</p>
                                    <p className="danger-zone-desc">
                                        Permanently delete your account and all associated data — words, PDFs, bookmarks. This cannot be undone.
                                    </p>
                                    <button
                                        className="btn-danger"
                                        onClick={handleDeleteAccount}
                                        disabled={deletingAccount}
                                    >
                                        {deletingAccount ? "Deleting…" : "Delete My Account"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                </div>
        </AppLayout>
    );
}

export default WordProfile;
