const mapImage = new Image();
mapImage.src = "/Modern_Exteriors_Complete_Tileset_32x32.png";

const blobGifImage = new Image();
blobGifImage.src = "/blob.gif";

const deadPlayerImage = new Image();
deadPlayerImage.src = "/dead-player.png";

// Add error handlers for dead player image
deadPlayerImage.addEventListener("load", () => {
  console.log("Dead player image loaded successfully");
});

deadPlayerImage.addEventListener("error", (e) => {
  console.warn("Dead player image failed to load:", e);
  console.warn("Falling back to red rectangle for dead bodies");
});

// Add error handlers for blob gif
blobGifImage.addEventListener("load", () => {
  console.log("Blob GIF loaded successfully");
});

blobGifImage.addEventListener("error", (e) => {
  console.warn("Blob GIF failed to load:", e);
  console.warn("Falling back to simple colored rectangle for players");
});

const walking = new Audio("/walking.mp3");
const nature = new Audio("/nature.mp3");

// Add error handlers for audio
walking.addEventListener("error", (e) => {
  console.warn("Walking audio failed to load:", e);
});

nature.addEventListener("error", (e) => {
  console.warn("Nature audio failed to load:", e);
});

const canvasEl = document.getElementById("canvas");
canvasEl.width = window.innerWidth;
canvasEl.height = window.innerHeight;
const canvas = canvasEl.getContext("2d");

// Handle window resize
window.addEventListener("resize", () => {
  canvasEl.width = window.innerWidth;
  canvasEl.height = window.innerHeight;
  updateButtons(); // Update button visibility when screen size changes
  handleAutoFullscreen(); // Check if fullscreen should be toggled
});

// Initial setup when game loads
setTimeout(() => {
  lockToLandscape(); // Lock to landscape orientation
  handleAutoFullscreen(); // Handle fullscreen for small screens
}, 1000); // Small delay to ensure page is fully loaded

// Trigger fullscreen and orientation lock on first user interaction (many browsers require this)
let hasInteracted = false;
function handleFirstInteraction() {
  if (!hasInteracted) {
    hasInteracted = true;
    lockToLandscape(); // Ensure landscape lock on first interaction
    handleAutoFullscreen(); // Ensure fullscreen on small screens
    // Remove listeners after first interaction
    document.removeEventListener("click", handleFirstInteraction);
    document.removeEventListener("keydown", handleFirstInteraction);
    document.removeEventListener("touchstart", handleFirstInteraction);
  }
}

document.addEventListener("click", handleFirstInteraction);
document.addEventListener("keydown", handleFirstInteraction);
document.addEventListener("touchstart", handleFirstInteraction);

// Cleanup orientation lock when leaving the page
window.addEventListener("beforeunload", () => {
  unlockOrientation();
});

// Also unlock when the page becomes hidden (user switches tabs/apps)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    unlockOrientation();
  } else {
    // Re-lock when page becomes visible again
    lockToLandscape();
  }
});

const socket = io(window.BACKEND_URL || "http://localhost:3000");

let groundMap = [[]];
let decalMap = [[]];
let players = [];
let gameStarted = false;

const TILE_SIZE = 32;
const IMPOSTER_VISION_RADIUS = 10 * TILE_SIZE; // 10 tiles vision radius for imposters
const STUDENT_VISION_RADIUS = Math.round((10 * TILE_SIZE * 2) / 3); // ~6.67 tiles vision radius for students (2/3 of imposter vision)
let TILES_IN_ROW = 8; // will be overwritten when image loads

mapImage.onload = () => {
  TILES_IN_ROW = Math.floor(mapImage.width / TILE_SIZE);
};

// Animation system for blob characters
let blobGifLoaded = false;
let animationFrame = 0;
let lastAnimationTime = 0;
const ANIMATION_SPEED = 200; // milliseconds per frame
const BOUNCE_INTENSITY = 1; // pixels of bounce (reduced for gentler effect)

// Trail effect system for moving players
const playerTrails = new Map(); // Store trail particles for each player

// Stable color assignment system - assigns colors sequentially to guarantee uniqueness
const playerColorAssignments = new Map(); // Maps player ID to color index
let nextColorIndex = 0; // Next available color index

function getStablePlayerColor(playerId, auraColors) {
  // Check if we already have a color assigned to this player
  if (playerColorAssignments.has(playerId)) {
    const colorIndex = playerColorAssignments.get(playerId);
    return auraColors[colorIndex];
  }

  // Assign the next available color sequentially
  const colorIndex = nextColorIndex % auraColors.length;
  const color = auraColors[colorIndex];

  // Store the assignment
  playerColorAssignments.set(playerId, colorIndex);
  nextColorIndex++;

  console.log(
    `🎨 Assigned stable color ${color} to player ${playerId} (index ${colorIndex})`
  );
  return color;
}

blobGifImage.onload = () => {
  console.log("Blob GIF loaded and ready for animation");
  console.log("🎭 Enhanced blob animation system activated!");
  console.log(
    "Features: bouncing, breathing, rotation, squash/stretch, trails, and color tinting"
  );
  blobGifLoaded = true;
};

socket.on("connect", () => {
  console.log("connected");
  // Join the room when connected
  const roomId = window.ROOM_ID;
  if (roomId) {
    // Check if we have an original socket ID from the waiting room
    const originalSocketId = sessionStorage.getItem(
      `room_${roomId}_originalSocketId`
    );
    socket.emit("joinRoom", {
      roomId,
      originalSocketId: originalSocketId,
    });
  }
});

socket.on("gameJoined", (data) => {
  console.log("Joined game room:", data.roomId);
  gameStarted = true;
});

socket.on("map", (loadedMap) => {
  groundMap = loadedMap.ground;
  decalMap = loadedMap.decal;
});

socket.on("error", (data) => {
  console.error("Game error:", data.message);
  alert(data.message);
  // Redirect to home page
  window.location.href = "/";
});

socket.on("players", (serverPlayers) => {
  players = serverPlayers;

  // Clean up color assignments for disconnected players
  const activePlayerIds = new Set(players.map((p) => p.id));
  for (const [playerId, _] of playerColorAssignments) {
    if (!activePlayerIds.has(playerId)) {
      playerColorAssignments.delete(playerId);
      console.log(
        `🗑️ Cleaned up color assignment for disconnected player ${playerId}`
      );
    }
  }
});

// Player left game event
socket.on("playerLeftGame", (data) => {
  console.log("Player left game:", data.playerId);
  // Remove the player from the players array
  players = players.filter((player) => player.id !== data.playerId);
});

// Game state updates
let gameState = {
  state: "playing",
  playerRole: "student",
  isAlive: true,
  deadBodies: [],
  killCooldown: 0,
  killCooldownStart: 0,
  gameStartTime: 0,
  lastKillTime: 0,
  meetingActive: false,
  votingActive: false,
  currentVote: null,
  playerTasks: [],
  completedTasks: [],
  currentTaskModal: null,
  sabotageActive: false,
  lastSabotageTime: null,
  repairLocation: null,
};

socket.on("gameState", (data) => {
  gameState.state = data.state;
  gameState.playerRole = data.playerRole;
  gameState.isAlive = data.isAlive;
  gameState.deadBodies = data.deadBodies;
  gameState.gameStartTime = data.gameStartTime;
  gameState.lastKillTime = data.lastKillTime;
  gameState.playerTasks = data.playerTasks || [];
  gameState.completedTasks = data.completedTasks || [];
  gameState.sabotageActive = data.sabotageActive || false;
  gameState.lastSabotageTime = data.lastSabotageTime;
  gameState.repairLocation = data.repairLocation;
});

// Kill cooldown updates
socket.on("killCooldown", (data) => {
  gameState.killCooldown = data.timeRemaining;
  gameState.killCooldownStart = Date.now();
});

// Player killed event
socket.on("playerKilled", (data) => {
  console.log("Player killed:", data.victimId);

  // If the current player was killed, close the task modal if it's open
  if (data.victimId === socket.id) {
    hideTaskModal();
  }
});

// Meeting events
socket.on("meetingStarted", (data) => {
  gameState.meetingActive = false; // No separate meeting phase
  gameState.votingActive = true; // Start voting immediately
  gameState.alivePlayers = data.alivePlayers;
  gameState.currentVote = null; // Reset current vote

  // Close any open task modal when meeting starts
  hideTaskModal();

  // Handle body removal and teleportation
  if (data.allBodiesRemoved) {
    gameState.deadBodies = []; // Clear all dead bodies from frontend
  }

  showVotingUI(); // Show voting UI immediately
  console.log("Meeting started by", data.reportedBy, "- voting begins now");
  console.log("All bodies removed and players teleported to spawn");
});

socket.on("votingStarted", (data) => {
  // This event may still be sent by old code, but we handle everything in meetingStarted now
  gameState.meetingActive = false;
  gameState.votingActive = true;
  gameState.alivePlayers = data.alivePlayers;

  // Close any open task modal when voting starts
  hideTaskModal();

  showVotingUI();
  console.log("Voting started");
});

socket.on("voteUpdate", (data) => {
  updateVoteStatus(data);
});

