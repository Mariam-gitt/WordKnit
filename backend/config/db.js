const mongoose = require("mongoose"); // library that manages the connection + models for MongoDB

// Opens a connection to MongoDB, reusing an existing one when possible.
const connectDB = async () => {
  // readyState of 1 means "already connected" — on Vercel, many requests share the same
  // warm serverless instance, so this check saves us from reconnecting on every request.
  if (mongoose.connections[0].readyState) {
    return;
  }

  // No try/catch here on purpose: if the connection fails, we let the error bubble up to
  // server.js, which already wraps this call in its own try/catch and returns a proper
  // 503 response. (This used to call process.exit(1) on failure — fine for a traditional
  // always-running server, but on Vercel that kills the whole serverless function instance
  // instead of just failing the one request, which is far more disruptive.)
  await mongoose.connect(process.env.MONGO_URI);
};

module.exports = connectDB;
