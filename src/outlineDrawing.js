import * as THREE from 'three';
import { computeCenterAndScale } from './geoUtils.js';

const EXTRUDE_DEPTH = 0.35;

/**
 * Create a glowing outline of Guangdong province that draws itself progressively.
 * Uses a double-line technique: a bright core line + a wider soft glow line behind it.
 * Chains are drawn SEQUENTIALLY.
 */
export function createOutlineDrawing(geoData, scene) {
  const { center, scale } = computeCenterAndScale(geoData);
  const group = new THREE.Group();

  // Collect outer boundary segments (province outline only)
  const segmentMap = new Map();

  geoData.features.forEach(feature => {
    const { coordinates } = feature.geometry;
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

  const drawLines = [];
  let cumulativeVertices = 0;

  chains.forEach(chain => {
    if (chain.length < 5) return;

    const points3d = chain.map(([x, y]) =>
      new THREE.Vector3(
        (x - center[0]) * scale,
        0.01,
        -(y - center[1]) * scale
      )
    );

    const totalVertices = points3d.length;

    // ─── Outer glow line (wider, softer) ───
    const glowGeometry = new THREE.BufferGeometry().setFromPoints(points3d);
    const glowMaterial = new THREE.LineBasicMaterial({
      color: 0x0088ff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      linewidth: 1,
    });
    const glowLine = new THREE.Line(glowGeometry, glowMaterial);
    glowGeometry.setDrawRange(0, 0);
    group.add(glowLine);

    // ─── Core bright line ───
    const coreGeometry = new THREE.BufferGeometry().setFromPoints(points3d);
    const coreMaterial = new THREE.LineBasicMaterial({
      color: 0x44ddff,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const coreLine = new THREE.Line(coreGeometry, coreMaterial);
    coreGeometry.setDrawRange(0, 0);
    group.add(coreLine);

    drawLines.push({
      glowLine,
      glowGeometry,
      glowMaterial,
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
   * Update the drawing progress (0 = nothing drawn, 1 = fully drawn)
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

      item.glowGeometry.setDrawRange(0, count);
      item.coreGeometry.setDrawRange(0, count);
    });
  }

  /**
   * Set overall opacity (for fading out)
   */
  function setOpacity(opacity) {
    drawLines.forEach(item => {
      item.glowMaterial.opacity = opacity * 0.4;
      item.coreMaterial.opacity = opacity;
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
