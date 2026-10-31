const mongoose = require("mongoose");

let connected = false;

// MongoDB is optional: if MONGO_URI is not set, the API still works with the in-memory buffer only
async function connectDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.log("[DB] MONGO_URI not set: history is kept in memory only.");
    return;
  }
  try {
    await mongoose.connect(uri);
    connected = true;
    console.log("[DB] MongoDB connected.");
  } catch (err) {
    console.error("[DB] MongoDB connection failed:", err.message);
  }
}

const isDbConnected = () => connected && mongoose.connection.readyState === 1;

module.exports = { connectDb, isDbConnected };
