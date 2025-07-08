import express from "express";
import { createServer } from "http";
import { initGameServer } from "./gameServer";
const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// Create http server to share with socket.io
const httpServer = createServer(app);

// Initialise the game socket server
initGameServer(app, httpServer);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

httpServer.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
