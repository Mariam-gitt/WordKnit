// A single Button component so every button in the app looks and behaves the same.
// variant: "primary" (black + yellow), "secondary" (white outline), "ghost" (no box), "danger" (red text)
// size: "md" (default) or "sm"; icon: an optional icon element shown before the text.
export default function Button({ variant = "secondary", size = "md", block = false, icon, children, className = "", ...rest }) {
    // Build the class list: base class + variant + size (+ block for full width) + any extra classes passed in.
    const classes = `btn btn--${variant} btn--${size}${block ? " btn--block" : ""} ${className}`.trim();
    // {...rest} passes through everything else (onClick, disabled, type, aria-label...).
    return (
        <button type="button" className={classes} {...rest}>
            {icon}
            {children}
        </button>
    );
}
