import * as THREE from 'three';

/**
 * Create outline-only renderings of all Chinese provinces (except Guangdong).
 * These appear as subtle, low-opacity border traces using the SAME
 * center/scale as Guangdong so they align perfectly.
 *
 * Uses flat ribbon meshes instead of Line primitives to ensure
 * consistent visible thickness regardless of distance from camera.
 */
export function createNeighborOutlines(chinaGeoData, gdGeoData, gdCenter, gdScale, scene, provinceName = 'Guangdong') {
  const group = new THREE.Group();

  // Helper to draw a core ribbon + glow ribbon on the ground along a 3D path
  function drawGroundOutline(points3d) {
    const ribbonWidth = 0.025; // world-space width
    const ribbonVerts = [];
    const ribbonIndices = [];

    for (let i = 0; i < points3d.length; i++) {
      const curr = points3d[i];
      const next = points3d[(i + 1) % points3d.length];
      const prev = points3d[(i - 1 + points3d.length) % points3d.length];

      // Direction tangent
      const dir = new THREE.Vector3().subVectors(next, prev).normalize();
      // Perpendicular in XZ plane (up is Y)
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(ribbonWidth * 0.5);

      const vIdx = i * 2;
      // Left side
      ribbonVerts.push(curr.x - perp.x, curr.y, curr.z - perp.z);
      // Right side
      ribbonVerts.push(curr.x + perp.x, curr.y, curr.z + perp.z);

      if (i < points3d.length - 1) {
        const a = vIdx, b = vIdx + 1, c = vIdx + 2, d = vIdx + 3;
        ribbonIndices.push(a, c, b);
        ribbonIndices.push(b, c, d);
      }
    }

    const ribbonGeom = new THREE.BufferGeometry();
    ribbonGeom.setAttribute('position', new THREE.Float32BufferAttribute(ribbonVerts, 3));
    ribbonGeom.setIndex(ribbonIndices);
    ribbonGeom.computeVertexNormals();

    // Core ribbon material (medium blue)
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x3399cc,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const coreMesh = new THREE.Mesh(ribbonGeom, coreMat);
    coreMesh.userData.lineType = 'core';
    coreMesh.renderOrder = 5;
    group.add(coreMesh);

    // Wider glow ribbon (softer, broader halo)
    const glowWidth = 0.06;
    const glowVerts = [];
    const glowIndices = [];

    for (let i = 0; i < points3d.length; i++) {
      const curr = points3d[i];
      const next = points3d[(i + 1) % points3d.length];
      const prev = points3d[(i - 1 + points3d.length) % points3d.length];

      const dir = new THREE.Vector3().subVectors(next, prev).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(glowWidth * 0.5);

      const vIdx = i * 2;
      glowVerts.push(curr.x - perp.x, curr.y - 0.001, curr.z - perp.z);
      glowVerts.push(curr.x + perp.x, curr.y - 0.001, curr.z + perp.z);

      if (i < points3d.length - 1) {
        const a = vIdx, b = vIdx + 1, c = vIdx + 2, d = vIdx + 3;
        glowIndices.push(a, c, b);
        glowIndices.push(b, c, d);
      }
    }

    const glowGeom = new THREE.BufferGeometry();
    glowGeom.setAttribute('position', new THREE.Float32BufferAttribute(glowVerts, 3));
    glowGeom.setIndex(glowIndices);
    glowGeom.computeVertexNormals();

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x1177aa,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const glowMesh = new THREE.Mesh(glowGeom, glowMat);
    glowMesh.userData.lineType = 'glow';
    glowMesh.renderOrder = 4;
    group.add(glowMesh);
  }

  // ─── Part 1: Draw Neighboring Provinces or Countries ───
  const isChinaCase = provinceName.toLowerCase() === 'china';
  const neighborFeatures = chinaGeoData.features.filter(f => {
    if (!f || !f.properties) return false;
    const name = (f.properties.name || '').trim();
    if (isChinaCase) {
      if (name.toLowerCase() === 'china') return false;
      const continent = (f.properties.continent || '').trim();
      return continent.toLowerCase() === 'asia' || name.toLowerCase() === 'russia';
    } else {
      return name.toLowerCase() !== provinceName.toLowerCase();
    }
  });

  neighborFeatures.forEach(feature => {
    if (!feature || !feature.geometry) return;
    const { coordinates, type } = feature.geometry;
    if (!coordinates) return;
    const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];

    polygons.forEach(polygon => {
      let ring = polygon[0]; // outer ring only
      if (!ring || ring.length < 4) return;

      // Simplify using Ramer-Douglas-Peucker
      ring = rdp(ring, 0.06);
      if (ring.length < 4) return;

      const tempPoints = ring.slice();
      const first = tempPoints[0];
      const last = tempPoints[tempPoints.length - 1];
      if (Math.abs(first[0] - last[0]) < 1e-5 && Math.abs(first[1] - last[1]) < 1e-5) {
        tempPoints.pop();
      }

      if (tempPoints.length < 3) return;

      const curvePoints = tempPoints.map(([x, y]) =>
        new THREE.Vector3(
          (x - gdCenter[0]) * gdScale,
          0.015,  // slightly above ground
          -(y - gdCenter[1]) * gdScale
        )
      );

      const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal', 0.5);
      const points3d = curve.getPoints(tempPoints.length * 3);
      drawGroundOutline(points3d);
    });
  });

  // ─── Part 2: Draw Guangdong Boundary (Coastline + Land Border) ───
  if (gdGeoData) {
    const segmentMap = new Map();
    gdGeoData.features.forEach(feature => {
      if (!feature || !feature.geometry) return;
      const { coordinates } = feature.geometry;
      if (!coordinates) return;
      coordinates.forEach(polygon => {
        const ring = polygon[0];
        if (ring.length < 4) return;
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i];
          const b = ring[i + 1];
          const keyForward = `${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`;
          const keyBackward = `${b[0].toFixed(6)},${b[1].toFixed(6)}|${a[0].toFixed(6)},${a[1].toFixed(6)}`;

          if (segmentMap.has(keyBackward)) {
            segmentMap.set(keyBackward, segmentMap.get(keyBackward) + 1);
          } else if (segmentMap.has(keyForward)) {
            segmentMap.set(keyForward, segmentMap.get(keyForward) + 1);
          } else {
            segmentMap.set(keyForward, 1);
          }
        }
      });
    });

    const outerSegments = [];
    segmentMap.forEach((count, key) => {
      if (count === 1) {
        const [aStr, bStr] = key.split('|');
        const [ax, ay] = aStr.split(',').map(Number);
        const [bx, by] = bStr.split(',').map(Number);
        outerSegments.push([[ax, ay], [bx, by]]);
      }
    });

    const chains = chainSegments(outerSegments);
    chains.forEach(chain => {
      if (chain.length < 6) return;

      // Simplify using Ramer-Douglas-Peucker (smaller epsilon to keep detail)
      let ring = rdp(chain, 0.02);
      if (ring.length < 4) return;

      const tempPoints = ring.slice();
      const first = tempPoints[0];
      const last = tempPoints[tempPoints.length - 1];
      if (Math.abs(first[0] - last[0]) < 1e-5 && Math.abs(first[1] - last[1]) < 1e-5) {
        tempPoints.pop();
      }

      if (tempPoints.length < 3) return;

      const curvePoints = tempPoints.map(([x, y]) =>
        new THREE.Vector3(
          (x - gdCenter[0]) * gdScale,
          0.015,  // slightly above ground
          -(y - gdCenter[1]) * gdScale
        )
      );

      const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'centripetal', 0.5);
      const points3d = curve.getPoints(tempPoints.length * 3);
      drawGroundOutline(points3d);
    });
  }

  group.visible = false;
  scene.add(group);

  /**
   * Set opacity of all province outlines (0–1).
   * Target max ~8% core / ~3% glow for very faint, 40%-weakened background borders.
   */
  function setOpacity(t) {
    const clamped = Math.max(0, Math.min(t, 1));
    group.children.forEach(mesh => {
      if (mesh.userData.lineType === 'core') {
        mesh.material.opacity = clamped * 0.08;
      } else {
        mesh.material.opacity = clamped * 0.03;
      }
    });
  }

  function setVisible(visible) {
    group.visible = visible;
  }

  return { group, setOpacity, setVisible };
}

