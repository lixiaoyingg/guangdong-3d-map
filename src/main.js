import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createMap } from './map.js';
import { createFlowingLight } from './flowingLight.js';
import { createLabels } from './labels.js';
import { createBackground } from './background.js';
import { createOutlineDrawing } from './outlineDrawing.js';
import { createNeighborOutlines } from './neighborProvinces.js';
import { computeCenterAndScale } from './geoUtils.js';
import { createRipple } from './ripple.js';

// ─── Scene setup ───
const container = document.getElementById('map-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
// ─── Camera positions ───
// Image 1 (start): elevated oblique view, dramatic 3/4 angle with clear side faces
const CAMERA_START = new THREE.Vector3(-0.5, 5.5, 10);
// Image 2 (end): near top-down but not quite — slight forward tilt remains
const CAMERA_FINAL = new THREE.Vector3(-0.2, 12, 4);

// ─── Camera animation uses direct 3D interpolation ───
// Start and end positions now have X offsets, so we interpolate all 3 axes

camera.position.copy(CAMERA_START);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0e1a, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

// ─── OrbitControls (mouse interaction — disabled during camera animation) ───
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.enableZoom = true;
controls.enableRotate = true;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI / 2.1;
controls.minPolarAngle = 0.2;
controls.target.set(0, 0, 0);
controls.update();
// Disable user interaction until camera animation completes
controls.enabled = false;

// ─── Post-processing ───
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.7,   // reduced bloom intensity for subtler glow
  0.5,
  0.85
);
composer.addPass(bloomPass);

// ─── Lighting ───
const ambientLight = new THREE.AmbientLight(0x334466, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0x4488cc, 0.8);
dirLight.position.set(5, 10, 7);
scene.add(dirLight);

// ─── Animation timing ───
// Sequence: outline draw → map rises → labels fade in → camera moves → flowing light + ripple
const anim = {
  startTime: null,
  outlineDuration: 1200,    // Phase 0: outline draws (0 → 1200ms)
  growDelay: 1300,           // Phase 1 starts (ms)
  growDuration: 1200,        // Phase 1: map grows (1300 → 2500ms) - Sped up
  labelDelay: 2600,          // Phase 2: labels start (2600ms) - Sped up
  labelDuration: 800,        // Phase 2: labels fade in (2600 → 3400ms) - Sped up
  camStart: 3500,            // Phase 3: camera starts moving (after labels done) - Sped up
  camEnd: 5500,              // Phase 3: camera arrives (3500 → 5500ms) - Sped up
  flowLightDelay: 5500,      // Phase 4: flowing light starts (after camera settles) - Sped up
  flowLightDuration: 1500,   // Phase 4: flowing light fade in (5500 → 7000ms) - Sped up
  neighborStart: 0.70,       // Neighbor outlines appear when growProgress reaches 70%
  cameraAnimDone: false,     // Flag: camera animation has finished

  // Ripple timing config
  rippleStart: 5500,         // Starts immediately after camera settles
  rippleDuration: 2000,      // Ripple duration (spreads and fades out)
};

// ─── Camera animation path ───
// Camera moves AFTER labels are fully visible
// Smooth 3D interpolation from CAMERA_START to CAMERA_FINAL
function updateCameraAnimation(elapsed) {
  if (anim.cameraAnimDone) return;

  const camDuration = anim.camEnd - anim.camStart;

  if (elapsed < anim.camStart) {
    // Before camera phase: stay at starting position
    camera.position.copy(CAMERA_START);
    camera.lookAt(0, 0, 0);
    return;
  }

  const camElapsed = elapsed - anim.camStart;
  const t = Math.min(camElapsed / camDuration, 1);
  const eased = easeInOutCubic(t);

  // ─── Smooth 3D interpolation ───
  camera.position.x = CAMERA_START.x + (CAMERA_FINAL.x - CAMERA_START.x) * eased;
  camera.position.y = CAMERA_START.y + (CAMERA_FINAL.y - CAMERA_START.y) * eased;
  camera.position.z = CAMERA_START.z + (CAMERA_FINAL.z - CAMERA_START.z) * eased;

  camera.lookAt(0, 0, 0);

  // Update OrbitControls internal state so it picks up from the right position
  controls.target.set(0, 0, 0);
  controls.update();

  // Animation complete — hand control back to user
  if (t >= 1) {
    anim.cameraAnimDone = true;
    camera.position.copy(CAMERA_FINAL);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    controls.enabled = true;
  }
}

