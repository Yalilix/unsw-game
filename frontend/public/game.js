const mapImage = new Image();
mapImage.src = "/Modern_Exteriors_Complete_Tileset_32x32.png";

const personImage = new Image();
personImage.src = "/person.png";

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

const socket = io(window.BACKEND_URL || "http://localhost:3000");

let groundMap = [[]];
let decalMap = [[]];
let players = [];
let gameStarted = false;

const TILE_SIZE = 32;
const VISION_RADIUS = 10 * TILE_SIZE; // 10 tiles vision radius (must match backend)
let TILES_IN_ROW = 8; // will be overwritten when image loads

mapImage.onload = () => {
  TILES_IN_ROW = Math.floor(mapImage.width / TILE_SIZE);
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
});

// Game state updates
let gameState = {
  state: "playing",
  playerRole: "crewmate",
  isAlive: true,
  deadBodies: [],
  killCooldown: 0,
  killCooldownStart: 0,
  gameStartTime: 0,
  lastKillTime: 0,
  meetingActive: false,
  votingActive: false,
};

socket.on("gameState", (data) => {
  gameState.state = data.state;
  gameState.playerRole = data.playerRole;
  gameState.isAlive = data.isAlive;
  gameState.deadBodies = data.deadBodies;
  gameState.gameStartTime = data.gameStartTime;
  gameState.lastKillTime = data.lastKillTime;
});

// Kill cooldown updates
socket.on("killCooldown", (data) => {
  gameState.killCooldown = data.timeRemaining;
  gameState.killCooldownStart = Date.now();
});

// Player killed event
socket.on("playerKilled", (data) => {
  console.log("Player killed:", data.victimId);
});

// Meeting events
socket.on("meetingStarted", (data) => {
  gameState.meetingActive = false; // No separate meeting phase
  gameState.votingActive = true; // Start voting immediately
  gameState.alivePlayers = data.alivePlayers;
  showVotingUI(); // Show voting UI immediately
  console.log("Meeting started by", data.reportedBy, "- voting begins now");
});

socket.on("votingStarted", (data) => {
  // This event may still be sent by old code, but we handle everything in meetingStarted now
  gameState.meetingActive = false;
  gameState.votingActive = true;
  gameState.alivePlayers = data.alivePlayers;
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

  let message = "Voting Results:\n";
  if (data.ejectedPlayer) {
    message += `${data.ejectedPlayer} was ejected!`;
  } else {
    message += "No one was ejected (tie or skip)";
  }
  alert(message);

  console.log("Voting results:", data);
});

socket.on("gameOver", (data) => {
  console.log("Game Over! Winner:", data.winner);
  alert(`Game Over! ${data.winner} win!`);
});

const inputs = {
  up: false,
  down: false,
  left: false,
  right: false,
};

window.addEventListener("keydown", (e) => {
  if (e.key === "w") {
    inputs["up"] = true;
  } else if (e.key === "s") {
    inputs["down"] = true;
  } else if (e.key === "d") {
    inputs["right"] = true;
  } else if (e.key === "a") {
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
  socket.emit("inputs", inputs);
});

window.addEventListener("keyup", (e) => {
  if (e.key === "w") {
    inputs["up"] = false;
  } else if (e.key === "s") {
    inputs["down"] = false;
  } else if (e.key === "d") {
    inputs["right"] = false;
  } else if (e.key === "a") {
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
  socket.emit("inputs", inputs);
});

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

// Update button visibility and state
function updateButtons() {
  const killButton = document.getElementById("killButton");
  const reportButton = document.getElementById("reportButton");

  if (!killButton || !reportButton) return;

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

    if (remainingCooldown > 0) {
      killButton.disabled = true;
      killButton.textContent = `KILL (${Math.ceil(remainingCooldown / 1000)}s)`;
      killButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    } else {
      killButton.disabled = false;
      killButton.textContent = "KILL";
      killButton.className =
        "px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg";
    }
  } else {
    killButton.style.display = "none";
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
        "px-4 py-2 bg-yellow-600 text-white rounded-lg font-bold hover:bg-yellow-700 transition-colors shadow-lg";
    } else {
      reportButton.disabled = true;
      reportButton.textContent = "REPORT";
      reportButton.className =
        "px-4 py-2 bg-gray-500 text-white rounded-lg font-bold cursor-not-allowed shadow-lg";
    }
  } else {
    reportButton.style.display = "none";
  }
}

