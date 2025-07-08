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
  currentVote: null,
  playerTasks: [],
  completedTasks: [],
  currentTaskModal: null,
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
  gameState.currentVote = null; // Reset current vote

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

// Helper function to find closest incomplete task
function findClosestTask(player) {
  if (gameState.playerRole !== "crewmate") return null;

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

// Helper function to check if a task location is completed
function isTaskCompleted(location) {
  const locationKey = `${location.x},${location.y}`;
  return gameState.completedTasks.includes(locationKey);
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

window.attemptTask = function () {
  if (
    gameState.playerRole === "crewmate" &&
    gameState.isAlive &&
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

// Update button visibility and state
function updateButtons() {
  const killButton = document.getElementById("killButton");
  const reportButton = document.getElementById("reportButton");
  const taskButton = document.getElementById("taskButton");

  if (!killButton || !reportButton || !taskButton) return;

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
        "px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg cursor-pointer";
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

  // Task button - show for living crewmates during active game
  if (gameState.playerRole === "crewmate" && gameState.isAlive && gameActive) {
    // Check if there's a task nearby
    const hasNearbyTask = myPlayer && findClosestTask(myPlayer);

    if (hasNearbyTask) {
      taskButton.style.display = "block";
      taskButton.disabled = false;
      taskButton.textContent = "DO TASK";
      taskButton.className =
        "px-4 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-lg cursor-pointer";
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
  const votingResultsUI = document.getElementById("votingResultsUI");
  const gameEndUI = document.getElementById("gameEndUI");
  const taskModal = document.getElementById("taskModal");

  if (meetingUI) meetingUI.style.display = "none";
  if (votingUI) votingUI.style.display = "none";
  if (votingResultsUI) votingResultsUI.style.display = "none";
  if (gameEndUI) gameEndUI.style.display = "none";
  if (taskModal) taskModal.style.display = "none";
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
}

function hideTaskModal() {
  const taskModal = document.getElementById("taskModal");
  if (taskModal) {
    taskModal.style.display = "none";
  }
  gameState.currentTaskModal = null;
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

  // Auto-close after 2 seconds
  setTimeout(() => {
    hideTaskModal();
  }, 2000);
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
        data.ejectedRole === "imposter" ? "an Imposter" : "a Crewmate"
      }</p>`;
    }
  } else {
    resultHTML = `<p class="text-lg font-bold text-gray-300">No one was ejected</p><p class="text-sm">(Tie vote or majority skipped)</p>`;
  }

  votingResultsContent.innerHTML = resultHTML;
  votingResultsUI.style.display = "flex";

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
      <p class="text-md mb-2 text-red-300">Imposters were: ${imposterNames}</p>
      <p class="text-sm text-gray-400">Evil triumphs this time...</p>
    `;
  } else if (data.winner === "crewmates") {
    gameEndTitle.textContent = "Crewmates Win!";
    gameEndTitle.className =
      "text-2xl font-bold mb-4 text-center text-blue-400";
    gameEndContent.innerHTML = `
      <p class="text-lg mb-2">All imposters have been ejected!</p>
      <p class="text-sm text-gray-400">Justice has been served!</p>
    `;
  } else {
    gameEndTitle.textContent = "Game Over";
    gameEndTitle.className = "text-2xl font-bold mb-4 text-center text-white";
    gameEndContent.innerHTML = `<p class="text-lg">Game ended</p>`;
  }

  gameEndUI.style.display = "flex";

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
    };
  }

  if (exitGameButton) {
    exitGameButton.onclick = () => {
      // Navigate back to home
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

  // Render task tiles (yellow overlay for crewmates)
  if (gameState.playerRole === "crewmate") {
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

  // Task list for crewmates
  if (gameState.playerRole === "crewmate") {
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

        canvas.fillStyle = color;
        canvas.fillText(`${status} ${location}`, 10, yOffset);
        yOffset += 20;
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
