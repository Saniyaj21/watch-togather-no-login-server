const Message = require("../models/Message");
const { chatLimiter } = require("../utils/socketRateLimit");

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
};
