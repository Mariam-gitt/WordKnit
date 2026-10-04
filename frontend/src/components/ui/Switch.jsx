import * as RadixSwitch from "@radix-ui/react-switch"; // Radix Switch: an accessible on/off toggle
// A labelled on/off switch. checked/onChange are controlled by the parent (parent → child).
export default function Switch({ label, checked, onChange }) {
    return (
        <label className="switch-row">
            <span>{label}</span>
            <RadixSwitch.Root className="switch" checked={checked} onCheckedChange={onChange}>
                <RadixSwitch.Thumb className="switch-thumb" />
            </RadixSwitch.Root>
        </label>
    );
}
