// pdfStorage = the ONE place that knows WHERE the bytes of a saved PDF live.
// BEFORE: the whole PDF was turned into base64 text and stored INSIDE the Document row in MongoDB (field "fileData").
//         MongoDB limits one document to 16 MB, base64 makes files ~33% bigger, and every list/read dragged those bytes around.
// NOW:    the bytes live in GridFS, MongoDB's built-in file storage. GridFS chops a file into 255 KB "chunks" stored in two
//         special collections (pdfs.files = the file's info, pdfs.chunks = the pieces). The Document row keeps only a small "fileId" pointing at it.
// Old documents (with fileData and no fileId) keep working: every function here understands BOTH layouts.

// mongoose gives us access to the underlying MongoDB driver, which contains GridFSBucket (the GridFS tool).
const mongoose = require("mongoose");
// The central logger (levels + timestamps).
const logger = require("./logger");

// All our PDFs go into one GridFS "bucket" (a named group of files). It creates the collections pdfs.files and pdfs.chunks.
const BUCKET_NAME = "pdfs";

// getBucket() builds a GridFSBucket on the database connection that is open right now.
// We build it on demand (not once at start-up) because on Vercel the connection is opened per request (see connectDB in server.js).
const getBucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });

// savePdf(buffer, fileName, userId) stores the PDF bytes in GridFS and returns the new file's id (an ObjectId).
// buffer = the PDF as raw bytes; fileName = the original name; userId = who owns it (kept as extra info on the stored file).
const savePdf = (buffer, fileName, userId) => new Promise((resolve, reject) => {
    // openUploadStream gives us a "writable stream": something we can pour bytes into. metadata is free-form extra info.
    const upload = getBucket().openUploadStream(fileName, { metadata: { userId: String(userId), contentType: "application/pdf" } });
    // If MongoDB refuses or the connection drops while writing, fail the promise so the caller can answer with an error.
    upload.on("error", reject);
    // "finish" means every byte has been written; upload.id is the id GridFS gave the file.
    upload.on("finish", () => resolve(upload.id));
    // end(buffer) writes the whole buffer and then closes the stream.
    upload.end(buffer);
});

// readPdf(doc) returns the PDF as a Buffer (all bytes in memory). Used when the server itself needs to analyse the PDF.
// doc = a Document row. For OLD documents it must have been loaded with .select("+fileData") (the field is hidden by default).
const readPdf = (doc) => new Promise((resolve, reject) => {
    // Old layout: the bytes are base64 text inside the row, so just decode them back into raw bytes.
    if (!doc.fileId) {
        // A legacy row whose fileData was not loaded (or is missing) can't be read — say so clearly.
        if (!doc.fileData) return reject(new Error("PDF data not found"));
        return resolve(Buffer.from(doc.fileData, "base64"));
    }
    // New layout: read the file from GridFS piece by piece and glue the pieces together.
    const chunks = [];
    // openDownloadStream gives a "readable stream": it emits the file's bytes in chunks.
    getBucket().openDownloadStream(doc.fileId)
        .on("data", (chunk) => chunks.push(chunk)) // collect every piece as it arrives
        .on("error", reject)                       // e.g. the file is missing from GridFS
        .on("end", () => resolve(Buffer.concat(chunks))); // all pieces received: join them into one Buffer
});

// streamPdf(doc, res) sends the PDF to the browser as raw bytes (NOT base64 inside JSON).
// For GridFS files the bytes flow straight from the database to the browser without being held in memory all at once.
const streamPdf = (doc, res) => new Promise((resolve, reject) => {
    // Tell the browser what is coming: a PDF. (Not JSON, so axios must ask for responseType "arraybuffer" on the frontend.)
    res.setHeader("Content-Type", "application/pdf");
    // The PDF is private to its owner: don't let browsers or proxies keep a shared copy.
    res.setHeader("Cache-Control", "private, no-store");
    // Old layout: decode the base64 and send it in one go.
    if (!doc.fileId) {
        // Same clear failure as readPdf for rows without bytes.
        if (!doc.fileData) return reject(new Error("PDF data not found"));
        // Decode the base64 text back into bytes.
        const buffer = Buffer.from(doc.fileData, "base64");
        // The exact size lets the browser know when the download is complete.
        res.setHeader("Content-Length", buffer.length);
        // end(buffer) sends the bytes and finishes the response.
        res.end(buffer);
        // Nothing left to wait for.
        return resolve();
    }
    // New layout: open the stored file as a readable stream.
    const stream = getBucket().openDownloadStream(doc.fileId);
    // If GridFS fails BEFORE any bytes were sent (e.g. missing file) the route can still answer with a clean error.
    stream.on("error", reject);
    // Done when the response has been fully written (or the browser closed the connection early).
    res.on("finish", resolve);
    res.on("close", resolve);
    // pipe() connects the two: every chunk read from GridFS is written to the browser immediately.
    stream.pipe(res);
});

// deletePdf(fileId) removes a stored PDF (all its chunks). Failure is logged, not thrown, so cleanup problems never break the user's request.
const deletePdf = async (fileId) => {
    // Nothing to do for old-layout documents (they have no fileId).
    if (!fileId) return;
    try {
        // delete() removes the file's info row and all its chunks.
        await getBucket().delete(fileId);
    } catch (err) {
        // "FileNotFound" just means it was already gone — that's fine. Anything else is worth a warning.
        if (!/FileNotFound/i.test(err.message)) logger.warn("[pdfStorage] Could not delete stored PDF:", err.message);
    }
};

// Export the four operations other files need.
module.exports = { savePdf, readPdf, streamPdf, deletePdf };
