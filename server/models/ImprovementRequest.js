const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    authorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    authorName: { type: String, required: true },
    authorType: { type: String, enum: ["human", "ai"], default: "human" },
    suggestionKey: { type: String, select: false },
    title: { type: String, required: true, maxlength: 100 },
    description: { type: String, required: true, maxlength: 2000 },
    reviewStatus: {
      type: String,
      enum: ["pending", "reviewed"],
      default: "pending",
    },
    decision: {
      type: String,
      enum: ["implemented", "partial", "rejected", null],
      default: null,
    },
    reviewNote: { type: String, maxlength: 2000, default: "" },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewerName: { type: String, default: "" },
  },
  { timestamps: true },
);
module.exports = mongoose.model("ImprovementRequest", schema);
