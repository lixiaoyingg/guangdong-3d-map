import * as THREE from 'three';
import { computeCenterAndScale } from './geoUtils.js';

const EXTRUDE_DEPTH = 0.35;

/**
 * Create flowing light effect using continuous TubeGeometry + gradient shader.
 * The light appears as a smooth, unbroken comet trail along the provincial border.
 */
export function createFlowingLight(geoData, scene) {
  const { center, scale } = computeCenterAndScale(geoData);
  const group = new THREE.Group();
  const flowPaths = [];

  // ─── Step 1: Collect outer boundary segments ───
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

  // ─── Step 2: Keep only outer boundary segments ───
  const outerSegments = [];
  segmentMap.forEach((count, key) => {
    if (count === 1) {
      const [aStr, bStr] = key.split('|');
      const [ax, ay] = aStr.split(',').map(Number);
      const [bx, by] = bStr.split(',').map(Number);
      outerSegments.push([[ax, ay], [bx, by]]);
    }
  });

  // ─── Step 3: Chain segments into continuous paths ───
  const chains = chainSegments(outerSegments);

  // ─── Step 4: Create tube-based flowing light for each chain ───
  chains.forEach((chain) => {
    if (chain.length < 10) return;

    const points = chain.map(([x, y]) =>
      new THREE.Vector3(
        (x - center[0]) * scale,
        EXTRUDE_DEPTH + 0.03,
        -(y - center[1]) * scale
      )
    );

    // Sample for performance
    const sampledPoints = [];
    const step = Math.max(1, Math.floor(points.length / 600));
    for (let i = 0; i < points.length; i += step) {
      sampledPoints.push(points[i]);
    }
    // Close the loop
    if (sampledPoints.length > 2 &&
        sampledPoints[0].distanceTo(sampledPoints[sampledPoints.length - 1]) > 0.01) {
      sampledPoints.push(sampledPoints[0].clone());
    }
    if (sampledPoints.length < 4) return;

    // Compute cumulative distances for UV mapping
    const distances = [0];
    for (let i = 1; i < sampledPoints.length; i++) {
      distances.push(distances[i - 1] + sampledPoints[i].distanceTo(sampledPoints[i - 1]));
    }
    const totalLength = distances[distances.length - 1];
    if (totalLength < 0.5) return;

    // Create a smooth CatmullRomCurve3 from sampled points
    const curve = new THREE.CatmullRomCurve3(sampledPoints, true, 'centripetal', 0.5);

    // Create tube geometry along the path — THIN tube
    const tubeSegments = Math.min(800, sampledPoints.length * 2);
    const tubeRadius = 0.006; // thin tube for subtle glow
    const radialSegs = 4;     // fewer radial segments for thinner tube
    const tubeGeo = new THREE.TubeGeometry(curve, tubeSegments, tubeRadius, radialSegs, true);

    // Add custom UV attribute based on position along curve (0→1)
    const posCount = tubeGeo.attributes.position.count;
    const pathFractions = new Float32Array(posCount);

    // TubeGeometry creates vertices in rings along the path.
    const vertsPerRing = radialSegs + 1;
    const numRings = tubeSegments + 1;

    for (let ring = 0; ring < numRings; ring++) {
      const frac = ring / tubeSegments; // 0 → 1 along tube
      for (let r = 0; r < vertsPerRing; r++) {
        const idx = ring * vertsPerRing + r;
        if (idx < posCount) {
          pathFractions[idx] = frac;
        }
      }
    }
    tubeGeo.setAttribute('aPathFrac', new THREE.BufferAttribute(pathFractions, 1));

    // Gradient shader: moves a glowing window along the tube
    function createTrailMaterial(trailLength) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uHeadPos: { value: 0.0 },
          uTrailLength: { value: trailLength },
          uOpacity: { value: 1.0 },
        },
        vertexShader: `
          attribute float aPathFrac;
          varying float vPathFrac;
          void main() {
            vPathFrac = aPathFrac;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uHeadPos;
          uniform float uTrailLength;
          uniform float uOpacity;
          varying float vPathFrac;
          void main() {
            // Only handle the trailing side
            float trailDiff = uHeadPos - vPathFrac;
            if (trailDiff < 0.0) trailDiff += 1.0;

            // Beyond trail length → fully transparent
            if (trailDiff > uTrailLength && trailDiff < (1.0 - 0.005)) {
              discard;
            }

            // Gradient from head (0) to tail (1)
            float t = clamp(trailDiff / uTrailLength, 0.0, 1.0);

            // Color: white head → bright cyan → transparent blue tail
            vec3 headColor = vec3(0.85, 0.92, 1.0);
            vec3 midColor = vec3(0.15, 0.55, 0.9);
            vec3 tailColor = vec3(0.03, 0.12, 0.35);

            vec3 color;
            if (t < 0.1) {
              color = mix(headColor, midColor, t / 0.1);
            } else {
              color = mix(midColor, tailColor, (t - 0.1) / 0.9);
            }

            // Opacity: smooth power falloff, multiplied by global opacity
            float alpha = pow(1.0 - t, 2.5) * uOpacity;

            gl_FragColor = vec4(color, alpha);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    }

    // Create 3 evenly distributed trails along each chain
    const trailOffsets = [0, 1/3, 2/3];
    const trailLength = 0.80; // long trailing light

    trailOffsets.forEach(offset => {
      const mat = createTrailMaterial(trailLength);
      const mesh = new THREE.Mesh(tubeGeo, mat);
      group.add(mesh);
      flowPaths.push({
        mesh,
        material: mat,
        speed: 0.00004,
        offset,
      });
    });
  });

  scene.add(group);

  let startTime = null;

  function update(time) {
    // Record the time when flow lights first start, so all 3 trails
    // begin synchronized from their offset positions
    if (startTime === null) {
      startTime = time;
    }
    const elapsed = time - startTime;

    flowPaths.forEach(path => {
      const headPos = (path.offset + elapsed * path.speed) % 1;
      path.material.uniforms.uHeadPos.value = headPos;
    });
  }

  // Allow resetting start time (e.g., when visibility toggles)
  function resetTime() {
    startTime = null;
  }

  return { group, update, resetTime };
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
