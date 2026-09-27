import { useState } from "react"; // useState: local component state (the typed word, loading flag, error text)
import api from "../api"; // shared axios instance (auto-attaches the auth token to every request)

function AddWord({ onWordAdded }) {
    const [word, setWord] = useState("");       // the text currently typed into the input box
    const [loading, setLoading] = useState(false); // true while the "Add" request is in flight
    const [error, setError] = useState("");      // inline message shown under the box (replaces the old alert() popup)

    const handleSubmit = async () => {
        if (!word.trim()) return; // nothing typed — do nothing, no need to show an error for an empty submit
        setLoading(true);
        setError(""); // clear any previous message before trying again
        try {
            await api.post("/words", { word: word.trim() });
            const added = word.trim().toLowerCase(); // normalize the same way the backend does, for the callback below
            setWord(""); // clear the input now that the word was saved successfully
            onWordAdded(added); // tell the parent (Dashboard) so it can refresh the list + show the profile preview
        } catch (err) {
            if (err.response?.status === 409) {
                // 409 Conflict = the backend's dedicated "you already have this word" response
                // (see wordController.js addWord) — show its friendly message instead of a generic failure.
                setError(err.response.data?.message || "That word is already in your list.");
            } else {
                // Any other failure (network issue, server error, etc.) — fall back to whatever
                // message the server sent, or a generic one if it sent nothing usable.
                setError(err.response?.data?.message || "Failed to add word. Please try again.");
            }
        } finally { setLoading(false); }
    };

    return (
        // Wrapping div lets the inline error message sit directly under the input+button row
        // without disturbing the existing .add-word-box layout used elsewhere (Dashboard stats etc).
        <div className="add-word-wrap">
            <div className="add-word-box">
                <input
                    value={word}
                    onChange={e => { setWord(e.target.value); if (error) setError(""); }} // typing again clears a stale error
                    placeholder="Add a new word..."
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                />
                <button className="btn btn-primary" onClick={handleSubmit} disabled={loading}>
                    {loading ? "Adding..." : "+ Add"}
                </button>
            </div>
            {error && <p className="add-word-error">{error}</p>}
        </div>
    );
}

export default AddWord;
