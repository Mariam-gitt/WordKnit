const express = require("express");
const router = express.Router();
const multer = require("multer"); // parses the incoming multipart file upload from the browser
const protect = require("../middleware/authMiddleware"); // same login-required check used by every other route
const { startConversation, handleTurn } = require("../controllers/speakingController");

// Audio clips here are just a few seconds of speech — memoryStorage keeps the whole
// upload in RAM just long enough to forward it to Groq, same pattern ocrRoutes.js uses.
const upload = multer({ storage: multer.memoryStorage() });

router.get("/start", protect, startConversation);           // kicks off a new conversation, no audio needed
router.post("/turn", protect, upload.single("audio"), handleTurn); // one voice exchange — "audio" must match the FormData field name the frontend sends

module.exports = router;
