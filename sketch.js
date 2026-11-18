const FACE_FILES = [
  "IMG_1517.png", // Interactive ghost
  "IMG_1516.png",
  "IMG_1518.png",
  "IMG_1519.png",
  "IMG_1520.png",
  "IMG_1521.png",
  "IMG_1522.png"
];

const BACKGROUND_POSITIONS = [
  [0.15, 0.25],
  [0.35, 0.13],
  [0.65, 0.17],
  [0.85, 0.31],
  [0.19, 0.66],
  [0.81, 0.70]
];

const SOUND_ZONES = [
  {
    label: "Upper left",
    name: "Footsteps",
    files: ["Footsteps.mp3", "Footsteps(1).mp3"]
  },
  {
    label: "Upper right",
    name: "Knocks",
    files: ["Knocks.mp3", "Knocks(1).mp3"]
  },
  {
    label: "Lower left",
    name: "Creepy giggles",
    files: ["Creepy giggles(3).mp3", "Creepy giggles.mp3"]
  },
  {
    label: "Lower right",
    name: "Woman scream",
    files: ["Woman scream.mp3"]
  }
];

const MIN_CONFIDENCE = 0.3;
const CENTER_GAP = 0.035;
const MAIN_SMOKE_PUFFS = 9;
const BACKGROUND_SMOKE_PUFFS = 3;

const JUMP_SCARE = {
  firstDelay: 7000,
  minDelay: 6000,
  maxDelay: 11000,
  rushMs: 230,
  holdMs: 180,
  returnMs: 650,
  scale: 3
};

let mainGhost;
let backgroundGhosts;
let backgroundSmokeTexture;
let mainSmokeTexture;
let jumpScare = null;
let nextJumpScareAt;

let camera;
let poseModel;
let latestPose;
let lastPoseTime = -Infinity;
let cameraStatus;

let soundContext;
let soundStatus;
let soundLoadStatus;
let currentZone = -1;

function setup() {
  pixelDensity(1);
  createCanvas(windowWidth, windowHeight);
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";

  backgroundSmokeTexture = makeSmokeTexture([
    [0, "rgba(218, 237, 255, 0.36)"],
    [0.36, "rgba(156, 195, 229, 0.22)"],
    [0.73, "rgba(99, 146, 190, 0.07)"],
    [1, "rgba(99, 146, 190, 0)"]
  ]);

  mainSmokeTexture = makeSmokeTexture([
    [0.1, "rgba(220, 240, 255, 1)"],
    [0.3, "rgba(180, 210, 230, 0.4)"],
    [1, "rgba(180, 210, 230, 0)"]
  ]);

  mainGhost = makeGhost(FACE_FILES[0], width / 2, height * 0.42);

  backgroundGhosts = BACKGROUND_POSITIONS.map(([x, y], index) => {
    const ghost = makeGhost(FACE_FILES[index + 1], x * width, y * height);
    const angle = index * TWO_PI / BACKGROUND_POSITIONS.length + 0.45;
    const speed = 0.9 + index * 0.18;

    ghost.vx = cos(angle) * speed;
    ghost.vy = sin(angle) * speed;
    ghost.faceWidth = 88 + (index % 3) * 9;
    return ghost;
  });

  nextJumpScareAt = millis() + JUMP_SCARE.firstDelay;

  cameraStatus = makeStatus("Allow camera access to control the ghost.", 14);
  setupSoundButton();
  startBodyTracking();
}

