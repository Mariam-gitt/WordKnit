// useEffect = a React "hook" that runs code AFTER the component is on screen; the function it returns is the cleanup that runs when the component goes away.
// useRef = a box that keeps a value between renders WITHOUT causing a re-render when the value changes.
import { useEffect, useRef } from "react";

// The smallest zoom the pinch may reach, in percent (same number PDFReader.js uses for its zoom buttons).
const MIN_ZOOM = 50;
// The biggest zoom the pinch may reach, in percent (same number PDFReader.js uses for its zoom buttons).
const MAX_ZOOM = 250;
// A swipe must travel at least this many pixels sideways before it counts as "turn the page".
const SWIPE_MIN_DISTANCE = 70;
// ...and it must finish within this many milliseconds, so a slow drag (like selecting text) is never mistaken for a swipe.
const SWIPE_MAX_TIME = 600;

// Distance between two fingers, using Pythagoras (hypot = the straight-line length of the triangle's long side).
const fingerDistance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

// isPhone() = true on narrow screens. It uses the SAME 860px breakpoint as the CSS (layout.css / reader.css), so JS and CSS always agree.
export const isPhone = () => window.matchMedia("(max-width: 860px)").matches;

// useReaderGestures = adds two touch gestures to the PDF page area: pinch with two fingers to zoom, swipe sideways to change page.
// DATA FLOW (parent -> child): PDFReader (parent) hands this hook its refs, its zoom value and its setters; the hook calls them back (child -> parent) when a gesture finishes.
export default function useReaderGestures({ scrollRef, wrapRef, zoom, setZoom, goToPage, currentPage, enabled }) {
    // "latest" always holds the newest props; the touch listeners below are added only ONCE, so they read from here to avoid using stale (old) values.
    const latest = useRef({});
    // Refresh the box on every render so it is never out of date.
    latest.current = { zoom, setZoom, goToPage, currentPage };

    // This effect adds the touch listeners when a PDF page is showing, and removes them when it is not.
    useEffect(() => {
        // The scrollable area that holds the page (PDFReader.js attaches scrollRef to it).
        const area = scrollRef.current;
        // Nothing to do if gestures are switched off (no PDF open) or the area does not exist yet.
        if (!enabled || !area) return undefined;

        // pinch = details of a two-finger gesture while it is happening, otherwise null.
        let pinch = null;
        // swipe = where and when a one-finger touch began, otherwise null.
        let swipe = null;

        // Put the page back to its normal look (the pinch preview uses a temporary CSS transform).
        const clearPreview = () => {
            // The wrapper is the <div> that holds the canvas and the invisible text layer.
            if (wrapRef.current) {
                // An empty string removes the temporary scale.
                wrapRef.current.style.transform = "";
                // And removes the temporary pivot point.
                wrapRef.current.style.transformOrigin = "";
            }
        };

        // A finger touched the screen.
        const onTouchStart = (e) => {
            // Two fingers down = the start of a pinch.
            if (e.touches.length === 2) {
                // A pinch is never also a swipe, so forget any one-finger touch.
                swipe = null;
                // fit-to-width is stored as null; for the maths it counts as 100%.
                const startZoom = latest.current.zoom === null ? 100 : latest.current.zoom;
                // Remember the starting finger distance and zoom so we can compare while the fingers move.
                pinch = { startDist: fingerDistance(e.touches[0], e.touches[1]), startZoom, ratio: 1 };
            } else if (e.touches.length === 1) {
                // One finger down = maybe a swipe; remember where and when it started.
                pinch = null;
                // clientX/clientY = the finger's position on screen in pixels.
                swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
            }
        };

        // A finger moved.
        const onTouchMove = (e) => {
            // Only react while a pinch is active and exactly two fingers are still down.
            if (pinch && e.touches.length === 2) {
                // Stop the browser from scrolling or zooming the whole page while WE handle the pinch.
                e.preventDefault();
                // How much bigger (or smaller) the finger distance is now compared with the start (1 = unchanged, 2 = twice as far apart).
                const raw = fingerDistance(e.touches[0], e.touches[1]) / pinch.startDist;
                // The lowest ratio that still keeps the zoom at or above MIN_ZOOM.
                const minRatio = MIN_ZOOM / pinch.startZoom;
                // The highest ratio that still keeps the zoom at or below MAX_ZOOM.
                const maxRatio = MAX_ZOOM / pinch.startZoom;
                // Clamp = force the number to stay between the two limits.
                pinch.ratio = Math.min(maxRatio, Math.max(minRatio, raw));
                // Live preview: stretch the already-drawn page with a cheap CSS transform (no expensive re-render while fingers are moving).
                if (wrapRef.current) {
                    // Pivot from the top centre so the page grows downwards and sideways, like a normal viewer.
                    wrapRef.current.style.transformOrigin = "50% 0";
                    // scale(1.5) = draw it one and a half times bigger.
                    wrapRef.current.style.transform = `scale(${pinch.ratio})`;
                }
            }
        };

        // A finger left the screen.
        const onTouchEnd = (e) => {
            // If a pinch was in progress...
            if (pinch) {
                // ...finish it only when fewer than two fingers remain on the screen.
                if (e.touches.length < 2) {
                    // Take the numbers out of the box, then empty the box.
                    const { ratio, startZoom } = pinch;
                    pinch = null;
                    // Remove the temporary preview scale.
                    clearPreview();
                    // Ignore tiny accidental changes (under 3%).
                    if (Math.abs(ratio - 1) > 0.03) {
                        // Commit the real zoom: child -> parent, PDFReader's setZoom re-renders the page sharply at the new size.
                        latest.current.setZoom(Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startZoom * ratio))));
                    }
                }
                // A pinch is never also a swipe, so stop here.
                return;
            }
            // A one-finger touch just ended: decide whether it was a swipe.
            if (swipe && e.changedTouches.length === 1) {
                // The finger that just lifted.
                const t = e.changedTouches[0];
                // How far it moved sideways (dx) and up/down (dy), and how long it took (dt, in milliseconds).
                const dx = t.clientX - swipe.x;
                const dy = t.clientY - swipe.y;
                const dt = Date.now() - swipe.time;
                // Forget the touch, it has been handled.
                swipe = null;
                // If text is selected, the finger was probably dragging a selection handle, not swiping.
                const hasSelection = (window.getSelection()?.toString() || "").trim().length > 0;
                // Swipe-to-turn only in fit-to-width mode, because when zoomed in a sideways drag must pan the page instead.
                const fitMode = latest.current.zoom === null;
                // Quick, long, mostly-horizontal movement with no text selected = a real page swipe.
                if (fitMode && !hasSelection && dt < SWIPE_MAX_TIME && Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > Math.abs(dy) * 2) {
                    // Swipe left (dx negative) = next page, swipe right = previous page. child -> parent: PDFReader's goToPage changes the page.
                    latest.current.goToPage(latest.current.currentPage + (dx < 0 ? 1 : -1));
                }
            }
        };

        // The system interrupted the touch (for example a phone call): undo everything without committing.
        const onTouchCancel = () => {
            // Forget both gestures.
            pinch = null;
            swipe = null;
            // And remove any preview scale.
            clearPreview();
        };

        // passive:true = "I promise not to call preventDefault here", which lets the browser keep scrolling smoothly.
        area.addEventListener("touchstart", onTouchStart, { passive: true });
        // passive:false is REQUIRED on touchmove, otherwise preventDefault() (used by the pinch) would be ignored.
        area.addEventListener("touchmove", onTouchMove, { passive: false });
        // Finger lifted.
        area.addEventListener("touchend", onTouchEnd, { passive: true });
        // Touch interrupted.
        area.addEventListener("touchcancel", onTouchCancel, { passive: true });

        // Cleanup: remove all four listeners when the PDF closes or the component goes away, so nothing leaks.
        return () => {
            area.removeEventListener("touchstart", onTouchStart);
            area.removeEventListener("touchmove", onTouchMove);
            area.removeEventListener("touchend", onTouchEnd);
            area.removeEventListener("touchcancel", onTouchCancel);
        };
    }, [enabled, scrollRef, wrapRef]); // re-run only when the gestures are switched on/off (the refs never change)
}
