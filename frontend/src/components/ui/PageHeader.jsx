// The headline block at the top of every page: a big serif title and a one-line subtitle.
export default function PageHeader({ title, subtitle }) {
    return (
        <header className="page-header">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
        </header>
    );
}
