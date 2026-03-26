const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
  roomId: { type: String, unique: true, required: true },
  hostSocketId: { type: String, default: null },
  hostName: { type: String, default: "" },
  videoUrl: { type: String, default: null },
  videoType: { type: String, enum: ["youtube", "iframe"], default: null },
  videoState: {
    isPlaying: { type: Boolean, default: false },
    currentTime: { type: Number, default: 0 },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  participants: [
    {
      socketId: { type: String, required: true },
      name: { type: String, required: true },
      joinedAt: { type: Date, default: Date.now },
    },
  ],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastActivityAt: { type: Date, default: Date.now },
});

// Auto-delete rooms with no activity for 24 hours
roomSchema.index({ lastActivityAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model("Room", roomSchema);
