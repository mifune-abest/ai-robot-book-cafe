import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyColorTransferChannel,
  analyzeFaceLandmarks,
  calculateColorTransfer,
  createIdentityPreservingTargetPoints,
  faceShapeRms,
  faceCountError,
  normalizedFaceShape,
  triangleAffineTransform,
} from '../public/local-face-compositor-math.js';
import {
  localCompositorAssetsStatus,
} from '../src/services/local-compositor-assets.js';

function sampleLandmarks() {
  const points = Array.from({ length: 478 }, (_, index) => {
    const angle = (index / 478) * Math.PI * 2;
    return { x: 0.5 + Math.cos(angle) * 0.14, y: 0.4 + Math.sin(angle) * 0.2, z: 0 };
  });
  points[33] = { x: 0.42, y: 0.39, z: 0 };
  points[133] = { x: 0.46, y: 0.39, z: 0 };
  points[362] = { x: 0.54, y: 0.39, z: 0 };
  points[263] = { x: 0.58, y: 0.39, z: 0 };
  points[1] = { x: 0.5, y: 0.44, z: 0 };
  return points;
}

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454,
  323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132,
  93, 234, 127, 162, 21, 54, 103, 67, 109,
];

function transformLandmarks(points, { scale = 1, angle = 0, x = 0, y = 0 } = {}) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return points.map((point) => ({
    x: x + (point.x * cosine - point.y * sine) * scale,
    y: y + (point.x * sine + point.y * cosine) * scale,
    z: Number(point.z || 0) * scale,
  }));
}

function differentTargetLandmarks() {
  const target = sampleLandmarks();
  FACE_OVAL.forEach((index) => {
    target[index] = {
      ...target[index],
      x: 0.5 + (target[index].x - 0.5) * 1.45,
      y: 0.4 + (target[index].y - 0.4) * 0.72,
    };
  });
  target[1] = { x: 0.5, y: 0.49, z: 0 };
  target[98] = { x: 0.455, y: 0.48, z: 0 };
  target[327] = { x: 0.545, y: 0.48, z: 0 };
  target[61] = { x: 0.43, y: 0.52, z: 0 };
  target[291] = { x: 0.57, y: 0.52, z: 0 };
  target[13] = { x: 0.5, y: 0.505, z: 0 };
  target[14] = { x: 0.5, y: 0.55, z: 0 };
  return transformLandmarks(target, { scale: 1.3, angle: 0.12, x: -0.18, y: -0.08 });
}

function eyePose(points) {
  function mean(indices) {
    return {
      x: indices.reduce((sum, index) => sum + points[index].x, 0) / indices.length,
      y: indices.reduce((sum, index) => sum + points[index].y, 0) / indices.length,
    };
  }
  const eyes = [mean([33, 133]), mean([362, 263])].sort((a, b) => a.x - b.x);
  const dx = eyes[1].x - eyes[0].x;
  const dy = eyes[1].y - eyes[0].y;
  return {
    center: { x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2 },
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
  };
}

test('顔が1人だけの場合だけローカル合成へ進める', () => {
  assert.equal(faceCountError(0), 'FACE_NOT_FOUND');
  assert.equal(faceCountError(1), '');
  assert.equal(faceCountError(2), 'MULTIPLE_FACES');
});

test('目の位置から顔の大きさと傾きを求める', () => {
  const result = analyzeFaceLandmarks(sampleLandmarks());
  assert.equal(result.ok, true);
  assert.ok(result.geometry.eyeDistance > 0.1);
  assert.ok(Math.abs(result.geometry.angle) < 0.001);

  const tilted = sampleLandmarks();
  tilted[362].y = 0.48;
  tilted[263].y = 0.48;
  assert.equal(analyzeFaceLandmarks(tilted).code, 'FACE_TILTED');
});

test('固定したMediaPipeとモデルのファイルを起動前に検証できる', () => {
  const status = localCompositorAssetsStatus('smart');
  assert.equal(status.ready, true, JSON.stringify(status));
  assert.equal(status.localOnly, true);
  assert.equal(status.sendsParticipantPhoto, false);
});

test('顔メッシュの三角形をCAS人物の対応位置へ写せる', () => {
  const transform = triangleAffineTransform(
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 3 }],
    [{ x: 5, y: 7 }, { x: 9, y: 7 }, { x: 5, y: 13 }],
  );
  assert.ok(transform);
  const mapped = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 3 }].map((point) => ({
    x: transform.a * point.x + transform.c * point.y + transform.e,
    y: transform.b * point.x + transform.d * point.y + transform.f,
  }));
  assert.deepEqual(mapped, [{ x: 5, y: 7 }, { x: 9, y: 7 }, { x: 5, y: 13 }]);
  assert.equal(
    triangleAffineTransform(
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }],
      [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 4, y: 2 }],
    ),
    null,
  );
});