function draw() {
  background(5, 8, 14);

  const now = millis();
  const time = now / 1000;
  const step = constrain(deltaTime / (1000 / 60), 0, 2);
  const sizeScale = constrain(min(width, height) / 640, 0.45, 1.4);

  updateJumpScare(now);

  for (const ghost of backgroundGhosts) {
    if (ghost === jumpScare?.ghost) continue;

    const faceWidth = ghost.faceWidth * sizeScale;
    moveBackgroundGhost(ghost, faceWidth, step);

    for (let i = 0; i < BACKGROUND_SMOKE_PUFFS; i++) {
      addBackgroundSmoke(ghost, faceWidth);
    }

    drawSmoke(ghost, backgroundSmokeTexture, step, time);
    drawFace(ghost, faceWidth, 0.78);
  }

  const pose = now - lastPoseTime <= 550 ? latestPose : null;
  const nose = getPoint(pose, "nose");
  const leftShoulder = getPoint(pose, "left_shoulder");
  const rightShoulder = getPoint(pose, "right_shoulder");

  const bodyCenter = leftShoulder && rightShoulder
    ? {
        x: (leftShoulder.x + rightShoulder.x) / 2,
        y: (leftShoulder.y + rightShoulder.y) / 2
      }
    : nose;

  moveMainGhost(nose, bodyCenter, step);

  const faceWidth = 174 * sizeScale;

  for (let i = 0; i < MAIN_SMOKE_PUFFS; i++) {
    addMainSmoke(mainGhost.x, mainGhost.y + faceWidth * 0.18, sizeScale, 1);
  }

  for (const name of ["left_wrist", "right_wrist"]) {
    const wrist = getPoint(pose, name);
    if (wrist) {
      addMainSmoke(wrist.x, wrist.y, sizeScale * 0.65, 0.65);
    }
  }

  drawSmoke(mainGhost, mainSmokeTexture, step, time);
  drawFace(mainGhost, faceWidth, 1);

  // Draw the rushing ghost last so it appears in front.
  drawJumpScare(now, sizeScale, step, time);
  playZoneSound(bodyCenter);
}

// Jump scares

function updateJumpScare(now) {
  if (jumpScare) {
    const elapsed = now - jumpScare.startedAt;
    const duration = JUMP_SCARE.rushMs + JUMP_SCARE.holdMs + JUMP_SCARE.returnMs;

    if (elapsed < duration) return;

    jumpScare.ghost.x = jumpScare.homeX * width;
    jumpScare.ghost.y = jumpScare.homeY * height;
    jumpScare = null;
    nextJumpScareAt = now + random(JUMP_SCARE.minDelay, JUMP_SCARE.maxDelay);
    return;
  }

  if (now < nextJumpScareAt) return;

  const ghost = random(backgroundGhosts);
  jumpScare = {
    ghost,
    homeX: ghost.x / width,
    homeY: ghost.y / height,
    startedAt: now
  };
}

function drawJumpScare(now, sizeScale, step, time) {
  if (!jumpScare) return;

  const { ghost, homeX, homeY, startedAt } = jumpScare;
  const { rushMs, holdMs, returnMs, scale } = JUMP_SCARE;
  const elapsed = now - startedAt;
  let approach = 1;

  if (elapsed < rushMs) {
    const progress = elapsed / rushMs;
    approach = progress * progress;
  } else if (elapsed >= rushMs + holdMs) {
    const progress = constrain((elapsed - rushMs - holdMs) / returnMs, 0, 1);
    approach = 1 - progress * progress * (3 - 2 * progress);
  }

  ghost.x = lerp(homeX * width, width / 2, approach);
  ghost.y = lerp(homeY * height, height / 2, approach);

  const faceWidth = ghost.faceWidth * sizeScale * lerp(1, scale, approach);
  const puffCount = BACKGROUND_SMOKE_PUFFS + floor(approach * 4);

  for (let i = 0; i < puffCount; i++) {
    addBackgroundSmoke(ghost, faceWidth);
  }

  drawSmoke(ghost, backgroundSmokeTexture, step, time);
  drawFace(ghost, faceWidth, lerp(0.78, 1, approach));
}

// Sound

function makeStatus(message, top) {
  const status = createDiv(message);
  status.position(14, top);
  status.style("color", "#d7e4ef");
  status.style("font", "14px system-ui");
  status.style("pointer-events", "none");
  return status;
}

function setupSoundButton() {
  const button = createButton("Enable sound");
  button.position(14, 42);

  soundLoadStatus = makeStatus("", 72);
  soundStatus = makeStatus("", 96);

  button.elt.addEventListener("click", async () => {
    button.elt.disabled = true;
    soundLoadStatus.elt.textContent = "Loading sound files…";

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      soundContext ??= new AudioContextClass();
      await soundContext.resume();

      const results = await Promise.allSettled(
        SOUND_ZONES.map(async (zone) => {
          if (!zone.buffer) {
            zone.buffer = await loadZoneSound(zone);
          }
        })
      );

      const missing = SOUND_ZONES.filter(
        (_, index) => results[index].status === "rejected"
      );

      currentZone = -1;

      if (missing.length === 0) {
        soundLoadStatus.elt.textContent = "";
        button.hide();
      } else {
        soundLoadStatus.elt.textContent =
          "Could not load " + missing.map((zone) => zone.files[0]).join(", ");
        button.elt.textContent = "Retry sound";
        button.elt.disabled = false;
      }
    } catch (error) {
      soundLoadStatus.elt.textContent = "Could not enable sound. Tap Retry sound.";
      button.elt.textContent = "Retry sound";
      button.elt.disabled = false;
      console.error(error);
    }
  });
}

