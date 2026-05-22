import * as THREE from 'three';
import { computeCenterAndScale } from './geoUtils.js';

/**
 * Create a water ripple wave of dots radiating outwards on the ground.
 * Centered at the map center (0, 0) and fades out completely as it expands.
 */
export function createRipple(geoData, scene) {
  const { center, scale } = computeCenterAndScale(geoData);

  const geometry = new THREE.PlaneGeometry(50, 50);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Vector2(0, 0) }, // centered around (0,0) in local space
      uRippleProgress: { value: 0.0 },
      uRippleWidth: { value: 2.5 },  // width of the wave ring
      uMaxRadius: { value: 24.0 },   // max radius it expands to (reaches the edge)
      uOpacity: { value: 1.0 },
    },
    vertexShader: `
      varying vec2 vWorldXZ;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec2 uCenter;
      uniform float uRippleProgress;
      uniform float uRippleWidth;
      uniform float uMaxRadius;
      uniform float uOpacity;
      varying vec2 vWorldXZ;
      varying vec2 vUv;

      void main() {
        float dist = distance(vWorldXZ, uCenter);

        // Dot grid pattern: dot spacing (approx 0.3 units)
        vec2 gridUV = fract(vWorldXZ * 3.333) - 0.5;
        float dotMask = smoothstep(0.18, 0.05, length(gridUV));

        // Wave peak radius
        float currentRadius = uRippleProgress * uMaxRadius;

        // Wave envelope
        float distFromWave = abs(dist - currentRadius);
        float waveEnvelope = smoothstep(uRippleWidth, 0.0, distFromWave);

        // Fading factors: starts fading out after 25% progress, completely gone by 100%
        float fadeOut = 1.0 - smoothstep(0.25, 1.0, uRippleProgress);
        float fadeIn = smoothstep(0.0, 0.10, uRippleProgress);
        float globalFade = fadeOut * fadeIn * uOpacity;

        // Base background dots (extremely faint, dark blue)
        float baseDots = dotMask * 0.04;

        // Glowing wave dots (bright cyan/blue)
        float waveDots = dotMask * waveEnvelope * 1.5;

        float finalIntensity = baseDots + waveDots;
        vec3 dotColor = vec3(0.0, 0.65, 1.0); // Bright Cyan-blue

        vec3 finalColor = dotColor * finalIntensity;

        // Add a white core highlight to the wave peak
        if (waveDots > 0.1) {
          finalColor += vec3(0.5, 0.8, 1.0) * (waveDots - 0.1) * 0.8;
        }

        // Edge falloff for the plane
        float planeDist = length(vUv - 0.5) * 2.0;
        float planeFalloff = smoothstep(1.0, 0.6, planeDist);

        gl_FragColor = vec4(finalColor, finalIntensity * globalFade * planeFalloff);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // Use additive blending for glowing effect
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.055; // just above floor (-0.06) but below map (0.0)
  mesh.renderOrder = 2;    // Ensure it renders after the floor background
  scene.add(mesh);

  return {
    mesh,
    setVisible(visible) {
      mesh.visible = visible;
    },
    update(elapsed, rippleStart, rippleDuration) {
      if (elapsed < rippleStart) {
        material.uniforms.uRippleProgress.value = 0.0;
        mesh.visible = false;
        return;
      }

      mesh.visible = true;
      const rippleElapsed = elapsed - rippleStart;
      const progress = Math.min(rippleElapsed / rippleDuration, 1.0);

      // Easing: starts fast and slows down gently (easeOutQuad)
      const easedProgress = 1.0 - Math.pow(1.0 - progress, 2);
      material.uniforms.uRippleProgress.value = easedProgress;
    }
  };
}