socket.on("votingResults", (data) => {
  gameState.meetingActive = false;
  gameState.votingActive = false;
  hideAllUI();
  showVotingResults(data);

  console.log("Voting results:", data);
});

socket.on("gameOver", (data) => {
  gameState.meetingActive = false;
  gameState.votingActive = false;
  hideAllUI();
  showGameEnd(data);

  console.log("Game Over! Winner:", data.winner);
});

// Return to lobby event
socket.on("returnToLobby", (data) => {
  console.log("Returning to lobby for room:", data.roomId);

  // Store current player info for lobby reconnection
  const currentPlayer = data.players.find((p) => p.id === socket.id);
  if (currentPlayer) {
    sessionStorage.setItem(
      `room_${data.roomId}_playerName`,
      currentPlayer.name
    );
    sessionStorage.setItem(`room_${data.roomId}_returnFromGame`, "true");
    console.log(
      `Stored player name "${currentPlayer.name}" for lobby reconnection`
    );
  }

  // Navigate to the room lobby page
  window.location.href = `/room/${data.roomId}`;
});

// Task events
socket.on("taskQuestion", (data) => {
  showTaskModal(data);
});

socket.on("taskCompleted", (data) => {
  if (data.correct) {
    console.log("Task completed successfully!");
    showTaskSuccess();
  } else {
    showTaskFailure(data.correctAnswer);
  }
});

socket.on("taskCompletedByPlayer", (data) => {
  console.log(
    `Player completed task at (${data.taskLocation.x},${data.taskLocation.y})`
  );
  // Task completion is handled by updated gameState
});

// Sabotage events
socket.on("sabotageQuestion", (data) => {
  gameState.currentSabotageModal = data;
  showSabotageModal(data);
});

socket.on("sabotageCompleted", (data) => {
  if (data.correct) {
    console.log("Sabotage activated - lights out!");
    showSabotageSuccess();
  } else {
    showSabotageFailure(data.correctAnswer);
  }
});

socket.on("sabotageActivated", (data) => {
  console.log("Sabotage activated - lights out!");
  hideSabotageModal();
});

// Repair events
socket.on("repairQuestion", (data) => {
  gameState.currentRepairModal = data;
  showRepairModal(data);
});

socket.on("repairCompleted", (data) => {
  if (data.correct) {
    console.log("Sabotage fixed - lights restored!");
    showRepairSuccess();
  } else {
    showRepairFailure(data.correctAnswer);
  }
});

socket.on("sabotageFixed", (data) => {
  console.log("Sabotage fixed - lights restored!");
  hideRepairModal();
});

const inputs = {
  up: false,
  down: false,
  left: false,
  right: false,
};

// Track if any modal is currently open to prevent movement
let isModalOpen = false;

// Helper function to emit inputs only when no modal is open
function emitInputs() {
  if (!isModalOpen) {
    socket.emit("inputs", inputs);
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "w" || e.key === "ArrowUp") {
    inputs["up"] = true;
  } else if (e.key === "s" || e.key === "ArrowDown") {
    inputs["down"] = true;
  } else if (e.key === "d" || e.key === "ArrowRight") {
    inputs["right"] = true;
  } else if (e.key === "a" || e.key === "ArrowLeft") {
    inputs["left"] = true;
  }
  const moving = inputs.up || inputs.down || inputs.left || inputs.right;
  if (moving && walking.paused) {
    try {
      walking.currentTime = 0;
      walking
        .play()
        .catch((err) => console.warn("Walking audio blocked:", err));
    } catch (err) {
      console.warn("Walking audio error:", err);
    }
  }
  // Removed spacebar functionality - now using buttons
  emitInputs();
});

window.addEventListener("keyup", (e) => {
  if (e.key === "w" || e.key === "ArrowUp") {
    inputs["up"] = false;
  } else if (e.key === "s" || e.key === "ArrowDown") {
    inputs["down"] = false;
  } else if (e.key === "d" || e.key === "ArrowRight") {
    inputs["right"] = false;
  } else if (e.key === "a" || e.key === "ArrowLeft") {
    inputs["left"] = false;
  }
  const stillMoving = inputs.up || inputs.down || inputs.left || inputs.right;
  if (!stillMoving) {
    try {
      walking.pause();
      walking.currentTime = 0;
    } catch (err) {
      console.warn("Walking audio pause error:", err);
    }
  }
  emitInputs();
});

// Mobile Joystick Implementation
let joystick = null;
let joystickKnob = null;
let joystickActive = false;
let joystickCenter = { x: 0, y: 0 };
let joystickRadius = 60;
let joystickKnobRadius = 25;

function createJoystick() {
  // Create joystick container
  joystick = document.createElement("div");
  joystick.id = "mobileJoystick";
  joystick.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 30px;
    width: ${joystickRadius * 2}px;
    height: ${joystickRadius * 2}px;
    border: 4px solid rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    background-color: rgba(0, 0, 0, 0.3);
    z-index: 100;
    display: none;
    touch-action: none;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
  `;

  // Create joystick knob
  joystickKnob = document.createElement("div");
  joystickKnob.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    width: ${joystickKnobRadius * 2}px;
    height: ${joystickKnobRadius * 2}px;
    background-color: rgba(255, 255, 255, 0.8);
    border: 2px solid rgba(0, 0, 0, 0.2);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    touch-action: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  `;

  joystick.appendChild(joystickKnob);
  document.body.appendChild(joystick);
  console.log("Joystick created and added to document");

  updateJoystickVisibility();
}

function updateJoystickVisibility() {
  if (!joystick) {
    console.log("Joystick element not found");
    return;
  }

  const shouldShow =
    (window.innerWidth < 700 || window.innerHeight < 700) && !isModalOpen;
  console.log(
    "Should show joystick:",
    shouldShow,
    "Screen:",
    window.innerWidth,
    "x",
    window.innerHeight,
    "Modal open:",
    isModalOpen
  );
  joystick.style.display = shouldShow ? "block" : "none";

  if (shouldShow) {
    console.log("Joystick should be visible now");
  }
}

function getJoystickInput(deltaX, deltaY) {
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const maxDistance = joystickRadius - joystickKnobRadius;

  if (distance > maxDistance) {
    deltaX = (deltaX / distance) * maxDistance;
    deltaY = (deltaY / distance) * maxDistance;
  }

  // Calculate input based on joystick position (with dead zone)
  const deadZone = 0.3;
  const normalizedX = deltaX / maxDistance;
  const normalizedY = deltaY / maxDistance;

  const magnitude = Math.sqrt(
    normalizedX * normalizedX + normalizedY * normalizedY
  );

  if (magnitude < deadZone) {
    return { up: false, down: false, left: false, right: false };
  }

  // Convert to directional inputs
  const threshold = 0.5;
  return {
    up: normalizedY < -threshold,
    down: normalizedY > threshold,
    left: normalizedX < -threshold,
    right: normalizedX > threshold,
  };
}

function updateJoystickKnobPosition(deltaX, deltaY) {
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const maxDistance = joystickRadius - joystickKnobRadius;

  if (distance > maxDistance) {
    deltaX = (deltaX / distance) * maxDistance;
    deltaY = (deltaY / distance) * maxDistance;
  }

  joystickKnob.style.transform = `translate(${
    -joystickKnobRadius + deltaX
  }px, ${-joystickKnobRadius + deltaY}px)`;
}

function resetJoystickInputs() {
  inputs.up = false;
  inputs.down = false;
  inputs.left = false;
  inputs.right = false;

  const stillMoving = false;
  if (!stillMoving) {
    try {
      walking.pause();
      walking.currentTime = 0;
    } catch (err) {
      console.warn("Walking audio pause error:", err);
    }
  }
  emitInputs();
}

function handleJoystickTouch(clientX, clientY) {
  const joystickRect = joystick.getBoundingClientRect();
  joystickCenter.x = joystickRect.left + joystickRect.width / 2;
  joystickCenter.y = joystickRect.top + joystickRect.height / 2;

  const deltaX = clientX - joystickCenter.x;
  const deltaY = clientY - joystickCenter.y;

  updateJoystickKnobPosition(deltaX, deltaY);

  const joystickInput = getJoystickInput(deltaX, deltaY);

  // Update inputs and check if movement started
  const wasMoving = inputs.up || inputs.down || inputs.left || inputs.right;
  inputs.up = joystickInput.up;
  inputs.down = joystickInput.down;
  inputs.left = joystickInput.left;
  inputs.right = joystickInput.right;

  const isMoving = inputs.up || inputs.down || inputs.left || inputs.right;

  // Handle audio
  if (isMoving && !wasMoving && walking.paused) {
    try {
      walking.currentTime = 0;
      walking
        .play()
        .catch((err) => console.warn("Walking audio blocked:", err));
    } catch (err) {
      console.warn("Walking audio error:", err);
    }
  } else if (!isMoving && wasMoving) {
    try {
      walking.pause();
      walking.currentTime = 0;
    } catch (err) {
      console.warn("Walking audio pause error:", err);
    }
  }

  emitInputs();
}

