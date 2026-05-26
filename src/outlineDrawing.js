import * as THREE from 'three';
import { computeCenterAndScale } from './geoUtils.js';

const EXTRUDE_DEPTH = 0.35;

/**
 * Create a glowing outline of a province/country that draws itself progressively.
 * Uses flat ribbon meshes instead of THREE.Line to guarantee consistent thickness,
 * but with extremely thin and soft opacity settings to avoid harshness/dazzling.
 */
export function createOutlineDrawing(geoData, scene) {
  const { center, scale } = computeCenterAndScale(geoData);
  const group = new THREE.Group();

  // Thin ribbon widths for a soft, delicate appearance
  const widthCore = 0.007 / scale;
  const widthGlow = 0.022 / scale;

  // Helper to generate a flat ribbon geometry from 3D points
  function createRibbonGeometry(points3d, width) {
    const vertices = [];
    const indices = [];

    for (let i = 0; i < points3d.length; i++) {
      const curr = points3d[i];
      const next = points3d[i + 1] || points3d[i];
      const prev = points3d[i - 1] || points3d[i];

      const dir = new THREE.Vector3().subVectors(next, prev).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width * 0.5);

      vertices.push(curr.x - perp.x, curr.y, curr.z - perp.z);
      vertices.push(curr.x + perp.x, curr.y, curr.z + perp.z);

      if (i < points3d.length - 1) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  // Collect outer boundary segments
  const segmentMap = new Map();

  geoData.features.forEach(feature => {
    if (!feature || !feature.geometry) return;
    const { coordinates, type } = feature.geometry;
    if (!coordinates) return;
    const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
    polygons.forEach(polygon => {
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

  const drawLines = [];
  let cumulativeVertices = 0;

  chains.forEach(chain => {
    if (chain.length < 5) return;

    const points3d = chain.map(([x, y]) =>
      new THREE.Vector3(
        (x - center[0]) * scale,
        0.015, // slightly above floor
        -(y - center[1]) * scale
      )
    );

    const totalVertices = points3d.length;

    // ─── Outer glow ribbon mesh (wider, extremely soft) ───
    const glowGeometry = createRibbonGeometry(points3d, widthGlow);
    // ─── Core bright native line (sharp, single-pixel) ───
    const coreGeometry = new THREE.BufferGeometry().setFromPoints(points3d);
    const coreMaterial = new THREE.LineBasicMaterial({
      color: 0x44ddff,
      transparent: true,
      opacity: 0.80, // Sharp and visible
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coreLine = new THREE.Line(coreGeometry, coreMaterial);
    coreLine.renderOrder = 5;
    coreGeometry.setDrawRange(0, 0);
    group.add(coreLine);

    drawLines.push({
      coreLine,
      coreGeometry,
      coreMaterial,
      totalVertices,
      startVertex: cumulativeVertices,
    });

    cumulativeVertices += totalVertices;
  });

  scene.add(group);

  const totalAllVertices = cumulativeVertices;

  /**
   * Update drawing progress (0 = nothing drawn, 1 = fully drawn)
   */
  function update(progress) {
    const globalVertex = Math.floor(totalAllVertices * progress);

    drawLines.forEach(item => {
      const chainEnd = item.startVertex + item.totalVertices;

      let count = 0;
      if (globalVertex <= item.startVertex) {
        count = 0;
      } else if (globalVertex >= chainEnd) {
        count = item.totalVertices;
      } else {
        count = globalVertex - item.startVertex;
      }

      // Native line uses 1 index per vertex.
      item.coreGeometry.setDrawRange(0, count);
    });
  }

  /**
   * Set overall opacity (for fading out)
   */
  function setOpacity(opacity) {
    drawLines.forEach(item => {
      item.coreMaterial.opacity = opacity * 0.80;
    });
  }

  /**
   * Set visibility
   */
  function setVisible(visible) {
    group.visible = visible;
  }

  // Start fully invisible
  update(0);

  return { group, update, setOpacity, setVisible };
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
