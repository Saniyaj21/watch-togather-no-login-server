const Room = require("../models/Room");
const { videoLimiter } = require("../utils/socketRateLimit");

const MAX_URL_LENGTH = 2048;
const MAX_QUEUE_SIZE = 50;

// Per-room debounce for queue:advance to prevent double-advance
const lastAdvancedAt = new Map();

function isValidUrl(val) {
  if (typeof val !== "string" || val.length === 0 || val.length > MAX_URL_LENGTH) return false;
  try {
    const parsed = new URL(val);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function safeVideoType(videoType) {
  if (videoType === "youtube" || videoType === "direct" || videoType === "iframe") return videoType;
  return "iframe";
}

module.exports = (io, socket, roomId, name) => {
  socket.on("queue:add", async ({ url, videoType }) => {
    if (!videoLimiter(socket.id)) return;
    if (!isValidUrl(url)) return;

    const room = await Room.findOne({ roomId }).lean();
    if (!room) return;
    if (room.queue && room.queue.length >= MAX_QUEUE_SIZE) return;

    const type = safeVideoType(videoType);
    const updatedRoom = await Room.findOneAndUpdate(
      { roomId },
      {
        $push: {
          queue: { url, videoType: type, addedBy: name, addedAt: new Date() },
        },
      },
      { new: true }
    );

    if (updatedRoom) {
      io.to(roomId).emit("queue:updated", { queue: updatedRoom.queue });
    }
  });

  socket.on("queue:remove", async ({ index }) => {
    if (!videoLimiter(socket.id)) return;
    if (typeof index !== "number" || index < 0) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    // Only host can remove
    if (room.hostSocketId !== socket.id) return;
    if (index >= room.queue.length) return;

    room.queue.splice(index, 1);

    // Adjust currentQueueIndex
    if (room.currentQueueIndex >= room.queue.length) {
      room.currentQueueIndex = room.queue.length - 1;
    } else if (room.currentQueueIndex > index) {
      room.currentQueueIndex -= 1;
    } else if (room.currentQueueIndex === index) {
      // Playing item was removed — reset
      room.currentQueueIndex = -1;
    }

    await room.save();

    io.to(roomId).emit("queue:updated", { queue: room.queue });
  });

  socket.on("queue:reorder", async ({ fromIndex, toIndex }) => {
    if (!videoLimiter(socket.id)) return;
    if (typeof fromIndex !== "number" || typeof toIndex !== "number") return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    // Only host can reorder
    if (room.hostSocketId !== socket.id) return;

    const len = room.queue.length;
    if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len) return;
    if (fromIndex === toIndex) return;

    const [item] = room.queue.splice(fromIndex, 1);
    room.queue.splice(toIndex, 0, item);

    // Keep currentQueueIndex pointing at the same item after reorder
    if (room.currentQueueIndex === fromIndex) {
      room.currentQueueIndex = toIndex;
    } else if (fromIndex < toIndex) {
      if (room.currentQueueIndex > fromIndex && room.currentQueueIndex <= toIndex) {
        room.currentQueueIndex -= 1;
      }
    } else {
      if (room.currentQueueIndex >= toIndex && room.currentQueueIndex < fromIndex) {
        room.currentQueueIndex += 1;
      }
    }

    await room.save();

    io.to(roomId).emit("queue:updated", { queue: room.queue });
  });

  socket.on("queue:play-index", async ({ index }) => {
    if (!videoLimiter(socket.id)) return;
    if (typeof index !== "number" || index < 0) return;

    const room = await Room.findOne({ roomId });
    if (!room) return;
    if (index >= room.queue.length) return;

    const item = room.queue[index];

    await Room.findOneAndUpdate(
      { roomId },
      {
        currentQueueIndex: index,
        videoUrl: item.url,
        videoType: item.videoType || "iframe",
        "videoState.isPlaying": false,
        "videoState.currentTime": 0,
        "videoState.lastUpdatedAt": new Date(),
      }
    );

    io.to(roomId).emit("queue:index-changed", {
      index,
      url: item.url,
      videoType: item.videoType,
    });
    io.to(roomId).emit("video:changed", {
      url: item.url,
      videoType: item.videoType,
    });
  });

  socket.on("queue:advance", async () => {
    if (!videoLimiter(socket.id)) return;

    const now = Date.now();
    const last = lastAdvancedAt.get(roomId) || 0;
    if (now - last < 5000) return;
    lastAdvancedAt.set(roomId, now);

    const room = await Room.findOne({ roomId });
    if (!room) return;

    const nextIndex = room.currentQueueIndex + 1;

    if (nextIndex >= room.queue.length) {
      await Room.findOneAndUpdate({ roomId }, { currentQueueIndex: -1 });
      io.to(roomId).emit("queue:exhausted");
      return;
    }

    const item = room.queue[nextIndex];

    await Room.findOneAndUpdate(
      { roomId },
      {
        currentQueueIndex: nextIndex,
        videoUrl: item.url,
        videoType: item.videoType || "iframe",
        "videoState.isPlaying": false,
        "videoState.currentTime": 0,
        "videoState.lastUpdatedAt": new Date(),
      }
    );

    io.to(roomId).emit("queue:index-changed", {
      index: nextIndex,
      url: item.url,
      videoType: item.videoType,
    });
    io.to(roomId).emit("video:changed", {
      url: item.url,
      videoType: item.videoType,
    });
  });
};
