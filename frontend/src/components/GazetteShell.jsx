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

// localStorage key used to remember whether the DESKTOP sidebar is hidden or
// showing, so it stays hidden (or showing) the next time the app is opened
// instead of always resetting to one state.
const SIDEBAR_COLLAPSED_KEY = "wk-sidebar-collapsed";

/**
 * GazetteShell — the app's persistent page frame.
 *
 * Layout, outside-in:
 *   .app-frame  — a thin yellow strip visible on all four edges of the window
 *                 (the brand color, kept small on purpose — not a big margin).
 *     .app-shell — a plain white, rounded panel sitting inside that frame,
 *                  holding everything else: the sidebar and the page content.
 *
 * The sidebar itself can be fully hidden (not just shrunk to icons) via the
 * collapse button in its header — when hidden, a small tab stays clipped to
 * the left edge so it can be reopened again. That collapsed/expanded choice
 * is remembered across visits via localStorage (SIDEBAR_COLLAPSED_KEY).
 *
 * On narrow/mobile screens (see the @media rule in index.css) this collapse
 * behavior is ignored in favor of a simpler pattern: a top bar with a
 * hamburger button that opens the sidebar as a full slide-in drawer.
 */
function GazetteShell({ children, rightSlot, reader, statusCount }) {
    const navigate = useNavigate(); // lets nav buttons below actually change the page
    const location = useLocation(); // current URL path, used to highlight the active nav link

    // Whether the MOBILE off-canvas sidebar drawer is currently open. Irrelevant on
    // desktop, where "collapsed" (below) is the state that matters instead.
    const [mobileOpen, setMobileOpen] = useState(false);

    // Whether the DESKTOP sidebar is fully hidden. Restored from localStorage so
    // a user who hides it stays with a hidden sidebar on their next visit too,
    // instead of it reappearing every time.
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");

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
        if (!mobileOpen) return;
        const onKey = (e) => { if (e.key === "Escape") setMobileOpen(false); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [mobileOpen]);

    // While the mobile drawer is open, stop the page underneath it from scrolling —
    // otherwise a swipe meant for the drawer can accidentally scroll the page behind it.
    useEffect(() => {
        document.body.style.overflow = mobileOpen ? "hidden" : "";
        return () => { document.body.style.overflow = ""; };
    }, [mobileOpen]);

    const closeMobileDrawer = () => setMobileOpen(false); // shared helper used by the backdrop, Escape key, and link clicks

    // Toggles the desktop sidebar hidden/shown, and remembers the choice for
    // next time by writing it straight to localStorage as it changes.
    const toggleCollapsed = () => {
        setCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
            return next;
        });
    };

    // Navigate to a page, then close the mobile drawer (a no-op on desktop, since
    // the sidebar there is never an overlay in the first place).
    const goTo = (path) => {
        navigate(path);
        closeMobileDrawer();
    };

    // Logs the user out: clears the stored JWT and sends them back to the login
    // page. Kept as its own function (rather than inline in the button) so it's
    // easy to find/reuse if a "Log out" control is ever added elsewhere.
    const handleLogout = () => {
        localStorage.removeItem("token");
        navigate("/");
        closeMobileDrawer();
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

    // Shared nav-list markup — used by both the desktop sidebar and the mobile
    // drawer (they're the same <aside> element, just shown differently by CSS),
    // so there's a single source of truth instead of two hand-copied lists.
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
        // .app-frame: the thin yellow strip visible on all four edges.
        <div className="app-frame">
            <div className={`app-shell${reader ? " app-shell--reader" : ""}`}>

                {/* Mobile-only top bar: hidden on desktop via CSS, shown under ~860px wide.
                    Holds the hamburger button that opens the sidebar as a drawer, since a
                    persistent sidebar wouldn't leave enough room for content on a phone. */}
                <header className="app-topbar">
                    <button
                        type="button"
                        className="app-menu-btn"
                        onClick={() => setMobileOpen((open) => !open)}
                        aria-expanded={mobileOpen}
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
                {mobileOpen && (
                    <button
                        type="button"
                        className="app-mobile-backdrop"
                        aria-label="Close menu"
                        onClick={closeMobileDrawer}
                    />
                )}

                {/* The sidebar itself: on desktop it's either fully in-flow (expanded) or
                    not rendered in-flow at all (collapsed — see the ".collapsed" CSS rule,
                    `display: none` on desktop only). On mobile it ignores "collapsed"
                    entirely and instead slides on/off screen as an overlay via ".open",
                    controlled by the top bar's hamburger button above. */}
                <aside className={`app-sidebar${mobileOpen ? " open" : ""}${collapsed ? " collapsed" : ""}`}>
                    <div className="app-sidebar-brand">
                        <YarnBallLogo size={28} />
                        <span className="app-sidebar-brand-text">WordKnit.</span>
                        {/* Hides the sidebar entirely (desktop only — see index.css, this
                            button is hidden on mobile where the hamburger already does this job). */}
                        <button
                            type="button"
                            className="app-sidebar-collapse-btn"
                            onClick={toggleCollapsed}
                            aria-label="Hide sidebar"
                        >
                            <span aria-hidden="true">‹</span>
                        </button>
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

                {/* The little "show sidebar" tab — only rendered (and, via CSS, only
                    ever visible on desktop widths) while the sidebar is collapsed.
                    Clicking it brings the full sidebar back. */}
                {collapsed && (
                    <button
                        type="button"
                        className="app-sidebar-reopen"
                        onClick={toggleCollapsed}
                        aria-label="Show sidebar"
                    >
                        <span aria-hidden="true">›</span>
                    </button>
                )}

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
        </div>
    );
}

export default GazetteShell;
