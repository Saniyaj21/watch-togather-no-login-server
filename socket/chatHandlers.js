const Message = require("../models/Message");
const Room = require("../models/Room");
const { chatLimiter, paginationLimiter } = require("../utils/socketRateLimit");
const seenState = require("./seenState");

// AES-GCM ciphertext for 2000-char plaintext is ~2710 chars; allow up to 4096
const MAX_MESSAGE_LENGTH = 4096;
const PAGE_SIZE = 30;

module.exports = (io, socket, roomId, name) => {
  socket.on("chat:send", async ({ text, replyToMessageId, replyToSnippet, imageUrl }) => {
    if (!chatLimiter(socket.id)) return;

    const hasText = text && typeof text === "string" && text.trim().length > 0;
    const hasImage = imageUrl && typeof imageUrl === "string" &&
      imageUrl.startsWith("https://res.cloudinary.com/") && imageUrl.length <= 500;
    if (!hasText && !hasImage) return;

    const trimmed = hasText ? text.trim() : "";
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;

    let replyTo = null;
    if (replyToMessageId) {
      try {
        const original = await Message.findOne({
          _id: replyToMessageId,
          roomId,
        }).lean();
        if (original && !original.isDeleted) {
          // Use the client-supplied encrypted snippet when provided; it preserves
          // the original plaintext meaning. Fall back to slicing stored text only
          // for unencrypted rooms (backward compatibility).
          const snippet =
            replyToSnippet && typeof replyToSnippet === "string" && replyToSnippet.length <= 300
              ? replyToSnippet
              : original.text.slice(0, 80);
          replyTo = {
            messageId: original._id,
            senderName: original.senderName,
            textSnippet: snippet,
          };
        }
      } catch {
        // invalid id — ignore replyTo
      }
    }

    const message = await Message.create({
      roomId,
      senderName: name,
      text: trimmed || " ",
      replyTo: replyTo || undefined,
      imageUrl: hasImage ? imageUrl : undefined,
    });

    io.to(roomId).emit("chat:received", {
      _id: message._id.toString(),
      senderName: message.senderName,
      text: message.text,
      createdAt: message.createdAt,
      isDeleted: false,
      editedAt: null,
      replyTo: replyTo
        ? {
            messageId: replyTo.messageId.toString(),
            senderName: replyTo.senderName,
            textSnippet: replyTo.textSnippet,
          }
        : null,
      imageUrl: hasImage ? imageUrl : null,
    });
  });

  socket.on("chat:load-more", async ({ beforeCreatedAt }, callback) => {
    if (typeof callback !== "function") return;
    if (!paginationLimiter(socket.id)) return callback({ messages: [], hasMore: false });
    try {
      const date = new Date(beforeCreatedAt);
      if (isNaN(date.getTime())) return callback({ messages: [], hasMore: false });

      const messages = await Message.find({
        roomId,
        createdAt: { $lt: date },
      })
        .sort({ createdAt: -1 })
        .limit(PAGE_SIZE + 1)
        .lean();

      const hasMore = messages.length > PAGE_SIZE;
      const page = messages
        .slice(0, PAGE_SIZE)
        .reverse()
        .map((m) => ({
          _id: m._id.toString(),
          senderName: m.senderName,
          text: m.text,
          createdAt: m.createdAt,
          isDeleted: m.isDeleted || false,
          editedAt: m.editedAt || null,
          replyTo: m.replyTo && m.replyTo.messageId
            ? {
                messageId: m.replyTo.messageId.toString(),
                senderName: m.replyTo.senderName,
                textSnippet: m.replyTo.textSnippet,
              }
            : null,
          imageUrl: m.imageUrl || null,
        }));

      callback({ messages: page, hasMore });
    } catch (e) {
      callback({ messages: [], hasMore: false });
    }
  });

  socket.on("chat:edit", async ({ messageId, newText }) => {
    if (!chatLimiter(socket.id)) return;
    if (!messageId || !newText || typeof newText !== "string") return;
    const trimmed = newText.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return; // MAX_MESSAGE_LENGTH covers encrypted payloads

    try {
      const message = await Message.findOne({ _id: messageId, roomId }).lean();
      if (!message) return;
      if (message.senderName !== name) return;
      if (message.isDeleted) return;

      const editedAt = new Date();
      await Message.findOneAndUpdate(
        { _id: messageId, roomId },
        { text: trimmed, editedAt }
      );

      io.to(roomId).emit("chat:message-edited", {
        messageId: messageId.toString(),
        newText: trimmed,
        editedAt: editedAt.toISOString(),
      });
    } catch {
      // invalid id — ignore
    }
  });

  socket.on("chat:delete", async ({ messageId }) => {
    if (!chatLimiter(socket.id)) return;
    if (!messageId) return;

    try {
      const message = await Message.findOne({ _id: messageId, roomId }).lean();
      if (!message) return;

      // Allow sender or host to delete
      const room = await Room.findOne({ roomId }, "hostSocketId").lean();
      const isHost = room && room.hostSocketId === socket.id;
      if (message.senderName !== name && !isHost) return;

      await Message.findOneAndUpdate(
        { _id: messageId, roomId },
        { isDeleted: true, text: "" }
      );

      io.to(roomId).emit("chat:message-deleted", {
        messageId: messageId.toString(),
      });
    } catch {
      // invalid id — ignore
    }
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
