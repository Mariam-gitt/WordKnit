const express = require("express");
const router = express.Router();
const multer = require("multer"); // parses the incoming multipart file upload from the browser
const protect = require("../middleware/authMiddleware"); // same login-required check used by every other route
const {
    startConversation, handleTurn, endSession,
    getSessions, getSessionById, deleteSession, deleteAllSessions,
    getLevel, setLevel
} = require("../controllers/speakingController");

// Audio clips here are just a few seconds of speech — memoryStorage keeps the whole
// upload in RAM just long enough to forward it to Groq, same pattern ocrRoutes.js uses.
const upload = multer({ storage: multer.memoryStorage() });

router.get("/start", protect, startConversation);           // kicks off a new conversation, no audio needed
router.post("/turn", protect, upload.single("audio"), handleTurn); // one voice exchange — "audio" must match the FormData field name the frontend sends
router.post("/end", protect, endSession);                   // closes a session out, generating teacher-style feedback + updating the learner's rolling memory

// Session history — "/sessions" must come before "/sessions/:id" in file order isn't
// actually required here since the paths are shape-distinct (one has a trailing id, one
// doesn't), but keeping the plain list route first mirrors wordRoutes.js's convention.
router.get("/sessions", protect, getSessions);               // sidebar list
router.get("/sessions/:id", protect, getSessionById);        // full transcript + reflection for one past conversation
router.delete("/sessions/:id", protect, deleteSession);      // remove one
router.delete("/sessions", protect, deleteAllSessions);      // clear all (the History panel's "Clear" button)

router.get("/level", protect, getLevel);                     // read the learner's saved difficulty level
router.put("/level", protect, setLevel);                     // save a new difficulty level choice

module.exports = router;
