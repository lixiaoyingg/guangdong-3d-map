import * as THREE from 'three';
import { computeCenterAndScale, ringToShape } from './geoUtils.js';

const EXTRUDE_DEPTH = 0.35;

/**
 * Create the 3D extruded map with:
 * - Top face: wenli.jpg texture (clearly visible, dark pattern)
 * - Side face: gradient shader (blue bottom → near-black top) using LOCAL position
 * - City boundary edges (initially hidden)
 *
 * Animation approach: scale each mesh's Y from 0→1 so the map "grows" from ground,
 * and the gradient grows with it naturally.
 */
export function createMap(geoData, scene) {
  const { center, scale } = computeCenterAndScale(geoData);

  const mapGroup = new THREE.Group();
  const outlineGroup = new THREE.Group();
  const topEdges = new THREE.Group();

  // ─── Load wenli texture for top face ───
  const textureLoader = new THREE.TextureLoader();
  const wenliTexture = textureLoader.load('/wenli.jpg');
  wenliTexture.wrapS = THREE.RepeatWrapping;
  wenliTexture.wrapT = THREE.RepeatWrapping;

  // ─── Top face: ShaderMaterial with clear texture display ───
  // No normal discard — works correctly from any viewing angle
  const topShaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
      wenliMap: { value: wenliTexture },
      opacity: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D wenliMap;
      uniform float opacity;
      varying vec3 vWorldPos;
      void main() {
        // Dual-sampling at different rotations to eliminate tile seams
        vec2 baseUV = vWorldPos.xz * 0.10;
        // Sample 1: normal orientation
        vec3 tex1 = texture2D(wenliMap, baseUV).rgb;
        // Sample 2: rotated 45 degrees + offset to break up repetition
        float s = 0.7071; // sin(45deg)
        float c = 0.7071; // cos(45deg)
        vec2 rotUV = vec2(baseUV.x * c - baseUV.y * s, baseUV.x * s + baseUV.y * c) + vec2(3.7, 1.3);
        vec3 tex2 = texture2D(wenliMap, rotUV * 0.8).rgb;
        // Blend both samples to hide seams
        vec3 texColor = mix(tex1, tex2, 0.5);

        float lum = dot(texColor, vec3(0.299, 0.587, 0.114));
        // Dark blue base
        vec3 baseColor = vec3(0.03, 0.06, 0.13);
        // Texture pattern adds visible detail
        vec3 finalColor = baseColor + vec3(lum) * vec3(0.05, 0.09, 0.16);

        gl_FragColor = vec4(finalColor, opacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  // ─── Side face: gradient shader using LOCAL Y position ───
  // Using local position means the gradient is always 0→1 from bottom to top,
  // regardless of mesh.scale.y — so it "grows" naturally during animation
  const sideShaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
      bottomColor: { value: new THREE.Color(0x0066cc) },
      topColor: { value: new THREE.Color(0x050a12) },
      opacity: { value: 0 },
      extrudeDepth: { value: EXTRUDE_DEPTH },
    },
    vertexShader: `
      varying float vLocalY;
      void main() {
        // Pass LOCAL position Y (always 0 → EXTRUDE_DEPTH, unaffected by scale)
        vLocalY = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 bottomColor;
      uniform vec3 topColor;
      uniform float opacity;
      uniform float extrudeDepth;
      varying float vLocalY;
      void main() {
        // Gradient: t=0 at bottom (blue), t=1 at top (near-black)
        float t = clamp(vLocalY / extrudeDepth, 0.0, 1.0);
        vec3 color = mix(bottomColor, topColor, t);
        // Glow at the very bottom edge
        float edgeGlow = smoothstep(0.15, 0.0, t) * 0.35;
        color += vec3(0.0, 0.3, 0.8) * edgeGlow;
        gl_FragColor = vec4(color, opacity);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
  });

  geoData.features.forEach(feature => {
    const { coordinates } = feature.geometry;

    coordinates.forEach(polygon => {
      if (polygon[0].length < 4) return;

      // Outer ring → shape
      const shape = ringToShape(polygon[0], center, scale);

      // Holes
      for (let i = 1; i < polygon.length; i++) {
        if (polygon[i].length >= 4) {
          const holePath = new THREE.Path();
          polygon[i].forEach(([x, y], j) => {
            const px = (x - center[0]) * scale;
            const py = (y - center[1]) * scale;
            if (j === 0) holePath.moveTo(px, py);
            else holePath.lineTo(px, py);
          });
          shape.holes.push(holePath);
        }
      }

      // Extruded geometry
      const extrudeSettings = {
        depth: EXTRUDE_DEPTH,
        bevelEnabled: false,
      };

      try {
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        // Rotate so extrusion goes upward (along Y)
        // After rotation: local Y goes from 0 (ground) to EXTRUDE_DEPTH (top)
        geometry.rotateX(-Math.PI / 2);
        geometry.computeVertexNormals();

        const mesh = new THREE.Mesh(geometry, [
          topShaderMaterial.clone(),
          sideShaderMaterial.clone(),
        ]);
        // Start completely flat
        mesh.scale.y = 0.001;
        mapGroup.add(mesh);
      } catch (e) {
        // Skip problematic polygons
      }

      // ─── Province outline (city boundary edges, initially hidden) ───
      const outlinePoints = [];
      polygon[0].forEach(([x, y]) => {
        outlinePoints.push(
          new THREE.Vector3(
            (x - center[0]) * scale,
            0,
            -(y - center[1]) * scale
          )
        );
      });

      const lineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const outlineLine = new THREE.Line(lineGeometry, outlineMaterial);
      outlineGroup.add(outlineLine);

      // ─── Top edges (city boundaries, initially hidden) ───
      const edgePoints = polygon[0].map(([x, y]) =>
        new THREE.Vector3(
          (x - center[0]) * scale,
          0,
          -(y - center[1]) * scale
        )
      );
      const edgeGeom = new THREE.BufferGeometry().setFromPoints(edgePoints);
      const edgeMat = new THREE.LineBasicMaterial({
        color: 0x1a8acd,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      topEdges.add(new THREE.Line(edgeGeom, edgeMat));
    });
  });


  // ─── Initial state: everything completely invisible ───
  mapGroup.visible = false;  // hidden until animation starts
  mapGroup.position.y = 0;
  outlineGroup.visible = false;
  topEdges.visible = false;

  scene.add(mapGroup);
  scene.add(outlineGroup);
  scene.add(topEdges);

  return { mapGroup, outlineGroup, topEdges, center, scale, EXTRUDE_DEPTH };
}