// Touch event listeners for joystick
function setupJoystickEvents() {
  if (!joystick) return;

  joystick.addEventListener("touchstart", (e) => {
    e.preventDefault();
    joystickActive = true;
    const touch = e.touches[0];
    handleJoystickTouch(touch.clientX, touch.clientY);
  });

  document.addEventListener("touchmove", (e) => {
    if (!joystickActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    handleJoystickTouch(touch.clientX, touch.clientY);
  });

  document.addEventListener("touchend", (e) => {
    if (!joystickActive) return;
    e.preventDefault();
    joystickActive = false;

    // Reset knob position
    joystickKnob.style.transform = `translate(-${joystickKnobRadius}px, -${joystickKnobRadius}px)`;

    // Reset inputs
    resetJoystickInputs();
  });
}

// Initialize joystick immediately since game.js loads after DOM is ready
function initializeJoystick() {
  console.log("Initializing joystick...");
  console.log("Screen size:", window.innerWidth, "x", window.innerHeight);
  createJoystick();
  setupJoystickEvents();
}

// Call immediately - DOM is already ready when game.js loads
initializeJoystick();

// Update joystick visibility on window resize
window.addEventListener("resize", updateJoystickVisibility);

// Setup background nature sound
nature.loop = true;
nature.volume = 0.3;

// Start nature sound on first user interaction
function startNatureSound() {
  if (nature.paused) {
    nature.play().catch((err) => console.warn("Nature audio blocked:", err));
  }
}

// Listen for any user interaction to start audio
document.addEventListener("click", startNatureSound, { once: true });
document.addEventListener("keydown", startNatureSound, { once: true });

// Helper function to find closest dead body
function findClosestBody(player) {
  let closest = null;
  let closestDist = Infinity;
  const REPORT_RADIUS = TILE_SIZE * 3; // Same as kill radius

  for (const body of gameState.deadBodies) {
    const dist = Math.sqrt((body.x - player.x) ** 2 + (body.y - player.y) ** 2);
    if (dist < closestDist && dist <= REPORT_RADIUS) {
      closestDist = dist;
      closest = body;
    }
  }
  return closest;
}

// Helper function to find closest incomplete task
function findClosestTask(player) {
  if (gameState.playerRole !== "student") return null;

  let closest = null;
  let closestDist = Infinity;
  const TASK_RADIUS = TILE_SIZE * 1.5; // How close player needs to be to interact with task

  for (const task of gameState.playerTasks) {
    if (task.completed) continue; // Skip completed tasks

    const taskPixelX = task.location.x * TILE_SIZE;
    const taskPixelY = task.location.y * TILE_SIZE;
    const dist = Math.sqrt(
      (taskPixelX - player.x) ** 2 + (taskPixelY - player.y) ** 2
    );

    if (dist < closestDist && dist <= TASK_RADIUS) {
      closestDist = dist;
      closest = task;
    }
  }
  return closest;
}

// Helper function to find closest killable target (living student)
function findClosestTarget(player) {
  if (gameState.playerRole !== "imposter") return null;

  let closest = null;
  let closestDist = Infinity;
  const KILL_RADIUS = TILE_SIZE * 3; // Same as report radius

  for (const target of players) {
    // Only target living students (not imposters, not dead players, not self)
    if (
      target.id === player.id ||
      !target.isAlive ||
      target.role === "imposter"
    ) {
      continue;
    }

    const dist = Math.sqrt(
      (target.x - player.x) ** 2 + (target.y - player.y) ** 2
    );
    if (dist < closestDist && dist <= KILL_RADIUS) {
      closestDist = dist;
      closest = target;
    }
  }
  return closest;
}

// Helper function to check if a task location is completed
function isTaskCompleted(location) {
  const locationKey = `${location.x},${location.y}`;
  return gameState.completedTasks.includes(locationKey);
}

// Helper function to wrap text within a given width
function wrapText(text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = canvas.measureText(currentLine + " " + word).width;
    if (width < maxWidth) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

// Button Functions
window.attemptKill = function () {
  if (
    gameState.playerRole === "imposter" &&
    gameState.isAlive &&
    !gameState.meetingActive &&
    !gameState.votingActive
  ) {
    socket.emit("kill");
  }
};

// Lock orientation to landscape for better mobile gaming experience
function lockToLandscape() {
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock("landscape").catch((err) => {
      console.log("Orientation lock failed:", err);
      // Fallback: some browsers don't support orientation lock
    });
  } else if (screen.lockOrientation) {
    // Fallback for older browsers
    screen.lockOrientation("landscape");
  } else if (screen.mozLockOrientation) {
    // Firefox fallback
    screen.mozLockOrientation("landscape");
  } else if (screen.msLockOrientation) {
    // IE/Edge fallback
    screen.msLockOrientation("landscape");
  } else {
    console.log("Orientation lock not supported on this browser");
  }
}

// Unlock orientation (for cleanup)
function unlockOrientation() {
  if (screen.orientation && screen.orientation.unlock) {
    screen.orientation.unlock();
  } else if (screen.unlockOrientation) {
    screen.unlockOrientation();
  } else if (screen.mozUnlockOrientation) {
    screen.mozUnlockOrientation();
  } else if (screen.msUnlockOrientation) {
    screen.msUnlockOrientation();
  }
}

// Automatic fullscreen management for small screens
function handleAutoFullscreen() {
  const isSmallScreen = window.innerWidth < 700 || window.innerHeight < 700;
  const isCurrentlyFullscreen = !!document.fullscreenElement;

  if (isSmallScreen && !isCurrentlyFullscreen) {
    // Enter fullscreen on small screens
    document.documentElement.requestFullscreen().catch((err) => {
      console.log("Auto-fullscreen failed:", err);
      // Fullscreen might fail on some browsers without user interaction
      // This is expected behavior and not an error
    });
  } else if (!isSmallScreen && isCurrentlyFullscreen) {
    // Exit fullscreen on large screens
    document.exitFullscreen().catch((err) => {
      console.log("Auto-exit fullscreen failed:", err);
    });
  }
}

window.attemptReport = function () {
  if (
    gameState.isAlive &&
    !gameState.meetingActive &&
    !gameState.votingActive
  ) {
    const myPlayer = players.find((player) => player.id === socket.id);
    if (myPlayer) {
      const closestBody = findClosestBody(myPlayer);
      if (closestBody) {
        socket.emit("reportBody", { bodyId: closestBody.id });
      }
    }
  }
};

window.attemptTask = function () {
  if (
    gameState.playerRole === "student" &&
    !gameState.meetingActive &&
    !gameState.votingActive
  ) {
    const myPlayer = players.find((player) => player.id === socket.id);
    if (myPlayer) {
      const closestTask = findClosestTask(myPlayer);
      if (closestTask) {
        socket.emit("attemptTask", { taskLocation: closestTask.location });
      }
    }
  }
};

window.attemptSabotage = function () {
  if (
    gameState.playerRole === "imposter" &&
    gameState.isAlive &&
    !gameState.meetingActive &&
    !gameState.votingActive
  ) {
    socket.emit("sabotage");
  }
};

window.attemptRepair = function () {
  if (
    gameState.isAlive &&
    !gameState.meetingActive &&
    !gameState.votingActive &&
    gameState.sabotageActive &&
    gameState.repairLocation
  ) {
    const myPlayer = players.find((player) => player.id === socket.id);
    if (myPlayer) {
      const dx = Math.abs(myPlayer.x / TILE_SIZE - gameState.repairLocation.x);
      const dy = Math.abs(myPlayer.y / TILE_SIZE - gameState.repairLocation.y);

      if (dx <= 1 && dy <= 1) {
        socket.emit("attemptRepair", { location: gameState.repairLocation });
      }
    }
  }
};

// Update button visibility and state
function updateButtons() {
  const killButton = document.getElementById("killButton");
  const sabotageButton = document.getElementById("sabotageButton");
  const reportButton = document.getElementById("reportButton");
  const taskButton = document.getElementById("taskButton");

  if (!killButton || !sabotageButton || !reportButton || !taskButton) return;

  const gameActive = !gameState.meetingActive && !gameState.votingActive;
  const myPlayer = players.find((player) => player.id === socket.id);

  // Kill button - only show for living imposters during active game
  if (gameState.playerRole === "imposter" && gameState.isAlive && gameActive) {
    killButton.style.display = "block";

    // Calculate cooldown based on game start time and last kill time
    const now = Date.now();
    let remainingCooldown = 0;

    if (gameState.gameStartTime > 0) {
      const timeSinceGameStart = now - gameState.gameStartTime;
      const timeSinceLastKill = gameState.lastKillTime
        ? now - gameState.lastKillTime
        : Infinity;

      // Check both initial 30s cooldown and kill cooldown
      const initialCooldown = Math.max(0, 30000 - timeSinceGameStart);
      const killCooldown = Math.max(0, 30000 - timeSinceLastKill);

      remainingCooldown = Math.max(initialCooldown, killCooldown);
    }

    // Fallback to server-provided cooldown if we have it
    if (gameState.killCooldownStart > 0) {
      const elapsed = now - gameState.killCooldownStart;
      const serverCooldown = Math.max(0, gameState.killCooldown - elapsed);
      remainingCooldown = Math.max(remainingCooldown, serverCooldown);
    }

    // Check if there's a target nearby
    const hasNearbyTarget = myPlayer && findClosestTarget(myPlayer);

    if (remainingCooldown > 0) {
      killButton.disabled = true;
      killButton.textContent = `KILL (${Math.ceil(remainingCooldown / 1000)}s)`;
      killButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    } else if (!hasNearbyTarget) {
      killButton.disabled = true;
      killButton.textContent = "KILL";
      killButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    } else {
      killButton.disabled = false;
      killButton.textContent = "KILL";
      killButton.className =
        "px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg cursor-pointer";
    }
  } else {
    killButton.style.display = "none";
  }

  // Sabotage button - only show for living imposters during active game
  if (gameState.playerRole === "imposter" && gameState.isAlive && gameActive) {
    sabotageButton.style.display = "block";

    // Calculate sabotage cooldown
    const now = Date.now();
    let remainingSabotageCooldown = 0;

    if (gameState.gameStartTime > 0) {
      const timeSinceGameStart = now - gameState.gameStartTime;
      const timeSinceLastSabotage = gameState.lastSabotageTime
        ? now - gameState.lastSabotageTime
        : Infinity;

      // Check both initial 30s cooldown and sabotage cooldown (60s)
      const initialCooldown = Math.max(0, 30000 - timeSinceGameStart);
      const sabotageCooldown = Math.max(0, 60000 - timeSinceLastSabotage);

      remainingSabotageCooldown = Math.max(initialCooldown, sabotageCooldown);
    }

    // Check if sabotage is already active
    const sabotageAlreadyActive = gameState.sabotageActive;

    if (remainingSabotageCooldown > 0) {
      sabotageButton.disabled = true;
      sabotageButton.textContent = `SABOTAGE (${Math.ceil(
        remainingSabotageCooldown / 1000
      )}s)`;
      sabotageButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    } else if (sabotageAlreadyActive) {
      sabotageButton.disabled = true;
      sabotageButton.textContent = "SABOTAGE (ACTIVE)";
      sabotageButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    } else {
      sabotageButton.disabled = false;
      sabotageButton.textContent = "SABOTAGE";
      sabotageButton.className =
        "px-4 py-2 bg-purple-600 text-white rounded-lg font-bold hover:bg-purple-700 transition-colors shadow-lg cursor-pointer";
    }
  } else {
    sabotageButton.style.display = "none";
  }

  // Report button - show for all living players during active game
  if (gameState.isAlive && gameActive) {
    reportButton.style.display = "block";

    // Check if there's a body nearby
    const hasNearbyBody = myPlayer && findClosestBody(myPlayer);

    if (hasNearbyBody) {
      reportButton.disabled = false;
      reportButton.textContent = "REPORT";
      reportButton.className =
        "px-4 py-2 bg-yellow-600 text-white rounded-lg font-bold hover:bg-yellow-700 transition-colors shadow-lg cursor-pointer";
    } else {
      reportButton.disabled = true;
      reportButton.textContent = "REPORT";
      reportButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    }
  } else {
    reportButton.style.display = "none";
  }

  // Task/Repair button - show for students and all players during sabotage
  if (gameActive && gameState.isAlive) {
    let buttonVisible = false;
    let buttonText = "DO TASK";
    let buttonClass =
      "px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-lg cursor-pointer";
    let buttonAction = "task";

    // Check for repair opportunity during sabotage
    if (gameState.sabotageActive && gameState.repairLocation && myPlayer) {
      const dx = Math.abs(myPlayer.x / TILE_SIZE - gameState.repairLocation.x);
      const dy = Math.abs(myPlayer.y / TILE_SIZE - gameState.repairLocation.y);

      if (dx <= 1 && dy <= 1) {
        buttonVisible = true;
        buttonText = "FIX LIGHTS";
        buttonClass =
          "px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg cursor-pointer";
        buttonAction = "repair";
      }
    }

    // Check for regular tasks (only for students when no repair available)
    if (!buttonVisible && gameState.playerRole === "student") {
      const hasNearbyTask = myPlayer && findClosestTask(myPlayer);
      if (hasNearbyTask) {
        buttonVisible = true;
        buttonText = "DO TASK";
        buttonAction = "task";
      }
    }

    if (buttonVisible) {
      taskButton.style.display = "block";
      taskButton.disabled = false;
      taskButton.textContent = buttonText;
      taskButton.className = buttonClass;

      // Update the onclick handler based on action
      if (buttonAction === "repair") {
        taskButton.onclick = () => window.attemptRepair();
      } else {
        taskButton.onclick = () => window.attemptTask();
      }
    } else {
      taskButton.style.display = "none";
    }
  } else {
    taskButton.style.display = "none";
  }
}

// UI Management Functions
function showMeetingUI() {
  const meetingUI = document.getElementById("meetingUI");
  if (meetingUI) {
    meetingUI.style.display = "flex";
    startMeetingTimer();
    isModalOpen = true; // Block movement when meeting UI is open
  }
}

function showVotingUI() {
  const meetingUI = document.getElementById("meetingUI");
  const votingUI = document.getElementById("votingUI");

  if (meetingUI) meetingUI.style.display = "none";
  if (votingUI) votingUI.style.display = "flex";

  createVotingOptions();
  startVotingTimer(); // Start the 60-second voting timer
  isModalOpen = true; // Block movement when voting UI is open
}

function hideAllUI() {
  const meetingUI = document.getElementById("meetingUI");
  const votingUI = document.getElementById("votingUI");
  const votingResultsUI = document.getElementById("votingResultsUI");
  const gameEndUI = document.getElementById("gameEndUI");
  const taskModal = document.getElementById("taskModal");
  const sabotageModal = document.getElementById("sabotageModal");
  const repairModal = document.getElementById("repairModal");

  if (meetingUI) meetingUI.style.display = "none";
  if (votingUI) votingUI.style.display = "none";
  if (votingResultsUI) votingResultsUI.style.display = "none";
  if (gameEndUI) gameEndUI.style.display = "none";
  if (taskModal) taskModal.style.display = "none";
  if (sabotageModal) sabotageModal.style.display = "none";
  if (repairModal) repairModal.style.display = "none";

  // Reset modal states
  gameState.currentTaskModal = null;
  gameState.currentSabotageModal = null;
  gameState.currentRepairModal = null;

  isModalOpen = false; // Allow movement when all UIs are hidden
}

// Task modal functions
function showTaskModal(data) {
  const taskModal = document.getElementById("taskModal");
  const taskQuestion = document.getElementById("taskQuestion");
  const taskOptions = document.getElementById("taskOptions");

  if (!taskModal || !taskQuestion || !taskOptions) return;

  gameState.currentTaskModal = data;

  taskQuestion.textContent = data.question;
  taskOptions.innerHTML = "";

  // Create option buttons
  data.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.className =
      "w-full p-3 bg-gray-600 text-white rounded mb-2 cursor-pointer hover:bg-gray-500 text-left";
    button.textContent = option;
    button.onclick = () => submitTaskAnswer(option);
    taskOptions.appendChild(button);
  });
  taskModal.style.display = "flex";
  console.log("Task modal shown with question:", data.question);
  isModalOpen = true; // Block movement when task modal is open
}

