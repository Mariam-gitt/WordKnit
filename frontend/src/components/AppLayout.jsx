import { useEffect, useState } from "react"; // React hooks: remember UI state and run code on change
import { useNavigate, useLocation } from "react-router-dom"; // routing helpers: change page, know the current page
import * as Tooltip from "@radix-ui/react-tooltip"; // Radix Tooltip.Provider: needed once so every IconButton tooltip works
import { TbMenu2, TbLogout } from "react-icons/tb"; // menu icon and logout icon
import YarnBallLogo from "./YarnBallLogo"; // the yarn-ball brand mark
import { IconButton } from "./ui"; // our shared icon button with a tooltip
import { NAV_LINKS } from "../navLinks"; // the list of sidebar links

// localStorage key that remembers whether the desktop sidebar is hidden, so it stays hidden next visit.
const COLLAPSED_KEY = "wk-sidebar-collapsed";

/**
 * AppLayout — the frame every logged-in page sits in.
 *   yellow frame → white rounded panel → [ sidebar | main ]
 *   main = top bar (menu button, CENTRED WordKnit logo, word count) + the page itself.
 * Props (parent → child): children = the page, reader = true makes the page fill the screen
 * without scrolling (used by the PDF reader), statusCount = number shown at the top right.
 */
function AppLayout({ children, reader = false, statusCount }) {
    const navigate = useNavigate(); // lets buttons change the page
    const location = useLocation(); // current URL, used to highlight the active menu item
    const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1"); // desktop: sidebar hidden?
    const [mobileOpen, setMobileOpen] = useState(false); // phones: is the slide-in drawer open?

    // Phones: close the drawer with Escape and stop the page behind it from scrolling while it is open.
    useEffect(() => {
        if (!mobileOpen) return; // nothing to do while the drawer is closed
        const onKey = (e) => { if (e.key === "Escape") setMobileOpen(false); }; // Escape closes it
        window.addEventListener("keydown", onKey); // start listening
        document.body.style.overflow = "hidden"; // lock the page scroll
        return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; }; // clean up
    }, [mobileOpen]);

    // The top-left menu button: on a phone it opens the drawer, on a computer it hides/shows the sidebar.
    const toggleMenu = () => {
        if (window.matchMedia("(max-width: 860px)").matches) { setMobileOpen((open) => !open); return; }
        setCollapsed((prev) => { localStorage.setItem(COLLAPSED_KEY, prev ? "0" : "1"); return !prev; }); // remember the choice
    };

    const goTo = (path) => { navigate(path); setMobileOpen(false); }; // change page and close the drawer
    const logout = () => { localStorage.removeItem("token"); navigate("/"); }; // forget the login and go to the sign-in page

    return (
        <Tooltip.Provider delayDuration={250}>
            <div className="frame">
                <div className={`shell${collapsed ? " shell--collapsed" : ""}`}>

                    {mobileOpen && <button className="drawer-backdrop" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}

                    {/* Sidebar: navigation only (the logo lives in the centre of the top bar) */}
                    <aside className={`sidebar${mobileOpen ? " is-open" : ""}`}>
                        {NAV_LINKS.map((link) => (
                            <button
                                key={link.path}
                                type="button"
                                className={`nav-item${location.pathname === link.path ? " is-active" : ""}`}
                                onClick={() => goTo(link.path)}
                            >
                                {link.icon}
                                {link.label}
                            </button>
                        ))}
                        <div className="sidebar-spacer" />
                        <button type="button" className="nav-item" onClick={logout}>
                            <TbLogout size={18} />
                            Log out
                        </button>
                    </aside>

                    <div className="main">
                        <header className="topbar">
                            <div className="topbar-left">
                                <IconButton label="Menu" onClick={toggleMenu}><TbMenu2 size={20} /></IconButton>
                            </div>
                            {/* The WordKnit logo, centred on every page */}
                            <button type="button" className="brand" onClick={() => goTo("/dashboard")} aria-label="WordKnit home">
                                <YarnBallLogo size={28} />
                                <span className="brand-name">WordKnit.</span>
                            </button>
                            <div className="topbar-right">
                                {typeof statusCount === "number" ? `${statusCount} words saved` : ""}
                            </div>
                        </header>
                        <main className={`content${reader ? " content--fill" : ""}`}>{children}</main>
                    </div>
                </div>
            </div>
        </Tooltip.Provider>
    );
}

export default AppLayout;
