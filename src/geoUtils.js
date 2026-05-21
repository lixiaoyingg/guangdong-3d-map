import * as THREE from 'three';

/**
 * Convert GeoJSON coordinates to 3D mesh coordinates
 * Centers and scales the map to fit nicely in the scene
 */
export function geoToVec2(coord, center, scale) {
  return new THREE.Vector2(
    (coord[0] - center[0]) * scale,
    (coord[1] - center[1]) * scale
  );
}

/**
 * Compute bounding box center and a scale factor for the GeoJSON data
 */
export function computeCenterAndScale(geoData) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  geoData.features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    coords.forEach(polygon => {
      polygon.forEach(ring => {
        ring.forEach(([x, y]) => {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        });
      });
    });
  });

  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const maxRange = Math.max(rangeX, rangeY);
  const scale = 10 / maxRange; // fit within 10 units

  return { center, scale };
}

/**
 * Create a THREE.Shape from a GeoJSON ring of coordinates
 */
export function ringToShape(ring, center, scale) {
  const shape = new THREE.Shape();
  ring.forEach(([x, y], i) => {
    const px = (x - center[0]) * scale;
    const py = (y - center[1]) * scale;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  return shape;
}
