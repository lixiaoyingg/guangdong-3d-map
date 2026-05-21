import * as THREE from 'three';
import { computeCenterAndScale } from './geoUtils.js';

const EXTRUDE_DEPTH = 0.35;

/**
 * Create city name labels as sprites above each city region
 * Uses a dimmer color to avoid Bloom over-exposure
 */
export function createLabels(geoData, scene, camera) {
  const { center, scale } = computeCenterAndScale(geoData);
  const group = new THREE.Group();

  geoData.features.forEach(feature => {
    const { name, centroid, center: cityCenter } = feature.properties;
    if (!name) return;

    const coord = centroid || cityCenter;
    if (!coord) return;

    const x = (coord[0] - center[0]) * scale;
    const z = -(coord[1] - center[1]) * scale;

    // Create text canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 36;
    canvas.width = 256;
    canvas.height = 64;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Subtle text glow - keep dim to avoid bloom overexposure
    ctx.shadowColor = 'rgba(0, 170, 255, 0.4)';
    ctx.shadowBlur = 4;
    // Use a dimmer color so bloom doesn't blow it out
    ctx.fillStyle = 'rgba(200, 230, 255, 0.85)';
    ctx.font = `${fontSize}px "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation: true,
      toneMapped: false, // prevent tone mapping from altering label brightness
    });

    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, EXTRUDE_DEPTH + 0.4, z);
    sprite.scale.set(1.0, 0.25, 1);
    sprite.renderOrder = 999; // render on top

    group.add(sprite);
  });

  scene.add(group);
  return { group };
}
