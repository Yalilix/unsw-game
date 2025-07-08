import express from "express";
import { Server as IOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { promises as fs } from "fs";
import path from "path";
import loadMap, { MapData } from "./mapLoader";
import {
  roomManager,
  Room,
  GameInstance,
  GamePlayer,
  DeadBody,
  TaskLocation,
  TASK_LOCATIONS,
} from "./roomManager";

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
const KILL_RADIUS = PLAYER_SIZE * 3; // larger proximity for teleport
const VISION_RADIUS = 10 * TILE_SIZE; // 10 tiles vision radius

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

function isOutOfBounds(player: { x: number; y: number }): boolean {
  const mapWidth = decal2D[0]?.length * TILE_SIZE || 0;
  const mapHeight = decal2D.length * TILE_SIZE || 0;

  // Check if player is outside map boundaries
  return (
    player.x < 0 ||
    player.y < 0 ||
    player.x + PLAYER_SIZE > mapWidth ||
    player.y + PLAYER_SIZE > mapHeight
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
  viewer: GamePlayer,
  allPlayers: GamePlayer[]
): (GamePlayer & { opacity?: number })[] {
  return allPlayers
    .map((player) => {
      // Ghost visibility rules
      if (!viewer.isAlive) {
        // Dead players (ghosts) can see everyone
        if (!player.isAlive) {
          // Other ghosts at 50% opacity
          return { ...player, opacity: 0.5 };
        }
        // Ghosts can see living players at full opacity (fall through to distance check)
      } else {
        // Living player visibility
        if (!player.isAlive) {
          // Living players can't see ghosts
          return null;
        }
      }

      // Always include the viewer themselves at full opacity (if alive)
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
    .filter((player) => player !== null) as (GamePlayer & {
    opacity: number;
  })[];
}

function processVotes(
  gameInstance: GameInstance,
  io: IOServer,
  roomId: string
): void {
  const votes = gameInstance.votes;
  const voteCounts: Record<string, number> = {};

  // Count votes
  Object.values(votes).forEach((target) => {
    voteCounts[target] = (voteCounts[target] || 0) + 1;
  });

  // Find target with most votes
  let maxVotes = 0;
  let ejectedPlayer: string | null = null;
  let targetsWithMaxVotes: string[] = [];

  // First pass: find the maximum vote count
  Object.entries(voteCounts).forEach(([target, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
    }
  });

  // Second pass: collect all targets with maximum votes
  Object.entries(voteCounts).forEach(([target, count]) => {
    if (count === maxVotes && count > 0) {
      targetsWithMaxVotes.push(target);
    }
  });

  // Determine ejection result
  if (targetsWithMaxVotes.length === 0) {
    // No votes cast
    ejectedPlayer = null;
  } else if (targetsWithMaxVotes.length > 1) {
    // Tie between multiple targets (including potentially skip)
    ejectedPlayer = null;
  } else if (targetsWithMaxVotes[0] === "skip") {
    // Skip won outright
    ejectedPlayer = null;
  } else {
    // A specific player won outright
    ejectedPlayer = targetsWithMaxVotes[0];
  }

  // Eject player if not a tie
  let ejectedRole: string | null = null;
  let ejectedPlayerName: string | null = null;

  if (ejectedPlayer && ejectedPlayer !== "skip") {
    const player = gameInstance.players.find((p) => p.id === ejectedPlayer);
    if (player) {
      player.isAlive = false;
      ejectedRole = player.role;

      // Get player name from room data
      const room = roomManager.getRoom(roomId);
      if (room) {
        const roomPlayer = room.players.find(
          (rp) => rp.socketId === ejectedPlayer
        );
        ejectedPlayerName =
          roomPlayer?.name || `Player (${ejectedPlayer.slice(-4)})`;
      }
    }
  }

  // Resume game
  gameInstance.gameState = "playing";
  gameInstance.gameStartTime = Date.now(); // Reset kill cooldown timer
  gameInstance.votes = {};

  // Notify players
  io.to(`game_${roomId}`).emit("votingResults", {
    ejectedPlayer: ejectedPlayerName,
    ejectedRole: ejectedRole,
    votes: votes,
    voteCounts: voteCounts,
  });

  // Check win conditions after ejection
  if (ejectedPlayer) {
    checkWinConditions(gameInstance, io, roomId);
  }
}

function checkWinConditions(
  gameInstance: GameInstance,
  io: IOServer,
  roomId: string
): void {
  const alivePlayers = gameInstance.players.filter((p) => p.isAlive);
  const aliveImposters = alivePlayers.filter((p) => p.role === "imposter");
  const aliveCrewmates = alivePlayers.filter((p) => p.role === "crewmate");

  let gameOver = false;
  let winner: "imposters" | "crewmates" | null = null;

  // Crewmates win if all tasks are completed
  if (roomManager.areAllTasksCompleted(roomId)) {
    gameOver = true;
    winner = "crewmates";
    console.log(
      `[DEBUG] Crewmates win by completing all tasks in room ${roomId}`
    );
  }
  // Imposters win if they equal or outnumber crewmates
  else if (
    aliveImposters.length >= aliveCrewmates.length &&
    aliveImposters.length > 0
  ) {
    gameOver = true;
    winner = "imposters";
  }
  // Crewmates win if all imposters are dead
  else if (aliveImposters.length === 0) {
    gameOver = true;
    winner = "crewmates";
  }

  if (gameOver) {
    // Get the room to access player names
    const room = roomManager.getRoom(roomId);

    io.to(`game_${roomId}`).emit("gameOver", {
      winner: winner,
      alivePlayers: alivePlayers.map((p) => {
        const roomPlayer = room?.players.find((rp) => rp.socketId === p.id);
        return {
          id: p.id,
          role: p.role,
          name: roomPlayer?.name || `Player (${p.id.slice(-4)})`,
        };
      }),
      allPlayers: gameInstance.players.map((p) => {
        const roomPlayer = room?.players.find((rp) => rp.socketId === p.id);
        return {
          id: p.id,
          role: p.role,
          isAlive: p.isAlive,
          name: roomPlayer?.name || `Player (${p.id.slice(-4)})`,
        };
      }),
    });
  }
}

function tickRoom(roomId: string, delta: number, io: IOServer): void {
  const gameInstance = roomManager.getGameInstance(roomId);
  const room = roomManager.getRoom(roomId);

  if (!gameInstance || !room || room.status !== "playing") {
    return;
  }

  // Handle meeting timer (auto-start voting after 1 minute)
  if (gameInstance.gameState === "voting" && gameInstance.meetingStartTime) {
    const meetingDuration = Date.now() - gameInstance.meetingStartTime;
    if (meetingDuration >= 60000) {
      // 1 minute - process votes even if not everyone has voted
      processVotes(gameInstance, io, roomId);
    }
  }

  // Update players based on inputs (both alive and dead can move)
  for (const player of gameInstance.players) {
    const inputs = gameInstance.inputsMap[player.id];
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
    if (isCollidingWithMap(player) || isOutOfBounds(player)) {
      player.x = previousX; // Revert X movement if collision or out of bounds
    }

    // Try moving in Y direction
    player.y += dy;
    if (isCollidingWithMap(player) || isOutOfBounds(player)) {
      player.y = previousY; // Revert Y movement if collision or out of bounds
    }
  }

  // Send player data with vision filtering to each player in the room
  for (const player of gameInstance.players) {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      const visiblePlayers = getVisiblePlayers(player, gameInstance.players);
      socket.emit("players", visiblePlayers);

      // Send game state info including tasks
      socket.emit("gameState", {
        state: gameInstance.gameState,
        playerRole: player.role,
        isAlive: player.isAlive,
        deadBodies: gameInstance.deadBodies,
        gameStartTime: gameInstance.gameStartTime,
        lastKillTime: player.lastKillTime,
        playerTasks: gameInstance.playerTasks[player.id] || [],
        completedTasks: Array.from(gameInstance.completedTasks),
      });
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

  // Initialize Socket.IO server
  const io = new IOServer(httpServer, {
    cors: {
      origin: "*", // Allow dev server on different port
    },
  });

  io.on("connect", (socket) => {
    console.log("[game] user connected", socket.id);
    console.log(`[game] Total connections: ${io.engine.clientsCount}`);

    // Join room event
    socket.on(
      "joinRoom",
      (data: {
        roomId: string;
        playerToken?: string;
        isCreator?: boolean;
        originalSocketId?: string;
      }) => {
        const { roomId, playerToken, isCreator, originalSocketId } = data;
        let room = roomManager.getRoom(roomId);

        // If room doesn't exist and user is the creator, create it
        if (!room && isCreator) {
          const newRoom = roomManager.createRoom(socket.id);
          // Update the room ID to match the requested one
          roomManager.updateRoomId(newRoom.id, roomId);
          room = roomManager.getRoom(roomId);
        }

        if (!room) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        // If room is in waiting state, join the waiting room
        if (room.status === "waiting") {
          // Try to join the room through room manager (only if not already the creator)
          if (!isCreator) {
            const joinResult = roomManager.joinRoom(roomId, socket.id);
            if (!joinResult.success) {
              socket.emit("error", { message: joinResult.error });
              return;
            }
          }

          // Join socket room
          socket.join(`room_${roomId}`);

          // Get updated room after join
          const updatedRoom = roomManager.getRoom(roomId);
          if (!updatedRoom) return;

          socket.emit("roomJoined", {
            roomId: roomId,
            players: updatedRoom.players.map((p) => ({
              id: p.socketId,
              name: p.name,
            })),
            isHost: updatedRoom.host === socket.id,
            status: updatedRoom.status,
          });

          // Notify others in room
          socket.to(`room_${roomId}`).emit("playerJoined", {
            playerId: socket.id,
            playerCount: updatedRoom.players.length,
          });

          // Also emit updated room state to all players in room
          io.to(`room_${roomId}`).emit("roomUpdate", {
            playerCount: updatedRoom.players.length,
            players: updatedRoom.players.map((p) => ({
              id: p.socketId,
              name: p.name,
            })),
          });
          return;
        }

        // If room is playing, join the game
        if (room && room.status === "playing") {
          console.log(
            `[DEBUG] Player ${socket.id} joining active game ${roomId}`
          );
          const gameInstance = roomManager.getGameInstance(roomId);
          if (!gameInstance) {
            socket.emit("error", { message: "Game not found" });
            return;
          }

          socket.join(`game_${roomId}`);

          // Try to reconnect to existing player if we have original socket ID
          let reconnected = false;
          if (originalSocketId) {
            console.log(
              `[DEBUG] Attempting reconnection: ${originalSocketId} -> ${socket.id}`
            );
            reconnected = roomManager.reconnectPlayerToGame(
              originalSocketId,
              socket.id,
              roomId
            );
            console.log(
              `[DEBUG] Reconnection ${reconnected ? "SUCCESS" : "FAILED"}`
            );
          } else {
            console.log(
              `[DEBUG] No originalSocketId provided for ${socket.id}`
            );
          }

          if (!reconnected) {
            console.log(
              `[DEBUG] Player ${socket.id} could not be reconnected, treating as new player`
            );
            // Update the player to room mapping for this new socket connection
            roomManager.updatePlayerToRoom(socket.id, roomId);

            // Add this socket to the game instance if not already present
            const existingPlayer = gameInstance.players.find(
              (p) => p.id === socket.id
            );
            if (!existingPlayer) {
              // For truly new players joining mid-game, assign them as crewmate
              console.log(
                `[WARNING] New player ${socket.id} joining mid-game, assigning as crewmate`
              );
              gameInstance.players.push({
                id: socket.id,
                x: 56 * 32, // TILE_SIZE
                y: 14 * 32, // TILE_SIZE
                role: "crewmate",
                isAlive: true,
              });

              // Assign tasks to new crewmate (5 random tasks from available locations)
              const shuffledTasks = [...TASK_LOCATIONS].sort(
                () => Math.random() - 0.5
              );
              const assignedTasks = shuffledTasks
                .slice(0, 4)
                .map((location) => ({
                  location,
                  completed: false,
                }));
              gameInstance.playerTasks[socket.id] = assignedTasks;
              console.log(
                `[DEBUG] Assigned ${assignedTasks.length} tasks to new mid-game player ${socket.id}`
              );

              // Initialize inputs for new player
              gameInstance.inputsMap[socket.id] = {
                up: false,
                down: false,
                left: false,
                right: false,
              };
            }
          }

          socket.emit("gameJoined", { roomId });
          socket.emit("map", { ground: ground2D, decal: decal2D });

          // Send current game state with tasks to the joining player
          const player = gameInstance.players.find((p) => p.id === socket.id);
          if (player) {
            socket.emit("gameState", {
              state: gameInstance.gameState,
              playerRole: player.role,
              isAlive: player.isAlive,
              deadBodies: gameInstance.deadBodies,
              gameStartTime: gameInstance.gameStartTime,
              lastKillTime: player.lastKillTime,
              playerTasks: gameInstance.playerTasks[player.id] || [],
              completedTasks: Array.from(gameInstance.completedTasks),
            });
            console.log(
              `[DEBUG] Sent game state with ${
                gameInstance.playerTasks[player.id]?.length || 0
              } tasks to ${socket.id}`
            );
          }
          return;
        }

        // If no room found but there's a game instance, allow joining
        // (for when players reconnect after game started)
        if (!room) {
          const gameInstance = roomManager.getGameInstance(roomId);
          if (gameInstance) {
            socket.join(`game_${roomId}`);

            // Try to reconnect to existing player if we have original socket ID
            let reconnected = false;
            if (originalSocketId) {
              console.log(
                `[DEBUG] Attempting reconnection (no room): ${originalSocketId} -> ${socket.id}`
              );
              reconnected = roomManager.reconnectPlayerToGame(
                originalSocketId,
                socket.id,
                roomId
              );
              console.log(
                `[DEBUG] Reconnection (no room) ${
                  reconnected ? "SUCCESS" : "FAILED"
                }`
              );
            } else {
              console.log(
                `[DEBUG] No originalSocketId provided (no room) for ${socket.id}`
              );
            }

            if (!reconnected) {
              // Update the player to room mapping for this new socket connection
              roomManager.updatePlayerToRoom(socket.id, roomId);

              // Add this socket to the game instance if not already present
              const existingPlayer = gameInstance.players.find(
                (p) => p.id === socket.id
              );
              if (!existingPlayer) {
                // For truly new players joining mid-game, assign them as crewmate
                console.log(
                  `[WARNING] New player ${socket.id} joining mid-game without room, assigning as crewmate`
                );
                gameInstance.players.push({
                  id: socket.id,
                  x: 56 * 32, // TILE_SIZE
                  y: 14 * 32, // TILE_SIZE
                  role: "crewmate",
                  isAlive: true,
                });

                // Assign tasks to new crewmate (4 random tasks from available locations)
                const shuffledTasks = [...TASK_LOCATIONS].sort(
                  () => Math.random() - 0.5
                );
                const assignedTasks = shuffledTasks
                  .slice(0, 4)
                  .map((location) => ({
                    location,
                    completed: false,
                  }));
                gameInstance.playerTasks[socket.id] = assignedTasks;
                console.log(
                  `[DEBUG] Assigned ${assignedTasks.length} tasks to new mid-game player (no room) ${socket.id}`
                );

                // Initialize inputs for new player
                gameInstance.inputsMap[socket.id] = {
                  up: false,
                  down: false,
                  left: false,
                  right: false,
                };
              }
            }

            socket.emit("gameJoined", { roomId });
            socket.emit("map", { ground: ground2D, decal: decal2D });

            // Send current game state with tasks to the joining player
            const player = gameInstance.players.find((p) => p.id === socket.id);
            if (player) {
              socket.emit("gameState", {
                state: gameInstance.gameState,
                playerRole: player.role,
                isAlive: player.isAlive,
                deadBodies: gameInstance.deadBodies,
                gameStartTime: gameInstance.gameStartTime,
                lastKillTime: player.lastKillTime,
                playerTasks: gameInstance.playerTasks[player.id] || [],
                completedTasks: Array.from(gameInstance.completedTasks),
              });
              console.log(
                `[DEBUG] Sent game state (no room) with ${
                  gameInstance.playerTasks[player.id]?.length || 0
                } tasks to ${socket.id}`
              );
            }
            return;
          }
        }
      }
    );

    // Start game event (only host can start)
    socket.on("startGame", (data: { roomId: string }) => {
      const { roomId } = data;
      console.log(
        `[DEBUG] Starting game for room ${roomId} initiated by ${socket.id}`
      );
      const result = roomManager.startGame(roomId, socket.id);

      if (result.success) {
        const room = roomManager.getRoom(roomId);
        if (room) {
          console.log(`[DEBUG] Game started successfully for room ${roomId}`);
          console.log(
            `[DEBUG] Room players at game start: ${room.players
              .map((p) => `${p.socketId}:"${p.name}"`)
              .join(", ")}`
          );
          const startedGameInstance = roomManager.getGameInstance(roomId);
          if (startedGameInstance) {
            console.log(
              `[DEBUG] Game instance players: ${startedGameInstance.players
                .map((p) => `${p.id}:${p.role}`)
                .join(", ")}`
            );
          }
          // Move all players from waiting room to game room
          io.in(`room_${roomId}`).socketsJoin(`game_${roomId}`);
          io.in(`room_${roomId}`).socketsLeave(`room_${roomId}`);

          // Notify all players that game started
          io.to(`game_${roomId}`).emit("gameStarted", { roomId });
          io.to(`game_${roomId}`).emit("map", {
            ground: ground2D,
            decal: decal2D,
          });

          // Send initial game state to each player with their role and tasks
          const gameInstance = roomManager.getGameInstance(roomId);
          if (gameInstance) {
            console.log(
              `[DEBUG] Sending gameState to ${gameInstance.players.length} players after game start`
            );
            gameInstance.players.forEach((player) => {
              const socket = io.sockets.sockets.get(player.id);
              const playerTasks = gameInstance.playerTasks[player.id] || [];
              console.log(
                `[DEBUG] Player ${player.id} (${
                  player.role
                }): socket found=${!!socket}, tasks=${playerTasks.length}`
              );

              if (socket) {
                const gameStateData = {
                  state: gameInstance.gameState,
                  playerRole: player.role,
                  isAlive: player.isAlive,
                  deadBodies: gameInstance.deadBodies,
                  gameStartTime: gameInstance.gameStartTime,
                  lastKillTime: player.lastKillTime,
                  playerTasks: playerTasks,
                  completedTasks: Array.from(gameInstance.completedTasks),
                };
                console.log(
                  `[DEBUG] Emitting gameState to ${player.id} with ${gameStateData.playerTasks.length} tasks`
                );
                socket.emit("gameState", gameStateData);
              } else {
                console.log(`[DEBUG] Socket not found for player ${player.id}`);
              }
            });
          }
        }
      } else {
        socket.emit("error", { message: result.error });
      }
    });

    // Update player name
    socket.on("updatePlayerName", (data: { name: string }) => {
      const result = roomManager.updatePlayerName(socket.id, data.name);
      if (result.success) {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (room && room.status === "waiting") {
          // Notify all players in the room about the updated player list
          io.to(`room_${room.id}`).emit("roomUpdate", {
            playerCount: room.players.length,
            players: room.players.map((p) => ({
              id: p.socketId,
              name: p.name,
            })),
          });
        }
      } else {
        socket.emit("error", { message: result.error });
      }
    });

    // Game inputs
    socket.on("inputs", (inputs: InputsState) => {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (room && room.status === "playing") {
        const gameInstance = roomManager.getGameInstance(room.id);
        if (gameInstance) {
          // Prevent movement during voting phase
          if (gameInstance.gameState === "voting") {
            // Clear all inputs during voting
            gameInstance.inputsMap[socket.id] = {
              up: false,
              down: false,
              left: false,
              right: false,
            };
          } else {
            gameInstance.inputsMap[socket.id] = inputs;
          }
        }
      }
    });

    // Report dead body
    socket.on("reportBody", (data: { bodyId: string }) => {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room || room.status !== "playing") return;

      const gameInstance = roomManager.getGameInstance(room.id);
      if (!gameInstance || gameInstance.gameState !== "playing") return;

      const reporter = gameInstance.players.find((p) => p.id === socket.id);
      if (!reporter || !reporter.isAlive) return;

      const body = gameInstance.deadBodies.find((b) => b.id === data.bodyId);
      if (!body) return;

      // Check if reporter is close enough to the body
      const distance = Math.sqrt(
        (body.x - reporter.x) ** 2 + (body.y - reporter.y) ** 2
      );
      if (distance > KILL_RADIUS) return;

      // Start meeting with immediate voting
      gameInstance.gameState = "voting";
      gameInstance.meetingStartTime = Date.now();
      gameInstance.votes = {};

      // Mark body as reported
      body.reportedBy = socket.id;

      // Remove ALL dead bodies from the map after report
      gameInstance.deadBodies = [];

      // Teleport ALL players back to spawn (both alive and dead)
      const SPAWN_X = 56 * 32; // TILE_SIZE
      const SPAWN_Y = 14 * 32; // TILE_SIZE
      gameInstance.players.forEach((player) => {
        player.x = SPAWN_X;
        player.y = SPAWN_Y;
      });

      // Get player names from room data
      console.log(
        `[DEBUG] Looking up names for alive players in room ${room.id}`
      );
      console.log(
        `[DEBUG] Room players: ${room.players
          .map((rp) => `${rp.socketId}:${rp.name}`)
          .join(", ")}`
      );
      console.log(
        `[DEBUG] Game players: ${gameInstance.players
          .map((p) => `${p.id}:${p.isAlive ? "alive" : "dead"}`)
          .join(", ")}`
      );

      const alivePlayers = gameInstance.players
        .filter((p) => p.isAlive)
        .map((p) => {
          const roomPlayer = room.players.find((rp) => rp.socketId === p.id);
          const name = roomPlayer?.name || `Player (${p.id.slice(-4)})`;
          console.log(
            `[DEBUG] Player ${
              p.id
            } -> name: ${name} (found roomPlayer: ${!!roomPlayer})`
          );
          return {
            id: p.id,
            name: name,
          };
        });

      // Notify all players - start voting immediately
      io.to(`game_${room.id}`).emit("meetingStarted", {
        reportedBy: socket.id,
        bodyId: body.id,
        deadPlayer: body.playerId,
        alivePlayers: alivePlayers,
        allBodiesRemoved: true,
        teleportToSpawn: { x: SPAWN_X, y: SPAWN_Y },
      });
    });

    // Vote during meeting
    socket.on("vote", (data: { targetId: string }) => {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room || room.status !== "playing") return;

      const gameInstance = roomManager.getGameInstance(room.id);
      if (!gameInstance || gameInstance.gameState !== "voting") return;

      const voter = gameInstance.players.find((p) => p.id === socket.id);
      if (!voter || !voter.isAlive) return;

      // Record vote
      gameInstance.votes[socket.id] = data.targetId;

      // Check if all living players have voted
      const alivePlayers = gameInstance.players.filter((p) => p.isAlive);
      const votedPlayers = Object.keys(gameInstance.votes);

      if (votedPlayers.length >= alivePlayers.length) {
        processVotes(gameInstance, io, room.id);
      } else {
        // Notify players of vote update
        io.to(`game_${room.id}`).emit("voteUpdate", {
          votes: gameInstance.votes,
          votedCount: votedPlayers.length,
          totalCount: alivePlayers.length,
        });
      }
    });

    // Kill functionality (imposters only)
    socket.on("kill", () => {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room || room.status !== "playing") return;

      const gameInstance = roomManager.getGameInstance(room.id);
      if (!gameInstance || gameInstance.gameState !== "playing") return;

      const killer = gameInstance.players.find((p) => p.id === socket.id);
      if (!killer || !killer.isAlive || killer.role !== "imposter") return;

      const now = Date.now();
      const timeSinceGameStart = now - gameInstance.gameStartTime;
      const timeSinceLastKill = killer.lastKillTime
        ? now - killer.lastKillTime
        : Infinity;

      // Check cooldowns: no kills in first 30 seconds, then 30 second cooldown between kills
      if (timeSinceGameStart < 30000 || timeSinceLastKill < 30000) {
        socket.emit("killCooldown", {
          timeRemaining: Math.max(
            30000 - timeSinceGameStart,
            30000 - timeSinceLastKill
          ),
        });
        return;
      }

      // Find closest living non-imposter player
      let closestVictim: GamePlayer | null = null;
      let closestDist = Infinity;
      for (const other of gameInstance.players) {
        if (
          other.id === killer.id ||
          !other.isAlive ||
          other.role === "imposter"
        )
          continue;
        const dist = Math.sqrt(
          (other.x - killer.x) ** 2 + (other.y - killer.y) ** 2
        );
        if (dist < closestDist) {
          closestDist = dist;
          closestVictim = other;
        }
      }

      if (closestVictim && closestDist <= KILL_RADIUS) {
        // Teleport killer to victim's position
        killer.x = closestVictim.x;
        killer.y = closestVictim.y;

        // Kill the victim
        closestVictim.isAlive = false;
        killer.lastKillTime = now;

        // Create dead body at victim's position
        const deadBody: DeadBody = {
          id: `body_${now}_${closestVictim.id}`,
          x: closestVictim.x,
          y: closestVictim.y,
          playerId: closestVictim.id,
        };
        gameInstance.deadBodies.push(deadBody);

        // Check win conditions
        checkWinConditions(gameInstance, io, room.id);

        // Emit to all players in this game room
        io.to(`game_${room.id}`).emit("playerKilled", {
          victimId: closestVictim.id,
          deadBody: deadBody,
          killerId: killer.id,
          killerNewPosition: { x: killer.x, y: killer.y },
        });
      }
    });

    // Task attempt event (get a random question)
    socket.on("attemptTask", async (data: { taskLocation: TaskLocation }) => {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room || room.status !== "playing") return;

      const gameInstance = roomManager.getGameInstance(room.id);
      if (!gameInstance || gameInstance.gameState !== "playing") return;

      const player = gameInstance.players.find((p) => p.id === socket.id);
      if (!player || !player.isAlive || player.role !== "crewmate") return;

      // Check if player is at the task location (within reasonable distance)
      const TILE_SIZE = 32;
      const taskPixelX = data.taskLocation.x * TILE_SIZE;
      const taskPixelY = data.taskLocation.y * TILE_SIZE;
      const distance = Math.sqrt(
        (player.x - taskPixelX) ** 2 + (player.y - taskPixelY) ** 2
      );

      if (distance > TILE_SIZE * 1.5) {
        socket.emit("error", { message: "Too far from task location" });
        return;
      }

      // Check if player has this task assigned and it's not completed
      const playerTasks = gameInstance.playerTasks[socket.id] || [];
      const assignedTask = playerTasks.find(
        (task) =>
          task.location.x === data.taskLocation.x &&
          task.location.y === data.taskLocation.y &&
          !task.completed
      );

      if (!assignedTask) {
        socket.emit("error", { message: "No task assigned at this location" });
        return;
      }

      try {
        // Load questions from questions.json
        const questionsPath = path.join(
          __dirname,
          "../../frontend/src/questions.json"
        );
        const questionsData = await fs.readFile(questionsPath, "utf-8");
        const questions = JSON.parse(questionsData);

        // Get all questions from all weeks and lectures
        const allQuestions: any[] = [];
        for (const week of Object.values(questions.weeks)) {
          for (const lecture of Object.values(week as any)) {
            allQuestions.push(...(lecture as any[]));
          }
        }

        // Pick a random question
        const randomQuestion =
          allQuestions[Math.floor(Math.random() * allQuestions.length)];

        // Store the current question for this player
        gameInstance.currentQuestions[socket.id] = randomQuestion;

        socket.emit("taskQuestion", {
          taskLocation: data.taskLocation,
          question: randomQuestion.question,
          options: randomQuestion.options,
          // Don't send the correct answer to the client
        });

        console.log(
          `[DEBUG] Sent task question to ${socket.id} at (${data.taskLocation.x},${data.taskLocation.y})`
        );
      } catch (error) {
        console.error("[DEBUG] Error loading questions:", error);
        socket.emit("error", { message: "Failed to load task question" });
      }
    });

    // Task completion event (submit answer)
    socket.on(
      "completeTask",
      async (data: { taskLocation: TaskLocation; answer: string }) => {
        const room = roomManager.getRoomByPlayer(socket.id);
        if (!room || room.status !== "playing") return;

        const gameInstance = roomManager.getGameInstance(room.id);
        if (!gameInstance || gameInstance.gameState !== "playing") return;

        const player = gameInstance.players.find((p) => p.id === socket.id);
        if (!player || !player.isAlive || player.role !== "crewmate") return;

        try {
          // Get the current question for this player
          const currentQuestion = gameInstance.currentQuestions[socket.id];

          if (!currentQuestion) {
            socket.emit("error", { message: "No active question found" });
            return;
          }

          // Check if the submitted answer matches the correct answer for this question
          if (data.answer === currentQuestion.answer) {
            // Correct answer! Complete the task
            const result = roomManager.completeTask(
              socket.id,
              data.taskLocation
            );

            if (result.success) {
              socket.emit("taskCompleted", {
                taskLocation: data.taskLocation,
                correct: true,
              });

              // Clear the current question for this player
              delete gameInstance.currentQuestions[socket.id];

              // Notify all players about task completion
              io.to(`game_${room.id}`).emit("taskCompletedByPlayer", {
                playerId: socket.id,
                taskLocation: data.taskLocation,
              });

              console.log(
                `[DEBUG] Task completed by ${socket.id} at (${data.taskLocation.x},${data.taskLocation.y})`
              );

              // Check if all tasks are completed (win condition)
              if (result.allTasksCompleted) {
                checkWinConditions(gameInstance, io, room.id);
              }
            } else {
              socket.emit("error", { message: result.error });
            }
          } else {
            // Wrong answer - send the correct answer for this specific question
            socket.emit("taskCompleted", {
              taskLocation: data.taskLocation,
              correct: false,
              correctAnswer: `Correct answer: ${currentQuestion.answer}`,
            });
          }
        } catch (error) {
          console.error("[DEBUG] Error validating task answer:", error);
          socket.emit("error", { message: "Failed to validate answer" });
        }
      }
    );

    // Return to lobby functionality
    socket.on("returnToLobby", () => {
      const room = roomManager.getRoomByPlayer(socket.id);
      if (!room || room.status !== "playing") {
        socket.emit("error", { message: "Not in an active game" });
        return;
      }

      console.log(
        `[DEBUG] Player ${socket.id} initiated return to lobby for room ${room.id}`
      );

      const result = roomManager.returnToLobby(room.id);
      if (result.success) {
        // Move all players from game room back to waiting room
        io.in(`game_${room.id}`).socketsJoin(`room_${room.id}`);
        io.in(`game_${room.id}`).socketsLeave(`game_${room.id}`);

        // Get updated room data
        const updatedRoom = roomManager.getRoom(room.id);
        if (updatedRoom) {
          // Notify all players to return to lobby
          io.to(`room_${room.id}`).emit("returnToLobby", {
            roomId: room.id,
            players: updatedRoom.players.map((p) => ({
              id: p.socketId,
              name: p.name,
            })),
            isHost: updatedRoom.host,
            status: updatedRoom.status,
          });

          console.log(
            `[DEBUG] All players in room ${room.id} have been returned to lobby`
          );
        }
      } else {
        socket.emit("error", { message: result.error });
      }
    });

    // Helper function to handle player leaving
    const handlePlayerLeave = (socketId: string) => {
      // Get the room before removing the player
      const room = roomManager.getRoomByPlayer(socketId);

      console.log(
        `[DEBUG] Player ${socketId} leaving, room status: ${
          room?.status || "no room"
        }`
      );

      // IMPORTANT: During active games, don't remove players from room data
      // They might just be navigating from waiting room to game page
      if (room && room.status === "playing") {
        console.log(
          `[DEBUG] Game in progress, keeping player ${socketId} in room data for reconnection`
        );
        // Just remove from playerToRoom mapping, but keep room player data intact
        roomManager.removePlayerMapping(socketId);
        return;
      }

      // Only remove from room if it's a waiting room (not during active game)
      roomManager.leaveRoom(socketId);

      // If there was a room and it's still in waiting status, notify remaining players
      if (room && room.status === "waiting") {
        const updatedRoom = roomManager.getRoom(room.id);
        if (updatedRoom && updatedRoom.players.length > 0) {
          // Notify all remaining players in the room about the updated player list
          io.to(`room_${room.id}`).emit("playerLeft", {
            playerId: socketId,
            playerCount: updatedRoom.players.length,
          });

          // Send updated room state
          io.to(`room_${room.id}`).emit("roomUpdate", {
            playerCount: updatedRoom.players.length,
            players: updatedRoom.players.map((p) => ({
              id: p.socketId,
              name: p.name,
            })),
          });
        }
      }
    };

    // Handle explicit leave room
    socket.on("leaveRoom", () => {
      handlePlayerLeave(socket.id);
    });

    socket.on("disconnect", () => {
      handlePlayerLeave(socket.id);
      console.log("[game] user disconnected", socket.id);
      console.log(`[game] Total connections: ${io.engine.clientsCount}`);
    });
  });

  // Game loop for all active rooms
  let lastUpdate = Date.now();
  setInterval(() => {
    const now = Date.now();
    const delta = now - lastUpdate;

    // Tick all active game rooms
    for (const room of roomManager.getAllRooms()) {
      if (room.status === "playing") {
        tickRoom(room.id, delta, io);
      }
    }

    lastUpdate = now;
  }, 1000 / TICK_RATE);

  // Optionally expose an endpoint for health check
  app.get("/game/health", (_req, res) => {
    res.send("ok");
  });

  console.log("[game] Game server initialised");
}
