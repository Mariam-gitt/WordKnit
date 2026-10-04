import * as Tooltip from "@radix-ui/react-tooltip"; // Radix Tooltip: the ready-made, accessible hover label
// A square icon-only button that shows its name in a tooltip (so icons never have to guess what they mean).
// label: the tooltip text (also read aloud by screen readers); active: highlights it as "switched on".
export default function IconButton({ label, active = false, className = "", children, ...rest }) {
    return (
        <Tooltip.Root>
            {/* asChild = use OUR <button> as the trigger instead of Radix creating another one */}
            <Tooltip.Trigger asChild>
                <button type="button" aria-label={label} className={`icon-btn${active ? " is-on" : ""} ${className}`.trim()} {...rest}>
                    {children}
                </button>
            </Tooltip.Trigger>
            {/* Portal renders the tooltip at the top of the page so no parent can clip it */}
            <Tooltip.Portal>
                <Tooltip.Content className="tooltip" sideOffset={6}>{label}</Tooltip.Content>
            </Tooltip.Portal>
        </Tooltip.Root>
    );
}
