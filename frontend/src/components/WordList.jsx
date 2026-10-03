import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";

function WordList({ words, onStatusChange }) {
    const navigate = useNavigate();
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [updating, setUpdating] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [editingNote, setEditingNote] = useState(null);   // word._id being edited
    const [noteText, setNoteText] = useState("");           // draft note value
    const [savingNote, setSavingNote] = useState(null);
    const [regenerating, setRegenerating] = useState(null); // NEW: _id of the word whose meaning is being rebuilt (null = none), used to show "…" on its button

    const toggleStatus = async (word) => {
        const newStatus = word.status === "learned" ? "review" : "learned";
        setUpdating(word._id);
        try {
            await api.patch(`/words/${word._id}/status`, { status: newStatus });
            if (onStatusChange) onStatusChange();
        } catch (err) { console.log(err); }
        finally { setUpdating(null); }
    };

    const regenerateMeaning = async (word) => {                         // NEW: runs when "↻ Regenerate" is clicked; word = the saved word object from the list
        if (!window.confirm(`Regenerate the meaning of "${word.word}"? The current meaning will be replaced.`)) return; // ask first, because the old meaning is overwritten
        setRegenerating(word._id);                                      // remember which word is busy so its button shows "…"
        try {                                                           // try/catch so a failed request shows a message instead of breaking the page
            await api.patch(`/words/${word._id}/regenerate`);           // browser → server: "rebuild this word's meaning"
            if (onStatusChange) onStatusChange();                       // child → parent: tell Vocabulary.js to re-fetch the list so the new meaning shows up
        } catch (err) {                                                 // the server said no (AI busy, word missing, ...)
            alert(err.response?.data?.message || "Failed to regenerate the meaning."); // show the server's message, or a default one
        } finally {                                                     // runs whether it worked or failed
            setRegenerating(null);                                      // stop showing the busy "…" state
        }
    };

    const handleDelete = async (e, word) => {
        e.stopPropagation();
        if (!window.confirm(`Remove "${word.word}" from your vocabulary?`)) return;
        setDeleting(word._id);
        try {
            await api.delete(`/words/${word._id}`);
            if (onStatusChange) onStatusChange();
        } catch {
            alert("Failed to delete word.");
        }
        finally { setDeleting(null); }
    };

    const startEditNote = (e, word) => {
        e.stopPropagation();
        setEditingNote(word._id);
        setNoteText(word.note || "");
    };

    const saveNote = async (wordId) => {
        setSavingNote(wordId);
        try {
            await api.patch(`/words/${wordId}/note`, { note: noteText });
            if (onStatusChange) onStatusChange();
            setEditingNote(null);
        } catch {
            alert("Failed to save note.");
        } finally {
            setSavingNote(null);
        }
    };

    const cancelNote = () => {
        setEditingNote(null);
        setNoteText("");
    };

    const filtered = words
        .filter(w => filter === "all" || w.status === filter)
        .filter(w =>
            w.word.toLowerCase().includes(search.toLowerCase()) ||
            w.meaning?.toLowerCase().includes(search.toLowerCase())
        );

    const learnedCount = words.filter(w => w.status === "learned").length;
    const reviewCount = words.filter(w => w.status !== "learned").length;

    return (
        <div>
            <input
                className="search-input"
                placeholder="Search words or meanings…"
                value={search}
                onChange={e => setSearch(e.target.value)}
            />

            <div className="filter-tabs">
                <button className={`filter-tab ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
                    All ({words.length})
                </button>
                <button className={`filter-tab ${filter === "review" ? "active" : ""}`} onClick={() => setFilter("review")}>
                    Review ({reviewCount})
                </button>
                <button className={`filter-tab ${filter === "learned" ? "active" : ""}`} onClick={() => setFilter("learned")}>
                    Learned ({learnedCount})
                </button>
            </div>

            {filtered.length === 0 ? (
                <div className="empty-state">
                    <div className="emoji">{search ? "?" : "+"}</div>
                    <p>{search ? `No words matching "${search}"` : "No words here yet."}</p>
                </div>
            ) : (
                <div className="word-list">
                    {filtered.map(w => (
                        <div key={w._id} className={`word-card ${w.status === "learned" ? "learned" : ""}`}>
                            <div className="word-card-top">
                                <h3 className="word-card-word-link" onClick={() => navigate(`/profile/${w.word}`)}>
                                    {w.word} →
                                </h3>
                                <div className="word-card-actions">
                                    <button
                                        className={`status-btn ${w.status === "learned" ? "learned" : "review"}`}
                                        onClick={() => toggleStatus(w)}
                                        disabled={updating === w._id}
                                    >
                                        {updating === w._id ? "…" : w.status === "learned" ? "✓ Learned" : "Review"}
                                    </button>
                                    <button
                                        className="btn-icon-delete"
                                        onClick={(e) => handleDelete(e, w)}
                                        disabled={deleting === w._id}
                                        title="Delete word"
                                    >
                                        {deleting === w._id ? "…" : "✕"}
                                    </button>
                                </div>
                            </div>
                            <p className="meaning">{w.partOfSpeech && <em>({w.partOfSpeech}) </em>}{w.meaning}</p> {/* NEW: shows "(noun)" etc. in italics before the meaning when we have it */}
                            {w.exampleSentence && w.exampleSentence !== "No example available" && (
                                <p className="example">"{w.exampleSentence}"</p>
                            )}

                            {/* NEW: Regenerate button — rebuilds this word's meaning */}
                            <button
                                className="word-note-add"
                                onClick={() => regenerateMeaning(w)}
                                disabled={regenerating === w._id}
                                title="Rebuild this meaning from the dictionary + AI"
                            >
                                {regenerating === w._id ? "Regenerating…" : "↻ Regenerate meaning"}
                            </button>

                            {/* Note section */}
                            {editingNote === w._id ? (
                                <div className="word-note-editor">
                                    <textarea
                                        className="word-note-textarea"
                                        value={noteText}
                                        onChange={e => setNoteText(e.target.value)}
                                        placeholder="Add your personal note about this word…"
                                        maxLength={500}
                                        autoFocus
                                        rows={3}
                                    />
                                    <div className="word-note-actions">
                                        <span className="word-note-count">{noteText.length}/500</span>
                                        <button className="word-note-btn save"
                                            onClick={() => saveNote(w._id)}
                                            disabled={savingNote === w._id}>
                                            {savingNote === w._id ? "Saving…" : "Save"}
                                        </button>
                                        <button className="word-note-btn cancel" onClick={cancelNote}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="word-note-row">
                                    {w.note ? (
                                        <p className="word-note-text" onClick={(e) => startEditNote(e, w)}>
                                            📝 {w.note}
                                        </p>
                                    ) : (
                                        <button className="word-note-add" onClick={(e) => startEditNote(e, w)}>
                                            + Add note
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default WordList;
