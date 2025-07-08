import express from "express";
import cors from "cors";
import { createServer } from "http";
import { initGameServer } from "./gameServer";
import { roomManager } from "./roomManager";

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Configure CORS to allow frontend requests
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Parse JSON bodies
app.use(express.json());

// Create http server to share with socket.io
const httpServer = createServer(app);

// Room API routes
app.post("/api/rooms/create", (req, res) => {
  try {
    // Just generate a room ID without creating the room yet
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    res.json({ success: true, room: { id: roomId, isCreator: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to create room" });
  }
});

app.post("/api/rooms/join", (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, error: "Room ID required" });
    }

    const socketId = "temp_" + Math.random().toString(36).substring(7);
    const result = roomManager.joinRoom(roomId.toUpperCase(), socketId);

    if (result.success) {
      res.json({
        success: true,
        room: { id: roomId.toUpperCase(), playerToken: socketId },
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to join room" });
  }
});

app.get("/api/rooms/:roomId", (req, res) => {
  try {
    const { roomId } = req.params;
    const room = roomManager.getRoom(roomId.toUpperCase());

    if (!room) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    res.json({
      success: true,
      room: {
        id: room.id,
        playerCount: room.players.length,
        maxPlayers: room.maxPlayers,
        minPlayers: room.minPlayers,
        status: room.status,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to get room info" });
  }
});

// Initialise the game socket server
initGameServer(app, httpServer);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// Cleanup rooms every 10 minutes
setInterval(() => {
  roomManager.cleanup();
}, 10 * 60 * 1000);

httpServer.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
