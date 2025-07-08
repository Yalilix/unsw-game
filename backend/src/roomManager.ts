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
}

export interface DeadBody {
  id: string;
  x: number;
  y: number;
  playerId: string;
  reportedBy?: string;
}

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

    // Check if player already in room
    if (room.players.some((p) => p.socketId === socketId)) {
      return { success: false, error: "Already in room" };
    }

    // Remove player from any existing room first
    this.leaveRoom(socketId);

    // Add to room
    room.players.push({
      id: roomId + "_" + socketId,
      socketId: socketId,
      name: `Player ${room.players.length + 1}`,
    });

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
    const shuffledPlayers = [...room.players].sort(() => Math.random() - 0.5);
    const playersWithRoles = shuffledPlayers.map((p, index) => ({
      id: p.socketId,
      x: 56 * 32, // TILE_SIZE
      y: 14 * 32, // TILE_SIZE
      role: (index < imposterCount ? "imposter" : "crewmate") as
        | "crewmate"
        | "imposter",
      isAlive: true,
    }));

    // Create game instance
    const gameInstance: GameInstance = {
      roomId: roomId,
      players: playersWithRoles,
      deadBodies: [],
      gameState: "playing",
      votes: {},
      gameStartTime: Date.now(),
      inputsMap: {},
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

  // Map new socket to existing player in game (preserve role/state)
  reconnectPlayerToGame(
    oldSocketId: string,
    newSocketId: string,
    roomId: string
  ): boolean {
    const gameInstance = this.gameInstances.get(roomId);
    if (!gameInstance) return false;

    // Find existing player by old socket ID
    const existingPlayer = gameInstance.players.find(
      (p) => p.id === oldSocketId
    );
    if (!existingPlayer) return false;

    // Update the player's socket ID
    existingPlayer.id = newSocketId;

    // Update input mapping
    if (gameInstance.inputsMap[oldSocketId]) {
      gameInstance.inputsMap[newSocketId] = gameInstance.inputsMap[oldSocketId];
      delete gameInstance.inputsMap[oldSocketId];
    }

    // Update player to room mapping
    this.playerToRoom.set(newSocketId, roomId);

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

    player.name = trimmedName;
    return { success: true };
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
