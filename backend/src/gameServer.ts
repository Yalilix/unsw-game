import express from "express";
import { Server as IOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import loadMap, { MapData } from "./mapLoader";

interface Player {
  id: string;
  x: number;
  y: number;
}

interface InputsState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const SPEED = 3.5;
const TICK_RATE = 30;
const PLAYER_SIZE = 32;
const TILE_SIZE = 32;
const KILL_RADIUS = PLAYER_SIZE * 2; // larger proximity for teleport

let players: Player[] = [];
const inputsMap: Record<string, InputsState> = {};
let ground2D: MapData["ground2D"]; // will be set after map loads
let decal2D: MapData["decal2D"];

function isColliding(
  rect1: { x: number; y: number; w: number; h: number },
  rect2: { x: number; y: number; w: number; h: number }
): boolean {
  return (
    rect1.x < rect2.x + rect2.w &&
    rect1.x + rect1.w > rect2.x &&
    rect1.y < rect2.y + rect2.h &&
    rect1.h + rect1.y > rect2.y
  );
}

function isCollidingWithMap(player: { x: number; y: number }): boolean {
  for (let row = 0; row < decal2D.length; row++) {
    for (let col = 0; col < decal2D[0].length; col++) {
      const tile = decal2D[row][col];
      if (
        tile &&
        isColliding(
          { x: player.x, y: player.y, w: PLAYER_SIZE, h: PLAYER_SIZE },
          { x: col * TILE_SIZE, y: row * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE }
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function tick(delta: number, io: IOServer): void {
  // Update players based on inputs
  for (const player of players) {
    const inputs = inputsMap[player.id];
    const previousY = player.y;
    const previousX = player.x;

    let dx = 0;
    let dy = 0;

    if (inputs?.up) dy -= SPEED;
    if (inputs?.down) dy += SPEED;
    if (inputs?.left) dx -= SPEED;
    if (inputs?.right) dx += SPEED;

    // Normalize diagonal movement
    if (dx !== 0 && dy !== 0) {
      const factor = SPEED / Math.sqrt(dx * dx + dy * dy);
      dx *= factor;
      dy *= factor;
    }

    player.x += dx;
    player.y += dy;

    if (isCollidingWithMap(player)) {
      player.x = previousX;
      player.y = previousY;
    }
  }

  // Emit game state
  io.emit("players", players);
}

export async function initGameServer(
  app: express.Application,
  httpServer: HTTPServer
): Promise<void> {
  // Load the tile map first
  const map = await loadMap();
  ground2D = map.ground2D;
  decal2D = map.decal2D;

  // Initialise Socket.IO server
  const io = new IOServer(httpServer, {
    cors: {
      origin: "*", // Allow dev server on different port
    },
  });

  io.on("connect", (socket) => {
    console.log("[game] user connected", socket.id);

    inputsMap[socket.id] = {
      up: false,
      down: false,
      left: false,
      right: false,
    };

    players.push({ id: socket.id, x: 800, y: 800 });

    socket.emit("map", { ground: ground2D, decal: decal2D });

    socket.on("inputs", (inputs: InputsState) => {
      inputsMap[socket.id] = inputs;
    });

    socket.on("teleport", () => {
      const player = players.find((p) => p.id === socket.id);
      if (!player) return;

      // find closest other player
      let closest: Player | null = null;
      let closestDist = Infinity;
      for (const other of players) {
        if (other.id === player.id) continue;
        const dist = Math.sqrt(
          (other.x - player.x) ** 2 + (other.y - player.y) ** 2
        );
        if (dist < closestDist) {
          closestDist = dist;
          closest = other;
        }
      }

      if (closest && closestDist <= KILL_RADIUS) {
        // teleport to target's position and respawn target
        player.x = closest.x;
        player.y = closest.y;
        closest.x = 0;
        closest.y = 0;
        io.emit("players", players);
      }
    });

    socket.on("disconnect", () => {
      players = players.filter((p) => p.id !== socket.id);
      delete inputsMap[socket.id];
    });
  });

  // Game loop
  let lastUpdate = Date.now();
  setInterval(() => {
    const now = Date.now();
    const delta = now - lastUpdate;
    tick(delta, io);
    lastUpdate = now;
  }, 1000 / TICK_RATE);

  // Optionally expose an endpoint for health check
  app.get("/game/health", (_req, res) => {
    res.send("ok");
  });

  console.log("[game] Game server initialised");
}
