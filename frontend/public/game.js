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
    socket.emit("joinRoom", { roomId });
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
  if (e.code === "Space") {
    socket.emit("teleport");
  }
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

  window.requestAnimationFrame(loop);
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
