import * as THREE from 'three';

/**
 * Create outline-only renderings of all Chinese provinces (except Guangdong).
 * These appear as subtle, low-opacity border traces using the SAME
 * center/scale as Guangdong so they align perfectly.
 *
 * Uses flat ribbon meshes instead of Line primitives to ensure
 * consistent visible thickness regardless of distance from camera.
 */
export function createNeighborOutlines(chinaGeoData, gdCenter, gdScale, scene) {
  const group = new THREE.Group();

  // Include all provinces except Guangdong itself
  const neighborFeatures = chinaGeoData.features.filter(f => {
    const name = (f.properties.name || '').trim();
    return name !== 'Guangdong';
  });

  neighborFeatures.forEach(feature => {
    const { coordinates, type } = feature.geometry;

    // Normalize to array of polygons
    const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];

    polygons.forEach(polygon => {
      const ring = polygon[0]; // outer ring only
      if (!ring || ring.length < 4) return;

      const points3d = ring.map(([x, y]) =>
        new THREE.Vector3(
          (x - gdCenter[0]) * gdScale,
          0.015,  // slightly above ground
          -(y - gdCenter[1]) * gdScale
        )
      );

      // ─── Ribbon mesh for consistent width ───
      // Build a ribbon (two-triangle-strip) along the outline
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

      // Core ribbon material
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
    });
  });

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
        // glow — proportionally weaker
        mesh.material.opacity = clamped * 0.03;
      }
    });
  }

  function setVisible(visible) {
    group.visible = visible;
  }

  return { group, setOpacity, setVisible };
}