function hideTaskModal() {
  const taskModal = document.getElementById("taskModal");
  if (taskModal) {
    taskModal.style.display = "none";
  }
  gameState.currentTaskModal = null;
  isModalOpen = false; // Allow movement when task modal is hidden
}

function showSabotageModal(data) {
  console.log("Showing sabotage modal:", data);

  const sabotageModal = document.getElementById("sabotageModal");
  const sabotageQuestion = document.getElementById("sabotageQuestion");
  const sabotageOptions = document.getElementById("sabotageOptions");

  if (!sabotageModal || !sabotageQuestion || !sabotageOptions) return;

  sabotageQuestion.textContent = data.question;
  sabotageOptions.innerHTML = "";

  data.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.textContent = option;
    button.className =
      "w-full py-2 px-4 bg-red-800 hover:bg-red-900 text-white rounded font-bold transition-colors";
    button.onclick = () => submitSabotageAnswer(option);
    sabotageOptions.appendChild(button);
  });

  sabotageModal.style.display = "flex";
  isModalOpen = true;
}

function hideSabotageModal() {
  const sabotageModal = document.getElementById("sabotageModal");
  if (sabotageModal) {
    sabotageModal.style.display = "none";
  }
  gameState.currentSabotageModal = null;
  isModalOpen = false;
}

function submitSabotageAnswer(answer) {
  socket.emit("completeSabotage", { answer: answer });
}

function showRepairModal(data) {
  console.log("Showing repair modal:", data);

  const repairModal = document.getElementById("repairModal");
  const repairQuestion = document.getElementById("repairQuestion");
  const repairOptions = document.getElementById("repairOptions");

  if (!repairModal || !repairQuestion || !repairOptions) return;

  repairQuestion.textContent = data.question;
  repairOptions.innerHTML = "";

  data.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.textContent = option;
    button.className =
      "w-full py-2 px-4 bg-blue-800 hover:bg-blue-900 text-white rounded font-bold transition-colors";
    button.onclick = () => submitRepairAnswer(option);
    repairOptions.appendChild(button);
  });

  repairModal.style.display = "flex";
  isModalOpen = true;
}

