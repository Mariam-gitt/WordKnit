import { useEffect, useState } from "react"; // state for the word list and loading flag
import api from "../api"; // shared axios instance
import AppLayout from "../components/AppLayout"; // the page frame
import WordList from "../components/WordList"; // the searchable list
import { PageHeader, Stat } from "../components/ui"; // shared UI kit

// The "My Words" page: three numbers on top, then the searchable, filterable list.
function Vocabulary() {
    const [words, setWords] = useState([]);       // every saved word
    const [loading, setLoading] = useState(true); // true until the first load finishes

    const fetchWords = async () => {
        try { const res = await api.get("/words"); setWords(res.data); }
        catch (err) { console.log(err); }
        finally { setLoading(false); }
    };
    useEffect(() => { fetchWords(); }, []); // load once when the page opens

    const learnedCount = words.filter((w) => w.status === "learned").length;

    return (
        <AppLayout statusCount={words.length}>
            <div className="page">
                <PageHeader title="My Words" subtitle="Search, filter and manage your vocabulary collection." />

                <div className="stats">
                    <Stat label="Total words" value={words.length} />
                    <Stat label="Learned" value={learnedCount} tone="green" />
                    <Stat label="To review" value={words.length - learnedCount} />
                </div>

                <div className="stack-gap">
                    {loading ? <div className="loading"><span /><span /><span /></div> : <WordList words={words} onStatusChange={fetchWords} />}
                </div>
            </div>
        </AppLayout>
    );
}

export default Vocabulary;
