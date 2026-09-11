import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Flashcards from "./pages/Flashcards";
import Quiz from "./pages/Quiz";
import Vocabulary from "./pages/Vocabulary";
import PDFReader from "./pages/PDFReader";
import WordProfile from "./pages/WordProfile";
import VoiceAssistant from "./pages/VoiceAssistant";
import SpeakingPractice from "./pages/SpeakingPractice";

function ProtectedRoute({ children }) {
    const token = localStorage.getItem("token");
    if (!token) return <Navigate to="/" replace />;
    return children;
}

export default function App() {
    return (
        <BrowserRouter>
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
        </BrowserRouter>
    );
}
