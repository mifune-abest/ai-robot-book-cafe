importScripts('/vendor/mediapipe/vision_bundle.js');

const root = self.location.origin;
const mathPromise = import('../local-face-compositor-math.js');
const { FaceLandmarker, FilesetResolver } = Vision;
let taskPromise;

function createTriangleIndexBuffer() {
  const connections = FaceLandmarker.FACE_LANDMARKS_TESSELATION || [];
  const values = [];
  for (let index = 0; index + 2 < connections.length; index += 3) {
    const points = new Set([
      connections[index].start,
      connections[index].end,
      connections[index + 1].start,
      connections[index + 1].end,
      connections[index + 2].start,
      connections[index + 2].end,
    ]);
    if (points.size === 3) values.push(...points);
  }
  return Uint16Array.from(values);
}

function createFaceOvalIndexBuffer() {
  const connections = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL || [];
  return Uint16Array.from(connections.map((connection) => connection.start));
}

const triangleIndices = createTriangleIndexBuffer();
const faceOvalIndices = createFaceOvalIndexBuffer();

async function createTasks() {
  const vision = await FilesetResolver.forVisionTasks(`${root}/vendor/mediapipe/wasm`);
  const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `${root}/models/face_landmarker.task`,
      delegate: 'CPU',
    },
    runningMode: 'IMAGE',
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  return { faceLandmarker };
}

function tasks() {
  if (!taskPromise) taskPromise = createTasks();
  return taskPromise;
}

function targetError(code) {
  if (code === 'MULTIPLE_FACES') return 'TARGET_MULTIPLE_FACES';
  if (code === 'FACE_TILTED') return 'TARGET_FACE_TILTED';
  if (code && code !== 'MODEL_UNAVAILABLE') return 'TARGET_FACE_NOT_FOUND';
  return code;
}

function postFailure(id, code, purpose) {
  self.postMessage({
    id,
    ok: false,
    code: purpose === 'target' ? targetError(code) : code,
  });
}

function serializeLandmarks(landmarks) {
  const values = new Float32Array(landmarks.length * 3);
  landmarks.forEach((point, index) => {
    const offset = index * 3;
    values[offset] = Number(point.x || 0);
    values[offset + 1] = Number(point.y || 0);
    values[offset + 2] = Number(point.z || 0);
  });
  return values;
}

async function analyze(id, bitmap, purpose = 'participant') {
  try {
    const { analyzeFaceLandmarks, faceCountError } = await mathPromise;
    const localTasks = await tasks();
    const faceResult = localTasks.faceLandmarker.detect(bitmap);
    const countCode = faceCountError(faceResult.faceLandmarks?.length || 0);
    if (countCode) {
      postFailure(id, countCode, purpose);
      return;
    }
    const points = faceResult.faceLandmarks[0];
    const faceAnalysis = analyzeFaceLandmarks(points, { purpose });
    if (!faceAnalysis.ok) {
      postFailure(id, faceAnalysis.code, purpose);
      return;
    }

    const landmarks = serializeLandmarks(points);
    const triangles = triangleIndices.slice();
    const faceOval = faceOvalIndices.slice();
    self.postMessage({
      id,
      ok: true,
      purpose,
      geometry: faceAnalysis.geometry,
      landmarks: {
        count: points.length,
        data: landmarks.buffer,
      },
      mesh: {
        triangles: triangles.buffer,
        faceOval: faceOval.buffer,
      },
    }, [landmarks.buffer, triangles.buffer, faceOval.buffer]);
  } catch (error) {
    console.error('local_face_compositor_failed', error);
    taskPromise = undefined;
    postFailure(id, 'MODEL_UNAVAILABLE', purpose);
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

self.addEventListener('message', (event) => {
  const value = event.data || {};
  if (value.type === 'init') {
    tasks().catch(() => {
      taskPromise = undefined;
    });
    return;
  }
  if (value.type === 'analyze' && value.bitmap) {
    analyze(value.id, value.bitmap, value.purpose === 'target' ? 'target' : 'participant');
  }
});
