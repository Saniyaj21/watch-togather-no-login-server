const Room = require("../models/Room");
const { videoLimiter } = require("../utils/socketRateLimit");

const MAX_URL_LENGTH = 2048;

function isValidTime(val) {
  return typeof val === "number" && isFinite(val) && val >= 0;
}

function isValidUrl(val) {
  if (typeof val !== "string" || val.length === 0 || val.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(val);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

module.exports = (io, socket, roomId, name) => {
  socket.on("video:change", async ({ url, videoType }) => {
    if (!videoLimiter(socket.id)) return;
    if (!isValidUrl(url)) return;
    const safeType = videoType === "youtube" ? "youtube" : "iframe";

    await Room.findOneAndUpdate(
      { roomId },
      {
        videoUrl: url,
        videoType: safeType,
        "videoState.isPlaying": false,
        "videoState.currentTime": 0,
        "videoState.lastUpdatedAt": new Date(),
      }
    );

    socket.to(roomId).emit("video:changed", { url, videoType: safeType });
  });

  socket.on("video:play", async ({ currentTime }) => {
    if (!videoLimiter(socket.id)) return;
    if (!isValidTime(currentTime)) return;

    await Room.findOneAndUpdate(
      { roomId },
      {
        "videoState.isPlaying": true,
        "videoState.currentTime": currentTime,
        "videoState.lastUpdatedAt": new Date(),
      }
    );

    socket.to(roomId).emit("video:played", {
      currentTime,
      serverTimestamp: Date.now(),
      name,
    });
  });

  socket.on("video:pause", async ({ currentTime }) => {
    if (!videoLimiter(socket.id)) return;
    if (!isValidTime(currentTime)) return;

    await Room.findOneAndUpdate(
      { roomId },
      {
        "videoState.isPlaying": false,
        "videoState.currentTime": currentTime,
        "videoState.lastUpdatedAt": new Date(),
      }
    );

    socket.to(roomId).emit("video:paused", { currentTime, name });
  });

  socket.on("video:seek", async ({ currentTime }) => {
    if (!videoLimiter(socket.id)) return;
    if (!isValidTime(currentTime)) return;

    await Room.findOneAndUpdate(
      { roomId },
      {
        "videoState.currentTime": currentTime,
        "videoState.lastUpdatedAt": new Date(),
      }
    );

    socket.to(roomId).emit("video:seeked", { currentTime, name });
  });
};
