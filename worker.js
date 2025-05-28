importScripts(
  "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.0.0/dist/tf.min.js",
);

importScripts(
  "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.0.0/dist/pose-detection.min.js",
);

let detector = null;
let isInitialized = false;
let isRunning = false;
let detectionInterval = null;
let targetFPS = 30;

async function initializeDetector() {
  try {
    const detectorConfig = {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
      enableSmoothing: true,
      enableTracking: true,
    };

    detector = await poseDetection.createDetector(
      poseDetection.SupportedModels.MoveNet,
      detectorConfig,
    );

    isInitialized = true;
    self.postMessage({ type: "initialized" });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message });
  }
}

async function detectPose(imageData) {
  if (!isInitialized || !detector) return;

  try {
    const poses = await detector.estimatePoses(imageData);
    self.postMessage({ type: "poses", poses: poses });
  } catch (error) {
    self.postMessage({ type: "error", error: error.message });
  }
}

function startDetectionLoop() {
  if (isRunning || !isInitialized) return;

  isRunning = true;
  const frameInterval = 1000 / targetFPS;

  detectionInterval = setInterval(() => {
    if (isRunning) {
      // request a frame from the main thread
      self.postMessage({ type: "requestFrame" });
    }
  }, frameInterval);

  self.postMessage({ type: "started" });
}

function stopDetectionLoop() {
  isRunning = false;

  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
  }

  self.postMessage({ type: "stopped" });
}

self.onmessage = function (e) {
  switch (e.data.type) {
    case "init":
      initializeDetector();
      break;
    case "detect":
      detectPose(e.data.imageData);
      break;
    case "frameData":
      if (isRunning) {
        detectPose(e.data.imageData);
      }
      break;
    case "start":
      startDetectionLoop();
      break;
    case "stop":
      stopDetectionLoop();
      break;
    case "setFPS":
      targetFPS = e.data.fps || 30;
      if (isRunning) {
        stopDetectionLoop();
        setTimeout(() => startDetectionLoop(), 100);
      }
      break;
  }
};
