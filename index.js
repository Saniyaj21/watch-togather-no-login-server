require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const connectDB = require("./config/db");
const roomsRouter = require("./routes/rooms");
const uploadRouter = require("./routes/upload");
const initSocket = require("./socket");
const { startImageCleanup } = require("./utils/imageCleanup");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting on API routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
app.use("/api/", apiLimiter);

// Routes
app.use("/api/rooms", roomsRouter);
app.use("/api/upload", uploadRouter);

app.get("/", (req, res) => {
  res.json({ status: "Watch Together server running" });
});

// Socket.IO
initSocket(io);

// Start
const PORT = process.env.PORT || 3000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
  startImageCleanup();
});
