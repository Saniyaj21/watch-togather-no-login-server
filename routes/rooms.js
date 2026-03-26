const express = require("express");
const router = express.Router();
const Room = require("../models/Room");
const generateRoomId = require("../utils/generateRoomId");

// Create a new room
router.post("/", async (req, res) => {
  try {
    const { hostName } = req.body;
    if (!hostName || !hostName.trim()) {
      return res.status(400).json({ error: "hostName is required" });
    }

    let roomId;
    let exists = true;
    while (exists) {
      roomId = generateRoomId();
      exists = await Room.findOne({ roomId });
    }

    const room = await Room.create({
      roomId,
      hostName: hostName.trim(),
    });

    res.status(201).json({ roomId: room.roomId });
  } catch (err) {
    res.status(500).json({ error: "Failed to create room" });
  }
});

// Get room details
router.get("/:roomId", async (req, res) => {
  try {
    const room = await Room.findOne({
      roomId: req.params.roomId,
      isActive: true,
    });
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json(room);
  } catch (err) {
    res.status(500).json({ error: "Failed to get room" });
  }
});

// Join a room
router.post("/:roomId/join", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const room = await Room.findOne({
      roomId: req.params.roomId,
      isActive: true,
    });
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }

    res.json({
      roomId: room.roomId,
      hostName: room.hostName,
      videoUrl: room.videoUrl,
      videoType: room.videoType,
      videoState: room.videoState,
      participants: room.participants,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to join room" });
  }
});

module.exports = router;
