// One number card (e.g. "Total words 27"). tone="green" colours the number green (used for "Learned").
export default function Stat({ label, value, tone }) {
    return (
        <div className="stat">
            <div className="stat-label">{label}</div>
            <div className={`stat-value${tone === "green" ? " stat-value--green" : ""}`}>{value}</div>
        </div>
    );
}
