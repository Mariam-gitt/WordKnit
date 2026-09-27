import { useEffect, useState, useRef, useCallback } from "react"; // React hooks used below
import { useNavigate, useLocation } from "react-router-dom"; // routing: navigate between pages, know which page is active
import YarnBallLogo from "./YarnBallLogo"; // the little yarn-ball brand mark shown next to "WordKnit."
import { NAV_LINKS } from "../navLinks"; // the list of { path, icon, label } entries for every sidebar link

// Minimum width the right-hand "aside" panel (used by the word-detail view) can be
// dragged down to, so it never gets squeezed unreadably small.
const ASIDE_MIN = 240;
// The aside can never be dragged wider than this fraction of the whole window —
// stops someone from resizing it until the main content has no room left.
const ASIDE_MAX_RATIO = 0.45;
// Width the aside opens at the very first time (before the user has ever dragged it).
const ASIDE_DEFAULT = 320;

/**
 * GazetteShell — the app's persistent page frame.
 *
 * This used to render a hamburger button that opened a slide-over "Sections" menu
 * on EVERY screen size, with the whole app boxed inside a bordered, drop-shadowed
 * "postcard" sitting in the middle of a big yellow margin (the look in the
 * screenshot). That's been replaced with a proper persistent sidebar, the same
 * pattern shadcn/ui's Sidebar component uses: a fixed nav rail down the left side
 * on desktop/tablet, which collapses into a slide-in drawer (opened by a top bar
 * hamburger button) only on narrow/mobile screens. The yellow brand color now
 * lives on the sidebar itself instead of being a big outer margin around a small
 * centered white box.
 */
