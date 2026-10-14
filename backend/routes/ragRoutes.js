const express = require("express");
const router = express.Router();

// The RAG (document Q&A) feature was removed from the project and is no longer mounted.
router.use((req, res) => {
    res.status(410).json({
        message: "Document Q&A (RAG) feature has been removed from WordKnit."
    });
});

module.exports = router;
