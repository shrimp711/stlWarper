import * as THREE from 'three';

function buildFixedMask(positions, zTol) {
  const count = positions.length / 3;
  let zMin = Infinity;
  for (let i = 0; i < count; i += 1) {
    zMin = Math.min(zMin, positions[i * 3 + 2]);
  }

  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const z = positions[i * 3 + 2];
    mask[i] = z <= (zMin + zTol) ? 1 : 0;
  }
  return { zMin, mask };
}

function predictWarp(positions, strain, bounds, zTol) {
  const count = positions.length / 3;
  const displacement = new Float32Array(positions.length);
  const { zMin, mask } = buildFixedMask(positions, zTol);

  const exx = strain[0];
  const eyy = strain[1];
  const ezz = strain[2];

  const cx = (bounds.max.x + bounds.min.x) * 0.5;
  const cy = (bounds.max.y + bounds.min.y) * 0.5;
  const zSpan = Math.max(bounds.max.z - bounds.min.z, 1e-6);
  const xSpan = Math.max(bounds.max.x - bounds.min.x, 1e-6);
  const ySpan = Math.max(bounds.max.y - bounds.min.y, 1e-6);
  const xySpan = Math.max(Math.max(xSpan, ySpan), 1e-6);

  const maxRadius = Math.max(Math.hypot(xSpan * 0.5, ySpan * 0.5), 1e-6);

  for (let i = 0; i < count; i += 1) {
    if (mask[i]) {
      continue;
    }

    const x = positions[i * 3 + 0];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const vx = x - cx;
    const vy = y - cy;
    const radius = Math.max(Math.hypot(vx, vy), 1e-9);
    const ux = vx / radius;
    const uy = vy / radius;

    const h = THREE.MathUtils.clamp((z - zMin) / zSpan, 0, 1);
    const c = ux;
    const s = uy;
    const eRR = exx * c * c + eyy * s * s;
    const edgeFactor = THREE.MathUtils.clamp(radius / maxRadius, 0, 1);

    const shrinkScale = Math.abs(eRR) * (xySpan * 0.35) * Math.pow(h, 1.2);
    const bendingDriver = Math.abs(ezz - 0.35 * (exx + eyy));
    const warpZ = bendingDriver * (zSpan * 0.6 + xySpan * 0.08) * Math.pow(h, 1.5) * edgeFactor;

    displacement[i * 3 + 0] = -ux * shrinkScale;
    displacement[i * 3 + 1] = -uy * shrinkScale;
    displacement[i * 3 + 2] = warpZ;
  }

  return { displacement, zMin };
}

function clonePositions(attr) {
  return new Float32Array(attr.array);
}

export function runCompensation(originalGeometry, strain, options = {}) {
  const relaxFactor = options.relaxFactor ?? 0.8;
  const maxIterations = options.maxIterations ?? 6;
  const convergenceTol = options.convergenceTol ?? 0.02;

  const baseGeometry = originalGeometry.clone();
  baseGeometry.computeBoundingBox();

  const bounds = {
    min: baseGeometry.boundingBox.min.clone(),
    max: baseGeometry.boundingBox.max.clone(),
  };

  const posAttr = baseGeometry.getAttribute('position');
  const nominal = clonePositions(posAttr);
  const compensated = clonePositions(posAttr);

  const zSpan = Math.max(bounds.max.z - bounds.min.z, 0.001);
  const zTol = Math.max(zSpan * 0.02, 0.08);

  let maxError = 0;
  let iterations = 0;

  for (let iter = 1; iter <= maxIterations; iter += 1) {
    const { displacement, zMin } = predictWarp(compensated, strain, bounds, zTol);

    let iterMaxError = 0;
    for (let i = 0; i < compensated.length; i += 3) {
      const errX = (compensated[i + 0] + displacement[i + 0]) - nominal[i + 0];
      const errY = (compensated[i + 1] + displacement[i + 1]) - nominal[i + 1];
      const errZ = (compensated[i + 2] + displacement[i + 2]) - nominal[i + 2];

      const err = Math.sqrt(errX * errX + errY * errY + errZ * errZ);
      iterMaxError = Math.max(iterMaxError, err);

      compensated[i + 0] -= relaxFactor * errX;
      compensated[i + 1] -= relaxFactor * errY;
      compensated[i + 2] -= relaxFactor * errZ;

      if (compensated[i + 2] < zMin) {
        compensated[i + 2] = zMin;
      }
    }

    maxError = iterMaxError;
    iterations = iter;
    if (iterMaxError < convergenceTol) {
      break;
    }
  }

  const compensatedGeometry = originalGeometry.clone();
  compensatedGeometry.setAttribute('position', new THREE.Float32BufferAttribute(compensated, 3));
  compensatedGeometry.computeVertexNormals();
  compensatedGeometry.computeBoundingBox();
  compensatedGeometry.computeBoundingSphere();

  return {
    geometry: compensatedGeometry,
    iterations,
    maxError,
  };
}

export function buildDatabaseIndex(db) {
  const materialMap = new Map();

  Object.entries(db).forEach(([key, value]) => {
    if (!value || value.status !== 'success') {
      return;
    }
    const material = value.material;
    if (!materialMap.has(material)) {
      materialMap.set(material, []);
    }
    materialMap.get(material).push({ key, ...value });
  });

  materialMap.forEach((entries) => {
    entries.sort((a, b) => {
      if (a.t_melt !== b.t_melt) return a.t_melt - b.t_melt;
      if (a.t_bed !== b.t_bed) return a.t_bed - b.t_bed;
      return a.t_chamber - b.t_chamber;
    });
  });

  return materialMap;
}
