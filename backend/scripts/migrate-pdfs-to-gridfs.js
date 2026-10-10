// One-time (and safe to repeat) helper: moves OLD PDFs from "base64 text inside the Document row" into GridFS.
// You only need this if you want to shrink your database; old PDFs keep working without it, because the app understands both layouts.
//
// HOW TO RUN (from the backend folder, with MONGO_URI set in your environment or a .env file):
//   node scripts/migrate-pdfs-to-gridfs.js            -> DRY RUN: only reports what it WOULD do, changes nothing
//   node scripts/migrate-pdfs-to-gridfs.js --apply    -> really migrates
// "Idempotent" = running it twice is harmless: documents that were already moved are skipped.

// dotenv loads variables from a .env file (like MONGO_URI) into process.env. Harmless if there is no .env file.
require("dotenv").config();
// mongoose = the library that talks to MongoDB.
const mongoose = require("mongoose");
// The Document model (one row per saved PDF).
const Document = require("../models/Document");
// savePdf puts bytes into GridFS; deletePdf removes them again (used to undo a half-finished move).
const { savePdf, deletePdf } = require("../utils/pdfStorage");

// migrate({ apply }) does the work and returns a small report. apply=false means "dry run".
const migrate = async ({ apply = false } = {}) => {
    // Counters for the final report.
    const report = { found: 0, migrated: 0, skipped: 0, failed: 0 };
    // Find old-style rows: they have base64 text in fileData and no fileId yet. "+fileData" loads the normally-hidden field.
    // .cursor() hands us one row at a time instead of loading every PDF into memory at once (they are big!).
    const cursor = Document.find({ fileId: { $exists: false }, fileData: { $exists: true, $ne: "" } }).select("+fileData").cursor();
    // Walk through the rows one by one.
    for await (const doc of cursor) {
        // One more old-style document found.
        report.found += 1;
        // Dry run: just say what would happen and move on.
        if (!apply) { report.skipped += 1; continue; }
        // The original bytes, decoded from base64 text.
        const buffer = Buffer.from(doc.fileData, "base64");
        // We remember the new file's id so we can undo it if something goes wrong below.
        let fileId = null;
        try {
            // 1) copy the bytes into GridFS (the old data is still untouched at this point).
            fileId = await savePdf(buffer, doc.fileName, doc.userId);
            // 2) check the stored copy has EXACTLY the same size as the original before we trust it.
            const stored = await mongoose.connection.db.collection("pdfs.files").findOne({ _id: fileId });
            if (!stored || stored.length !== buffer.length) throw new Error("size mismatch after copy");
            // 3) only now switch the row over: set the new fileId and remove the old base64 text, in ONE update.
            await Document.updateOne({ _id: doc._id }, { $set: { fileId }, $unset: { fileData: 1 } });
            // This document is done.
            report.migrated += 1;
        } catch (err) {
            // Something failed: leave the old data exactly as it was, and delete the half-copied GridFS file if there is one.
            if (fileId) await deletePdf(fileId);
            // Count the failure and say which document it was.
            report.failed += 1;
            console.error(`Could not migrate document ${doc._id}:`, err.message);
        }
    }
    // Hand the report back to whoever called us (the command line below, or a test).
    return report;
};

// export so tests can call migrate() directly.
module.exports = { migrate };

// require.main === module means "this file was started directly with node", not imported by another file.
if (require.main === module) {
    // Only an explicit --apply flag makes real changes.
    const apply = process.argv.includes("--apply");
    // Connect, run, report, disconnect.
    mongoose.connect(process.env.MONGO_URI)
        .then(() => migrate({ apply }))
        .then((report) => {
            console.log(apply ? "Migration finished:" : "DRY RUN (nothing changed). Re-run with --apply to migrate:", report);
        })
        .catch((err) => { console.error("Migration failed:", err.message); process.exitCode = 1; })
        .finally(() => mongoose.disconnect());
}
