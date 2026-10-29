const mongoose = require("mongoose");
module.exports = mongoose.model(
  "AiWorkerStatus",
  new mongoose.Schema(
    { _id: String, lastSeenAt: Date, workerId: String },
    { versionKey: false },
  ),
);