// UI Management Functions
function showMeetingUI() {
  const meetingUI = document.getElementById("meetingUI");
  if (meetingUI) {
    meetingUI.style.display = "flex";
    startMeetingTimer();
  }
}

function showVotingUI() {
  const meetingUI = document.getElementById("meetingUI");
  const votingUI = document.getElementById("votingUI");

  if (meetingUI) meetingUI.style.display = "none";
  if (votingUI) votingUI.style.display = "flex";

  createVotingOptions();
  startVotingTimer(); // Start the 60-second voting timer
}

function hideAllUI() {
  const meetingUI = document.getElementById("meetingUI");
  const votingUI = document.getElementById("votingUI");

  if (meetingUI) meetingUI.style.display = "none";
  if (votingUI) votingUI.style.display = "none";
}

function startVotingTimer() {
  let timeLeft = 60;
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

function createVotingOptions() {
  const votingOptions = document.getElementById("votingOptions");
  if (!votingOptions || !gameState.alivePlayers) return;

  votingOptions.innerHTML = "";

  // Add skip option
  const skipButton = document.createElement("button");
  skipButton.className =
    "w-full p-2 bg-gray-600 hover:bg-gray-500 text-white rounded mb-2";
  skipButton.textContent = "Skip Vote";
  skipButton.onclick = () => vote("skip");
  votingOptions.appendChild(skipButton);

  // Add player options (only if alive) - including self
  if (gameState.isAlive) {
    gameState.alivePlayers.forEach((player) => {
      const button = document.createElement("button");
      button.className =
        "w-full p-2 bg-blue-600 hover:bg-blue-500 text-white rounded mb-2";

      // Special styling for self-vote
      if (player.id === socket.id) {
        button.textContent = `Vote for ${player.name || player.id} (You)`;
        button.className =
          "w-full p-2 bg-purple-600 hover:bg-purple-500 text-white rounded mb-2";
      } else {
        button.textContent = `Vote for ${player.name || player.id}`;
      }

      button.onclick = () => vote(player.id);
      votingOptions.appendChild(button);
    });
  } else {
    // Dead players can't vote
    const deadMessage = document.createElement("p");
    deadMessage.className = "text-center text-gray-300";
    deadMessage.textContent = "You are dead and cannot vote.";
    votingOptions.appendChild(deadMessage);
  }
}

function vote(targetId) {
  if (gameState.isAlive && gameState.votingActive) {
    socket.emit("vote", { targetId: targetId });

    // Disable all voting buttons
    const buttons = document.querySelectorAll("#votingOptions button");
    buttons.forEach((button) => {
      button.disabled = true;
      button.className = button.className.replace("hover:bg-", "");
    });
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

  // Render dead bodies
  for (const body of gameState.deadBodies) {
    canvas.fillStyle = "red";
    canvas.fillRect(body.x - cameraX, body.y - cameraY, TILE_SIZE, TILE_SIZE);
  }

  for (const player of players) {
    // Set player opacity if provided
    if (player.opacity !== undefined && player.opacity < 1.0) {
      canvas.globalAlpha = player.opacity;
    }

    canvas.drawImage(
      personImage,
      player.x - cameraX,
      player.y - cameraY,
      TILE_SIZE,
      TILE_SIZE
    );

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
  canvas.fillText(`Role: ${gameState.playerRole}`, 10, 30);
  canvas.fillText(`Status: ${gameState.isAlive ? "Alive" : "Dead"}`, 10, 55);

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

  // Instructions
  canvas.fillStyle = "white";
  canvas.font = "14px Arial";
  canvas.fillText("WASD: Move", 10, canvasEl.height - 20);
  if (gameState.playerRole === "imposter" && gameState.isAlive) {
    canvas.fillText("Use buttons to KILL and REPORT", 10, canvasEl.height - 40);
  } else if (gameState.isAlive) {
    canvas.fillText(
      "Use button to REPORT dead bodies",
      10,
      canvasEl.height - 40
    );
  }
}

function renderFogOfWar(player, cameraX, cameraY) {
  // Create radial gradient for fog of war
  const playerScreenX = player.x - cameraX + TILE_SIZE / 2;
  const playerScreenY = player.y - cameraY + TILE_SIZE / 2;

  // Slightly larger visual fog radius with smoother transitions
  const visualFogRadius = VISION_RADIUS * 1.1;
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
