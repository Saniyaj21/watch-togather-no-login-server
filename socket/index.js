const Room = require("../models/Room");
const Message = require("../models/Message");
const chatHandlers = require("./chatHandlers");
const videoHandlers = require("./videoHandlers");
const queueHandlers = require("./queueHandlers");
const seenState = require("./seenState");

module.exports = (io) => {
  io.on("connection", async (socket) => {
    const { roomId, name } = socket.handshake.query;

    if (!roomId || !name) {
      socket.disconnect(true);
      return;
    }

    console.log(`${name} connected to room ${roomId}`);

    // Join the Socket.IO room
    socket.join(roomId);

    // Re-activate room if it was deactivated (user backgrounded and came back)
    // Also remove any stale entries for the same user name before adding fresh one
    let room = await Room.findOneAndUpdate(
      { roomId },
      {
        isActive: true,
        lastActivityAt: new Date(),
        $pull: { participants: { name } },
      },
      { new: true }
    );

    if (!room) {
      socket.emit("error", { message: "Room not found" });
      socket.disconnect(true);
      return;
    }

    // Now add the participant with new socketId
    room = await Room.findOneAndUpdate(
      { roomId },
      {
        $push: {
          participants: { socketId: socket.id, name },
        },
      },
      { new: true }
    );

    // If no host yet (new room), assign this person as host
    // If rejoining as the original host, refresh their socket ID
    if (!room.hostName || room.participants.length === 1) {
      await Room.findOneAndUpdate(
        { roomId },
        { hostSocketId: socket.id, hostName: name }
      );
    } else if (room.hostName === name) {
      await Room.findOneAndUpdate(
        { roomId },
        { hostSocketId: socket.id }
      );
    }

    // Notify everyone of updated participant list + current host
    const hostInfo = await Room.findOne({ roomId }, "hostName");
    io.to(roomId).emit("room:participant-joined", {
      name,
      participants: room.participants,
      hostName: hostInfo?.hostName || room.hostName,
    });

    // Send current video state to the joiner
    if (room.videoUrl) {
      let currentTime = room.videoState.currentTime;
      if (room.videoState.isPlaying) {
        const elapsed =
          (Date.now() - new Date(room.videoState.lastUpdatedAt).getTime()) /
          1000;
        currentTime += elapsed;
      }

      socket.emit("video:state", {
        url: room.videoUrl,
        videoType: room.videoType,
        isPlaying: room.videoState.isPlaying,
        currentTime,
        serverTimestamp: Date.now(),
      });
    }

    // Send recent chat messages (paginated shape)
    const recentMessages = await Message.find({ roomId })
      .sort({ createdAt: -1 })
      .limit(51)
      .lean();

    const hasMore = recentMessages.length > 50;
    const msgs = recentMessages
      .slice(0, 50)
      .reverse()
      .map((m) => ({
        _id: m._id.toString(),
        senderName: m.senderName,
        text: m.text,
        createdAt: m.createdAt,
        isDeleted: m.isDeleted || false,
        editedAt: m.editedAt || null,
        replyTo:
          m.replyTo && m.replyTo.messageId
            ? {
                messageId: m.replyTo.messageId.toString(),
                senderName: m.replyTo.senderName,
                textSnippet: m.replyTo.textSnippet,
              }
            : null,
        imageUrl: m.imageUrl || null,
      }));

    socket.emit("chat:history", { messages: msgs, hasMore });

    // Send queue state to the joiner
    socket.emit("queue:state", {
      queue: room.queue || [],
      currentQueueIndex: room.currentQueueIndex != null ? room.currentQueueIndex : -1,
    });

    // Register event handlers
    chatHandlers(io, socket, roomId, name);
    videoHandlers(io, socket, roomId, name);
    queueHandlers(io, socket, roomId, name);

    // Host can kick a participant
    socket.on("room:kick", async ({ socketId: targetSocketId }) => {
      const currentRoom = await Room.findOne({ roomId });
      if (!currentRoom || currentRoom.hostSocketId !== socket.id) return; // only host can kick
      if (targetSocketId === socket.id) return; // can't kick yourself

      const target = currentRoom.participants.find(
        (p) => p.socketId === targetSocketId
      );
      if (!target) return;

      // Notify the kicked user
      io.to(targetSocketId).emit("room:kicked", {
        reason: "You were removed by the host",
      });

      // Force disconnect the kicked user's socket
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(roomId);
        targetSocket.disconnect(true);
      }

      // Remove from DB
      const updatedRoom = await Room.findOneAndUpdate(
        { roomId },
        { $pull: { participants: { socketId: targetSocketId } } },
        { new: true }
      );

      if (updatedRoom) {
        io.to(roomId).emit("room:participant-left", {
          name: target.name,
          participants: updatedRoom.participants,
        });
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      console.log(`${name} disconnected from room ${roomId}`);

      const updatedRoom = await Room.findOneAndUpdate(
        { roomId },
        { $pull: { participants: { socketId: socket.id } } },
        { new: true }
      );

      if (!updatedRoom) return;

      // DON'T deactivate room on last disconnect — user may just be backgrounding
      // Room will be reactivated on reconnect, or cleaned up by TTL/cron later

      // Notify others
      io.to(roomId).emit("room:participant-left", {
        name,
        participants: updatedRoom.participants,
      });

      // Clear typing status
      socket.to(roomId).emit("chat:user-typing", { name, isTyping: false });

      // Clear seen state
      seenState.remove(roomId, socket.id);
      io.to(roomId).emit("chat:seen-update", { seenData: seenState.getList(roomId) });
    });
  });
};
