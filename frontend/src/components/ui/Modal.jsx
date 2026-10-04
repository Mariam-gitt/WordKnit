import * as Dialog from "@radix-ui/react-dialog"; // Radix Dialog: handles focus trapping, Escape and click-outside for us
import { TbX } from "react-icons/tb";            // the close (X) icon
// A pop-up window over the page. open/onOpenChange are controlled by the parent (parent → child);
// title/subtitle go in the header, actions (optional) sit beside the close button, children is the body.
export default function Modal({ open, onOpenChange, title, subtitle, actions, children }) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="dialog-overlay" />
                {/* aria-describedby={undefined} tells Radix we don't use a Dialog.Description */}
                <Dialog.Content className="dialog-content" aria-describedby={undefined}>
                    <div className="dialog-head">
                        <div>
                            <Dialog.Title className="dialog-title">{title}</Dialog.Title>
                            {subtitle && <p className="dialog-sub">{subtitle}</p>}
                        </div>
                        <div className="dialog-actions">
                            {actions}
                            <Dialog.Close asChild>
                                <button type="button" className="icon-btn" aria-label="Close"><TbX size={18} /></button>
                            </Dialog.Close>
                        </div>
                    </div>
                    <div className="dialog-body">{children}</div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
