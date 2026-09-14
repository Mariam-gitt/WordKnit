// React, plus two extra tools needed for code splitting:
// lazy()    — wraps an import so its code is fetched ONLY when that route is actually
//             visited, instead of all at once when the app first loads.
// Suspense  — a wrapper that shows a fallback (like "Loading…") while a lazy import is
//             still being fetched over the network, then swaps in the real component.
import React, { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// Login is imported NORMALLY (not lazily) on purpose: it's the very first thing almost
// everyone sees, so there's no benefit to code-splitting it — doing so would just add an
// extra "Loading…" flash on the page people land on first, for no real speed gain.
import Login from "./pages/Login";

// Every OTHER page is now lazy-loaded: its JavaScript is only downloaded the moment
// someone actually navigates to that specific route, instead of all ten pages' worth of
// code being bundled into one giant file that loads before you've even logged in.
// This is the single biggest initial-load speed win available without changing any
// actual page component or build tool.
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Flashcards = lazy(() => import("./pages/Flashcards"));
const Quiz = lazy(() => import("./pages/Quiz"));
const Vocabulary = lazy(() => import("./pages/Vocabulary"));
const PDFReader = lazy(() => import("./pages/PDFReader"));
const WordProfile = lazy(() => import("./pages/WordProfile"));
const VoiceAssistant = lazy(() => import("./pages/VoiceAssistant"));
const SpeakingPractice = lazy(() => import("./pages/SpeakingPractice"));

function ProtectedRoute({ children }) {
    const token = localStorage.getItem("token"); // same login check as before — unchanged
    if (!token) return <Navigate to="/" replace />;
    return children;
}

// Shown briefly while a lazy page's code is still being downloaded — normally so fast
// (a fraction of a second, especially on repeat visits once the browser caches it) that
// you'd barely notice it, but it needs to exist so React has something to render in the
// gap instead of a blank white screen.
function PageLoading() {
    return (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
            <p style={{ color: "var(--text-2)" }}>Loading…</p>
        </div>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            {/* Suspense wraps ALL the routes in one place — any lazy page rendered below
                automatically shows PageLoading while its code is still being fetched,
                without needing to repeat that logic on every single route. */}
            <Suspense fallback={<PageLoading />}>
                <Routes>
                    <Route path="/" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                    <Route path="/flashcards" element={<ProtectedRoute><Flashcards /></ProtectedRoute>} />
                    <Route path="/quiz" element={<ProtectedRoute><Quiz /></ProtectedRoute>} />
                    <Route path="/vocabulary" element={<ProtectedRoute><Vocabulary /></ProtectedRoute>} />
                    <Route path="/reader" element={<ProtectedRoute><PDFReader /></ProtectedRoute>} />
                    <Route path="/profile/:word" element={<ProtectedRoute><WordProfile /></ProtectedRoute>} />
                    <Route path="/voice" element={<ProtectedRoute><VoiceAssistant /></ProtectedRoute>} />
                    <Route path="/speaking" element={<ProtectedRoute><SpeakingPractice /></ProtectedRoute>} />
                </Routes>
            </Suspense>
        </BrowserRouter>
    );
}