test('顔の色合わせは極端な補正をせず0〜255に収める', () => {
  const transfer = calculateColorTransfer(
    { mean: [70, 80, 90], deviation: [5, 12, 20] },
    { mean: [210, 190, 170], deviation: [50, 30, 15] },
  );
  assert.ok(transfer);
  assert.ok(transfer.scale.every((value) => value >= 0.9 && value <= 1.1));
  assert.equal(new Set(transfer.scale).size, 1);
  assert.ok(transfer.offset.every((value) => value >= -48 && value <= 48));
  assert.equal(transfer.strength, 0.92);
  for (let channel = 0; channel < 3; channel += 1) {
    assert.ok(applyColorTransferChannel(0, channel, transfer) >= 0);
    assert.ok(applyColorTransferChannel(255, channel, transfer) <= 255);
  }
});

test('CASから位置だけ借り、本人の顔形状を主成分として残す', () => {
  const source = sampleLandmarks();
  const target = differentTargetLandmarks();
  const plan = createIdentityPreservingTargetPoints(source, target);
  assert.ok(plan);

  const sourceTargetError = faceShapeRms(source, target);
  const outputSourceError = faceShapeRms(plan.points, source);
  const outputTargetError = faceShapeRms(plan.points, target);
  assert.ok(sourceTargetError > 0.2, `テスト用の顔形状差が不足: ${sourceTargetError}`);
  assert.ok(outputSourceError < 0.00001, `本人の顔比率が変わりました: ${outputSourceError}`);
  assert.ok(outputSourceError < outputTargetError * 0.2, {
    outputSourceError,
    outputTargetError,
  });
  assert.ok(
    outputSourceError / (outputSourceError + outputTargetError) < 0.15,
    `CAS顔形状の混入が大きすぎます: ${outputSourceError}`,
  );

  const sourcePose = eyePose(source);
  const targetPose = eyePose(target);
  const outputPose = eyePose(plan.points);
  assert.ok(Math.abs(outputPose.center.x - targetPose.center.x) < 0.00001);
  assert.ok(Math.abs(outputPose.center.y - targetPose.center.y) < 0.00001);
  assert.ok(Math.abs(outputPose.distance - targetPose.distance) < 0.00001);
  assert.ok(Math.abs(outputPose.angle - targetPose.angle) < 0.00001);
  assert.ok(sourcePose.distance > 0);
});

test('本人の目位置が不正な場合にCAS顔へ置き換えて続行しない', () => {
  const source = sampleLandmarks();
  [33, 133, 362, 263].forEach((index) => {
    source[index] = { x: 0.5, y: 0.4, z: 0 };
  });
  assert.equal(createIdentityPreservingTargetPoints(source, differentTargetLandmarks()), null);
});

test('CAS人物が変わっても本人の目・鼻・口の比率を維持する', () => {
  const source = sampleLandmarks();
  const firstTarget = differentTargetLandmarks();
  const secondTarget = differentTargetLandmarks().map((point) => ({
    ...point,
    x: 0.72 + (point.x - 0.5) * 0.84,
    y: 0.18 + (point.y - 0.4) * 1.12,
  }));
  const firstPlan = createIdentityPreservingTargetPoints(source, firstTarget);
  const secondPlan = createIdentityPreservingTargetPoints(source, secondTarget);
  assert.ok(firstPlan && secondPlan);
  const innerFeatures = [33, 133, 159, 145, 362, 263, 386, 374, 168, 1, 98, 327, 61, 291, 13, 14];
  assert.ok(faceShapeRms(firstPlan.points, source, innerFeatures) < 0.00001);
  assert.ok(faceShapeRms(secondPlan.points, source, innerFeatures) < 0.00001);
  assert.ok(faceShapeRms(firstPlan.points, secondPlan.points, innerFeatures) < 0.00001);
  assert.ok(normalizedFaceShape(firstPlan.points, innerFeatures));
});

test('同じCAS人物でも本人が違えば出力顔形状も変わる', () => {
  const firstSource = sampleLandmarks();
  const secondSource = sampleLandmarks();
  [234, 454, 172, 397, 10, 152].forEach((index) => {
    secondSource[index] = {
      ...secondSource[index],
      x: 0.5 + (secondSource[index].x - 0.5) * 0.62,
      y: 0.4 + (secondSource[index].y - 0.4) * 1.32,
    };
  });
  secondSource[61] = { x: 0.46, y: 0.51, z: 0 };
  secondSource[291] = { x: 0.54, y: 0.51, z: 0 };
  const target = differentTargetLandmarks();
  const firstPlan = createIdentityPreservingTargetPoints(firstSource, target);
  const secondPlan = createIdentityPreservingTargetPoints(secondSource, target);
  assert.ok(firstPlan && secondPlan);
  assert.ok(faceShapeRms(firstSource, secondSource) > 0.08);
  assert.ok(faceShapeRms(firstPlan.points, secondPlan.points) > 0.06);
});

test('CAS側の顔は少し小さくても検出対象にできる', () => {
  const points = sampleLandmarks().map((point) => ({
    x: 0.5 + (point.x - 0.5) * 0.4,
    y: 0.34 + (point.y - 0.4) * 0.4,
    z: point.z,
  }));
  assert.equal(analyzeFaceLandmarks(points).code, 'FACE_TOO_SMALL');
  assert.equal(analyzeFaceLandmarks(points, { purpose: 'target' }).ok, true);
});