// ─── Load GeoJSON and create map ───
async function init() {
  // Load both Guangdong and China provinces data
  const [gdResponse, cnResponse] = await Promise.all([
    fetch('./guangdong.json'),
    fetch('./china_provinces.json'),
  ]);
  const geoData = await gdResponse.json();
  const chinaData = await cnResponse.json();

  const background = createBackground(scene);
  const { mapGroup, outlineGroup, topEdges, EXTRUDE_DEPTH } = createMap(geoData, scene);
  const flowingLights = createFlowingLight(geoData, scene);
  const labels = createLabels(geoData, scene, camera);
  const ripple = createRipple(geoData, scene);

  // Create the outline drawing animation (glowing border that draws itself)
  const outlineDrawing = createOutlineDrawing(geoData, scene);

  // Create neighboring province outlines using Guangdong's center/scale
  const { center, scale } = computeCenterAndScale(geoData);
  const neighbors = createNeighborOutlines(chinaData, center, scale, scene);

  // Initial hidden state — EVERYTHING invisible
  mapGroup.visible = false;
  outlineGroup.visible = false;
  topEdges.visible = false;
  flowingLights.group.visible = false;
  labels.group.visible = false;
  neighbors.setVisible(false);
  ripple.setVisible(false);

  // Start animation
  setTimeout(() => {
    anim.startTime = performance.now();
  }, 300);

  function animate(time) {
    requestAnimationFrame(animate);

    if (anim.startTime !== null) {
      const elapsed = time - anim.startTime;
      // Update camera cinematic path
      updateCameraAnimation(elapsed);
      updateAnimation(elapsed, mapGroup, outlineGroup, topEdges, flowingLights, labels, outlineDrawing, neighbors, EXTRUDE_DEPTH, time, ripple);
    }

    // Only update controls when animation is done (user has control)
    if (anim.cameraAnimDone) {
      controls.update();
    }

    background.update(time);
    composer.render();
  }

  requestAnimationFrame(animate);
}

