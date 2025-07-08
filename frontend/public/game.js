const mapImage = new Image();
mapImage.src = "/Modern_Exteriors_Complete_Tileset_32x32.png";

const personImage = new Image();
personImage.src = "/person.png";

const walking = new Audio("walking.mp3");
const nature = new Audio("nature.mp3");

const canvasEl = document.getElementById("canvas");
canvasEl.width = window.innerWidth;
canvasEl.height = window.innerHeight;
const canvas = canvasEl.getContext("2d");

const socket = io(window.BACKEND_URL || "http://localhost:3000");

let groundMap = [[]];
let decalMap = [[]];
let players = [];

const TILE_SIZE = 32;
let TILES_IN_ROW = 8; // will be overwritten when image loads

mapImage.onload = () => {
  TILES_IN_ROW = Math.floor(mapImage.width / TILE_SIZE);
};

socket.on("connect", () => {
  console.log("connected");
});

socket.on("map", (loadedMap) => {
  groundMap = loadedMap.ground;
  decalMap = loadedMap.decal;
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
      walking.play();
    } catch (_) {}
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
    walking.pause();
    walking.currentTime = 0;
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
  canvas.clearRect(0, 0, canvasEl.width, canvasEl.height);

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
    canvas.drawImage(
      personImage,
      player.x - cameraX,
      player.y - cameraY,
      TILE_SIZE,
      TILE_SIZE
    );
  }

  window.requestAnimationFrame(loop);
}

window.requestAnimationFrame(loop);
