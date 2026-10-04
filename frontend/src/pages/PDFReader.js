import { useState, useRef, useEffect, useCallback } from "react";
import api from "../api";
import AppLayout from "../components/AppLayout";
import * as Tooltip from "@radix-ui/react-tooltip"; // Radix Tooltip: the hover card shown on each book
import { TbBooks, TbLayoutSidebar, TbChevronLeft, TbChevronRight, TbChevronUp, TbChevronDown, TbMinus, TbPlus, TbSearch, TbUpload, TbArrowAutofitWidth, TbTrash, TbBookmark } from "react-icons/tb"; // toolbar and shelf icons
import { Button, IconButton, Tabs } from "../components/ui"; // shared UI kit

const MIN_ZOOM = 50;
const MAX_ZOOM = 250;
const ZOOM_STEP = 10;
const BOOKMARK_WORD_THRESHOLD = 3;

// Deterministic spine colors for the bookshelf — picked to look like real book covers
const BOOK_COLORS = [
    "#7b3f00", "#1a237e", "#1b5e20", "#880e4f", "#4a148c",
    "#bf360c", "#006064", "#33691e", "#1565c0", "#4e342e",
    "#37474f", "#6a1b9a", "#558b2f", "#c62828", "#00695c",
];

// Page render cache: stores resolved {canvas, textContent} per page number
// so flipping back to a visited page is instant (no re-render to pdf.js).
const pageCache = {};