function hideRepairModal() {
  const repairModal = document.getElementById("repairModal");
  if (repairModal) {
    repairModal.style.display = "none";
  }
  gameState.currentRepairModal = null;
  isModalOpen = false;
}

function submitRepairAnswer(answer) {
  socket.emit("completeRepair", { answer: answer });
}

function submitTaskAnswer(answer) {
  if (gameState.currentTaskModal) {
    socket.emit("completeTask", {
      taskLocation: gameState.currentTaskModal.taskLocation,
      answer: answer,
    });
  }
}

function showTaskFailure(correctAnswer) {
  const taskOptions = document.getElementById("taskOptions");
  if (!taskOptions) return;

  // Show failure message and correct answer
  taskOptions.innerHTML = `
    <div class="text-center text-red-400 mb-4">
      <p class="text-lg font-bold">Incorrect!</p>
      <p class="text-sm">${correctAnswer}</p>
    </div>
    <button id="tryAgainButton" class="w-full p-3 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700" disabled>
      Try Again (5s)
    </button>
  `;

  // 5 second cooldown
  let timeLeft = 5;
  const tryAgainButton = document.getElementById("tryAgainButton");

  const timer = setInterval(() => {
    timeLeft--;
    if (tryAgainButton) {
      tryAgainButton.textContent = `Try Again (${timeLeft}s)`;
    }

    if (timeLeft <= 0) {
      clearInterval(timer);
      if (tryAgainButton) {
        tryAgainButton.disabled = false;
        tryAgainButton.textContent = "Try Again";
        tryAgainButton.onclick = () => {
          if (gameState.currentTaskModal) {
            socket.emit("attemptTask", {
              taskLocation: gameState.currentTaskModal.taskLocation,
            });
          }
        };
      }
    }
  }, 1000);
}

function showTaskSuccess() {
  const taskOptions = document.getElementById("taskOptions");
  if (!taskOptions) return;

  // Show success message
  taskOptions.innerHTML = `
    <div class="text-center text-green-400 mb-4">
      <p class="text-xl font-bold">🎉 Congratulations!</p>
      <p class="text-lg">Task completed successfully!</p>
    </div>
  `;

  // Auto-close after 1 second
  setTimeout(() => {
    hideTaskModal();
  }, 1000);
}

function showSabotageFailure(correctAnswer) {
  const sabotageOptions = document.getElementById("sabotageOptions");
  if (!sabotageOptions) return;

  // Show failure message and correct answer
  sabotageOptions.innerHTML = `
    <div class="text-center text-red-400 mb-4">
      <p class="text-lg font-bold">Incorrect!</p>
      <p class="text-sm">${correctAnswer}</p>
    </div>
    <button id="sabotageRetryButton" class="w-full p-3 bg-red-600 text-white rounded cursor-pointer hover:bg-red-700" disabled>
      Try Again (5s)
    </button>
  `;

  // 5 second cooldown
  let timeLeft = 5;
  const retryButton = document.getElementById("sabotageRetryButton");

  const timer = setInterval(() => {
    timeLeft--;
    if (retryButton) {
      retryButton.textContent = `Try Again (${timeLeft}s)`;
    }

    if (timeLeft <= 0) {
      clearInterval(timer);
      if (retryButton) {
        retryButton.disabled = false;
        retryButton.textContent = "Try Again";
        retryButton.onclick = () => {
          if (gameState.currentSabotageModal) {
            socket.emit("sabotage");
          }
        };
      }
    }
  }, 1000);
}

function showSabotageSuccess() {
  const sabotageOptions = document.getElementById("sabotageOptions");
  if (!sabotageOptions) return;

  // Show success message
  sabotageOptions.innerHTML = `
    <div class="text-center text-green-400 mb-4">
      <p class="text-xl font-bold">💥 Sabotage Activated!</p>
      <p class="text-lg">Lights are out!</p>
    </div>
  `;

  // Auto-close after 1 second
  setTimeout(() => {
    hideSabotageModal();
  }, 1000);
}

function showRepairFailure(correctAnswer) {
  const repairOptions = document.getElementById("repairOptions");
  if (!repairOptions) return;

  // Show failure message and correct answer
  repairOptions.innerHTML = `
    <div class="text-center text-red-400 mb-4">
      <p class="text-lg font-bold">Incorrect!</p>
      <p class="text-sm">${correctAnswer}</p>
    </div>
    <button id="repairRetryButton" class="w-full p-3 bg-blue-600 text-white rounded cursor-pointer hover:bg-blue-700" disabled>
      Try Again (5s)
    </button>
  `;

  // 5 second cooldown
  let timeLeft = 5;
  const retryButton = document.getElementById("repairRetryButton");

  const timer = setInterval(() => {
    timeLeft--;
    if (retryButton) {
      retryButton.textContent = `Try Again (${timeLeft}s)`;
    }

    if (timeLeft <= 0) {
      clearInterval(timer);
      if (retryButton) {
        retryButton.disabled = false;
        retryButton.textContent = "Try Again";
        retryButton.onclick = () => {
          if (gameState.currentRepairModal && gameState.repairLocation) {
            socket.emit("attemptRepair", {
              location: gameState.repairLocation,
            });
          }
        };
      }
    }
  }, 1000);
}

function showRepairSuccess() {
  const repairOptions = document.getElementById("repairOptions");
  if (!repairOptions) return;

  // Show success message
  repairOptions.innerHTML = `
    <div class="text-center text-green-400 mb-4">
      <p class="text-xl font-bold">🔧 Repair Complete!</p>
      <p class="text-lg">Lights restored!</p>
    </div>
  `;

  // Auto-close after 1 second
  setTimeout(() => {
    hideRepairModal();
  }, 1000);
}

function startVotingTimer() {
  let timeLeft = 59;
  const timer = setInterval(() => {
    const timerElement = document.getElementById("votingTimer");
    if (timerElement) {
      timerElement.textContent = timeLeft;
    }
    timeLeft--;

    if (timeLeft < 0 || !gameState.votingActive) {
      clearInterval(timer);
    }
  }, 1000);
}

function showVotingResults(data) {
  const votingResultsUI = document.getElementById("votingResultsUI");
  const votingResultsContent = document.getElementById("votingResultsContent");

  if (!votingResultsUI || !votingResultsContent) return;

  // Show the results
  let resultHTML = "";
  if (data.ejectedPlayer) {
    resultHTML = `<p class="text-lg font-bold text-red-400 mb-2">${data.ejectedPlayer} was ejected!</p>`;
    if (data.ejectedRole) {
      resultHTML += `<p class="text-sm">They were ${
        data.ejectedRole === "imposter" ? "an Imposter" : "a Student"
      }</p>`;
    }
  } else {
    resultHTML = `<p class="text-lg font-bold text-gray-300">No one was ejected</p><p class="text-sm">(Tie vote or majority skipped)</p>`;
  }

  votingResultsContent.innerHTML = resultHTML;
  votingResultsUI.style.display = "flex";
  isModalOpen = true; // Block movement when voting results are shown

  // Start 5-second countdown
  let timeLeft = 5;
  const timer = setInterval(() => {
    const timerElement = document.getElementById("continueTimer");
    if (timerElement) {
      timerElement.textContent = timeLeft;
    }
    timeLeft--;

    if (timeLeft < 0) {
      clearInterval(timer);
      votingResultsUI.style.display = "none";
      isModalOpen = false; // Allow movement when voting results are hidden
    }
  }, 1000);
}

function showGameEnd(data) {
  const gameEndUI = document.getElementById("gameEndUI");
  const gameEndTitle = document.getElementById("gameEndTitle");
  const gameEndContent = document.getElementById("gameEndContent");

  if (!gameEndUI || !gameEndTitle || !gameEndContent) return;

  // Set title and content based on winner
  if (data.winner === "imposters") {
    gameEndTitle.textContent = "Imposters Win!";
    gameEndTitle.className = "text-2xl font-bold mb-4 text-center text-red-400";

    // Find all imposters and their names
    const imposters = data.allPlayers.filter((p) => p.role === "imposter");
    const imposterNames = imposters.map((p) => p.name).join(", ");

    gameEndContent.innerHTML = `
      <p class="text-lg mb-2">The imposters have won!</p>
      <p class="text-md mb-2 text-red-300">The imposter(s) were: ${imposterNames}</p>
      <p class="text-sm text-gray-400">Evil triumphs this time...</p>
    `;
  } else if (data.winner === "students") {
    gameEndTitle.textContent = "Students Win!";
    gameEndTitle.className =
      "text-2xl font-bold mb-4 text-center text-blue-400";
    gameEndContent.innerHTML = `
      <p class="text-lg mb-2">Justice has been served</p>
    `;
  } else {
    gameEndTitle.textContent = "Game Over";
    gameEndTitle.className = "text-2xl font-bold mb-4 text-center text-white";
    gameEndContent.innerHTML = `<p class="text-lg">Game ended</p>`;
  }
  gameEndUI.style.display = "flex";
  isModalOpen = true; // Block movement when game end screen is shown

  // Set up button handlers
  setupGameEndButtons();
}

