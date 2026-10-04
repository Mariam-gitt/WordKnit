import * as RadixPopover from "@radix-ui/react-popover"; // Radix Popover: a small floating panel anchored to a button
// trigger = the button element that opens it; children = what is shown inside the floating panel.
export default function Popover({ trigger, children, align = "end" }) {
    return (
        <RadixPopover.Root>
            <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content className="popover" align={align} sideOffset={8}>{children}</RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}
