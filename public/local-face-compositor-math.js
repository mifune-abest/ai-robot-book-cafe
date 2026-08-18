const LEFT_EYE_POINTS = [33, 133];
const RIGHT_EYE_POINTS = [362, 263];
const NOSE_POINT = 1;
const FACE_SIGNATURE_POINTS = Object.freeze([
  10, 152, 234, 454, 172, 397,
  33, 133, 159, 145, 362, 263, 386, 374,
  168, 1, 98, 327,
  61, 291, 13, 14,
]);

export const LOCAL_FACE_ERROR_MESSAGES = Object.freeze({
  FACE_NOT_FOUND: 'かおを みつけられなかったよ',
  MULTIPLE_FACES: 'ひとりで うつってね',
  FACE_TOO_SMALL: 'かおを もうすこし おおきく うつしてね',
  FACE_TOO_LARGE: 'カメラから すこし はなれてね',
  FACE_OFF_CENTER: 'かおを わくの まんなかに あわせてね',
  FACE_TILTED: 'まえを むいて しゃしんを とってね',
  MODEL_UNAVAILABLE: 'かおを あわせる じゅんびが できていません',
  COMPOSITOR_TIMEOUT: 'かおを あわせるのに じかんが かかっています',
  COMPOSITOR_FAILED: 'かおを ばめんに あわせられなかったよ',
  TARGET_FACE_NOT_FOUND: 'へんしん用の しゃしんに かおが ありません',
  TARGET_MULTIPLE_FACES: 'へんしん用の しゃしんに かおが ふたつ あります',
  TARGET_FACE_TILTED: 'へんしん用の しゃしんを つくりなおしてね',
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function averagePoints(landmarks, indices) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean);
  if (points.length !== indices.length) return null;
  return {
    x: points.reduce((sum, point) => sum + Number(point.x || 0), 0) / points.length,
    y: points.reduce((sum, point) => sum + Number(point.y || 0), 0) / points.length,
  };
}

function eyePose(points) {
  const firstEye = averagePoints(points, LEFT_EYE_POINTS);
  const secondEye = averagePoints(points, RIGHT_EYE_POINTS);
  if (!firstEye || !secondEye) return null;
  const eyes = [firstEye, secondEye].sort((a, b) => a.x - b.x);
  const leftEye = eyes[0];
  const rightEye = eyes[1];
  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 0.00001) return null;
  return {
    center: {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2,
    },
    distance,
    angle: Math.atan2(dy, dx),
  };
}

/**
 * CAS画像から借りるのは顔の位置・大きさ・傾きだけにし、
 * 本人の目・鼻・口・輪郭の比率を相似変換のまま保つ。
 */
export function createIdentityPreservingTargetPoints(
  sourcePoints,
  targetPoints,
) {
  if (
    !Array.isArray(sourcePoints) || !Array.isArray(targetPoints) ||
    sourcePoints.length < 468 || sourcePoints.length !== targetPoints.length
  ) {
    return null;
  }
  const sourcePose = eyePose(sourcePoints);
  const targetPose = eyePose(targetPoints);
  if (!sourcePose || !targetPose) return null;
  const scale = targetPose.distance / sourcePose.distance;
  const rotation = targetPose.angle - sourcePose.angle;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const alignedSource = sourcePoints.map((point) => {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const x = point.x - sourcePose.center.x;
    const y = point.y - sourcePose.center.y;
    return {
      x: targetPose.center.x + (x * cosine - y * sine) * scale,
      y: targetPose.center.y + (x * sine + y * cosine) * scale,
      z: Number(point.z || 0) * scale,
    };
  });
  if (alignedSource.some((point) => !point)) return null;
  return {
    points: alignedSource,
    alignedSource,
    scale,
    rotation,
  };
}