function setupGameEndButtons() {
  const goToLobbyButton = document.getElementById("goToLobbyButton");
  const exitGameButton = document.getElementById("exitGameButton");

  if (goToLobbyButton) {
    goToLobbyButton.onclick = () => {
      // Send return to lobby request to server
      socket.emit("returnToLobby");
      isModalOpen = false; // Allow movement when returning to lobby
    };
  }

  if (exitGameButton) {
    exitGameButton.onclick = () => {
      // Navigate back to home
      isModalOpen = false; // Allow movement when exiting
      window.location.href = "/";
    };
  }
}

function createVotingOptions() {
  const votingOptions = document.getElementById("votingOptions");
  if (!votingOptions || !gameState.alivePlayers) return;

  votingOptions.innerHTML = "";

  // Only show voting options if alive
  if (gameState.isAlive) {
    // Add skip option
    const skipButton = document.createElement("button");
    const isSkipSelected = gameState.currentVote === "skip";
    skipButton.className = isSkipSelected
      ? "w-full p-2 bg-gray-800 border-2 border-yellow-400 text-white rounded mb-2 cursor-pointer hover:bg-gray-700"
      : "w-full p-2 bg-gray-600 text-white rounded mb-2 cursor-pointer hover:bg-gray-500";
    skipButton.textContent = isSkipSelected ? "Skip Vote ✓" : "Skip Vote";
    skipButton.onclick = () => vote("skip");
    votingOptions.appendChild(skipButton);

    // Add player options - including self
    gameState.alivePlayers.forEach((player) => {
      const button = document.createElement("button");
      const isSelected = gameState.currentVote === player.id;

      // Special styling for self-vote
      if (player.id === socket.id) {
        button.textContent = isSelected
          ? `Vote for ${player.name || player.id} (You) ✓`
          : `Vote for ${player.name || player.id} (You)`;
        button.className = isSelected
          ? "w-full p-2 bg-purple-800 border-2 border-yellow-400 text-white rounded mb-2 cursor-pointer hover:bg-purple-700"
          : "w-full p-2 bg-purple-600 text-white rounded mb-2 cursor-pointer hover:bg-purple-500";
      } else {
        button.textContent = isSelected
          ? `Vote for ${player.name || player.id} ✓`
          : `Vote for ${player.name || player.id}`;
        button.className = isSelected
          ? "w-full p-2 bg-blue-800 border-2 border-yellow-400 text-white rounded mb-2 cursor-pointer hover:bg-blue-700"
          : "w-full p-2 bg-blue-600 text-white rounded mb-2 cursor-pointer hover:bg-blue-500";
      }

      button.onclick = () => vote(player.id);
      votingOptions.appendChild(button);
    });
  } else {
    // Dead players can't vote - no options shown
    const deadMessage = document.createElement("p");
    deadMessage.className = "text-center text-gray-300";
    deadMessage.textContent = "You are dead and cannot vote.";
    votingOptions.appendChild(deadMessage);
  }
}

function vote(targetId) {
  if (gameState.isAlive && gameState.votingActive) {
    // Update current vote
    gameState.currentVote = targetId;

    // Send vote to server
    socket.emit("vote", { targetId: targetId });

    // Refresh voting options to show new selection
    createVotingOptions();
  }
}

function updateVoteStatus(data) {
  const voteStatus = document.getElementById("voteStatus");
  if (voteStatus) {
    voteStatus.textContent = `Votes cast: ${data.votedCount}/${data.totalCount}`;
  }
}

