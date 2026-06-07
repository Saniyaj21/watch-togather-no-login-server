const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  roomId: { type: String, required: true, index: true },
  senderName: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false },
  editedAt: { type: Date, default: null },
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    senderName: { type: String, default: null },
    textSnippet: { type: String, default: null },
  },
  imageUrl: { type: String, default: null },
});

// Auto-delete messages older than 24 hours
messageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

// Compound index for efficient pagination queries
messageSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