async function loadZoneSound(zone) {
  for (const filename of zone.files) {
    try {
      const response = await fetch(filename);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const bytes = await response.arrayBuffer();
      return await soundContext.decodeAudioData(bytes);
    } catch (error) {
      console.warn(`Could not load ${filename}`, error);
    }
  }

  throw new Error(`No playable file found for ${zone.name}`);
}

function playZoneSound(bodyCenter) {
  if (!soundContext || soundContext.state !== "running") return;
  if (!SOUND_ZONES.some((zone) => zone.buffer)) return;

  if (!bodyCenter) {
    currentZone = -1;
    soundStatus.elt.textContent = "Waiting for the camera to see you.";
    return;
  }

  const x = bodyCenter.x / width;
  const y = bodyCenter.y / height;

  if (Math.abs(x - 0.5) < CENTER_GAP || Math.abs(y - 0.5) < CENTER_GAP) {
    soundStatus.elt.textContent = "Move farther into a corner.";
    return;
  }

  const column = x < 0.5 ? 0 : 1;
  const row = y < 0.5 ? 0 : 1;
  const nextZone = row * 2 + column;
  const zone = SOUND_ZONES[nextZone];

  soundStatus.elt.textContent = zone.buffer
    ? `${zone.label} · ${zone.name}`
    : `${zone.label} · sound file unavailable`;

  if (nextZone === currentZone) return;
  currentZone = nextZone;
  if (!zone.buffer) return;

  const source = soundContext.createBufferSource();
  source.buffer = zone.buffer;
  source.connect(soundContext.destination);
  source.start();
}

// Camera and body tracking

async function startBodyTracking() {
  if (typeof ml5 === "undefined") {
    cameraStatus.elt.textContent = "The ml5 library is missing from index.html.";
    return;
  }

  let stream;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });

    camera = createVideo([]);
    camera.hide();
    camera.elt.muted = true;
    camera.elt.playsInline = true;
    camera.elt.srcObject = stream;
    await camera.elt.play();

    cameraStatus.elt.textContent = "Loading body tracking…";

    poseModel = await new Promise((resolve, reject) => {
      const model = ml5.bodyPose("MoveNet", () => {
        queueMicrotask(() => resolve(model));
      });

      if (typeof model?.then === "function") {
        model.then(resolve, reject);
      }
    });

    cameraStatus.elt.textContent = "Step back until the camera can see you.";

    poseModel.detectStart(camera, (poses) => {
      if (!poses[0]) return;

      latestPose = poses[0];
      lastPoseTime = millis();
    });
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    cameraStatus.elt.textContent = stream
      ? "Body tracking could not start. Check the console."
      : "Allow camera access and run the sketch again.";
    console.error(error);
  }
}

function getPoint(pose, name) {
  const point = pose?.keypoints?.find(
    (keypoint) => keypoint.name === name && keypoint.confidence >= MIN_CONFIDENCE
  );

  const videoWidth = camera?.elt.videoWidth;
  const videoHeight = camera?.elt.videoHeight;

  if (!point || !videoWidth || !videoHeight) return null;

  return {
    x: width * (1 - point.x / videoWidth),
    y: height * point.y / videoHeight
  };
}

function moveMainGhost(nose, bodyCenter, step) {
  if (!bodyCenter) {
    mainGhost.x = lerp(mainGhost.x, width / 2, 0.025 * step);
    mainGhost.y = lerp(mainGhost.y, height * 0.42, 0.025 * step);
    return;
  }

  cameraStatus.hide();

  const targetY = nose ? nose.y : bodyCenter.y - height * 0.08;

  mainGhost.x = lerp(
    mainGhost.x,
    constrain(bodyCenter.x, width * 0.12, width * 0.88),
    0.17 * step
  );

  mainGhost.y = lerp(
    mainGhost.y,
    constrain(targetY, height * 0.13, height * 0.75),
    0.17 * step
  );
}

// Ghost faces and movement

function makeGhost(filename, x, y) {
  const ghost = { x, y, vx: 0, vy: 0, face: null, smoke: [] };
  const face = new Image();

  face.onload = () => {
    ghost.face = face;
  };
  face.onerror = () => console.warn(`Could not load ${filename}`);
  face.src = filename;

  return ghost;
}

