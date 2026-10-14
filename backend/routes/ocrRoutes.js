const express = require("express");
const router = express.Router();

// The OCR feature was removed from the project and is no longer mounted.
router.use((req, res) => {
    res.status(410).json({
        message: "OCR feature has been removed from WordKnit."
    });
});

module.exports = router;