export function normalizedFaceShape(points, indices = FACE_SIGNATURE_POINTS) {
  if (!Array.isArray(points)) return null;
  const pose = eyePose(points);
  if (!pose) return null;
  const cosine = Math.cos(-pose.angle);
  const sine = Math.sin(-pose.angle);
  const shape = indices.map((index) => {
    const point = points[index];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const x = point.x - pose.center.x;
    const y = point.y - pose.center.y;
    return {
      x: (x * cosine - y * sine) / pose.distance,
      y: (x * sine + y * cosine) / pose.distance,
    };
  });
  return shape.some((point) => !point) ? null : shape;
}

export function faceShapeRms(firstPoints, secondPoints, indices = FACE_SIGNATURE_POINTS) {
  const first = normalizedFaceShape(firstPoints, indices);
  const second = normalizedFaceShape(secondPoints, indices);
  if (!first || !second || first.length !== second.length) return Infinity;
  const squaredError = first.reduce((sum, point, index) => {
    const dx = point.x - second[index].x;
    const dy = point.y - second[index].y;
    return sum + dx * dx + dy * dy;
  }, 0);
  return Math.sqrt(squaredError / first.length);
}

export function faceCountError(faceCount) {
  if (faceCount < 1) return 'FACE_NOT_FOUND';
  if (faceCount > 1) return 'MULTIPLE_FACES';
  return '';
}

export function analyzeFaceLandmarks(landmarks, options = {}) {
  if (!Array.isArray(landmarks) || landmarks.length < 468) {
    return { ok: false, code: 'FACE_NOT_FOUND' };
  }
  const validPoints = landmarks.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (validPoints.length < 468) return { ok: false, code: 'FACE_NOT_FOUND' };

  const firstEye = averagePoints(landmarks, LEFT_EYE_POINTS);
  const secondEye = averagePoints(landmarks, RIGHT_EYE_POINTS);
  if (!firstEye || !secondEye) return { ok: false, code: 'FACE_NOT_FOUND' };
  const eyes = [firstEye, secondEye].sort((a, b) => a.x - b.x);
  const leftEye = eyes[0];
  const rightEye = eyes[1];
  const eyeDx = rightEye.x - leftEye.x;
  const eyeDy = rightEye.y - leftEye.y;
  const eyeDistance = Math.hypot(eyeDx, eyeDy);
  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };

  const bounds = validPoints.reduce((value, point) => ({
    minX: Math.min(value.minX, point.x),
    maxX: Math.max(value.maxX, point.x),
    minY: Math.min(value.minY, point.y),
    maxY: Math.max(value.maxY, point.y),
  }), { minX: 1, maxX: 0, minY: 1, maxY: 0 });
  const faceWidth = bounds.maxX - bounds.minX;
  const faceHeight = bounds.maxY - bounds.minY;
  const faceCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const angle = Math.atan2(eyeDy, eyeDx);
  const nose = landmarks[NOSE_POINT];
  const yawRatio = nose ? Math.abs(nose.x - eyeCenter.x) / Math.max(eyeDistance, 0.001) : 0;

  const target = options.purpose === 'target';
  const minimumFaceWidth = target ? 0.085 : 0.12;
  const minimumFaceHeight = target ? 0.11 : 0.15;
  const minimumEyeDistance = target ? 0.032 : 0.045;
  if (faceWidth < minimumFaceWidth || faceHeight < minimumFaceHeight || eyeDistance < minimumEyeDistance) {
    return { ok: false, code: 'FACE_TOO_SMALL' };
  }
  if (faceWidth > 0.72 || faceHeight > 0.82 || eyeDistance > 0.38) {
    return { ok: false, code: 'FACE_TOO_LARGE' };
  }
  if (
    faceCenter.x < 0.15 || faceCenter.x > 0.85 ||
    faceCenter.y < 0.14 || faceCenter.y > 0.72 ||
    bounds.minX < 0.025 || bounds.maxX > 0.975 || bounds.minY < 0.015
  ) {
    return { ok: false, code: 'FACE_OFF_CENTER' };
  }
  if (Math.abs(angle) > ((target ? 24 : 20) * Math.PI) / 180 || yawRatio > (target ? 0.52 : 0.45)) {
    return { ok: false, code: 'FACE_TILTED' };
  }

  return {
    ok: true,
    geometry: {
      leftEye,
      rightEye,
      eyeCenter,
      eyeDistance,
      angle,
      faceCenter,
      faceWidth,
      faceHeight,
      faceTop: bounds.minY,
      faceBottom: bounds.maxY,
    },
  };
}

