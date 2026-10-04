// A small rounded tag, e.g. the "Review" / "Learned" status. tone: "default" | "learned" | "yellow".
// Pass onClick to make it a real button (clickable chips need a <button> for keyboard users).
export default function Chip({ tone = "default", onClick, children, ...rest }) {
    const classes = `chip${tone !== "default" ? ` chip--${tone}` : ""}`;
    if (onClick) return <button type="button" className={classes} onClick={onClick} {...rest}>{children}</button>;
    return <span className={classes} {...rest}>{children}</span>;
}
