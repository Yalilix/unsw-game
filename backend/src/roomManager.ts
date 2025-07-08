import { Server as IOServer, Socket } from "socket.io";

export interface RoomPlayer {
  id: string;
  socketId: string;
  name: string;
}

export interface Room {
  id: string;
  players: RoomPlayer[];
  host: string; // socket id of host
  status: "waiting" | "playing";
  maxPlayers: number;
  minPlayers: number;
  createdAt: Date;
}

export interface GamePlayer {
  id: string;
  x: number;
  y: number;
  role: "crewmate" | "imposter";
  isAlive: boolean;
  lastKillTime?: number;
  killCooldownPausedAt?: number; // When voting started while cooldown was active
  pausedCooldownRemaining?: number; // How much cooldown was left when paused
}

export interface DeadBody {
  id: string;
  x: number;
  y: number;
  playerId: string;
  reportedBy?: string;
}

export interface TaskLocation {
  x: number;
  y: number;
  name: string;
}

export interface PlayerTask {
  location: TaskLocation;
  completed: boolean;
}

// Task locations in tile coordinates
export const TASK_LOCATIONS: TaskLocation[] = [
  { x: 14, y: 30, name: "Village Green" },
  { x: 10, y: 14, name: "Roundhouse" },
  { x: 39, y: 29, name: "Red Centre" },
  { x: 26, y: 13, name: "Business School" },
  { x: 53, y: 14, name: "Quadrangle Lawn" },
  { x: 54, y: 24, name: "Ainsworth Building" },
  { x: 83, y: 14, name: "Main Library" },
];

export interface GameInstance {
  roomId: string;
  players: GamePlayer[];
  deadBodies: DeadBody[];
  gameState: "playing" | "meeting" | "voting";
  meetingStartTime?: number;
  votes: Record<string, string>; // playerId -> targetId ("skip" for skip vote)
  gameStartTime: number;
  inputsMap: Record<
    string,
    {
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
    }
  >;
  playerTasks: Record<string, PlayerTask[]>; // playerId -> assigned tasks
  completedTasks: Set<string>; // completed task location keys "x,y"
  currentQuestions: Record<string, any>; // playerId -> current question object
}