function getFaceHeight(ghost, faceWidth) {
  if (!ghost.face) return faceWidth;

  return faceWidth * ghost.face.naturalHeight / ghost.face.naturalWidth;
}

function moveBackgroundGhost(ghost, faceWidth, step) {
  const marginX = min(faceWidth / 2 + 8, width / 2);
  const marginY = min(getFaceHeight(ghost, faceWidth) / 2 + 8, height / 2);

  ghost.x += ghost.vx * step;
  ghost.y += ghost.vy * step;

  if (ghost.x <= marginX) {
    ghost.x = marginX;
    ghost.vx = abs(ghost.vx);
  } else if (ghost.x >= width - marginX) {
    ghost.x = width - marginX;
    ghost.vx = -abs(ghost.vx);
  }

  if (ghost.y <= marginY) {
    ghost.y = marginY;
    ghost.vy = abs(ghost.vy);
  } else if (ghost.y >= height - marginY) {
    ghost.y = height - marginY;
    ghost.vy = -abs(ghost.vy);
  }
}

function drawFace(ghost, faceWidth, opacity) {
  const ctx = drawingContext;
  ctx.save();

  drawPuff(ctx, backgroundSmokeTexture, ghost.x, ghost.y, faceWidth * 0.65);

  if (ghost.face) {
    const faceHeight = getFaceHeight(ghost, faceWidth);
    ctx.globalAlpha = opacity;
    ctx.drawImage(
      ghost.face,
      ghost.x - faceWidth / 2,
      ghost.y - faceHeight / 2,
      faceWidth,
      faceHeight
    );
  }

  ctx.restore();
}

// Smoke

function makeSmokeTexture(stops) {
  const texture = document.createElement("canvas");
  texture.width = texture.height = 128;

  const ctx = texture.getContext("2d");
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);

  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return texture;
}

function addBackgroundSmoke(ghost, faceWidth) {
  const baseRadius = faceWidth * 0.24;
  const radius = baseRadius * random(0.62, 1.22);
  const life = random(25, 63);

  ghost.smoke.push({
    x: ghost.x + random(-0.45, 0.45) * baseRadius,
    y: ghost.y + faceWidth * 0.13,
    vx: random(-0.75, 0.75),
    vy: baseRadius * random(0.025, 0.075),
    radius,
    maxRadius: radius * 2,
    life,
    maxLife: life,
    opacity: 0.62 * 0.65,
    phase: random(TWO_PI),
    wobbleSpeed: 2.3,
    wobbleAmount: 0.8
  });

  if (ghost.smoke.length > 260) ghost.smoke.shift();
}

function addMainSmoke(x, y, size, opacity) {
  const radius = random(20, 44) * size;
  const life = 0.35 / random(0.0028, 0.0045);

  mainGhost.smoke.push({
    x: x + random(-18, 18) * size,
    y: y + random(-10, 10) * size,
    vx: random(-0.85, 0.85) * size,
    vy: random(0.8, 2.6) * size,
    radius,
    maxRadius: radius * random(2.5, 4.5),
    life,
    maxLife: life,
    opacity: 0.35 * opacity,
    phase: random(TWO_PI),
    wobbleSpeed: random(0.9, 3),
    wobbleAmount: 0.55 * size
  });

  if (mainGhost.smoke.length > 1500) mainGhost.smoke.shift();
}

function drawSmoke(ghost, texture, step, time) {
  const ctx = drawingContext;
  let activeCount = 0;
  ctx.save();

  for (const puff of ghost.smoke) {
    puff.life -= step;
    if (puff.life <= 0) continue;

    const remaining = puff.life / puff.maxLife;
    const wobble = sin(time * puff.wobbleSpeed + puff.phase) * puff.wobbleAmount;
    const radius = lerp(puff.radius, puff.maxRadius, 1 - remaining);

    puff.x += (puff.vx + wobble) * step;
    puff.y += puff.vy * step;

    ctx.globalAlpha = puff.opacity * remaining;
    drawPuff(ctx, texture, puff.x, puff.y, radius);

    ghost.smoke[activeCount] = puff;
    activeCount++;
  }

  ghost.smoke.length = activeCount;
  ctx.restore();
}

function drawPuff(ctx, texture, x, y, radius) {
  const diameter = radius * 2;
  ctx.drawImage(texture, x - radius, y - radius, diameter, diameter);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}