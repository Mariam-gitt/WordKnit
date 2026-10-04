import { useState } from "react"; // local state: the typed word, loading flag, error text
import api from "../api"; // shared axios instance (adds the login token to every request automatically)
import { Button } from "./ui"; // the shared button

// A single-line "add a word" field with its button inside. onWordAdded is a callback from the parent:
// this child calls it with the new word so the parent can refresh its list (child → parent).
function AddWord({ onWordAdded }) {
    const [word, setWord] = useState("");           // text currently typed in the box
    const [loading, setLoading] = useState(false);  // true while the request is in flight
    const [error, setError] = useState("");         // message shown under the box

    const handleSubmit = async () => {
        if (!word.trim()) return; // nothing typed: do nothing
        setLoading(true); setError(""); // start loading and clear an old message
        try {
            await api.post("/words", { word: word.trim() }); // save the word
            const added = word.trim().toLowerCase(); // same normalisation the backend uses
            setWord(""); // clear the box
            onWordAdded(added); // tell the parent (child → parent)
        } catch (err) {
            // 409 = "you already have this word"; anything else gets the server's message or a generic one
            setError(err.response?.data?.message || (err.response?.status === 409 ? "That word is already in your list." : "Failed to add word. Please try again."));
        } finally { setLoading(false); }
    };

    return (
        <div className="add-wrap">
            <div className="add-box">
                <input
                    value={word}
                    onChange={(e) => { setWord(e.target.value); if (error) setError(""); }} // typing again clears an old error
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()} // Enter adds the word
                    placeholder="Add a new word"
                    aria-label="New word"
                />
                <Button variant="primary" onClick={handleSubmit} disabled={loading}>{loading ? "Adding…" : "Add"}</Button>
            </div>
            {error && <p className="form-error add-error">{error}</p>}
        </div>
    );
}

export default AddWord;
