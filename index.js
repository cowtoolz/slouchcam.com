// TODO: de-spaghettification

let detector = null;
let isRunning = false;
let worker = null;
let useWorker = true;
let lastTime = 0;
let frameCount = 0;
let fps = 0;

let max_neck_length = 0;
let current_neck_length = 0;
let current_shoulder_width = 0;
let current_head_width = 0;

const video = document.getElementById("inputVideo");
const canvas = document.getElementById("outputCanvas");
const ctx = canvas.getContext("2d");
const poseDataElement = document.getElementById("poseData");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const screenshotBtn = document.getElementById("screenshotBtn");
const statusElement = document.getElementById("status");
const tabStatus = document.getElementById("tabStatus");
const fpsDisplay = document.getElementById("fpsDisplay");

// debug tab visibility
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    tabStatus.textContent = "Tab in Background - Worker Active";
    tabStatus.className = "background-indicator background";
  } else {
    tabStatus.textContent = "Tab Active";
    tabStatus.className = "background-indicator active";
  }
});

function updateStatus(message, type = "loading") {
  statusElement.textContent = message;
  statusElement.className = `status ${type}`;
}

function updateFPS() {
  const now = performance.now();
  frameCount++;

  if (now - lastTime >= 1000) {
    fps = Math.round((frameCount * 1000) / (now - lastTime));
    fpsDisplay.textContent = fps;
    frameCount = 0;
    lastTime = now;
  }
}

async function setupCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 640,
        height: 480,
        facingMode: "user",
      },
    });
    video.srcObject = stream;

    return new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play().then(resolve).catch(reject);
      };
      video.onerror = reject;
    });
  } catch (error) {
    throw new Error(`Camera access failed: ${error.message}`);
  }
}

async function loadModel() {
  try {
    updateStatus("Loading pose detection model...", "loading");

    worker = new Worker("worker.js");

    worker.onmessage = function (e) {
      switch (e.data.type) {
        case "initialized":
          updateStatus("Model loaded in Web Worker!", "ready");
          startBtn.disabled = false;
          screenshotBtn.disabled = false;
          break;
        case "poses":
          drawKeypoints(e.data.poses);
          poseDataElement.textContent = formatPoseData(e.data.poses);
          updateFPS();
          break;
        case "requestFrame":
          // worker requested frame
          if (isRunning && video.readyState >= 2) {
            const imageData = getVideoFrame();
            worker.postMessage({
              type: "frameData",
              imageData: imageData,
            });
          }
          break;
        case "started":
          updateStatus("Running pose detection in worker...", "ready");
          break;
        case "stopped":
          updateStatus("Pose detection stopped", "loading");
          break;
        case "error":
          updateStatus(`Worker error: ${e.data.error}`, "error");
          break;
      }
    };

    worker.postMessage({ type: "init" });
  } catch (error) {
    updateStatus(`Failed to load model: ${error.message}`, "error");
    throw error;
  }
}