function PDFReader() {
    const canvasRef = useRef(null);
    const fileRef = useRef(null);
    const pdfRef = useRef(null);
    const textLayerRef = useRef(null);
    const canvasWrapRef = useRef(null);

    const [pdfLoaded, setPdfLoaded] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [loading, setLoading] = useState(false);
    const [pdfjsLoaded, setPdfjsLoaded] = useState(false);
    const [fileName, setFileName] = useState("");

    const [selectedText, setSelectedText] = useState("");
    const [word, setWord] = useState("");
    const [explaining, setExplaining] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");
    const [added, setAdded] = useState(false);

    // Zoom: null = "fit to width" (auto), number = manual zoom %
    const [zoom, setZoom] = useState(null);

    // Sidebar (page thumbnails / bookmarks / difficult words)
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [sidebarTab, setSidebarTab] = useState("pages"); // "pages" | "bookmarks" | "difficulty"

    // Search
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [matches, setMatches] = useState([]); // [{page}]
    const [activeMatch, setActiveMatch] = useState(-1);
    const searchInputRef = useRef(null);

    // ─── Saved PDFs (library) ───
    const [showLibrary, setShowLibrary] = useState(true);
    const [savedDocs, setSavedDocs] = useState([]);
    const [libSearch, setLibSearch] = useState("");   // text typed in the shelf search box
    const [libSort, setLibSort] = useState("recent");  // shelf order: "recent" | "name" | "bookmarks"
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [libraryError, setLibraryError] = useState("");
    const [uploading, setUploading] = useState(false);
    const [currentDocId, setCurrentDocId] = useState(null);

    // ─── Bookmarks ───
    const [bookmarks, setBookmarks] = useState([]);
    const [bookmarkSaving, setBookmarkSaving] = useState(false);
    const [bookmarkSaved, setBookmarkSaved] = useState(false);
    const [isLongSelection, setIsLongSelection] = useState(false);

    // ─── Difficult words (for the open PDF) ───
    const [diffWords, setDiffWords] = useState([]);
    const [diffLoaded, setDiffLoaded] = useState(false);
    const [diffAnalyzing, setDiffAnalyzing] = useState(false);
    const [diffError, setDiffError] = useState("");
    const [diffAdded, setDiffAdded] = useState(new Set());
    const [diffTruncated, setDiffTruncated] = useState(false);

    // Load PDF.js + its text layer CSS from CDN
    useEffect(() => {
        if (!document.getElementById("pdfjs-css")) {
            const link = document.createElement("link");
            link.id = "pdfjs-css";
            link.rel = "stylesheet";
            link.href = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf_viewer.min.css";
            document.head.appendChild(link);
        }

        if (window.pdfjsLib) { setPdfjsLoaded(true); return; }

        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            setPdfjsLoaded(true);
        };
        document.head.appendChild(script);
    }, []);

    // ─── Load the saved-PDF library on mount ───
    const loadLibrary = useCallback(async () => {
        setLibraryLoading(true);
        setLibraryError("");
        try {
            const res = await api.get("/documents");
            setSavedDocs(res.data);
        } catch (err) {
            setLibraryError("Couldn't load your saved PDFs.");
        } finally {
            setLibraryLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLibrary();
    }, [loadLibrary]);

    // ─── Bookmarks: load whenever a document is open ───
    const loadBookmarks = useCallback(async (docId) => {
        if (!docId) { setBookmarks([]); return; }
        try {
            const res = await api.get(`/bookmarks/${docId}`);
            setBookmarks(res.data);
        } catch {
            setBookmarks([]);
        }
    }, []);

    useEffect(() => {
        if (currentDocId) loadBookmarks(currentDocId);
    }, [currentDocId, loadBookmarks]);

    const renderPage = useCallback(async (pageNum, zoomOverride) => {
        if (!pdfRef.current || !canvasRef.current) return;
        setLoading(true);

        try {
            const page = await pdfRef.current.getPage(pageNum);
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");

            const containerWidth = canvasWrapRef.current?.parentElement?.clientWidth || 800;
            const viewport = page.getViewport({ scale: 1 });

            const baseScale = Math.max((containerWidth - 40) / viewport.width, 0.5);

            const zoomPct = zoomOverride !== undefined ? zoomOverride : zoom;
            let scale;
            if (zoomPct === null) {
                scale = baseScale;
            } else {
                scale = baseScale * (zoomPct / 100);
            }

            const scaledViewport = page.getViewport({ scale });

            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;
            canvas.style.width = `${scaledViewport.width}px`;
            canvas.style.height = `${scaledViewport.height}px`;

            await page.render({
                canvasContext: ctx,
                viewport: scaledViewport
            }).promise;

            const textContent = await page.getTextContent();
            const textLayer = textLayerRef.current;

            if (textLayer) {
                textLayer.innerHTML = "";
                textLayer.style.width = `${scaledViewport.width}px`;
                textLayer.style.height = `${scaledViewport.height}px`;

                textContent.items.forEach((item, idx) => {
                    if (!item.str) return;
                    const tx = window.pdfjsLib.Util.transform(
                        scaledViewport.transform,
                        item.transform
                    );
                    const span = document.createElement("span");
                    span.textContent = item.str;
                    span.dataset.idx = idx;
                    span.style.position = "absolute";
                    span.style.left = `${tx[4]}px`;
                    span.style.top = `${tx[5] - item.height * scale}px`;
                    span.style.fontSize = `${Math.abs(tx[0])}px`;
                    span.style.fontFamily = item.fontName || "sans-serif";
                    span.style.color = "transparent";
                    span.style.whiteSpace = "pre";
                    span.style.cursor = "text";
                    span.style.transformOrigin = "0% 0%";
                    textLayer.appendChild(span);
                });

                if (searchTerm.trim().length > 1) {
                    highlightOnTextLayer(searchTerm, textLayer, "search-match");
                }

                // Re-highlight any bookmark(s) saved on this page
                const pageBookmarks = bookmarks.filter(b => b.page === pageNum);
                pageBookmarks.forEach(b => {
                    highlightSnippetOnTextLayer(b.text, textLayer);
                });
            }

        } catch (err) {
            console.log("Render error:", err);
        } finally {
            setLoading(false);
        }

        // Pre-fetch and cache the next page in the background so flipping
        // forward is instant. Runs silently after the current page is shown.
        const nextPage = pageNum + 1;
        if (pdfRef.current && nextPage <= totalPages && !pageCache[nextPage]) {
            try {
                const page = await pdfRef.current.getPage(nextPage);
                const containerWidth = canvasWrapRef.current?.parentElement?.clientWidth || 800;
                const baseScale = Math.max((containerWidth - 40) / page.getViewport({ scale: 1 }).width, 0.5);
                const zoomPct = zoom;
                const scale = zoomPct === null ? baseScale : baseScale * (zoomPct / 100);
                const vp = page.getViewport({ scale });
                const offscreen = document.createElement("canvas");
                offscreen.width = vp.width;
                offscreen.height = vp.height;
                await page.render({ canvasContext: offscreen.getContext("2d"), viewport: vp }).promise;
                const textContent = await page.getTextContent();
                pageCache[nextPage] = { canvas: offscreen, textContent, scale, viewport: vp };
            } catch { /* silent — pre-fetch failure is fine */ }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zoom, searchTerm, bookmarks, totalPages]);

    // Invalidate page cache when zoom changes — cached renders are now stale
    useEffect(() => {
        Object.keys(pageCache).forEach(k => delete pageCache[k]);
    }, [zoom]);

    useEffect(() => {
        if (pdfLoaded && pdfjsLoaded) renderPage(currentPage);
    }, [currentPage, pdfLoaded, pdfjsLoaded, renderPage]);

    // Re-render on window resize when in "fit to width" mode
    useEffect(() => {
        if (zoom !== null) return;
        const onResize = () => {
            if (pdfLoaded && pdfjsLoaded) renderPage(currentPage);
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [zoom, pdfLoaded, pdfjsLoaded, currentPage, renderPage]);

    // ─── Persist last-read page to backend (debounced) ───
    useEffect(() => {
        if (!currentDocId || !pdfLoaded) return;
        const t = setTimeout(() => {
            api.patch(`/documents/${currentDocId}`, { lastPage: currentPage }).catch(() => {});
        }, 800);
        return () => clearTimeout(t);
    }, [currentPage, currentDocId, pdfLoaded]);

    // Reset reader-local state before loading any new PDF
    const resetReaderState = () => {
        setResult(null);
        setSelectedText("");
        setWord("");
        setPdfLoaded(false);
        setZoom(null);
        setSearchTerm("");
        setMatches([]);
        setActiveMatch(-1);
        setSearchOpen(false);
        setIsLongSelection(false);
        setBookmarkSaved(false);
        setError("");
        setDiffWords([]);
        setDiffLoaded(false);
        setDiffError("");
        setDiffAdded(new Set());
        setDiffTruncated(false);
        Object.keys(pageCache).forEach(k => delete pageCache[k]);
    };

    // Open a PDF from raw bytes (Uint8Array) into pdf.js
    const openPdfBytes = async (typedArray, startPage = 1) => {
        try {
            const pdf = await window.pdfjsLib.getDocument({ data: typedArray }).promise;
            pdfRef.current = pdf;
            setTotalPages(pdf.numPages);
            setCurrentPage(Math.min(Math.max(1, startPage), pdf.numPages));
            setPdfLoaded(true);
        } catch (err) {
            console.log("PDF load error:", err);
            setError("Failed to load PDF.");
            setLoading(false);
        }
    };

    // ─── Upload a brand-new PDF: save to backend, then open it ───
    const loadPDF = async (file) => {
        if (!file || !pdfjsLoaded) return;
        setFileName(file.name);
        setLoading(true);
        resetReaderState();
        setShowLibrary(false);
        setCurrentDocId(null);
        setBookmarks([]);
        setUploading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const typedArray = new Uint8Array(arrayBuffer);

            // Figure out page count first (needed for the save call)
            const tempPdf = await window.pdfjsLib.getDocument({ data: typedArray.slice() }).promise;
            const pageCount = tempPdf.numPages;

            // Save to backend
            const formData = new FormData();
            formData.append("pdf", file);
            formData.append("pageCount", pageCount);
            const saveRes = await api.post("/documents", formData, {
                headers: { "Content-Type": "multipart/form-data" }
            });
            setCurrentDocId(saveRes.data._id);
            loadLibrary();

            // Now actually render it
            pdfRef.current = tempPdf;
            setTotalPages(pageCount);
            setCurrentPage(1);
            setPdfLoaded(true);
        } catch (err) {
            console.log("PDF upload error:", err);
            setError(err.response?.data?.message || "Failed to save PDF.");
        } finally {
            setLoading(false);
            setUploading(false);
        }
    };

    // ─── Open a previously-saved PDF from the library ───
    const openSavedDoc = async (doc) => {
        setFileName(doc.fileName);
        setLoading(true);
        resetReaderState();
        setShowLibrary(false);
        setCurrentDocId(doc._id);
        setBookmarks([]);

        try {
            const res = await api.get(`/documents/${doc._id}`);
            const { fileData, lastPage } = res.data;
            const binary = atob(fileData);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            await openPdfBytes(bytes, lastPage || 1);
        } catch (err) {
            console.log("Open saved PDF error:", err);
            setError("Failed to open this PDF.");
            setLoading(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) loadPDF(file);
    };

    const handleChangePDF = () => {
        setShowLibrary(true);
        loadLibrary();
    };

    const handleDeleteDoc = async (e, docId) => {
        e.stopPropagation();
        if (!window.confirm("Delete this PDF and all its bookmarks?")) return;
        try {
            await api.delete(`/documents/${docId}`);
            setSavedDocs(docs => docs.filter(d => d._id !== docId));
            if (docId === currentDocId) {
                setShowLibrary(true);
                setPdfLoaded(false);
                setCurrentDocId(null);
            }
        } catch {
            setLibraryError("Failed to delete PDF.");
        }
    };

    const handleTextSelection = () => {
        setTimeout(() => {
            const selection = window.getSelection();
            const text = selection?.toString().trim();
            if (text && text.length > 3) {
                setSelectedText(text);
                setResult(null);
                setAdded(false);
                setBookmarkSaved(false);

                const words = text.trim().split(/\s+/);
                if (words.length === 1) {
                    setWord(text.toLowerCase().replace(/[^a-z]/g, ""));
                    setIsLongSelection(false);
                } else if (words.length <= BOOKMARK_WORD_THRESHOLD) {
                    setWord("");
                    setIsLongSelection(false);
                } else {
                    // Long selection → bookmark flow, not word lookup
                    setIsLongSelection(true);
                    setWord("");
                }
            }
        }, 150);
    };

    const handleExplain = async () => {
        if (!selectedText || !word) return;
        setExplaining(true);
        setError("");
        setResult(null);
        setAdded(false);
        try {
            const res = await api.post("/contextual/explain", {
                paragraph: selectedText,
                word: word.trim()
            });
            setResult(res.data);
        } catch (err) {
            setError(err.response?.data?.message || "Failed to get explanation.");
        } finally {
            setExplaining(false);
        }
    };

    const handleAdd = async () => {
        if (!result) return;
        try {
            await api.post("/words", {
                word: word.toLowerCase(),
                meaning: result.explanation,
                exampleSentence: selectedText.substring(0, 200)
            });
            setAdded(true);
        } catch {
            setError("Failed to add word.");
        }
    };

    // ─── Save current selection as a bookmark ───
    const handleSaveBookmark = async () => {
        if (!selectedText || !currentDocId) return;
        setBookmarkSaving(true);
        setError("");
        try {
            const res = await api.post("/bookmarks", {
                documentId: currentDocId,
                text: selectedText,
                page: currentPage
            });
            setBookmarks(prev => [...prev, res.data].sort((a, b) => a.page - b.page));
            setBookmarkSaved(true);
            // Highlight it immediately on the current page
            highlightSnippetOnTextLayer(selectedText, textLayerRef.current);
            loadLibrary(); // refresh bookmark count shown in library
        } catch (err) {
            setError("Failed to save bookmark.");
        } finally {
            setBookmarkSaving(false);
        }
    };

    const handleDeleteBookmark = async (id) => {
        try {
            await api.delete(`/bookmarks/${id}`);
            setBookmarks(prev => prev.filter(b => b._id !== id));
            loadLibrary();
        } catch {
            setError("Failed to delete bookmark.");
        }
    };

    const jumpToBookmark = (bm) => {
        setSidebarTab("bookmarks");
        if (bm.page !== currentPage) {
            setCurrentPage(bm.page);
        } else {
            highlightSnippetOnTextLayer(bm.text, textLayerRef.current);
        }
    };

    // ─── Difficult words: analyze the currently-open saved PDF ───
    const runDifficultyAnalysis = async () => {
        if (!currentDocId) {
            setDiffError("Difficult-word detection only works for PDFs saved to your library.");
            return;
        }
        setDiffAnalyzing(true);
        setDiffError("");
        try {
            const res = await api.get(`/pdf/analyze-difficulty/${currentDocId}`);
            setDiffWords(res.data.words || []);
            setDiffTruncated(!!res.data.truncated);
            setDiffLoaded(true);
            if (!res.data.words?.length) {
                setDiffError("No difficult words found in this PDF.");
            }
        } catch (err) {
            setDiffError(err.response?.data?.message || "Analysis failed.");
        } finally {
            setDiffAnalyzing(false);
        }
    };

    const addDifficultWord = async (w) => {
        if (diffAdded.has(w)) return;
        try {
            await api.post("/words", { word: w });
            setDiffAdded(prev => new Set([...prev, w]));
        } catch {
            setDiffError(`Could not add "${w}".`);
        }
    };

    const addAllDifficultWords = async () => {
        for (const w of diffWords) {
            if (!diffAdded.has(w)) await addDifficultWord(w);
        }
    };

    // ─── Zoom controls ───
    const zoomIn = () => {
        setZoom(prev => {
            const base = prev === null ? 100 : prev;
            return Math.min(MAX_ZOOM, base + ZOOM_STEP);
        });
    };

    const zoomOut = () => {
        setZoom(prev => {
            const base = prev === null ? 100 : prev;
            return Math.max(MIN_ZOOM, base - ZOOM_STEP);
        });
    };

    const fitToWidth = () => setZoom(null);

    const zoomLabel = zoom === null ? "Fit" : `${zoom}%`;

    // ─── Search ───
    const toggleSearch = () => {
        setSearchOpen(open => {
            const next = !open;
            if (next) {
                setTimeout(() => searchInputRef.current?.focus(), 50);
            } else {
                clearSearch();
            }
            return next;
        });
    };

    const clearSearch = () => {
        setSearchTerm("");
        setMatches([]);
        setActiveMatch(-1);
        const textLayer = textLayerRef.current;
        if (textLayer) {
            textLayer.querySelectorAll("span.search-match").forEach(s => {
                s.classList.remove("search-match", "active");
            });
        }
    };

    // Highlight matches of `term` within a single rendered text layer
    const highlightOnTextLayer = (term, textLayer, className) => {
        if (!textLayer) return;
        const needle = term.trim().toLowerCase();
        textLayer.querySelectorAll("span").forEach(span => {
            if (needle && span.textContent.toLowerCase().includes(needle)) {
                span.classList.add(className);
            }
        });
    };

    // Highlight a saved bookmark snippet by matching consecutive text-layer
    // spans against the snippet text (snippets can span multiple spans/lines)
    const highlightSnippetOnTextLayer = (snippet, textLayer) => {
        if (!textLayer || !snippet) return;
        const spans = Array.from(textLayer.querySelectorAll("span"));
        if (spans.length === 0) return;

        const normalize = s => s.replace(/\s+/g, " ").trim().toLowerCase();
        const targetWords = normalize(snippet).split(" ").filter(Boolean);
        if (targetWords.length === 0) return;

        // Build a flat string of all span text (space-joined) and track offsets
        const spanTexts = spans.map(s => normalize(s.textContent));
        const fullText = spanTexts.join(" ");
        const needle = targetWords.join(" ");

        const startIdx = fullText.indexOf(needle.slice(0, Math.min(needle.length, 60)));
        if (startIdx === -1) return;

        // Walk spans accumulating offsets to find which spans overlap the match range
        let offset = 0;
        const matchEnd = startIdx + Math.min(needle.length, 60);
        spans.forEach((span, i) => {
            const len = spanTexts[i].length;
            const spanStart = offset;
            const spanEnd = offset + len;
            if (spanEnd >= startIdx && spanStart <= matchEnd) {
                span.classList.add("bookmark-highlight");
            }
            offset = spanEnd + 1; // +1 for the joining space
        });
    };

    // Scan the whole document for search matches
    const runSearch = async () => {
        const term = searchTerm.trim();
        if (!term || term.length < 2 || !pdfRef.current) {
            clearSearch();
            return;
        }
        setLoading(true);
        try {
            const needle = term.toLowerCase();
            const found = [];
            for (let p = 1; p <= totalPages; p++) {
                const page = await pdfRef.current.getPage(p);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(it => it.str).join(" ").toLowerCase();
                let from = 0;
                let count = 0;
                while (true) {
                    const idx = pageText.indexOf(needle, from);
                    if (idx === -1) break;
                    count++;
                    from = idx + needle.length;
                }
                for (let i = 0; i < count; i++) {
                    found.push({ page: p });
                }
            }
            setMatches(found);
            if (found.length > 0) {
                const first = found[0];
                setActiveMatch(0);
                if (first.page !== currentPage) {
                    setCurrentPage(first.page);
                } else {
                    highlightOnTextLayer(term, textLayerRef.current, "search-match");
                    setActiveOnCurrentPage(0, found);
                }
            } else {
                setActiveMatch(-1);
            }
        } catch (err) {
            console.log("Search error:", err);
        } finally {
            setLoading(false);
        }
    };

    const setActiveOnCurrentPage = (matchIdx, matchList) => {
        const textLayer = textLayerRef.current;
        if (!textLayer) return;
        textLayer.querySelectorAll("span.search-match").forEach(s => s.classList.remove("active"));

        const m = matchList[matchIdx];
        if (!m || m.page !== currentPage) return;

        let occurrenceOnPage = 0;
        for (let i = 0; i <= matchIdx; i++) {
            if (matchList[i].page === currentPage) occurrenceOnPage++;
        }

        const spans = Array.from(textLayer.querySelectorAll("span.search-match"));
        const target = spans[occurrenceOnPage - 1];
        if (target) {
            target.classList.add("active");
            target.scrollIntoView({ block: "center", behavior: "smooth" });
        }
    };

    const goToMatch = (delta) => {
        if (matches.length === 0) return;
        let next = activeMatch + delta;
        if (next < 0) next = matches.length - 1;
        if (next >= matches.length) next = 0;
        setActiveMatch(next);
        const m = matches[next];
        if (m.page !== currentPage) {
            setCurrentPage(m.page);
        } else {
            highlightOnTextLayer(searchTerm, textLayerRef.current, "search-match");
            setActiveOnCurrentPage(next, matches);
        }
    };

    // Once a page finishes rendering, re-apply active search state
    // (page-level highlight re-application already happens inside renderPage)
    useEffect(() => {
        if (!loading && searchTerm.trim().length > 1 && pdfLoaded && activeMatch >= 0) {
            setActiveOnCurrentPage(activeMatch, matches);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, currentPage]);

    const handleSearchKeyDown = (e) => {
        if (e.key === "Enter") {
            if (matches.length > 0) {
                goToMatch(e.shiftKey ? -1 : 1);
            } else {
                runSearch();
            }
        } else if (e.key === "Escape") {
            toggleSearch();
        }
    };

    // ─── Keyboard navigation ───
    useEffect(() => {
        const onKeyDown = (e) => {
            if (!pdfLoaded) return;
            const tag = document.activeElement?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;

            if (e.key === "ArrowRight" || e.key === "PageDown") {
                setCurrentPage(p => Math.min(totalPages, p + 1));
            } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
                setCurrentPage(p => Math.max(1, p - 1));
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [pdfLoaded, totalPages]);

    const goToPage = (n) => {
        setCurrentPage(Math.max(1, Math.min(totalPages, n)));
    };

    const formatSize = (bytes) => {
        if (!bytes) return "";
        const kb = bytes / 1024;
        if (kb < 1024) return `${Math.round(kb)} KB`;
        return `${(kb / 1024).toFixed(1)} MB`;
    };

    const formatDate = (d) => {
        if (!d) return "";
        return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };

    // The books actually shown on the shelf: filtered by the search box, then ordered by the chosen sort.
    const shelfDocs = savedDocs
        .filter((d) => d.fileName.toLowerCase().includes(libSearch.toLowerCase()))
        .sort((a, b) => libSort === "name" ? a.fileName.localeCompare(b.fileName)
            : libSort === "bookmarks" ? (b.bookmarkCount || 0) - (a.bookmarkCount || 0) : 0); // 0 = keep the server's newest-first order

    return (
        <AppLayout reader>
            <div className="reader-layout">

                {/* LEFT — PDF Viewer / Library */}
                <div className="reader-left">

                    {/* Page thumbnail / bookmarks sidebar — only while a PDF is open */}
                    {pdfLoaded && !showLibrary && (
                        <div className={`reader-thumbs${sidebarOpen ? "" : " collapsed"}`}>
                            <Tabs
                                variant="line"
                                className="reader-tabs"
                                value={sidebarTab}
                                onChange={setSidebarTab}
                                items={[
                                    { value: "pages", label: "Pages" },
                                    { value: "bookmarks", label: "Marks", count: bookmarks.length || undefined },
                                    { value: "difficulty", label: "Hard", count: diffWords.length || undefined },
                                ]}
                            />

                            {sidebarTab === "pages" && (
                                <div className="reader-thumbs-list">
                                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                        <div
                                            key={p}
                                            className={`reader-thumb${p === currentPage ? " active" : ""}`}
                                            onClick={() => goToPage(p)}
                                            title={`Page ${p}`}
                                        >
                                            {p}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {sidebarTab === "bookmarks" && (
                                <div className="reader-bookmarks-list">
                                    {bookmarks.length === 0 && (
                                        <p className="reader-bookmarks-empty">
                                            Select a longer passage of text and click "Save as Bookmark" to add one.
                                        </p>
                                    )}
                                    {bookmarks.map(bm => (
                                        <div key={bm._id} className="reader-bookmark-item" onClick={() => jumpToBookmark(bm)}>
                                            <div className="reader-bookmark-page">Page {bm.page}</div>
                                            <p className="reader-bookmark-text">
                                                {bm.text.length > 90 ? bm.text.slice(0, 90) + "…" : bm.text}
                                            </p>
                                            <button
                                                className="reader-bookmark-delete"
                                                onClick={(e) => { e.stopPropagation(); handleDeleteBookmark(bm._id); }}
                                                title="Delete bookmark">
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {sidebarTab === "difficulty" && (
                                <div className="reader-difficulty-list">
                                    {!diffLoaded && !diffAnalyzing && (
                                        <div className="reader-difficulty-empty">
                                            <p>Scan this PDF for hard vocabulary words.</p>
                                            <button
                                                className="btn btn-primary"
                                                style={{ width: "100%", marginTop: "10px" }}
                                                onClick={runDifficultyAnalysis}
                                                disabled={!currentDocId}>
                                                🧠 Analyze this PDF
                                            </button>
                                            {!currentDocId && (
                                                <p className="reader-difficulty-hint">
                                                    Only available for PDFs saved to your library.
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    {diffAnalyzing && (
                                        <div className="reader-difficulty-empty">
                                            <div className="loading-dots"><span/><span/><span/></div>
                                            <p style={{ marginTop: "10px" }}>Scanning for difficult words…</p>
                                        </div>
                                    )}

                                    {diffError && !diffAnalyzing && (
                                        <p className="reader-difficulty-hint" style={{ color: "var(--accent)" }}>
                                            {diffError}
                                        </p>
                                    )}

                                    {diffTruncated && diffLoaded && (
                                        <p className="reader-difficulty-hint">
                                            ⚠ Large PDF — only the first 150 pages were scanned.
                                        </p>
                                    )}

                                    {diffLoaded && diffWords.length > 0 && (
                                        <>
                                            <button
                                                className="btn btn-ghost"
                                                style={{ width: "100%", fontSize: "0.7rem", marginBottom: "8px" }}
                                                onClick={addAllDifficultWords}>
                                                + Add All
                                            </button>
                                            {diffWords.map(w => (
                                                <div
                                                    key={w}
                                                    className={`reader-difficulty-chip${diffAdded.has(w) ? " added" : ""}`}
                                                    onClick={() => addDifficultWord(w)}>
                                                    {w}
                                                    <span>{diffAdded.has(w) ? "✓" : "+"}</span>
                                                </div>
                                            ))}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="reader-main">
                        {/* Toolbar: icon buttons with tooltips, grouped (left: library + side panel, centre: pages + zoom, right: search) */}
                        <div className="reader-toolbar">
                            {showLibrary || !pdfLoaded ? (
                                <>
                                    <span className="reader-toolbar-title">{showLibrary ? "My library" : "PDF reader"}</span>
                                    <span className="grow" />
                                    <Button variant="primary" size="sm" icon={<TbUpload size={16} />}
                                        onClick={() => fileRef.current.click()} disabled={uploading}>
                                        {uploading ? "Uploading…" : "Upload PDF"}
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <IconButton label="My PDFs" onClick={handleChangePDF}><TbBooks size={19} /></IconButton>
                                    <IconButton label="Toggle side panel" active={sidebarOpen} onClick={() => setSidebarOpen((o) => !o)}><TbLayoutSidebar size={19} /></IconButton>
                                    <span className="reader-toolbar-title" title={fileName}>{fileName}</span>
                                    <span className="grow" />

                                    <div className="tool-group">
                                        <IconButton label="Previous page" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1 || loading}><TbChevronLeft size={18} /></IconButton>
                                        <span className="tool-label">{currentPage} / {totalPages}</span>
                                        <IconButton label="Next page" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages || loading}><TbChevronRight size={18} /></IconButton>
                                    </div>

                                    <div className="tool-group">
                                        <IconButton label="Zoom out" onClick={zoomOut} disabled={zoom !== null && zoom <= MIN_ZOOM}><TbMinus size={18} /></IconButton>
                                        <span className="tool-label">{zoomLabel}</span>
                                        <IconButton label="Zoom in" onClick={zoomIn} disabled={zoom !== null && zoom >= MAX_ZOOM}><TbPlus size={18} /></IconButton>
                                        <IconButton label="Fit to width" onClick={fitToWidth} disabled={zoom === null}><TbArrowAutofitWidth size={18} /></IconButton>
                                    </div>

                                    <IconButton label="Search in document" active={searchOpen} onClick={toggleSearch}><TbSearch size={18} /></IconButton>

                                    {searchOpen && (
                                        <div className="reader-search">
                                            <input
                                                ref={searchInputRef}
                                                type="text"
                                                placeholder="Find in document"
                                                value={searchTerm}
                                                onChange={(e) => setSearchTerm(e.target.value)}
                                                onKeyDown={handleSearchKeyDown}
                                                onBlur={() => { if (!searchTerm) runSearch(); }}
                                            />
                                            {matches.length > 0 && <span className="reader-search-count">{activeMatch + 1} / {matches.length}</span>}
                                            <IconButton label="Previous match" onClick={() => goToMatch(-1)} disabled={matches.length === 0}><TbChevronUp size={17} /></IconButton>
                                            <IconButton label="Next match" onClick={() => goToMatch(1)} disabled={matches.length === 0}><TbChevronDown size={17} /></IconButton>
                                            <Button size="sm" onClick={runSearch}>Go</Button>
                                        </div>
                                    )}
                                </>
                            )}
                            <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handleFileChange} />
                        </div>

                        {/* Library view: search + sort above a wooden shelf. Books are as thick as the PDF is long;
                            the Upload slot is the first place on the shelf; hovering a book shows its details. */}
                        {showLibrary && (
                            <div className="reader-library">
                                {libraryLoading && <div className="loading"><span /><span /><span /></div>}
                                {!libraryLoading && libraryError && <p className="form-error shelf-msg">{libraryError}</p>}

                                {!libraryLoading && !libraryError && (
                                    <>
                                        <div className="shelf-controls">
                                            <input type="search" placeholder="Search your PDFs" aria-label="Search your PDFs" value={libSearch} onChange={(e) => setLibSearch(e.target.value)} />
                                            <select aria-label="Sort PDFs" value={libSort} onChange={(e) => setLibSort(e.target.value)}>
                                                <option value="recent">Recently added</option>
                                                <option value="name">Name A to Z</option>
                                                <option value="bookmarks">Most bookmarks</option>
                                            </select>
                                        </div>

                                        {savedDocs.length === 0 && <p className="note shelf-msg">Your shelf is empty. Upload a PDF to place your first book.</p>}
                                        {savedDocs.length > 0 && shelfDocs.length === 0 && <p className="note shelf-msg">No PDFs match "{libSearch}".</p>}

                                        <div className="shelf">
                                            {/* Group the shelf items into rows of 8; the first item is always the Upload slot */}
                                            {Array.from({ length: Math.ceil((shelfDocs.length + 1) / 8) }, (_, rowIdx) => {
                                                const items = [{ upload: true }, ...shelfDocs].slice(rowIdx * 8, rowIdx * 8 + 8);
                                                return (
                                                    <div key={rowIdx} className="shelf-row">
                                                        {items.map((doc) => {
                                                            if (doc.upload) return (
                                                                <button key="upload" className="book book--upload" onClick={() => fileRef.current.click()} disabled={uploading} aria-label="Upload new PDF">
                                                                    <TbPlus size={20} />
                                                                    <span>Add PDF</span>
                                                                </button>
                                                            );
                                                            const color = BOOK_COLORS[parseInt(doc._id.slice(-4), 16) % BOOK_COLORS.length];
                                                            const shortName = doc.fileName.replace(/\.pdf$/i, "");
                                                            const thickness = Math.min(62, Math.max(36, 30 + (doc.pageCount || 0) / 6)); // longer PDF = thicker spine
                                                            return (
                                                                <Tooltip.Root key={doc._id}>
                                                                    <Tooltip.Trigger asChild>
                                                                        <div className="book" role="button" tabIndex={0} style={{ background: color, width: thickness }}
                                                                            onClick={() => openSavedDoc(doc)}
                                                                            onKeyDown={(e) => e.key === "Enter" && openSavedDoc(doc)}>
                                                                            {doc.bookmarkCount > 0 && <span className="book-badge">{doc.bookmarkCount}</span>}
                                                                            <span className="book-title">{shortName}</span>
                                                                            <button className="book-delete" aria-label={`Delete ${shortName}`} onClick={(e) => handleDeleteDoc(e, doc._id)}><TbTrash size={14} /></button>
                                                                        </div>
                                                                    </Tooltip.Trigger>
                                                                    <Tooltip.Portal>
                                                                        <Tooltip.Content className="tooltip tooltip--card" sideOffset={8}>
                                                                            <strong>{shortName}</strong>
                                                                            <span>{doc.pageCount ? `${doc.pageCount} pages` : "PDF"}{doc.bookmarkCount ? ` · ${doc.bookmarkCount} bookmarks` : ""}</span>
                                                                        </Tooltip.Content>
                                                                    </Tooltip.Portal>
                                                                </Tooltip.Root>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Canvas area */}
                        {!showLibrary && (
                            <div className="reader-canvas-container"
                                onMouseUp={handleTextSelection}>

                                {!pdfLoaded && !loading && (
                                    <div className="reader-empty" onClick={() => fileRef.current.click()}>
                                        <div style={{ fontSize: "3.5rem", marginBottom: "16px" }}>📖</div>
                                        <p style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "6px" }}>Open a PDF to start reading</p>
                                        <p style={{ fontSize: "0.85rem", color: "var(--text-2)" }}>
                                            Select any text → get contextual meaning instantly
                                        </p>
                                    </div>
                                )}

                                {loading && (
                                    <div className="reader-empty">
                                        <div className="loading-dots"><span/><span/><span/></div>
                                        <p style={{ marginTop: "16px", color: "var(--text-2)", fontSize: "0.9rem" }}>
                                            {uploading ? "Saving PDF..." : `Rendering page ${currentPage}...`}
                                        </p>
                                    </div>
                                )}

                                <div ref={canvasWrapRef} style={{
                                    position: "relative",
                                    display: pdfLoaded && !loading ? "inline-block" : "none",
                                    boxShadow: "0 4px 32px rgba(0,0,0,0.15)",
                                    borderRadius: "4px",
                                    overflow: "hidden"
                                }}>
                                    <canvas ref={canvasRef} style={{ display: "block" }}/>
                                    <div
                                        ref={textLayerRef}
                                        className="pdf-text-layer"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT: word panel. Select text in the PDF, ask about a word, then add it to your words. */}
                <aside className="reader-right">
                    <h3 className="panel-title">Contextual meaning</h3>

                    {!selectedText && (
                        <div className="reader-tip">
                            <p className="reader-tip-title">How to use</p>
                            <ol>
                                <li>Open a PDF from your library</li>
                                <li>Select a word or short phrase to see its meaning</li>
                                <li>Select a longer passage to save it as a bookmark</li>
                            </ol>
                        </div>
                    )}

                    {selectedText && (
                        <div className="reader-selected-text">
                            <p className="context-label">{isLongSelection ? "Selected passage" : "Selected text"}</p>
                            <p className="selected-quote">"{selectedText.length > 250 ? selectedText.substring(0, 250) + "…" : selectedText}"</p>
                        </div>
                    )}

                    {/* Long selection: save it as a bookmark */}
                    {selectedText && isLongSelection && (
                        <div className="panel-block">
                            <Button variant="primary" block icon={<TbBookmark size={17} />}
                                onClick={handleSaveBookmark}
                                disabled={bookmarkSaving || bookmarkSaved || !currentDocId}>
                                {bookmarkSaved ? "Saved to bookmarks" : bookmarkSaving ? "Saving…" : "Save as bookmark"}
                            </Button>
                            {!currentDocId && <p className="note">Bookmarks are only available for PDFs saved to your library.</p>}
                        </div>
                    )}

                    {/* Short selection: look a word up */}
                    {!isLongSelection && (
                        <div className="panel-block">
                            <p className="context-label">Which word confuses you?</p>
                            <div className="panel-row">
                                <input
                                    placeholder="Type the word"
                                    value={word}
                                    onChange={(e) => setWord(e.target.value.toLowerCase().replace(/[^a-z]/g, ""))}
                                    onKeyDown={(e) => e.key === "Enter" && handleExplain()}
                                    disabled={!selectedText}
                                />
                                <Button variant="primary" onClick={handleExplain} disabled={!selectedText || !word || explaining}>
                                    {explaining ? "…" : "Explain"}
                                </Button>
                            </div>
                        </div>
                    )}

                    {explaining && (
                        <div className="loading"><span /><span /><span /></div>
                    )}

                    {error && <p className="form-error panel-block">{error}</p>}

                    {result && !explaining && (
                        <div className="reader-result">
                            <div className="result-word">{word}</div>

                            <div className="result-section">
                                <p className="result-label">In this context</p>
                                <p className="result-explanation">{result.explanation}</p>
                            </div>

                            {result.example && (
                                <div className="result-section">
                                    <p className="result-label">A simpler way to think</p>
                                    <p className="result-simpler">{result.example}</p>
                                </div>
                            )}

                            {result.relatedWords && (
                                <div className="chip-cloud result-chips">
                                    {(Array.isArray(result.relatedWords) ? result.relatedWords : result.relatedWords.split(",").map((w) => w.trim())).map((w, i) => (
                                        <span key={i} className="chip">{w}</span>
                                    ))}
                                </div>
                            )}

                            <Button variant="primary" block onClick={handleAdd} disabled={added}>
                                {added ? "Added to My Words" : "Add to My Words"}
                            </Button>
                        </div>
                    )}
                </aside>
            </div>
        </AppLayout>
    );
}

export default PDFReader;