export function triangleAffineTransform(source, target) {
  if (!Array.isArray(source) || !Array.isArray(target) || source.length !== 3 || target.length !== 3) {
    return null;
  }
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  if ([s0, s1, s2, t0, t1, t2].some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))) {
    return null;
  }
  const sourceX1 = s1.x - s0.x;
  const sourceY1 = s1.y - s0.y;
  const sourceX2 = s2.x - s0.x;
  const sourceY2 = s2.y - s0.y;
  const targetX1 = t1.x - t0.x;
  const targetY1 = t1.y - t0.y;
  const targetX2 = t2.x - t0.x;
  const targetY2 = t2.y - t0.y;
  const determinant = sourceX1 * sourceY2 - sourceX2 * sourceY1;
  if (Math.abs(determinant) < 0.00001) return null;

  const a = (targetX1 * sourceY2 - targetX2 * sourceY1) / determinant;
  const c = (-targetX1 * sourceX2 + targetX2 * sourceX1) / determinant;
  const b = (targetY1 * sourceY2 - targetY2 * sourceY1) / determinant;
  const d = (-targetY1 * sourceX2 + targetY2 * sourceX1) / determinant;
  const e = t0.x - a * s0.x - c * s0.y;
  const f = t0.y - b * s0.x - d * s0.y;
  if (![a, b, c, d, e, f].every(Number.isFinite)) return null;
  return { a, b, c, d, e, f };
}

export function calculateColorTransfer(sourceStats, targetStats) {
  const sourceMean = sourceStats?.mean;
  const sourceDeviation = sourceStats?.deviation;
  const targetMean = targetStats?.mean;
  const targetDeviation = targetStats?.deviation;
  if (
    !Array.isArray(sourceMean) || !Array.isArray(sourceDeviation) ||
    !Array.isArray(targetMean) || !Array.isArray(targetDeviation) ||
    [sourceMean, sourceDeviation, targetMean, targetDeviation].some((values) => values.length !== 3)
  ) {
    return null;
  }
  const luminanceWeights = [0.2126, 0.7152, 0.0722];
  const sourceLuminanceDeviation = Math.sqrt(sourceDeviation.reduce(
    (sum, value, index) => sum + Number(value) ** 2 * luminanceWeights[index],
    0,
  ));
  const targetLuminanceDeviation = Math.sqrt(targetDeviation.reduce(
    (sum, value, index) => sum + Number(value) ** 2 * luminanceWeights[index],
    0,
  ));
  const luminanceScale = clamp(
    targetLuminanceDeviation / Math.max(8, sourceLuminanceDeviation),
    0.9,
    1.1,
  );
  const scale = [luminanceScale, luminanceScale, luminanceScale];
  const offset = sourceMean.map((value, index) => clamp(
    Number(targetMean[index]) - Number(value) * luminanceScale,
    -48,
    48,
  ));
  if (![...scale, ...offset].every(Number.isFinite)) return null;
  return { scale, offset, strength: 0.92 };
}

export function applyColorTransferChannel(value, channel, transfer) {
  if (!transfer || !Number.isInteger(channel) || channel < 0 || channel > 2) return value;
  const mapped = Number(value) * transfer.scale[channel] + transfer.offset[channel];
  return Math.round(clamp(
    Number(value) * (1 - transfer.strength) + mapped * transfer.strength,
    0,
    255,
  ));
}
