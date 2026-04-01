const Message = require("../models/Message");
const { chatLimiter } = require("../utils/socketRateLimit");
const seenState = require("./seenState");

const MAX_MESSAGE_LENGTH = 2000;

module.exports = (io, socket, roomId, name) => {
  socket.on("chat:send", async ({ text }) => {
    if (!chatLimiter(socket.id)) return;
    if (!text || typeof text !== "string") return;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return;

    const message = await Message.create({
      roomId,
      senderName: name,
      text: trimmed,
    });

    io.to(roomId).emit("chat:received", {
      senderName: message.senderName,
      text: message.text,
      createdAt: message.createdAt,
    });
  });

  socket.on("chat:typing", ({ isTyping }) => {
    if (typeof isTyping !== "boolean") return;
    socket.to(roomId).emit("chat:user-typing", { name, isTyping });
  });

  socket.on("chat:seen", ({ lastSeenAt }) => {
    if (typeof lastSeenAt !== "string" || !lastSeenAt) return;
    seenState.update(roomId, socket.id, name, lastSeenAt);
    io.to(roomId).emit("chat:seen-update", { seenData: seenState.getList(roomId) });
  });
};