function loop() {
  // Fill background with black
  canvas.fillStyle = "black";
  canvas.fillRect(0, 0, canvasEl.width, canvasEl.height);

  const myPlayer = players.find((player) => player.id === socket.id);
  let cameraX = 0;
  let cameraY = 0;
  if (myPlayer) {
    cameraX = parseInt(myPlayer.x - canvasEl.width / 2);
    cameraY = parseInt(myPlayer.y - canvasEl.height / 2);
  }

  // ground
  for (let row = 0; row < groundMap.length; row++) {
    for (let col = 0; col < groundMap[0].length; col++) {
      let { id } = groundMap[row][col];
      const imageRow = parseInt(id / TILES_IN_ROW);
      const imageCol = id % TILES_IN_ROW;
      canvas.drawImage(
        mapImage,
        imageCol * TILE_SIZE,
        imageRow * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
        col * TILE_SIZE - cameraX,
        row * TILE_SIZE - cameraY,
        TILE_SIZE,
        TILE_SIZE
      );
    }
  }

  // decals
  for (let row = 0; row < decalMap.length; row++) {
    for (let col = 0; col < decalMap[0].length; col++) {
      let { id } = decalMap[row][col] ?? { id: undefined };
      const imageRow = parseInt(id / TILES_IN_ROW);
      const imageCol = id % TILES_IN_ROW;

      canvas.drawImage(
        mapImage,
        imageCol * TILE_SIZE,
        imageRow * TILE_SIZE,
        TILE_SIZE,
        TILE_SIZE,
        col * TILE_SIZE - cameraX,
        row * TILE_SIZE - cameraY,
        TILE_SIZE,
        TILE_SIZE
      );
    }
  }

  // Render task tiles (yellow overlay for students)
  if (gameState.playerRole === "student") {
    for (const task of gameState.playerTasks) {
      if (!task.completed && !isTaskCompleted(task.location)) {
        const taskX = task.location.x * TILE_SIZE - cameraX;
        const taskY = task.location.y * TILE_SIZE - cameraY;

        // Render transparent yellow overlay
        canvas.fillStyle = "rgba(255, 255, 0, 0.4)";
        canvas.fillRect(taskX, taskY, TILE_SIZE, TILE_SIZE);

        // Add subtle border
        canvas.strokeStyle = "rgba(255, 255, 0, 0.8)";
        canvas.lineWidth = 2;
        canvas.strokeRect(taskX, taskY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // Render repair location (red highlighting when sabotage is active)
  if (gameState.sabotageActive && gameState.repairLocation) {
    const repairX = gameState.repairLocation.x * TILE_SIZE - cameraX;
    const repairY = gameState.repairLocation.y * TILE_SIZE - cameraY;

    // Render pulsing red overlay with animation
    const time = Date.now() * 0.005; // Adjust speed of pulsing
    const alpha = 0.3 + 0.2 * Math.sin(time); // Pulsing between 0.3 and 0.5 alpha
    canvas.fillStyle = `rgba(255, 0, 0, ${alpha})`;
    canvas.fillRect(repairX, repairY, TILE_SIZE, TILE_SIZE);

    // Add bright red border
    canvas.strokeStyle = "rgba(255, 0, 0, 0.9)";
    canvas.lineWidth = 3;
    canvas.strokeRect(repairX, repairY, TILE_SIZE, TILE_SIZE);
  }

  // Render dead bodies
  for (const body of gameState.deadBodies) {
    if (deadPlayerImage.complete && deadPlayerImage.naturalWidth > 0) {
      // Draw the dead player image
      canvas.drawImage(
        deadPlayerImage,
        body.x - cameraX,
        body.y - cameraY,
        TILE_SIZE,
        TILE_SIZE
      );
    } else {
      // Fallback: red rectangle if image isn't loaded
      canvas.fillStyle = "red";
      canvas.fillRect(body.x - cameraX, body.y - cameraY, TILE_SIZE, TILE_SIZE);
    }
  }

  const BLOB_SIZE = 34; // reduced size for the blob
  // Define aura colors outside the loop for better performance
  const auraColors = [
    "#FF4B4B", // red
    "#4B8BFF", // blue
    "#FFD93D", // yellow
    "#4BFF4B", // green
    "#FF4BFF", // magenta
    "#FF914B", // orange
    "#4BFFD9", // cyan
    "#B84BFF", // purple
    "#A0FF4B", // lime
    "#FF4B8B", // pink
  ];

  for (const [i, player] of players.entries()) {
    // Get stable color assignment based on player ID, not array position
    const auraColor = getStablePlayerColor(player.id, auraColors);

    // Use the assigned color index for stable animation timing
    const colorIndex = playerColorAssignments.get(player.id);
    const stableIndex = colorIndex * 100; // Scale up for animation variation
    const auraX = player.x - cameraX + TILE_SIZE / 2;
    const auraY = player.y - cameraY + BLOB_SIZE - 8; // move up by 8px
    canvas.save();
    canvas.globalAlpha = 0.55;
    canvas.beginPath();
    canvas.ellipse(auraX, auraY, 26, 14, 0, 0, 2 * Math.PI); // larger halo
    canvas.shadowColor = auraColor;
    canvas.shadowBlur = 24;
    canvas.fillStyle = auraColor;
    canvas.fill();
    canvas.restore();

    // Set player opacity if provided
    const playerOpacity =
      player.opacity !== undefined && player.opacity < 1.0
        ? player.opacity
        : 1.0;
    canvas.globalAlpha = playerOpacity;

    // Draw smaller blob.gif, keeping feet in same place
    // Calculate animation effects for blob character
    const currentTime = Date.now();
    if (currentTime - lastAnimationTime > ANIMATION_SPEED) {
      animationFrame = (animationFrame + 1) % 8; // 8 frame cycle for smooth animation
      lastAnimationTime = currentTime;
    }

    // Check if player is moving for enhanced animation (with tolerance for floating point precision)
    const isMoving = Math.abs(player.vx) > 0.1 || Math.abs(player.vy) > 0.1;
    const movementMultiplier = isMoving ? 2.0 : 1.0;
    const speedMultiplier = isMoving ? 1.5 : 1.0;

    // Create vertical bouncing effects (enhanced when moving) - using stable index
    const bounceOffset =
      Math.sin(currentTime * 0.005 * speedMultiplier + stableIndex * 0.008) *
      BOUNCE_INTENSITY *
      movementMultiplier;
    const scaleEffect =
      1 +
      Math.sin(currentTime * 0.006 * speedMultiplier + stableIndex * 0.003) *
        0.02 *
        movementMultiplier; // breathing effect (reduced for subtle effect)

    // Add slight color tint variation per player for uniqueness - using stable index
    const colorPhase = currentTime * 0.002 + stableIndex * 0.021;
    const tintAmount = 0.1 + Math.sin(colorPhase) * 0.05;

    // Trail effect for moving players
    if (isMoving) {
      // Initialize trail array for this player if it doesn't exist
      if (!playerTrails.has(player.id)) {
        playerTrails.set(player.id, []);
      }

      const trail = playerTrails.get(player.id);
      // Add new trail particle every few frames
      if (animationFrame % 3 === 0) {
        trail.push({
          x: player.x,
          y: player.y,
          life: 1.0,
          color: auraColor,
        });
      }

      // Update and draw trail particles
      for (let j = trail.length - 1; j >= 0; j--) {
        const particle = trail[j];
        particle.life -= 0.08;

        if (particle.life <= 0) {
          trail.splice(j, 1);
        } else {
          // Draw fading trail particle
          canvas.save();
          canvas.globalAlpha = particle.life * 0.4;
          canvas.fillStyle = particle.color;
          const size = TILE_SIZE * 0.4 * particle.life;
          canvas.fillRect(
            particle.x - cameraX - size / 2,
            particle.y - cameraY - size / 2,
            size,
            size
          );
          canvas.restore();
        }
      }

      // Limit trail length for performance
      if (trail.length > 8) {
        trail.splice(0, trail.length - 8);
      }
    } else {
      // Gradually fade trail when not moving
      if (playerTrails.has(player.id)) {
        const trail = playerTrails.get(player.id);
        for (let j = trail.length - 1; j >= 0; j--) {
          trail[j].life -= 0.15;
          if (trail[j].life <= 0) {
            trail.splice(j, 1);
          }
        }
      }
    }

    if (
      blobGifLoaded &&
      blobGifImage.complete &&
      blobGifImage.naturalWidth > 0
    ) {
      // Save canvas state for transformations
      canvas.save();

      // Calculate animated position (vertical bounce only)
      const baseX = player.x - cameraX - (BLOB_SIZE - TILE_SIZE) / 2;
      const baseY = player.y - cameraY - (BLOB_SIZE - TILE_SIZE);
      const drawX = baseX;
      const drawY = baseY + bounceOffset;

      // Apply scale and rotation for more life-like movement
      const centerX = drawX + BLOB_SIZE / 2;
      const centerY = drawY + BLOB_SIZE / 2;
      canvas.translate(centerX, centerY);

      // Add subtle rotation only when moving - using stable index
      if (isMoving) {
        const rotationAngle =
          Math.sin(
            currentTime * 0.004 * speedMultiplier + stableIndex * 0.004
          ) * 0.08;
        canvas.rotate(rotationAngle);
      }

      // Squash and stretch effect for bouncing - using stable index
      const squashY =
        1 +
        Math.sin(currentTime * 0.01 * speedMultiplier + stableIndex * 0.012) *
          0.01 *
          movementMultiplier;
      const stretchX = 1 / squashY; // maintain area

      // Scale breathing effect with squash/stretch
      canvas.scale(scaleEffect * stretchX, scaleEffect * squashY);
      canvas.translate(-BLOB_SIZE / 2, -BLOB_SIZE / 2);

      // Add color tinting for variety
      canvas.globalCompositeOperation = "multiply";
      canvas.fillStyle = `rgba(${255 - tintAmount * 50}, ${
        255 - tintAmount * 30
      }, ${255 - tintAmount * 20}, ${0.1 + tintAmount * 0.1})`;
      canvas.fillRect(0, 0, BLOB_SIZE, BLOB_SIZE);
      canvas.globalCompositeOperation = "source-over";

      // Draw the blob with all animation effects
      canvas.drawImage(blobGifImage, 0, 0, BLOB_SIZE, BLOB_SIZE);

      // Restore canvas state
      canvas.restore();
    } else {
      // Fallback: draw animated colored rectangle while blob loads or if it fails
      canvas.fillStyle = auraColor;
      canvas.fillRect(
        player.x - cameraX,
        player.y - cameraY + bounceOffset,
        TILE_SIZE * scaleEffect,
        TILE_SIZE * scaleEffect
      );
    }

    // Draw player name underneath
    if (player.name || player.id) {
      const displayName = player.name || player.id;
      // Truncate name if longer than 16 characters
      const truncatedName =
        displayName.length > 16
          ? displayName.substring(0, 16) + "..."
          : displayName;

      // Make names more opaque - minimum 0.7 opacity, maximum 1.0
      const nameOpacity = Math.max(0.7, playerOpacity);
      canvas.globalAlpha = nameOpacity;

      canvas.font = "12px Arial";
      canvas.textAlign = "center";

      // Position name below the player sprite
      const nameX = player.x - cameraX + TILE_SIZE / 2;
      const nameY = player.y - cameraY + TILE_SIZE + 14; // 14px below sprite

      // Draw strong black outline by drawing text multiple times with offsets
      canvas.fillStyle = "black";
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx !== 0 || dy !== 0) {
            canvas.fillText(truncatedName, nameX + dx, nameY + dy);
          }
        }
      }

      // Draw the main white text
      canvas.fillStyle = "white";
      canvas.fillText(truncatedName, nameX, nameY);

      // Reset text alignment
      canvas.textAlign = "start";
    }

    // Reset opacity
    canvas.globalAlpha = 1.0;
  }

  // Render fog of war
  if (myPlayer) {
    renderFogOfWar(myPlayer, cameraX, cameraY);
  }

  // Render UI
  renderUI();

  // Update buttons
  updateButtons();

  window.requestAnimationFrame(loop);
}

function renderUI() {
  // Role display
  canvas.fillStyle = "white";
  canvas.font = "20px Arial";
  canvas.fillText(
    `Role: ${
      gameState.playerRole.charAt(0).toUpperCase() +
      gameState.playerRole.slice(1)
    }`,
    10,
    30
  );
  canvas.fillText(`Status: ${gameState.isAlive ? "Alive" : "Dead"}`, 10, 55);

  // Task list for students
  if (gameState.playerRole === "student") {
    const isSmallScreen = window.innerWidth < 700 || window.innerHeight < 700;
    const maxTextWidth = isSmallScreen
      ? canvasEl.width / 3
      : canvasEl.width * 0.6; // 1/3 on small screens, 60% on large

    canvas.font = "16px Arial";
    canvas.fillStyle = "yellow";
    canvas.fillText("Task Locations:", 10, 85);

    if (gameState.playerTasks.length === 0) {
      canvas.fillStyle = "gray";
      canvas.fillText("No tasks assigned", 10, 105);
    } else {
      let yOffset = 105;
      for (const task of gameState.playerTasks) {
        const location =
          task.location.name || `(${task.location.x}, ${task.location.y})`;
        const status = task.completed ? "✓" : "○";
        const color = task.completed ? "lightgreen" : "white";
        const fullText = `${status} ${location}`;

        canvas.fillStyle = color;

        // Check if text fits in one line
        if (canvas.measureText(fullText).width <= maxTextWidth) {
          canvas.fillText(fullText, 10, yOffset);
          yOffset += 20;
        } else {
          // Wrap text for small screens with proper indentation
          const statusWidth = canvas.measureText(status + " ").width;
          const indentedMaxWidth = maxTextWidth - statusWidth;
          const locationOnlyWrapped = wrapText(location, indentedMaxWidth);

          // First line: status + first part of location
          canvas.fillText(`${status} ${locationOnlyWrapped[0]}`, 10, yOffset);
          yOffset += 20;

          // Subsequent lines: indented to align with text after status
          for (let i = 1; i < locationOnlyWrapped.length; i++) {
            canvas.fillText(locationOnlyWrapped[i], 10 + statusWidth, yOffset);
            yOffset += 20;
          }
        }
      }
    }
  }

  // Kill cooldown info removed - now shown on button

  // Meeting/Voting status
  if (gameState.meetingActive) {
    canvas.fillStyle = "yellow";
    canvas.font = "24px Arial";
    canvas.fillText("MEETING IN PROGRESS", canvasEl.width / 2 - 150, 50);
  } else if (gameState.votingActive) {
    canvas.fillStyle = "orange";
    canvas.font = "24px Arial";
    canvas.fillText("VOTING IN PROGRESS", canvasEl.width / 2 - 150, 50);
  }

  // Render minimap
  renderMinimap();

  // Show sabotage status message under minimap
  if (gameState.sabotageActive) {
    const isSmallScreen = window.innerWidth < 700 || window.innerHeight < 700;
    const minimapWidth = isSmallScreen ? 100 : 200;
    const minimapHeight = isSmallScreen ? 75 : 150;

    // Calculate the same scaled dimensions as the minimap
    const mapPixelWidth = groundMap[0].length * TILE_SIZE;
    const mapPixelHeight = groundMap.length * TILE_SIZE;
    const scaleX = minimapWidth / mapPixelWidth;
    const scaleY = minimapHeight / mapPixelHeight;
    const scale = Math.min(scaleX, scaleY);
    const scaledHeight = mapPixelHeight * scale;

    const spacing = 20;
    const minimapX = canvasEl.width - minimapWidth - spacing;
    const minimapY = spacing;

    // Position text closer to minimap using actual scaled height with minimal gap
    const statusX = minimapX;
    const statusY = minimapY + scaledHeight + 17;

    canvas.fillStyle = "red";
    canvas.font = "bold 12px Arial";

    const statusText = "Night Mode: Fix Lights Upper Campus Entrance";
    const textWidth = canvas.measureText(statusText).width;

    // Check if text needs wrapping
    if (textWidth > minimapWidth) {
      // Split text into multiple lines
      const line1 = "Night Mode:";
      const line2 = "Fix Lights";
      const line3 = "Upper Campus Entrance";

      canvas.fillText(line1, statusX, statusY);
      canvas.fillText(line2, statusX, statusY + 14); // 14px line spacing
      canvas.fillText(line3, statusX, statusY + 28); // 28px total spacing
    } else {
      canvas.fillText(statusText, statusX, statusY);
    }
  }
}

function renderMinimap() {
  if (!groundMap || !groundMap.length || !decalMap || !decalMap.length) return;

  const myPlayer = players.find((player) => player.id === socket.id);
  if (!myPlayer) return;

  // Minimap configuration - responsive sizing for small screens
  const isSmallScreen = window.innerWidth < 700 || window.innerHeight < 700;
  const minimapWidth = isSmallScreen ? 100 : 200;
  const minimapHeight = isSmallScreen ? 75 : 150;

  // Calculate scale factors
  const mapPixelWidth = groundMap[0].length * TILE_SIZE;
  const mapPixelHeight = groundMap.length * TILE_SIZE;
  const scaleX = minimapWidth / mapPixelWidth;
  const scaleY = minimapHeight / mapPixelHeight;
  const scale = Math.min(scaleX, scaleY); // Use smaller scale to maintain aspect ratio

  const scaledWidth = mapPixelWidth * scale;
  const scaledHeight = mapPixelHeight * scale;

  // Position minimap with equal spacing from top and right edges
  const spacing = 20; // Equal spacing from edges
  const minimapX = canvasEl.width - scaledWidth - spacing;
  const minimapY = spacing;

  // No offset needed since we're positioning the actual content
  const offsetX = 0;
  const offsetY = 0;

  // Draw minimap background - fit exactly around the map content
  canvas.fillStyle = "rgba(0, 0, 0, 0.7)";
  canvas.fillRect(
    minimapX + offsetX,
    minimapY + offsetY,
    scaledWidth,
    scaledHeight
  );

  // Draw minimap border - fit exactly around the map content
  canvas.strokeStyle = "white";
  canvas.lineWidth = 2;
  canvas.strokeRect(
    minimapX + offsetX,
    minimapY + offsetY,
    scaledWidth,
    scaledHeight
  );

  // Draw simplified map (just a dark background for now)
  canvas.fillStyle = "rgba(40, 40, 40, 1)";
  canvas.fillRect(
    minimapX + offsetX,
    minimapY + offsetY,
    scaledWidth,
    scaledHeight
  );

  // Draw task locations for students
  if (gameState.playerRole === "student") {
    for (const task of gameState.playerTasks) {
      if (!task.completed && !isTaskCompleted(task.location)) {
        const taskMinimapX =
          minimapX + offsetX + task.location.x * TILE_SIZE * scale;
        const taskMinimapY =
          minimapY + offsetY + task.location.y * TILE_SIZE * scale;

        // Draw yellow dot for task - smaller on small screens
        const taskDotRadius = isSmallScreen ? 2 : 3;
        canvas.fillStyle = "yellow";
        canvas.beginPath();
        canvas.arc(taskMinimapX, taskMinimapY, taskDotRadius, 0, 2 * Math.PI);
        canvas.fill();
      }
    }
  }

  // Draw repair location when sabotage is active
  if (gameState.sabotageActive && gameState.repairLocation) {
    const repairMinimapX =
      minimapX + offsetX + gameState.repairLocation.x * TILE_SIZE * scale;
    const repairMinimapY =
      minimapY + offsetY + gameState.repairLocation.y * TILE_SIZE * scale;

    // Draw pulsing red dot for repair location
    const time = Date.now() * 0.005;
    const pulseAlpha = 0.7 + 0.3 * Math.sin(time); // Pulsing between 0.7 and 1.0 alpha
    const repairDotRadius = isSmallScreen ? 3 : 4;
    canvas.fillStyle = `rgba(255, 0, 0, ${pulseAlpha})`;
    canvas.beginPath();
    canvas.arc(repairMinimapX, repairMinimapY, repairDotRadius, 0, 2 * Math.PI);
    canvas.fill();

    // Add white outline for visibility
    canvas.strokeStyle = "white";
    canvas.lineWidth = 1;
    canvas.beginPath();
    canvas.arc(repairMinimapX, repairMinimapY, repairDotRadius, 0, 2 * Math.PI);
    canvas.stroke();
  }

  // Draw player position
  const playerMinimapX = minimapX + offsetX + myPlayer.x * scale;
  const playerMinimapY = minimapY + offsetY + myPlayer.y * scale;

  // Draw player dot - smaller on small screens
  const playerDotRadius = isSmallScreen ? 3 : 4;
  const playerColor = gameState.playerRole === "imposter" ? "red" : "cyan";
  canvas.fillStyle = playerColor;
  canvas.beginPath();
  canvas.arc(playerMinimapX, playerMinimapY, playerDotRadius, 0, 2 * Math.PI);
  canvas.fill();

  // Add white outline to player dot for visibility
  canvas.strokeStyle = "white";
  canvas.lineWidth = 1;
  canvas.beginPath();
  canvas.arc(playerMinimapX, playerMinimapY, playerDotRadius, 0, 2 * Math.PI);
  canvas.stroke();
}

function renderFogOfWar(player, cameraX, cameraY) {
  // Create radial gradient for fog of war
  const playerScreenX = player.x - cameraX + TILE_SIZE / 2;
  const playerScreenY = player.y - cameraY + TILE_SIZE / 2;

  // Determine vision radius based on role and sabotage state
  let visionRadius;
  if (gameState.playerRole === "imposter") {
    visionRadius = IMPOSTER_VISION_RADIUS;
  } else {
    // student vision - reduce to quarter during sabotage
    visionRadius = gameState.sabotageActive
      ? STUDENT_VISION_RADIUS / 4
      : STUDENT_VISION_RADIUS;
  }
  const visualFogRadius = visionRadius * 1.1;
  const gradient = canvas.createRadialGradient(
    playerScreenX,
    playerScreenY,
    0,
    playerScreenX,
    playerScreenY,
    visualFogRadius
  );

  // Smoother gradient with more gradual transitions
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)"); // Center: fully visible
  gradient.addColorStop(0.45, "rgba(0, 0, 0, 0)"); // 45%: still fully visible
  gradient.addColorStop(0.6, "rgba(0, 0, 0, 0.05)"); // 60%: barely visible dimming
  gradient.addColorStop(0.7, "rgba(0, 0, 0, 0.15)"); // 70%: very light dimming
  gradient.addColorStop(0.8, "rgba(0, 0, 0, 0.3)"); // 80%: light dimming
  gradient.addColorStop(0.87, "rgba(0, 0, 0, 0.5)"); // 87%: moderate dimming
  gradient.addColorStop(0.93, "rgba(0, 0, 0, 0.65)"); // 93%: heavy dimming
  gradient.addColorStop(0.97, "rgba(0, 0, 0, 0.78)"); // 97%: very heavy dimming
  gradient.addColorStop(1.0, "rgba(0, 0, 0, 0.85)"); // Edge: almost black

  // Fill the entire screen with the gradient
  canvas.fillStyle = gradient;
  canvas.fillRect(0, 0, canvasEl.width, canvasEl.height);
}

window.requestAnimationFrame(loop);