function updateAnimation(elapsed, mapGroup, outlineGroup, topEdges, flowingLights, labels, outlineDrawing, neighbors, extrudeDepth, time, ripple) {

  // ══════════════════════════════════════════════════════
  // PHASE 0: Glow outline draws the province border
  // ══════════════════════════════════════════════════════
  const outlineProgress = Math.min(elapsed / anim.outlineDuration, 1);
  const easedOutline = outlineProgress;

  outlineDrawing.update(easedOutline);

  // During Phase 0: only the drawing outline is visible
  if (outlineProgress < 1) {
    mapGroup.visible = false;
    outlineGroup.visible = false;
    topEdges.visible = false;
    flowingLights.group.visible = false;
    labels.group.visible = false;
    neighbors.setVisible(false);
    return;
  }

  // ══════════════════════════════════════════════════════
  // PHASE 1: Map GROWS from ground (after outline is complete)
  // Smooth cross-fade from outline drawing → 3D map
  // ══════════════════════════════════════════════════════
  const growElapsed = elapsed - anim.growDelay;
  const growProgress = Math.min(Math.max(growElapsed / anim.growDuration, 0), 1);
  const easedGrow = easeOutCubic(growProgress);

  // Smoothly cross-fade the outline drawing as the map grows
  // Outline fades over the first 60% of the growth animation
  if (growProgress > 0) {
    const fadeOutProgress = Math.min(growProgress / 0.6, 1);
    outlineDrawing.setOpacity(1 - easeInOutQuad(fadeOutProgress));
  }

  // Only show the map once it has meaningful height (avoids paper-thin flash)
  if (growProgress > 0.02) {
    mapGroup.visible = true;
    const currentScale = easedGrow;
    mapGroup.children.forEach(mesh => {
      mesh.scale.y = Math.max(0.001, currentScale);

      // Full opacity — no fade-in, map is solid from the start
      if (mesh.material[0] && mesh.material[0].uniforms) {
        mesh.material[0].uniforms.opacity.value = 1.0;
      }
      if (mesh.material[1] && mesh.material[1].uniforms) {
        mesh.material[1].uniforms.opacity.value = 1.0;
      }
    });

    // ─── City borders RISE with the map ───
    // Borders are created at Y=0, position.y tracks the map's growing top surface
    const borderFade = Math.min(growProgress / 0.5, 1); // fade in over first 50% of growth
    const easedBorderFade = easeInOutQuad(borderFade);

    outlineGroup.visible = true;
    outlineGroup.position.y = (extrudeDepth + 0.01) * easedGrow;
    outlineGroup.children.forEach(line => {
      line.material.opacity = easedBorderFade * 0.40;
    });

    topEdges.visible = true;
    topEdges.position.y = (extrudeDepth + 0.015) * easedGrow;
    topEdges.children.forEach(line => {
      line.material.opacity = easedBorderFade * 0.30;
    });
  } else {
    mapGroup.visible = false;
    outlineGroup.visible = false;
    topEdges.visible = false;
  }

  // ─── Neighboring province outlines fade in near the end of map growth ───
  // Creates a dramatic reveal where borders emerge from the edges
  // as the map finishes rising
  if (growProgress >= anim.neighborStart) {
    neighbors.setVisible(true);
    const neighborFade = Math.min((growProgress - anim.neighborStart) / (1 - anim.neighborStart), 1);
    // Use easeOutCubic for a fast initial reveal that gently settles
    neighbors.setOpacity(easeOutCubic(neighborFade));
  } else {
    neighbors.setVisible(false);
  }

  // ══════════════════════════════════════════════════════
  // PHASE 2: After map fully risen → labels fade in
  // Camera stays still during this phase
  // ══════════════════════════════════════════════════════
  if (growProgress >= 1) {
    // Ensure borders at final resting position
    outlineGroup.position.y = extrudeDepth + 0.01;
    topEdges.position.y = extrudeDepth + 0.015;

    const labelElapsed = elapsed - anim.labelDelay;
    const labelProgress = Math.max(0, Math.min(labelElapsed / anim.labelDuration, 1));
    const easedLabel = easeInOutQuad(labelProgress);

    labels.group.visible = labelProgress > 0;
    if (labels.group.visible) {
      labels.group.children.forEach(sprite => {
        sprite.material.opacity = easedLabel;
      });
    }

    // Ensure neighbors remain visible
    neighbors.setVisible(true);
    neighbors.setOpacity(1);
  } else {
    // During growth: labels and flowing light stay hidden
    flowingLights.group.visible = false;
    labels.group.visible = false;
  }

  // ══════════════════════════════════════════════════════
  // PHASE 4: Flowing light fades in AFTER camera arrives
  // Smooth eased entrance
  // ══════════════════════════════════════════════════════
  const flowElapsed = elapsed - anim.flowLightDelay;
  const flowProgress = Math.max(0, Math.min(flowElapsed / anim.flowLightDuration, 1));
  const easedFlow = easeInOutQuad(flowProgress);

  flowingLights.group.visible = flowProgress > 0;
  if (flowingLights.group.visible) {
    flowingLights.update(time);
    // Smooth opacity fade-in via shader uniform
    flowingLights.group.children.forEach(mesh => {
      if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
        mesh.material.uniforms.uOpacity.value = easedFlow;
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // PHASE 5: Steady state — breathing glow + continuous flow
  // ══════════════════════════════════════════════════════
  const totalDuration = anim.flowLightDelay + anim.flowLightDuration;
  if (elapsed > totalDuration) {
    flowingLights.update(time);
    const breathe = 0.35 + 0.10 * Math.sin(time * 0.002);
    outlineGroup.children.forEach(line => {
      line.material.opacity = breathe;
    });
  }

  // Update ground water ripple animation
  if (ripple) {
    ripple.update(elapsed, anim.rippleStart, anim.rippleDuration);
  }
}

// ─── Easing ───
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Resize ───
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

init();
