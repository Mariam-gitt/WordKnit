// The friendly box shown when a page has nothing to show yet. icon is an element; action is an optional button.
export default function EmptyState({ icon, children, action }) {
    return (
        <div className="empty">
            {icon && <span className="empty-icon">{icon}</span>}
            <p>{children}</p>
            {action}
        </div>
    );
}
