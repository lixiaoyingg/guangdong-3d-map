import * as THREE from 'three';

/**
 * Create background using wenli.jpg texture with dark blue tint
 */
export function createBackground(scene) {
  const group = new THREE.Group();

  // ─── Load wenli texture for ground ───
  const textureLoader = new THREE.TextureLoader();
  const wenliTexture = textureLoader.load('/wenli.jpg');
  wenliTexture.wrapS = THREE.RepeatWrapping;
  wenliTexture.wrapT = THREE.RepeatWrapping;

  // ─── Ground plane with wenli texture ───
  const floorGeom = new THREE.PlaneGeometry(50, 50); // larger for better coverage
  const floorMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      wenliMap: { value: wenliTexture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform sampler2D wenliMap;
      varying vec2 vUv;
      void main() {
        // Tile the wenli texture
        vec2 tiledUV = vUv * 5.0;
        vec3 tex1 = texture2D(wenliMap, tiledUV).rgb;
        // Second sample rotated to hide seams
        float s = 0.7071;
        float c = 0.7071;
        vec2 rotUV = vec2(tiledUV.x * c - tiledUV.y * s, tiledUV.x * s + tiledUV.y * c) + vec2(2.3, 1.7);
        vec3 tex2 = texture2D(wenliMap, rotUV * 0.9).rgb;
        vec3 texColor = mix(tex1, tex2, 0.5);

        float lum = dot(texColor, vec3(0.299, 0.587, 0.114));

        // Very dark blue base tint — subdued to let map stand out
        vec3 baseColor = vec3(0.008, 0.015, 0.035);
        // Minimal texture pattern — just enough to add depth
        vec3 finalColor = baseColor + vec3(lum) * vec3(0.008, 0.016, 0.032);

        // Radial falloff — fade to fully transparent WELL before geometry edge
        float d = length(vUv - 0.5) * 2.0;
        // Start fading at d=0.5, fully transparent by d=0.9 (geometry edge is at d=1.0)
        float falloff = smoothstep(0.95, 0.35, d);
        finalColor *= falloff;

        // Very subtle pulse
        finalColor += vec3(0.0, 0.003, 0.008) * sin(time * 0.001 + d * 3.0) * 0.2 * falloff;

        gl_FragColor = vec4(finalColor, falloff);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const floor = new THREE.Mesh(floorGeom, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.06;
  group.add(floor);

  scene.add(group);

  // ─── Floating particles (subtle) ───
  const particleCount = 150;
  const particleGeom = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 20;
    positions[i * 3 + 1] = Math.random() * 5;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
  }

  particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const particleMat = new THREE.PointsMaterial({
    color: 0x2266aa,
    size: 0.025,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const particles = new THREE.Points(particleGeom, particleMat);
  scene.add(particles);

  return {
    update(time) {
      floorMat.uniforms.time.value = time;

      // Slowly rotate particles
      particles.rotation.y = time * 0.00005;

      // Float particles up
      const pos = particles.geometry.attributes.position.array;
      for (let i = 0; i < particleCount; i++) {
        pos[i * 3 + 1] += 0.0008;
        if (pos[i * 3 + 1] > 5) {
          pos[i * 3 + 1] = 0;
        }
      }
      particles.geometry.attributes.position.needsUpdate = true;
    },
  };
}
