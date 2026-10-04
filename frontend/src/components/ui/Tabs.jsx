import * as RadixTabs from "@radix-ui/react-tabs"; // Radix Tabs: keyboard arrows, focus and ARIA roles built in
// A row of tabs. items = [{ value, label, count? }]; value/onChange are controlled by the parent.
// variant: "segmented" (soft pill track, default) or "line" (plain underlined tabs).
// The page decides what to show for the selected tab, so there is no <Tabs.Content> here.
export default function Tabs({ items, value, onChange, variant = "segmented", className = "" }) {
    return (
        <RadixTabs.Root value={value} onValueChange={onChange}>
            <RadixTabs.List className={`tabs-list${variant === "line" ? " tabs-list--line" : ""} ${className}`.trim()}>
                {items.map((item) => (
                    <RadixTabs.Trigger key={item.value} value={item.value} className="tabs-trigger">
                        {item.label}
                        {item.count !== undefined && <span className="tabs-count">{item.count}</span>}
                    </RadixTabs.Trigger>
                ))}
            </RadixTabs.List>
        </RadixTabs.Root>
    );
}
