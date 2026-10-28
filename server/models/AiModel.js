const mongoose = require("mongoose");
module.exports = mongoose.model(
  "AiModel",
  new mongoose.Schema(
    {
      name: { type: String, required: true },
      provider: {
        type: String,
        enum: ["openrouter", "vercel", "compatible"],
        required: true,
      },
      baseUrl: String,
      model: String,
      apiKeyCipher: { type: String, select: false },
      enabled: { type: Boolean, default: true },
      isDefault: { type: Boolean, default: false },
      timeoutSeconds: { type: Number, default: 60 },
      maxTokens: { type: Number, default: 512 },
      temperature: { type: Number, default: 0.3 },
      updatedBy: mongoose.Schema.Types.ObjectId,
    },
    { timestamps: true },
  ),
);