function GazetteShell({ children, rightSlot, reader, statusCount }) {
    const navigate = useNavigate(); // lets nav buttons below actually change the page
    const location = useLocation(); // current URL path, used to highlight the active nav link

    // Whether the MOBILE off-canvas sidebar drawer is currently open. Irrelevant on
    // desktop, where the sidebar is always visible (no "open/closed" state needed).
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Width (in pixels) of the right-hand "aside" panel, restored from localStorage
    // so a user's preferred width persists across visits instead of resetting every time.
    const [asideWidth, setAsideWidth] = useState(() => {
        const saved = parseInt(localStorage.getItem("wk-gazette-aside-w"), 10);
        return saved > ASIDE_MIN ? saved : ASIDE_DEFAULT;
    });
    const dragging = useRef(false); // tracks drag state without triggering re-renders on every pixel of movement

    // Close the mobile drawer if the user presses Escape — a standard accessibility
    // expectation for any overlay/drawer/modal.
    useEffect(() => {
        if (!sidebarOpen) return;
        const onKey = (e) => { if (e.key === "Escape") setSidebarOpen(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [sidebarOpen]);

    // While the mobile drawer is open, stop the page underneath it from scrolling —
    // otherwise a swipe meant for the drawer can accidentally scroll the page behind it.
    useEffect(() => {
        document.body.style.overflow = sidebarOpen ? "hidden" : "";
        return () => { document.body.style.overflow = ""; };
    }, [sidebarOpen]);

    const closeSidebar = () => setSidebarOpen(false); // shared helper used by the backdrop, Escape key, and link clicks

    // Navigate to a page, then close the mobile drawer (a no-op on desktop, since
    // the sidebar there is always visible and never "open" in the first place).
    const goTo = (path) => {
        navigate(path);
        closeSidebar();
    };

    // Logs the user out: clears the stored JWT and sends them back to the login
    // page. Kept as its own function (rather than inline in the button) so it's
    // easy to find/reuse if a "Log out" control is ever added elsewhere.
    const handleLogout = () => {
        localStorage.removeItem("token");
        navigate("/");
        closeSidebar();
    };

    // Pointer-drag handler for resizing the right-hand aside panel. Unchanged from
    // before — only the surrounding shell layout changed, not this resize behavior.
    const onResizeStart = useCallback((e) => {
        e.preventDefault();
        dragging.current = true;
        const startX = e.clientX; // where the drag started, horizontally
        const startW = asideWidth; // aside's width at the moment the drag started

        const onMove = (ev) => {
            if (!dragging.current) return;
            const maxW = window.innerWidth * ASIDE_MAX_RATIO; // recompute in case the window was resized mid-drag
            const delta = startX - ev.clientX; // dragging left (toward center) widens the aside
            const next = Math.min(maxW, Math.max(ASIDE_MIN, startW + delta)); // clamp between min and max
            setAsideWidth(next);
        };

        const onUp = () => {
            dragging.current = false;
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            // Persist the final width so it's remembered next time this page loads.
            setAsideWidth((w) => {
                localStorage.setItem("wk-gazette-aside-w", String(Math.round(w)));
                return w;
            });
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    }, [asideWidth]);

    // statusCount is a number of saved words on most pages, or undefined elsewhere —
    // fall back to an em-dash so the sidebar never shows a blank/broken value.
    const count = statusCount ?? "—";
    const countLabel = typeof count === "number" ? `${count} saved` : count;

    // Shared nav-list markup — rendered twice below (once in the desktop sidebar,
    // once in the mobile drawer) so both stay perfectly in sync with a single
    // source of truth instead of two hand-copied lists that could drift apart.
    const navList = (
        <nav className="app-sidebar-nav">
            {NAV_LINKS.map((link) => (
                <button
                    key={link.path}
                    type="button"
                    // "active" is added when this link's path matches the current URL,
                    // giving it the filled highlight style defined in index.css.
                    className={`app-nav-item${location.pathname === link.path ? " active" : ""}`}
                    onClick={() => goTo(link.path)}
                >
                    <span className="app-nav-icon" aria-hidden="true">{link.icon}</span>
                    <span className="app-nav-label">{link.label}</span>
                </button>
            ))}
        </nav>
    );

    return (
        <div className={`app-shell${reader ? " app-shell--reader" : ""}`}>

            {/* Mobile-only top bar: hidden on desktop via CSS, shown under ~860px wide.
                Holds the hamburger button that opens the sidebar as a drawer, since a
                persistent sidebar wouldn't leave enough room for content on a phone. */}
            <header className="app-topbar">
                <button
                    type="button"
                    className="app-menu-btn"
                    onClick={() => setSidebarOpen((open) => !open)}
                    aria-expanded={sidebarOpen}
                    aria-label="Open menu"
                >
                    <span aria-hidden="true">☰</span>
                </button>
                <div className="app-topbar-brand">
                    <YarnBallLogo size={22} />
                    <span>WordKnit.</span>
                </div>
                <span className="app-topbar-status">{countLabel}</span>
            </header>

            {/* Dark backdrop behind the mobile drawer — clicking it closes the drawer,
                same as clicking outside any standard overlay/modal. Only rendered
                (and therefore only clickable/visible) while the drawer is open. */}
            {sidebarOpen && (
                <button
                    type="button"
                    className="app-mobile-backdrop"
                    aria-label="Close menu"
                    onClick={closeSidebar}
                />
            )}

            {/* The sidebar itself: always visible and in-flow on desktop (plain CSS
                flex child), but fixed/off-canvas and toggled by `sidebarOpen` on
                mobile — see the @media rule in index.css for exactly where that
                switch happens. */}
            <aside className={`app-sidebar${sidebarOpen ? " open" : ""}`}>
                <div className="app-sidebar-brand">
                    <YarnBallLogo size={28} />
                    <span className="app-sidebar-brand-text">WordKnit.</span>
                </div>

                {navList}

                <div className="app-sidebar-footer">
                    <div className="app-sidebar-status">
                        <span className="app-sidebar-status-dot" aria-hidden="true" />
                        {countLabel}
                    </div>
                    <button type="button" className="app-sidebar-logout" onClick={handleLogout}>
                        <span className="app-nav-icon" aria-hidden="true">⇥</span>
                        Logout
                    </button>
                </div>
            </aside>

            {/* Main content column: the actual page (Dashboard, Vocabulary, etc.),
                plus the optional right-hand "aside" detail panel and its drag handle. */}
            <div className={`app-body${rightSlot ? " has-aside" : ""}${reader ? " app-body--reader" : ""}`}>
                <main className="app-main">{children}</main>
                {rightSlot && (
                    <>
                        <div
                            className="app-resizer"
                            role="separator"
                            aria-orientation="vertical"
                            onPointerDown={onResizeStart}
                        >
                            <span className="app-resizer-pill" />
                        </div>
                        <aside className="app-aside" style={{ width: asideWidth }}>
                            {rightSlot}
                        </aside>
                    </>
                )}
            </div>
        </div>
    );
}

export default GazetteShell;
