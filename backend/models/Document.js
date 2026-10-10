const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    fileName: {
        type: String,
        required: true
    },

    // Base64-encoded PDF bytes (data URI without the "data:application/pdf;base64," prefix)
    // NEW: fileId points at the PDF's bytes stored in GridFS (MongoDB's built-in file storage) — see utils/pdfStorage.js.
    // This is how every NEW upload is stored: the row stays tiny and the file size is no longer limited by MongoDB's 16 MB-per-document cap.
    fileId: {
        type: mongoose.Schema.Types.ObjectId
    },

    // LEGACY: PDFs uploaded BEFORE this change keep their bytes here as base64 text. New uploads leave this empty.
    // select: false = queries do NOT load this big field unless you explicitly ask with .select("+fileData"), so it can't leak into lists by accident.
    // (It is no longer "required", because new documents don't have it.)
    fileData: {
        type: String,
        select: false
    },

    fileSize: {
        type: Number,
        default: 0
    },

    pageCount: {
        type: Number,
        default: 0
    },

    // Last page the user was on, so reopening resumes where they left off
    lastPage: {
        type: Number,
        default: 1
    },

    lastOpenedAt: {
        type: Date,
        default: Date.now
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("Document", documentSchema);
