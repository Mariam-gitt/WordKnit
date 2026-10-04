import { useState } from "react"; // local state for filters, search, notes and busy flags
import { useNavigate } from "react-router-dom"; // opens a word's profile page
import { TbRefresh, TbTrash } from "react-icons/tb"; // regenerate and delete icons
import api from "../api"; // shared axios instance
import { Button, IconButton, Chip, Tabs, EmptyState } from "./ui"; // shared UI kit

// The searchable, filterable list on the My Words page.
// words and onStatusChange come from the parent (Vocabulary page): parent → child data,
// and onStatusChange is called to ask the parent to re-fetch after any change (child → parent).
function WordList({ words, onStatusChange }) {
    const navigate = useNavigate();
    const [filter, setFilter] = useState("all");           // "all" | "review" | "learned"
    const [search, setSearch] = useState("");              // text typed in the search box
    const [updating, setUpdating] = useState(null);        // id of the word whose status is being changed
    const [deleting, setDeleting] = useState(null);        // id of the word being deleted
    const [regenerating, setRegenerating] = useState(null);// id of the word whose meaning is being rebuilt
    const [editingNote, setEditingNote] = useState(null);  // id of the word whose note is being edited
    const [noteText, setNoteText] = useState("");          // draft note text
    const [savingNote, setSavingNote] = useState(null);    // id of the word whose note is being saved

    const refresh = () => { if (onStatusChange) onStatusChange(); }; // ask the parent to re-fetch the list

    const toggleStatus = async (word) => {
        const newStatus = word.status === "learned" ? "review" : "learned"; // flip learned <-> review
        setUpdating(word._id);
        try { await api.patch(`/words/${word._id}/status`, { status: newStatus }); refresh(); }
        catch (err) { console.log(err); }
        finally { setUpdating(null); }
    };

    const regenerateMeaning = async (word) => {
        if (!window.confirm(`Regenerate the meaning of "${word.word}"? The current meaning will be replaced.`)) return;
        setRegenerating(word._id);
        try { await api.patch(`/words/${word._id}/regenerate`); refresh(); }
        catch (err) { alert(err.response?.data?.message || "Failed to regenerate the meaning."); }
        finally { setRegenerating(null); }
    };

    const handleDelete = async (word) => {
        if (!window.confirm(`Remove "${word.word}" from your vocabulary?`)) return;
        setDeleting(word._id);
        try { await api.delete(`/words/${word._id}`); refresh(); }
        catch { alert("Failed to delete word."); }
        finally { setDeleting(null); }
    };

    const startEditNote = (word) => { setEditingNote(word._id); setNoteText(word.note || ""); };
    const cancelNote = () => { setEditingNote(null); setNoteText(""); };
    const saveNote = async (wordId) => {
        setSavingNote(wordId);
        try { await api.patch(`/words/${wordId}/note`, { note: noteText }); refresh(); setEditingNote(null); }
        catch { alert("Failed to save note."); }
        finally { setSavingNote(null); }
    };

    const q = search.toLowerCase(); // lower-case search text so matching ignores capitals
    const filtered = words
        .filter((w) => filter === "all" || w.status === filter)
        .filter((w) => w.word.toLowerCase().includes(q) || w.meaning?.toLowerCase().includes(q));

    const learnedCount = words.filter((w) => w.status === "learned").length;
    const reviewCount = words.length - learnedCount;

    return (
        <div>
            <input
                className="search"
                placeholder="Search words or meanings"
                aria-label="Search words"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />

            <Tabs
                value={filter}
                onChange={setFilter}
                items={[
                    { value: "all", label: "All", count: words.length },
                    { value: "review", label: "Review", count: reviewCount },
                    { value: "learned", label: "Learned", count: learnedCount },
                ]}
            />

            <div className="word-stack">
                {filtered.length === 0 ? (
                    <EmptyState>{search ? `No words matching "${search}"` : "No words here yet."}</EmptyState>
                ) : filtered.map((w) => (
                    <article key={w._id} className="word-row">
                        <div className="word-row-head">
                            <h3 className="word-title" onClick={() => navigate(`/profile/${encodeURIComponent(w.word)}`)}>{w.word}</h3>
                            {w.partOfSpeech && <span className="word-pos">{w.partOfSpeech}</span>}
                            <span className="grow" />
                            <Chip tone={w.status === "learned" ? "learned" : "default"} onClick={() => toggleStatus(w)} disabled={updating === w._id}>
                                {updating === w._id ? "…" : w.status === "learned" ? "✓ Learned" : "Review"}
                            </Chip>
                            <IconButton label="Regenerate meaning" onClick={() => regenerateMeaning(w)} disabled={regenerating === w._id}>
                                <TbRefresh size={17} />
                            </IconButton>
                            <IconButton label="Delete word" onClick={() => handleDelete(w)} disabled={deleting === w._id}>
                                <TbTrash size={17} />
                            </IconButton>
                        </div>

                        <p className="word-meaning">{w.meaning}</p>
                        {w.exampleSentence && w.exampleSentence !== "No example available" && (
                            <p className="word-example">"{w.exampleSentence}"</p>
                        )}

                        {editingNote === w._id ? (
                            <div className="note-editor">
                                <textarea
                                    value={noteText}
                                    onChange={(e) => setNoteText(e.target.value)}
                                    placeholder="Add your personal note about this word…"
                                    maxLength={500}
                                    autoFocus
                                    rows={3}
                                />
                                <div className="note-actions">
                                    <span className="note">{noteText.length}/500</span>
                                    <span className="grow" />
                                    <Button size="sm" variant="ghost" onClick={cancelNote}>Cancel</Button>
                                    <Button size="sm" variant="primary" onClick={() => saveNote(w._id)} disabled={savingNote === w._id}>
                                        {savingNote === w._id ? "Saving…" : "Save"}
                                    </Button>
                                </div>
                            </div>
                        ) : w.note ? (
                            <p className="word-note" onClick={() => startEditNote(w)}>{w.note}</p>
                        ) : (
                            <button className="link-btn" onClick={() => startEditNote(w)}>+ Add note</button>
                        )}
                    </article>
                ))}
            </div>
        </div>
    );
}

export default WordList;
