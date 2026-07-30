const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

const app = express();

// ✅ CORS first
// const corsOptions = {
//     origin: "https://my-mern-project-frontend-1.vercel.app",
//     "http://localhost:3000",
//   "http://localhost:3001",
//     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//     credentials: true
// };
const corsOptions = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
};

app.use(cors(corsOptions));
// app.options("*", cors(corsOptions)); // ✅ fixed wildcard

app.use(express.json());

// ✅ Connect DB on every request (safe due to readyState check in db.js)
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

// Routes
app.get("/", (req, res) => res.send("Vocabulary App Backend is running 🚀"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/words", require("./routes/wordRoutes"));
app.use("/api/quiz", require("./routes/quizRoutes"));
app.use("/api/pdf", require("./routes/pdfRoutes"));
app.use("/api/rag", require("./routes/ragRoutes"));
app.use("/api/contextual", require("./routes/contextualRoutes"));
app.use("/api/ragl", require("./routes/ragLlmRoutes"));
// OCR temporarily disabled — uncomment to re-enable (ocrRoutes.js/ocr_service.py left intact)
// app.use("/api/ocr", require("./routes/ocrRoutes"));
app.use("/api/profile", require("./routes/wordProfileRoutes"));
app.use("/api/documents", require("./routes/documentRoutes"));
app.use("/api/bookmarks", require("./routes/bookmarkRoutes"));

if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Local server running on port ${PORT}`));
}

module.exports = app;

// pat-na2-79c4b6f1-bd8b-45d8-a154-ef6bdc843a09