// ─── Ramer-Douglas-Peucker (RDP) Simplification Algorithm ───

function perpendicularDistance(p, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  if (dx === 0 && dy === 0) {
    return Math.sqrt((p[0] - lineStart[0])**2 + (p[1] - lineStart[1])**2);
  }
  const num = Math.abs(dy * p[0] - dx * p[1] + lineEnd[0] * lineStart[1] - lineEnd[1] * lineStart[0]);
  const den = Math.sqrt(dx * dx + dy * dy);
  return num / den;
}

function rdp(points, epsilon) {
  if (points.length <= 2) return points;
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const results1 = rdp(points.slice(0, index + 1), epsilon);
    const results2 = rdp(points.slice(index), epsilon);
    return results1.slice(0, results1.length - 1).concat(results2);
  } else {
    return [points[0], points[end]];
  }
}

/**
 * Chain disconnected segments into continuous ordered paths
 */
function chainSegments(segments) {
  if (segments.length === 0) return [];

  const adj = new Map();
  const keyOf = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;

  segments.forEach((seg, idx) => {
    const kA = keyOf(seg[0]);
    const kB = keyOf(seg[1]);
    if (!adj.has(kA)) adj.set(kA, []);
    if (!adj.has(kB)) adj.set(kB, []);
    adj.get(kA).push(idx);
    adj.get(kB).push(idx);
  });

  const used = new Set();
  const chains = [];

  for (let startIdx = 0; startIdx < segments.length; startIdx++) {
    if (used.has(startIdx)) continue;

    const chain = [];
    let current = segments[startIdx][0];
    chain.push(current);

    let segIdx = startIdx;
    while (segIdx !== -1 && !used.has(segIdx)) {
      used.add(segIdx);
      const seg = segments[segIdx];
      const kA = keyOf(seg[0]);
      const kCur = keyOf(current);

      const next = kA === kCur ? seg[1] : seg[0];
      chain.push(next);
      current = next;

      const kNext = keyOf(current);
      const neighbors = adj.get(kNext) || [];
      segIdx = -1;
      for (const nIdx of neighbors) {
        if (!used.has(nIdx)) {
          segIdx = nIdx;
          break;
        }
      }
    }

    if (chain.length > 3) {
      chains.push(chain);
    }
  }

  chains.sort((a, b) => b.length - a.length);
  return chains;
}