class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private gameInstances: Map<string, GameInstance> = new Map();
  private playerToRoom: Map<string, string> = new Map();

  // Generate a random 6-character room ID
  generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Create a new room
  createRoom(hostSocketId: string): Room {
    const roomId = this.generateRoomId();

    // Ensure unique room ID
    while (this.rooms.has(roomId)) {
      const newRoomId = this.generateRoomId();
      if (newRoomId !== roomId) break;
    }

    const room: Room = {
      id: roomId,
      players: [
        {
          id: roomId + "_" + hostSocketId,
          socketId: hostSocketId,
          name: "Player 1",
        },
      ],
      host: hostSocketId,
      status: "waiting",
      maxPlayers: 10,
      minPlayers: 4,
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.playerToRoom.set(hostSocketId, roomId);
    return room;
  }

  // Join an existing room
  joinRoom(
    roomId: string,
    socketId: string
  ): { success: boolean; room?: Room; error?: string } {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { success: false, error: "Room not found" };
    }

    if (room.status === "playing") {
      return { success: false, error: "Game already in progress" };
    }

    if (room.players.length >= room.maxPlayers) {
      return { success: false, error: "Room is full" };
    }

    // Remove player from any existing room first
    this.leaveRoom(socketId);

    // Check if player already in room
    if (room.players.some((p) => p.socketId === socketId)) {
      return { success: false, error: "Already in room" };
    }

    // Add to room
    const newPlayer = {
      id: roomId + "_" + socketId,
      socketId: socketId,
      name: `Player ${room.players.length + 1}`,
    };
    room.players.push(newPlayer);
    console.log(
      `[DEBUG] Player joined room: ${newPlayer.socketId} with name "${newPlayer.name}"`
    );
    console.log(
      `[DEBUG] Room ${roomId} now has players: ${room.players
        .map((p) => `${p.socketId}:"${p.name}"`)
        .join(", ")}`
    );

    this.playerToRoom.set(socketId, roomId);
    return { success: true, room };
  }

  // Leave a room
  leaveRoom(socketId: string): boolean {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return false;

    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Remove player from room
    room.players = room.players.filter((p) => p.socketId !== socketId);
    this.playerToRoom.delete(socketId);

    // If room is empty and not playing, delete it
    // Keep room alive during game even if socket connections are lost
    if (room.players.length === 0 && room.status === "waiting") {
      this.rooms.delete(roomId);
      this.gameInstances.delete(roomId);
      return true;
    }

    // If host left, assign new host
    if (room.host === socketId && room.players.length > 0) {
      room.host = room.players[0].socketId;
    }

    return true;
  }

  // Start a game for a room
  startGame(
    roomId: string,
    hostSocketId: string
  ): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);

    if (!room) {
      return { success: false, error: "Room not found" };
    }

    if (room.host !== hostSocketId) {
      return { success: false, error: "Only host can start game" };
    }

    if (room.players.length < room.minPlayers) {
      return {
        success: false,
        error: `Need at least ${room.minPlayers} players to start`,
      };
    }

    if (room.status === "playing") {
      return { success: false, error: "Game already started" };
    }

    // Assign roles - determine imposter count based on player count
    const playerCount = room.players.length;
    const imposterCount = playerCount <= 6 ? 1 : 2;

    // Shuffle players and assign roles
    console.log(
      `[DEBUG] Starting game for room ${roomId} with players: ${room.players
        .map((p) => `${p.socketId}:"${p.name}"`)
        .join(", ")}`
    );
    const shuffledPlayers = [...room.players].sort(() => Math.random() - 0.5);
    const playersWithRoles = shuffledPlayers.map((p, index) => {
      const role = (index < imposterCount ? "imposter" : "crewmate") as
        | "crewmate"
        | "imposter";
      console.log(
        `[DEBUG] Assigning role to ${p.socketId} ("${p.name}"): ${role}`
      );
      return {
        id: p.socketId,
        x: 56 * 32, // TILE_SIZE
        y: 14 * 32, // TILE_SIZE
        role: role,
        isAlive: true,
      };
    });

    // Assign tasks to crewmates (5 random tasks from the 7 available)
    const playerTasks: Record<string, PlayerTask[]> = {};
    playersWithRoles.forEach((player) => {
      if (player.role === "crewmate") {
        // Shuffle all task locations and pick first 5
        const shuffledTasks = [...TASK_LOCATIONS].sort(
          () => Math.random() - 0.5
        );
        const assignedTasks = shuffledTasks.slice(0, 5).map((location) => ({
          location,
          completed: false,
        }));
        playerTasks[player.id] = assignedTasks;
        console.log(
          `[DEBUG] Assigned tasks to crewmate ${player.id}: ${assignedTasks
            .map((t) => `(${t.location.x},${t.location.y})`)
            .join(", ")}`
        );
      } else {
        // Imposters don't get tasks
        playerTasks[player.id] = [];
      }
    });

    // Create game instance
    const gameInstance: GameInstance = {
      roomId: roomId,
      players: playersWithRoles,
      deadBodies: [],
      gameState: "playing",
      votes: {},
      gameStartTime: Date.now(),
      inputsMap: {},
      playerTasks: playerTasks,
      completedTasks: new Set<string>(),
      currentQuestions: {},
    };

    // Initialize inputs for all players
    room.players.forEach((player) => {
      gameInstance.inputsMap[player.socketId] = {
        up: false,
        down: false,
        left: false,
        right: false,
      };
    });

    room.status = "playing";
    this.gameInstances.set(roomId, gameInstance);

    console.log(
      `[DEBUG] Game instance created with players: ${gameInstance.players
        .map((p) => `${p.id}:${p.role}`)
        .join(", ")}`
    );
    console.log(
      `[DEBUG] Room still has players: ${room.players
        .map((p) => `${p.socketId}:"${p.name}"`)
        .join(", ")}`
    );

    return { success: true };
  }

  // Get room by ID
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  // Get room by player socket ID
  getRoomByPlayer(socketId: string): Room | undefined {
    const roomId = this.playerToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  // Get game instance
  getGameInstance(roomId: string): GameInstance | undefined {
    return this.gameInstances.get(roomId);
  }

  // Get all rooms (for debugging)
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  // Update room ID (for when frontend provides specific room ID)
  updateRoomId(oldRoomId: string, newRoomId: string): boolean {
    const room = this.rooms.get(oldRoomId);
    if (!room) return false;

    // Update the room ID
    room.id = newRoomId;
    this.rooms.delete(oldRoomId);
    this.rooms.set(newRoomId, room);

    // Update player mappings
    for (const player of room.players) {
      this.playerToRoom.set(player.socketId, newRoomId);
    }

    return true;
  }

  // Update player to room mapping (for when socket reconnects during game)
  updatePlayerToRoom(socketId: string, roomId: string): void {
    this.playerToRoom.set(socketId, roomId);
  }

  // Remove player from mapping (for disconnections during game without removing from room)
  removePlayerMapping(socketId: string): void {
    this.playerToRoom.delete(socketId);
  }

  // Remove player from active game when they disconnect (not just mapping)
  removePlayerFromGame(socketId: string): {
    success: boolean;
    shouldEndGame?: boolean;
    error?: string;
  } {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) {
      return { success: false, error: "Player not in any room" };
    }

    const room = this.rooms.get(roomId);
    const gameInstance = this.gameInstances.get(roomId);

    if (!room || !gameInstance) {
      return { success: false, error: "Room or game instance not found" };
    }

    // Remove player from room players list
    room.players = room.players.filter((p) => p.socketId !== socketId);

    // Remove player from game instance
    gameInstance.players = gameInstance.players.filter(
      (p) => p.id !== socketId
    );

    // Clean up all related data for this player
    delete gameInstance.inputsMap[socketId];
    delete gameInstance.playerTasks[socketId];
    delete gameInstance.currentQuestions[socketId];
    delete gameInstance.votes[socketId];

    // Remove player from mapping
    this.playerToRoom.delete(socketId);

    // If host left, assign new host to first remaining player
    if (room.host === socketId && room.players.length > 0) {
      room.host = room.players[0].socketId;
    }

    console.log(
      `[DEBUG] Player ${socketId} removed from active game in room ${roomId}`
    );
    console.log(
      `[DEBUG] Remaining players in game: ${gameInstance.players
        .map((p) => p.id)
        .join(", ")}`
    );

    // Check if all players have left the game
    const shouldEndGame = room.players.length === 0;

    return { success: true, shouldEndGame };
  }

  // Check if all players have disconnected from an active game
  hasAllPlayersLeft(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== "playing") {
      return false;
    }

    return room.players.length === 0;
  }

  // End game due to all players leaving
  endGameAllPlayersLeft(roomId: string): {
    success: boolean;
    error?: string;
  } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    if (room.status !== "playing") {
      return { success: false, error: "Room is not in playing status" };
    }

    // Clean up the game instance
    this.gameInstances.delete(roomId);

    // Delete the empty room entirely
    this.rooms.delete(roomId);

    console.log(
      `[DEBUG] Game in room ${roomId} ended due to all players leaving`
    );

    return { success: true };
  }

  // Map new socket to existing player in game (preserve role/state)
  reconnectPlayerToGame(
    oldSocketId: string,
    newSocketId: string,
    roomId: string
  ): boolean {
    console.log(
      `[DEBUG] reconnectPlayerToGame: ${oldSocketId} -> ${newSocketId} in room ${roomId}`
    );

    const gameInstance = this.gameInstances.get(roomId);
    if (!gameInstance) {
      console.log(`[DEBUG] No game instance found for room ${roomId}`);
      return false;
    }

    // Find existing player by old socket ID
    const existingPlayer = gameInstance.players.find(
      (p) => p.id === oldSocketId
    );
    if (!existingPlayer) {
      console.log(`[DEBUG] No existing player found with ID ${oldSocketId}`);
      console.log(
        `[DEBUG] Available player IDs: ${gameInstance.players
          .map((p) => p.id)
          .join(", ")}`
      );
      return false;
    }

    // Update the player's socket ID in game instance
    existingPlayer.id = newSocketId;

    // Update input mapping
    if (gameInstance.inputsMap[oldSocketId]) {
      gameInstance.inputsMap[newSocketId] = gameInstance.inputsMap[oldSocketId];
      delete gameInstance.inputsMap[oldSocketId];
    }

    // Update task mapping
    if (gameInstance.playerTasks[oldSocketId]) {
      gameInstance.playerTasks[newSocketId] =
        gameInstance.playerTasks[oldSocketId];
      delete gameInstance.playerTasks[oldSocketId];
      console.log(
        `[DEBUG] Transferred ${gameInstance.playerTasks[newSocketId].length} tasks from ${oldSocketId} to ${newSocketId}`
      );
    }

    // Update current question mapping
    if (gameInstance.currentQuestions[oldSocketId]) {
      gameInstance.currentQuestions[newSocketId] =
        gameInstance.currentQuestions[oldSocketId];
      delete gameInstance.currentQuestions[oldSocketId];
      console.log(
        `[DEBUG] Transferred current question from ${oldSocketId} to ${newSocketId}`
      );
    }

    // IMPORTANT: Also update the room player's socket ID so name lookup works
    const room = this.rooms.get(roomId);
    if (room) {
      const roomPlayer = room.players.find((p) => p.socketId === oldSocketId);
      if (roomPlayer) {
        console.log(
          `[DEBUG] Updating room player socket ID: ${roomPlayer.socketId} ("${roomPlayer.name}") -> ${newSocketId}`
        );
        roomPlayer.socketId = newSocketId;
        console.log(
          `[DEBUG] Room players after reconnection: ${room.players
            .map((p) => `${p.socketId}:"${p.name}"`)
            .join(", ")}`
        );
      } else {
        console.log(
          `[DEBUG] No room player found with socketId ${oldSocketId}`
        );
        console.log(
          `[DEBUG] Available room players: ${room.players
            .map((p) => `${p.socketId}:"${p.name}"`)
            .join(", ")}`
        );
      }

      // Update host if needed
      if (room.host === oldSocketId) {
        room.host = newSocketId;
        console.log(
          `[DEBUG] Updated host from ${oldSocketId} to ${newSocketId}`
        );
      }
    } else {
      console.log(
        `[DEBUG] No room found for roomId ${roomId} during reconnection`
      );
    }

    // Update player to room mapping
    this.playerToRoom.set(newSocketId, roomId);

    console.log(
      `[DEBUG] Successfully reconnected player: ${oldSocketId} -> ${newSocketId}, role: ${existingPlayer.role}`
    );
    return true;
  }

  // Update player name
  updatePlayerName(
    socketId: string,
    newName: string
  ): { success: boolean; error?: string } {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) {
      return { success: false, error: "Player not in any room" };
    }

    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    const player = room.players.find((p) => p.socketId === socketId);
    if (!player) {
      return { success: false, error: "Player not found in room" };
    }

    // Validate name (basic validation)
    const trimmedName = newName.trim();
    if (!trimmedName || trimmedName.length > 20) {
      return { success: false, error: "Name must be 1-20 characters" };
    }

    const oldName = player.name;
    player.name = trimmedName;
    console.log(
      `[DEBUG] Player name updated: ${socketId} "${oldName}" -> "${trimmedName}"`
    );
    console.log(
      `[DEBUG] Room ${roomId} players after name update: ${room.players
        .map((p) => `${p.socketId}:"${p.name}"`)
        .join(", ")}`
    );
    return { success: true };
  }

  // Return room to lobby (reset from playing to waiting)
  returnToLobby(roomId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { success: false, error: "Room not found" };
    }

    if (room.status !== "playing") {
      return { success: false, error: "Room is not currently playing" };
    }

    // Reset room status to waiting
    room.status = "waiting";

    // Remove the game instance
    this.gameInstances.delete(roomId);

    console.log(
      `[DEBUG] Room ${roomId} returned to lobby - status reset to waiting`
    );
    console.log(
      `[DEBUG] Room players in lobby: ${room.players
        .map((p) => `${p.socketId}:"${p.name}"`)
        .join(", ")}`
    );

    return { success: true };
  }

  // Complete a task for a player
  completeTask(
    socketId: string,
    taskLocation: TaskLocation
  ): { success: boolean; error?: string; allTasksCompleted?: boolean } {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) {
      return { success: false, error: "Player not in any room" };
    }

    const gameInstance = this.gameInstances.get(roomId);
    if (!gameInstance) {
      return { success: false, error: "Game not found" };
    }

    const player = gameInstance.players.find((p) => p.id === socketId);
    if (!player || player.role !== "crewmate") {
      return {
        success: false,
        error: "Only crewmates can complete tasks",
      };
    }

    const playerTasks = gameInstance.playerTasks[socketId] || [];
    const taskToComplete = playerTasks.find(
      (task) =>
        task.location.x === taskLocation.x &&
        task.location.y === taskLocation.y &&
        !task.completed
    );

    if (!taskToComplete) {
      return {
        success: false,
        error: "Task not found or already completed",
      };
    }

    // Mark task as completed
    taskToComplete.completed = true;
    const locationKey = `${taskLocation.x},${taskLocation.y}`;
    gameInstance.completedTasks.add(locationKey);

    console.log(
      `[DEBUG] Player ${socketId} completed task at (${taskLocation.x},${taskLocation.y})`
    );

    // Check if all crewmate tasks are completed
    const allTasksCompleted = this.areAllTasksCompleted(roomId);

    return { success: true, allTasksCompleted };
  }

  // Check if all crewmate tasks are completed
  areAllTasksCompleted(roomId: string): boolean {
    const gameInstance = this.gameInstances.get(roomId);
    if (!gameInstance) return false;

    // Get all crewmates (alive and dead)
    const crewmates = gameInstance.players.filter((p) => p.role === "crewmate");

    for (const crewmate of crewmates) {
      const tasks = gameInstance.playerTasks[crewmate.id] || [];
      const incompleteTasks = tasks.filter((task) => !task.completed);
      if (incompleteTasks.length > 0) {
        return false; // Found a crewmate with incomplete tasks
      }
    }

    console.log(`[DEBUG] All crewmate tasks completed in room ${roomId}!`);
    return true;
  }

  // Get player's tasks
  getPlayerTasks(socketId: string): PlayerTask[] {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return [];

    const gameInstance = this.gameInstances.get(roomId);
    if (!gameInstance) return [];

    return gameInstance.playerTasks[socketId] || [];
  }

  // Clean up empty rooms (called periodically)
  cleanup(): void {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    for (const [roomId, room] of this.rooms.entries()) {
      // Delete old empty rooms
      if (room.players.length === 0 || room.createdAt < oneHourAgo) {
        this.rooms.delete(roomId);
        this.gameInstances.delete(roomId);

        // Clean up player mappings
        for (const [playerId, mappedRoomId] of this.playerToRoom.entries()) {
          if (mappedRoomId === roomId) {
            this.playerToRoom.delete(playerId);
          }
        }
      }
    }
  }
}

export const roomManager = new RoomManager();
