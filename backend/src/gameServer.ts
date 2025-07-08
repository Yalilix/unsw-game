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
const PLAYER_SIZE = 32; // Visual size remains 32
const TILE_SIZE = 32;
const TILE_COLLISION_SIZE = 32; // Smaller collision box for tiles (4px padding each side)
const KILL_RADIUS = PLAYER_SIZE * 2; // larger proximity for teleport
const VISION_RADIUS = 10 * TILE_SIZE; // 10 tiles vision radius

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
  // Use a rectangular collision box at the bottom: 100% width, 20% height
  const footWidth = PLAYER_SIZE; // 100% of player width
  const footHeight = PLAYER_SIZE * 0.2; // 20% of player height
  const playerFootLeft = player.x;
  const playerFootRight = player.x + footWidth;
  const playerFootTop = player.y + PLAYER_SIZE - footHeight; // Start 20% from bottom
  const playerFootBottom = player.y + PLAYER_SIZE; // Bottom of sprite

  // Calculate tile collision offset to center smaller collision boxes
  const tileCollisionOffset = (TILE_SIZE - TILE_COLLISION_SIZE) / 2;

  for (let row = 0; row < decal2D.length; row++) {
    for (let col = 0; col < decal2D[0].length; col++) {
      const tile = decal2D[row][col];
      if (tile) {
        const tileX = col * TILE_SIZE + tileCollisionOffset;
        const tileY = row * TILE_SIZE + tileCollisionOffset;
        const tileRight = tileX + TILE_COLLISION_SIZE;
        const tileBottom = tileY + TILE_COLLISION_SIZE;

        // Check if the player's foot rectangle intersects with the tile's collision box
        if (
          playerFootLeft < tileRight &&
          playerFootRight > tileX &&
          playerFootTop < tileBottom &&
          playerFootBottom > tileY
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function getVisiblePlayers(
  viewer: Player,
  allPlayers: Player[]
): (Player & { opacity?: number })[] {
  return allPlayers
    .map((player) => {
      // Always include the viewer themselves at full opacity
      if (player.id === viewer.id) {
        return { ...player, opacity: 1.0 };
      }

      // Calculate distance from viewer to other player
      const distance = Math.sqrt(
        (player.x - viewer.x) ** 2 + (player.y - viewer.y) ** 2
      );

      // Extended vision radius for gradual fading
      const fadeStartRadius = VISION_RADIUS * 0.7; // Start fading at 70%
      const fadeEndRadius = VISION_RADIUS * 1.2; // Completely hidden at 120%

      if (distance <= fadeStartRadius) {
        // Fully visible
        return { ...player, opacity: 1.0 };
      } else if (distance <= fadeEndRadius) {
        // Gradual fade based on distance
        const fadeProgress =
          (distance - fadeStartRadius) / (fadeEndRadius - fadeStartRadius);
        const opacity = Math.max(0, 1.0 - fadeProgress);
        return { ...player, opacity };
      } else {
        // Too far, don't include
        return null;
      }
    })
    .filter((player) => player !== null) as (Player & { opacity: number })[];
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

    // Try moving in X direction first
    player.x += dx;
    if (isCollidingWithMap(player)) {
      player.x = previousX; // Revert X movement if collision
    }

    // Try moving in Y direction
    player.y += dy;
    if (isCollidingWithMap(player)) {
      player.y = previousY; // Revert Y movement if collision
    }
  }

  // Send player data with vision filtering
  for (const player of players) {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      const visiblePlayers = getVisiblePlayers(player, players);
      socket.emit("players", visiblePlayers);
    }
  }
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