function drawKeypoints(poses) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  //ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (poses.length === 0) return;

  const pose = poses[0];

  let i = 0;
  pose.keypoints.forEach((keypoint) => {
    if (keypoint.score > 1.0 / 3.0) {
      ctx.beginPath();
      ctx.arc(keypoint.x, keypoint.y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#FF0000";
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    i++;
  });

  ctx.strokeStyle = "#00FF00";
  ctx.lineWidth = 3;
  const connections = [
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 4],
    [5, 6],
    [5, 7],
    [7, 9],
    [6, 8],
    [8, 10],
    [5, 11],
    [6, 12],
    [11, 12],
    [11, 13],
    [13, 15],
    [12, 14],
    [14, 16],
  ];
  connections.forEach(([i, j]) => {
    const kp1 = pose.keypoints[i];
    const kp2 = pose.keypoints[j];

    if (kp1 && kp2 && kp1.score > 1.0 / 3.0 && kp2.score > 1.0 / 3.0) {
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  });

  const SHOULDER_L = 5,
    SHOULDER_R = 6,
    EAR_L = 3,
    EAR_R = 4,
    EYE_L = 1,
    EYE_R = 2,
    NOSE = 0;

  let shoulder_mid_x =
    (pose.keypoints[SHOULDER_L].x + pose.keypoints[SHOULDER_R].x) / 2.0;
  let shoulder_mid_y =
    (pose.keypoints[SHOULDER_L].y + pose.keypoints[SHOULDER_R].y) / 2.0;
  let ear_mid_x = (pose.keypoints[EAR_L].x + pose.keypoints[EAR_R].x) / 2.0;
  let ear_mid_y = (pose.keypoints[EAR_L].y + pose.keypoints[EAR_R].y) / 2.0;
  let eye_mid_x = (pose.keypoints[EYE_L].x + pose.keypoints[EYE_R].x) / 2.0;
  let eye_mid_y = (pose.keypoints[EYE_L].y + pose.keypoints[EYE_R].y) / 2.0;
  let head_mid_x = (shoulder_mid_x + (ear_mid_x + eye_mid_x) / 2.0) / 2.0;
  let head_mid_y = (ear_mid_y + eye_mid_y) / 2.0;

  current_shoulder_width = Math.sqrt(
    Math.pow(pose.keypoints[SHOULDER_L].x - pose.keypoints[SHOULDER_R].x, 2) +
      Math.pow(pose.keypoints[SHOULDER_L].y - pose.keypoints[SHOULDER_R].y, 2),
  );

  current_head_width =
    Math.sqrt(
      Math.pow(pose.keypoints[EAR_L].x - pose.keypoints[EYE_L].x, 2) +
        Math.pow(pose.keypoints[EAR_L].y - pose.keypoints[EYE_L].y, 2),
    ) +
    Math.sqrt(
      Math.pow(pose.keypoints[EYE_L].x - pose.keypoints[NOSE].x, 2) +
        Math.pow(pose.keypoints[EYE_L].y - pose.keypoints[NOSE].y, 2),
    ) +
    Math.sqrt(
      Math.pow(pose.keypoints[NOSE].x - pose.keypoints[EYE_R].x, 2) +
        Math.pow(pose.keypoints[NOSE].y - pose.keypoints[EYE_R].y, 2),
    ) +
    Math.sqrt(
      Math.pow(pose.keypoints[EYE_R].x - pose.keypoints[EAR_R].x, 2) +
        Math.pow(pose.keypoints[EYE_R].y - pose.keypoints[EAR_R].y, 2),
    );

  // neck length figuring
  current_neck_length =
    Math.sqrt(
      Math.pow(shoulder_mid_x - head_mid_x, 2) +
        Math.pow(shoulder_mid_y - head_mid_y, 2),
    ) / current_head_width;
  max_neck_length = Math.max(current_neck_length, max_neck_length);

  if (current_neck_length < max_neck_length - max_neck_length * 0.15) {
    ctx.strokeStyle = "#FF0000";
  }

  ctx.beginPath();
  ctx.moveTo(shoulder_mid_x, shoulder_mid_y);
  ctx.lineTo(head_mid_x, head_mid_y);
  ctx.stroke();
}

function formatPoseData(poses) {
  if (poses.length === 0) {
    return "No pose detected";
  }

  const pose = poses[0];
  const keyPoints = pose.keypoints.filter((kp) => kp.score > 0.3);

  let result = `Detected ${keyPoints.length}/17 keypoints:\n\n`;

  const bodyParts = {
    Head: [0, 1, 2, 3, 4],
    Arms: [5, 6, 7, 8, 9, 10],
    Body: [11, 12],
    Legs: [13, 14, 15, 16],
  };

  for (const [partName, indices] of Object.entries(bodyParts)) {
    const partPoints = indices
      .map((i) => pose.keypoints[i])
      .filter((kp) => kp && kp.score > 0.3);

    if (partPoints.length > 0) {
      result += `${partName}:\n`;
      partPoints.forEach((kp) => {
        result += `  ${kp.name}: (${Math.round(kp.x)}, ${Math.round(kp.y)}) [${(kp.score * 100).toFixed(1)}%]\n`;
      });
      result += "\n";
    }
  }

  result += `\nMax neck length: ${max_neck_length}\n`;
  result += `Current neck length: ${current_neck_length}\n`;
  result += `current_head_width: ${current_head_width}\n`;
  return result;
}

function getVideoFrame() {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const tempCtx = tempCanvas.getContext("2d");
  tempCtx.drawImage(video, 0, 0);
  return tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
}

async function start() {
  if (useWorker && !worker) return;

  isRunning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  lastTime = performance.now();
  frameCount = 0;

  worker.postMessage({ type: "start" });
}

function stop() {
  isRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;

  if (useWorker && worker) {
    worker.postMessage({ type: "stop" });
  }
}

function takeScreenshot() {
  const link = document.createElement("a");
  link.download = `pose-detection-${Date.now()}.png`;
  link.href = canvas.toDataURL();
  link.click();
}

startBtn.addEventListener("click", start);
stopBtn.addEventListener("click", stop);
screenshotBtn.addEventListener("click", takeScreenshot);

async function initialize() {
  try {
    updateStatus("Setting up camera...", "loading");
    await setupCamera();
    updateStatus("Camera ready. Loading AI model...", "loading");
    await loadModel();

    Notification.requestPermission().then((result) => {
      console.log(result);
    });
  } catch (error) {
    updateStatus(`Initialization failed: ${error.message}`, "error");
    console.error("Initialization error:", error);
  }
}

window.addEventListener("load", initialize);

window.addEventListener("beforeunload", () => {
  if (worker) {
    worker.terminate();
  }
});
