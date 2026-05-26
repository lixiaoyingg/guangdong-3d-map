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

// ─── Global State & Variables ───
let chinaDataGlobal = null;

const STATE = {
  CHINA_INTRO: 'china_intro',
  CHINA_ACTIVE: 'china_active',
  PROVINCE_LOADING: 'province_loading',
  PROVINCE_INTRO: 'province_intro',
  PROVINCE_ACTIVE: 'province_active',
  TRANSITION_TO_CHINA: 'transition_to_china'
};
let currentState = null; // null initially to prevent initial glitches
let stateStartTime = 0;

let chinaMap = null;
let chinaLabels = null;
let chinaOutlineDrawing = null;
let chinaFlowingLights = null;
let chinaNeighbors = null;
let chinaRipple = null;

let activeProvinceMap = {
  mapGroup: null,
  outlineGroup: null,
  topEdges: null,
  flowingLights: null,
  labels: null,
  outlineDrawing: null,
  neighbors: null,
  ripple: null,
  extrudeDepth: 0.35,
  name: '',
  adcode: null,
  geoData: null,
  center: null
};

// ─── Asynchronous Loading State ───
let loadingProvinceName = '';
let provinceLoaded = false;
let provinceBuilt = false;
let provBuiltTime = 0;
let mouseMoved = false;
let mapStack = [];
let loadedGeoData = null;
let clickStartCamPos = new THREE.Vector3();
let clickTarget3D = new THREE.Vector3();

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
// China Map views (Syncing perspectives with province ratios, scaled to fit the country)
const CAMERA_CHINA_START = new THREE.Vector3(-0.6, 6.6, 12.0);
const CAMERA_CHINA_FINAL = new THREE.Vector3(-0.24, 14.4, 4.8);

// Province Detail views
const CAMERA_PROV_START = new THREE.Vector3(-0.5, 5.5, 10);
const CAMERA_PROV_FINAL = new THREE.Vector3(-0.2, 12, 4);

let camBackStartPos = new THREE.Vector3();
let camBackTargetPos = new THREE.Vector3();
let poppedParent = null;

camera.position.copy(CAMERA_CHINA_START);
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

// ─── OrbitControls (mouse interaction) ───
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
controls.enabled = false; // Disable initially during intro

// ─── Post-processing ───
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.7,   // bloom intensity
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

// ─── Animation Timing Configurations ───
const animChina = {
  outlineDuration: 1200,    // Outline draws (0 → 1200ms)
  growDelay: 1200,           // Map grows starts at 1200ms
  growDuration: 1200,        // Map grows (1200 → 2400ms)
  labelDelay: 2400,          // Labels start at 2400ms
  labelDuration: 600,        // Labels fade in (2400 → 3000ms)
  camStart: 3000,            // Camera starts moving at 3000ms
  camEnd: 5000,              // Camera arrives (3000 → 5000ms)
};

const animProv = {
  duration: 1200,            // Smooth fade-in + camera glide transition duration
  rippleStart: 0,            // Ripple starts immediately during province fade-in
  rippleDuration: 8000,
};

// ─── Interaction & Raycasting Setup ───
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hoveredProvinceName = null;

const PROVINCE_NAME_MAP = {
  'Gansu': '甘肃',
  'Qianghai': '青海',
  'Guangxi': '广西',
  'Guizhou': '贵州',
  'Chongqing': '重庆',
  'Beijing': '北京',
  'Fujian': '福建',
  'Anhui': '安徽',
  'Guangdong': '广东',
  'Tibet': '西藏',
  'Xinjiang': '新疆',
  'Hainan': '海南',
  'Ningxia': '宁夏',
  'Shaanxi': '陕西',
  'Shanxi': '山西',
  'Hubei': '湖北',
  'Hunan': '湖南',
  'Sichuan': '四川',
  'Yunnan': '云南',
  'Hebei': '河北',
  'Henan': '河南',
  'Liaoning': '辽宁',
  'Shandong': '山东',
  'Tianjin': '天津',
  'Jiangxi': '江西',
  'Jiangsu': '江苏',
  'Shanghai': '上海',
  'Zhejiang': '浙江',
  'Jilin': '吉林',
  'Inner Mongolia': '内蒙古',
  'Heilongjiang': '黑龙江',
  'Taiwan': '台湾',
  'Hongkong': '香港',
  'Macau': '澳门'
};

// ─── Opacity Helpers ───
function setChinaMapOpacity(opacity) {
  if (chinaMap) {
    chinaMap.mapGroup.children.forEach(mesh => {
      if (mesh.material[0] && mesh.material[0].uniforms) {
        mesh.material[0].uniforms.opacity.value = opacity;
        mesh.material[0].transparent = opacity < 1.0;
      }
      if (mesh.material[1] && mesh.material[1].uniforms) {
        mesh.material[1].uniforms.opacity.value = opacity;
        mesh.material[1].transparent = opacity < 1.0;
      }
    });
    chinaMap.outlineGroup.children.forEach(line => {
      line.material.opacity = opacity * 0.40;
    });
    chinaMap.topEdges.children.forEach(line => {
      line.material.opacity = opacity * 0.30;
    });
  }
  if (chinaLabels && chinaLabels.group) {
    chinaLabels.group.children.forEach(sprite => {
      sprite.material.opacity = opacity;
    });
  }
  if (chinaFlowingLights && chinaFlowingLights.group) {
    chinaFlowingLights.group.children.forEach(mesh => {
      if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
        mesh.material.uniforms.uOpacity.value = opacity;
      }
    });
  }
  if (chinaNeighbors) {
    chinaNeighbors.setOpacity(opacity);
  }
  if (chinaRipple && chinaRipple.mesh && chinaRipple.mesh.material.uniforms) {
    chinaRipple.mesh.material.uniforms.uOpacity.value = opacity;
  }
}

function setProvinceMapOpacity(opacity) {
  if (activeProvinceMap.mapGroup) {
    activeProvinceMap.mapGroup.children.forEach(mesh => {
      if (mesh.material[0] && mesh.material[0].uniforms) {
        mesh.material[0].uniforms.opacity.value = opacity;
        mesh.material[0].transparent = opacity < 1.0;
      }
      if (mesh.material[1] && mesh.material[1].uniforms) {
        mesh.material[1].uniforms.opacity.value = opacity;
        mesh.material[1].transparent = opacity < 1.0;
      }
    });
  }
  if (activeProvinceMap.labels && activeProvinceMap.labels.group) {
    activeProvinceMap.labels.group.children.forEach(sprite => {
      sprite.material.opacity = opacity;
    });
  }
  if (activeProvinceMap.outlineGroup) {
    activeProvinceMap.outlineGroup.children.forEach(line => {
      line.material.opacity = opacity * 0.80;
    });
  }
  if (activeProvinceMap.topEdges) {
    activeProvinceMap.topEdges.children.forEach(line => {
      line.material.opacity = opacity * 0.60;
    });
  }
  if (activeProvinceMap.flowingLights && activeProvinceMap.flowingLights.group) {
    activeProvinceMap.flowingLights.group.children.forEach(mesh => {
      if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
        mesh.material.uniforms.uOpacity.value = opacity;
      }
    });
  }
  if (activeProvinceMap.neighbors) {
    activeProvinceMap.neighbors.setOpacity(opacity);
  }
  if (activeProvinceMap.ripple && activeProvinceMap.ripple.mesh && activeProvinceMap.ripple.mesh.material.uniforms) {
    activeProvinceMap.ripple.mesh.material.uniforms.uOpacity.value = opacity;
  }
}

function setMapOpacityDirect(mapObj, opacity) {
  if (mapObj.mapGroup) {
    mapObj.mapGroup.children.forEach(mesh => {
      if (mesh.material[0] && mesh.material[0].uniforms) {
        mesh.material[0].uniforms.opacity.value = opacity;
        mesh.material[0].transparent = opacity < 1.0;
      }
      if (mesh.material[1] && mesh.material[1].uniforms) {
        mesh.material[1].uniforms.opacity.value = opacity;
        mesh.material[1].transparent = opacity < 1.0;
      }
    });
  }
  if (mapObj.labels && mapObj.labels.group) {
    mapObj.labels.group.children.forEach(sprite => {
      sprite.material.opacity = opacity;
    });
  }
  if (mapObj.outlineGroup) {
    mapObj.outlineGroup.children.forEach(line => {
      line.material.opacity = opacity * 0.80;
    });
  }
  if (mapObj.topEdges) {
    mapObj.topEdges.children.forEach(line => {
      line.material.opacity = opacity * 0.60;
    });
  }
  if (mapObj.flowingLights && mapObj.flowingLights.group) {
    mapObj.flowingLights.group.children.forEach(mesh => {
      if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
        mesh.material.uniforms.uOpacity.value = opacity;
      }
    });
  }
  if (mapObj.neighbors) {
    mapObj.neighbors.setOpacity(opacity);
  }
  if (mapObj.ripple && mapObj.ripple.mesh && mapObj.ripple.mesh.material.uniforms) {
    mapObj.ripple.mesh.material.uniforms.uOpacity.value = opacity;
  }
}

function setParentMapOpacity(opacity) {
  if (mapStack.length === 0) {
    setChinaMapOpacity(opacity);
  } else {
    setMapOpacityDirect(mapStack[mapStack.length - 1], opacity);
  }
}

// ─── Disposal Helper ───
function disposeGroup(group, scene) {
  if (!group) return;
  group.traverse(child => {
    if (child.isMesh || child.isLine || child.isSprite) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
  scene.remove(group);
}

function disposeActiveProvince() {
  if (activeProvinceMap.mapGroup) disposeGroup(activeProvinceMap.mapGroup, scene);
  if (activeProvinceMap.outlineGroup) disposeGroup(activeProvinceMap.outlineGroup, scene);
  if (activeProvinceMap.topEdges) disposeGroup(activeProvinceMap.topEdges, scene);
  if (activeProvinceMap.flowingLights && activeProvinceMap.flowingLights.group) {
    disposeGroup(activeProvinceMap.flowingLights.group, scene);
  }
  if (activeProvinceMap.labels && activeProvinceMap.labels.group) {
    disposeGroup(activeProvinceMap.labels.group, scene);
  }
  if (activeProvinceMap.outlineDrawing && activeProvinceMap.outlineDrawing.group) {
    disposeGroup(activeProvinceMap.outlineDrawing.group, scene);
  }
  if (activeProvinceMap.neighbors && activeProvinceMap.neighbors.group) {
    disposeGroup(activeProvinceMap.neighbors.group, scene);
  }
  if (activeProvinceMap.ripple && activeProvinceMap.ripple.mesh) {
    scene.remove(activeProvinceMap.ripple.mesh);
    activeProvinceMap.ripple.mesh.geometry.dispose();
    activeProvinceMap.ripple.mesh.material.dispose();
  }
  activeProvinceMap = {
    mapGroup: null,
    outlineGroup: null,
    topEdges: null,
    flowingLights: null,
    labels: null,
    outlineDrawing: null,
    neighbors: null,
    ripple: null,
    extrudeDepth: 0.35,
    name: '',
    adcode: null,
    geoData: null,
    center: null
  };
}

// ─── Interaction Handlers ───
function updateHover(intersects) {
  let newHoveredName = null;
  if (intersects.length > 0) {
    const hitObj = intersects[0].object;
    if (hitObj.userData && hitObj.userData.properties) {
      newHoveredName = hitObj.userData.properties.name;
    }
  }

  const currentActiveMap = (currentState === STATE.CHINA_ACTIVE) ? chinaMap : activeProvinceMap;

  if (newHoveredName !== hoveredProvinceName) {
    // Reset previous hover highlights
    if (hoveredProvinceName && currentActiveMap) {
      currentActiveMap.mapGroup.children.forEach(mesh => {
        if (mesh.userData && mesh.userData.properties && mesh.userData.properties.name === hoveredProvinceName) {
          if (mesh.material[0] && mesh.material[0].uniforms) mesh.material[0].uniforms.uHover.value = 0.0;
          if (mesh.material[1] && mesh.material[1].uniforms) mesh.material[1].uniforms.uHover.value = 0.0;
        }
      });
    }

    // Set new hover highlights
    hoveredProvinceName = newHoveredName;
    if (hoveredProvinceName && currentActiveMap) {
      currentActiveMap.mapGroup.children.forEach(mesh => {
        if (mesh.userData && mesh.userData.properties && mesh.userData.properties.name === hoveredProvinceName) {
          if (mesh.material[0] && mesh.material[0].uniforms) mesh.material[0].uniforms.uHover.value = 1.0;
          if (mesh.material[1] && mesh.material[1].uniforms) mesh.material[1].uniforms.uHover.value = 1.0;
        }
      });
      const isClickable = (currentState === STATE.CHINA_ACTIVE) || (currentState === STATE.PROVINCE_ACTIVE && mapStack.length === 0);
      if (isClickable) {
        document.body.style.cursor = 'pointer';
        const chineseName = PROVINCE_NAME_MAP[hoveredProvinceName] || hoveredProvinceName;
        const subtitle = (currentState === STATE.CHINA_ACTIVE) ? '点击下钻 3D 城市地图' : '点击下钻 3D 区县地图';
        tooltip.innerHTML = `<div style="font-weight:bold;color:#00c3ff;text-align:center;">${chineseName}</div><div style="font-size:11px;color:#88aacc;margin-top:4px;">${subtitle}</div>`;
      } else {
        document.body.style.cursor = 'default';
        const chineseName = PROVINCE_NAME_MAP[hoveredProvinceName] || hoveredProvinceName;
        tooltip.innerHTML = `<div style="font-weight:bold;color:#00c3ff;text-align:center;">${chineseName}</div>`;
      }
      tooltip.style.display = 'block';
    } else {
      document.body.style.cursor = 'default';
      tooltip.style.display = 'none';
    }
  }
}

// ─── Build Province Map Components inside Scene ───
// ─── Build Province Map Components inside Scene ───
function buildProvinceMapInScene() {
  // Create new active province map components
  const pMap = createMap(loadedGeoData, scene);
  const pLights = createFlowingLight(loadedGeoData, scene);
  const pLabels = createLabels(loadedGeoData, scene, camera, false);
  const pRipple = createRipple(loadedGeoData, scene);
  
  const { center, scale } = computeCenterAndScale(loadedGeoData);
  
  const parentGeoData = (mapStack.length > 0) ? mapStack[mapStack.length - 1].geoData : chinaDataGlobal;
  const pNeighbors = createNeighborOutlines(parentGeoData, loadedGeoData, center, scale, scene, loadingProvinceName);

  activeProvinceMap = {
    mapGroup: pMap.mapGroup,
    outlineGroup: pMap.outlineGroup,
    topEdges: pMap.topEdges,
    flowingLights: pLights,
    labels: pLabels,
    outlineDrawing: null,
    neighbors: pNeighbors,
    ripple: pRipple,
    extrudeDepth: pMap.EXTRUDE_DEPTH,
    name: loadingProvinceName,
    scale: scale, // Save scale for returning transition
    center: center,
    adcode: loadingProvinceAdcode,
    geoData: loadedGeoData
  };

  // Configure fully extruded meshes initially with 0.0 opacity for clean fade-in
  activeProvinceMap.mapGroup.visible = true;
  activeProvinceMap.outlineGroup.visible = true;
  activeProvinceMap.topEdges.visible = true;
  activeProvinceMap.flowingLights.group.visible = true;
  activeProvinceMap.labels.group.visible = true;
  activeProvinceMap.neighbors.setVisible(true);
  activeProvinceMap.ripple.setVisible(true);

  activeProvinceMap.mapGroup.children.forEach(mesh => {
    mesh.scale.y = 1.0; // Fully extruded, no Y-growing
  });
  activeProvinceMap.outlineGroup.position.y = activeProvinceMap.extrudeDepth + 0.01;
  activeProvinceMap.topEdges.position.y = activeProvinceMap.extrudeDepth + 0.015;

  // Set initial position and scale to align with its slot on the parent map
  const parentScale = (mapStack.length > 0) ? mapStack[mapStack.length - 1].scale : chinaMap.scale;
  const relativeScale = parentScale / scale;
  activeProvinceMap.mapGroup.position.copy(clickTarget3D);
  activeProvinceMap.outlineGroup.position.copy(clickTarget3D);
  activeProvinceMap.topEdges.position.copy(clickTarget3D);
  activeProvinceMap.flowingLights.group.position.copy(clickTarget3D);
  activeProvinceMap.labels.group.position.copy(clickTarget3D);
  activeProvinceMap.neighbors.group.position.copy(clickTarget3D);

  activeProvinceMap.mapGroup.scale.set(relativeScale, relativeScale, relativeScale);
  activeProvinceMap.outlineGroup.scale.set(relativeScale, relativeScale, relativeScale);
  activeProvinceMap.topEdges.scale.set(relativeScale, relativeScale, relativeScale);
  activeProvinceMap.flowingLights.group.scale.set(relativeScale, relativeScale, relativeScale);
  activeProvinceMap.labels.group.scale.set(relativeScale, relativeScale, relativeScale);
  activeProvinceMap.neighbors.group.scale.set(relativeScale, relativeScale, relativeScale);

  setProvinceMapOpacity(0.0);

  provinceBuilt = true;
}

function getGeometryCenter(feature) {
  if (!feature || !feature.geometry) return [0, 0];
  const { coordinates, type } = feature.geometry;
  if (!coordinates) return [0, 0];
  const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let count = 0;
  polygons.forEach(polygon => {
    if (!polygon || !polygon[0]) return;
    polygon[0].forEach(([x, y]) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      count++;
    });
  });
  if (count === 0) return [0, 0];
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

// ─── Asynchronous GeoJSON Loading ───
let loadingProvinceAdcode = null;

async function loadProvinceMap(provinceName, id) {
  // Push current activeProvinceMap to stack if we're nested (active province map is visible)
  if (currentState === STATE.PROVINCE_ACTIVE) {
    const parentMapState = { ...activeProvinceMap };
    mapStack.push(parentMapState);
  } else if (currentState === STATE.CHINA_ACTIVE) {
    // Only dispose if we start from China to province to avoid memory leak
    disposeActiveProvince();
  }

  currentState = STATE.PROVINCE_LOADING;
  stateStartTime = performance.now(); // Track duration of exit dive animation
  controls.enabled = false;

  loadingProvinceName = provinceName;
  loadingProvinceAdcode = id;
  provinceLoaded = false;
  loadedGeoData = null;
  provinceBuilt = false;

  // Clean up hover highlights & tooltip
  if (hoveredProvinceName) {
    const currentActiveMap = (mapStack.length > 0) ? activeProvinceMap : chinaMap;
    if (currentActiveMap) {
      currentActiveMap.mapGroup.children.forEach(mesh => {
        if (mesh.userData && mesh.userData.properties && mesh.userData.properties.name === hoveredProvinceName) {
          if (mesh.material[0] && mesh.material[0].uniforms) mesh.material[0].uniforms.uHover.value = 0.0;
          if (mesh.material[1] && mesh.material[1].uniforms) mesh.material[1].uniforms.uHover.value = 0.0;
        }
      });
    }
  }
  hoveredProvinceName = null;
  tooltip.style.display = 'none';
  document.body.style.cursor = 'default';

  // Find clicked province/city center coordinates to focus camera dive-in
  let parentCenter, parentScale, parentFeatures;
  if (mapStack.length > 0) {
    const parent = mapStack[mapStack.length - 1];
    parentCenter = parent.center;
    parentScale = parent.scale;
    parentFeatures = parent.geoData.features;
  } else {
    parentCenter = chinaMap.center;
    parentScale = chinaMap.scale;
    parentFeatures = chinaDataGlobal.features;
  }

  const clickedFeature = parentFeatures.find(f => f && f.properties && f.properties.name === provinceName);
  let targetX = 0;
  let targetZ = 0;
  if (clickedFeature) {
    let centroid = clickedFeature.properties.centroid || clickedFeature.properties.center || (clickedFeature.properties.longitude ? [clickedFeature.properties.longitude, clickedFeature.properties.latitude] : null);
    if (!centroid || typeof centroid[0] !== 'number' || typeof centroid[1] !== 'number') {
      centroid = getGeometryCenter(clickedFeature);
    }
    targetX = (centroid[0] - parentCenter[0]) * parentScale;
    targetZ = -(centroid[1] - parentCenter[1]) * parentScale;
  }
  clickTarget3D.set(targetX, 0, targetZ);
  clickStartCamPos.copy(camera.position);

  // Start Asynchronous Fetch
  fetchGeoData(provinceName, id);
}

function showToast(message, duration = 3000) {
  let toast = document.getElementById('error-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'error-toast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: rgba(20, 30, 50, 0.92); color: #ff6b6b; padding: 12px 28px;
      border-radius: 8px; font-size: 14px; z-index: 10000;
      border: 1px solid rgba(255,107,107,0.3); backdrop-filter: blur(8px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.4); transition: opacity 0.4s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 400);
  }, duration);
}

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`[Map] Fetch attempt ${i + 1} failed for ${url}:`, e.message);
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function fetchGeoData(provinceName, id) {
  let geoData;
  if (id === 44) {
    const res = await fetch('./guangdong.json');
    geoData = await res.json();
  } else {
    let urlId = id;
    if (typeof id === 'number' && id < 100) {
      urlId = id * 10000;
    }
    console.log(`[Map] Loading geo data: name=${provinceName}, id=${id}, urlId=${urlId}`);

    try {
      // Try full map with sub-regions first
      geoData = await fetchWithRetry(`https://geo.datav.aliyun.com/areas_v3/bound/${urlId}_full.json`);
    } catch (e1) {
      console.warn('[Map] Full map failed, trying boundary only...');
      try {
        // Fallback: boundary-only (no sub-regions)
        geoData = await fetchWithRetry(`https://geo.datav.aliyun.com/areas_v3/bound/${urlId}.json`);
      } catch (e2) {
        console.error('[Map] All fetch attempts failed for', urlId);
        showToast('数据加载失败，请检查网络后重试');
        document.getElementById('loading-overlay').classList.remove('visible');
        setParentMapOpacity(1.0);
        
        if (mapStack.length > 0) {
          const popped = mapStack.pop();
          activeProvinceMap = popped;
          setProvinceMapOpacity(1.0);
          if (activeProvinceMap.mapGroup) activeProvinceMap.mapGroup.visible = true;
          if (activeProvinceMap.outlineGroup) activeProvinceMap.outlineGroup.visible = true;
          if (activeProvinceMap.topEdges) activeProvinceMap.topEdges.visible = true;
          if (activeProvinceMap.flowingLights && activeProvinceMap.flowingLights.group) activeProvinceMap.flowingLights.group.visible = true;
          if (activeProvinceMap.labels && activeProvinceMap.labels.group) activeProvinceMap.labels.group.visible = true;
          if (activeProvinceMap.neighbors) activeProvinceMap.neighbors.setVisible(true);
          if (activeProvinceMap.ripple) activeProvinceMap.ripple.setVisible(true);
          currentState = STATE.PROVINCE_ACTIVE;
        } else {
          if (chinaMap) {
            chinaMap.mapGroup.visible = true;
            chinaMap.outlineGroup.visible = true;
            chinaMap.topEdges.visible = true;
          }
          if (chinaLabels && chinaLabels.group) {
            chinaLabels.group.visible = true;
          }
          if (chinaFlowingLights && chinaFlowingLights.group) {
            chinaFlowingLights.group.visible = true;
          }
          if (chinaNeighbors) chinaNeighbors.setVisible(true);
          if (chinaRipple) chinaRipple.setVisible(true);
          currentState = STATE.CHINA_ACTIVE;
        }
        controls.enabled = true;
        return;
      }
    }
  }
  loadedGeoData = geoData;
  provinceLoaded = true;
}

// ─── Initialize Application ───
async function init() {
  const [cnResponse, worldResponse] = await Promise.all([
    fetch('./china_provinces.json'),
    fetch('./world_countries.json')
  ]);
  const chinaData = await cnResponse.json();
  const worldData = await worldResponse.json();
  chinaDataGlobal = chinaData; // Store globally for neighbor generation

  const background = createBackground(scene);

  // Create China Map components
  chinaMap = createMap(chinaData, scene);
  chinaLabels = createLabels(chinaData, scene, camera, true);
  chinaOutlineDrawing = createOutlineDrawing(chinaData, scene);
  chinaFlowingLights = createFlowingLight(chinaData, scene); // Add flowing lights for China

  // Create China Neighbor Outlines and Ripple
  chinaNeighbors = createNeighborOutlines(worldData, null, chinaMap.center, chinaMap.scale, scene, 'China');
  chinaRipple = createRipple(chinaData, scene);

  // Initial hidden state
  chinaMap.mapGroup.visible = false;
  chinaMap.outlineGroup.visible = false;
  chinaMap.topEdges.visible = false;
  chinaLabels.group.visible = false;
  chinaFlowingLights.group.visible = false;

  if (chinaNeighbors) {
    chinaNeighbors.setVisible(false);
    chinaNeighbors.setOpacity(0);
  }
  if (chinaRipple) {
    chinaRipple.setVisible(false);
  }

  // Start Intro Animation
  setTimeout(() => {
    stateStartTime = performance.now();
    currentState = STATE.CHINA_INTRO;
  }, 300);

  // ─── Animation Loop ───
  function animate(time) {
    requestAnimationFrame(animate);

    if (currentState === null) {
      background.update(time);
      composer.render();
      return;
    }

    const stateElapsed = time - stateStartTime;

    if (currentState === STATE.CHINA_INTRO) {
      // Ensure outline drawing is visible and has full base opacity during drawing phase
      chinaOutlineDrawing.setVisible(true);
      if (stateElapsed <= animChina.growDelay) {
        chinaOutlineDrawing.setOpacity(1.0);
      }

      // Outline draws (Phase 0)
      const outlineProgress = Math.min(stateElapsed / animChina.outlineDuration, 1);
      chinaOutlineDrawing.update(outlineProgress);

      // Neighbor outlines and Ripple fade-in starts just before map rises (at 1000ms)
      if (stateElapsed >= 1000) {
        if (chinaNeighbors) {
          chinaNeighbors.setVisible(true);
          const neighborFade = Math.min((stateElapsed - 1000) / 1000, 1.0);
          chinaNeighbors.setOpacity(neighborFade);
        }
        if (chinaRipple) {
          chinaRipple.setVisible(true);
          chinaRipple.update(stateElapsed, 1000, 8000, true); // loop = true
        }
      }

      if (stateElapsed > animChina.outlineDuration) {
        // Map grows (Phase 1)
        const growProgress = Math.min((stateElapsed - animChina.growDelay) / animChina.growDuration, 1);
        const easedGrow = easeOutCubic(growProgress);
        
        if (growProgress > 0) {
          chinaMap.mapGroup.visible = true;
          chinaMap.outlineGroup.visible = true;
          chinaMap.topEdges.visible = true;
          
          chinaMap.mapGroup.children.forEach(mesh => {
            mesh.scale.y = Math.max(0.001, easedGrow);
            if (mesh.material[0] && mesh.material[0].uniforms) mesh.material[0].uniforms.opacity.value = 1.0;
            if (mesh.material[1] && mesh.material[1].uniforms) mesh.material[1].uniforms.opacity.value = 1.0;
          });
          
          chinaMap.outlineGroup.position.y = (chinaMap.EXTRUDE_DEPTH + 0.01) * easedGrow;
          chinaMap.outlineGroup.children.forEach(line => {
            line.material.opacity = easedGrow * 0.40;
          });
          
          chinaMap.topEdges.position.y = (chinaMap.EXTRUDE_DEPTH + 0.015) * easedGrow;
          chinaMap.topEdges.children.forEach(line => {
            line.material.opacity = easedGrow * 0.30;
          });
          
          chinaOutlineDrawing.setOpacity(1 - easeInOutQuad(Math.min((stateElapsed - animChina.growDelay) / 720, 1)));

          // China Flow lights rise and fade in concurrently with the map
          chinaFlowingLights.group.visible = true;
          chinaFlowingLights.group.position.y = (chinaMap.EXTRUDE_DEPTH + 0.03) * (easedGrow - 1.0);
          chinaFlowingLights.group.children.forEach(mesh => {
            if (mesh.material && mesh.material.uniforms && mesh.material.uniforms.uOpacity) {
              mesh.material.uniforms.uOpacity.value = easedGrow;
            }
          });
        }
      }

      // Update China flowing lights continuously once map starts growing
      if (stateElapsed >= animChina.growDelay) {
        chinaFlowingLights.update(time);
      }

      if (stateElapsed > animChina.labelDelay) {
        // Labels fade in (Phase 2)
        const labelProgress = Math.min((stateElapsed - animChina.labelDelay) / animChina.labelDuration, 1);
        const easedLabel = easeInOutQuad(labelProgress);
        
        chinaLabels.group.visible = true;
        chinaLabels.group.children.forEach(sprite => {
          sprite.material.opacity = easedLabel;
        });
      }

      // Camera moves (Phase 3)
      if (stateElapsed >= animChina.camStart) {
        const camDuration = animChina.camEnd - animChina.camStart;
        const t = Math.min((stateElapsed - animChina.camStart) / camDuration, 1);
        const eased = easeInOutCubic(t);
        
        camera.position.lerpVectors(CAMERA_CHINA_START, CAMERA_CHINA_FINAL, eased);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();

        if (stateElapsed >= animChina.camEnd) {
          currentState = STATE.CHINA_ACTIVE;
          controls.enabled = true;
          chinaOutlineDrawing.setVisible(false);
        }
      } else {
        camera.position.copy(CAMERA_CHINA_START);
        camera.lookAt(0, 0, 0);
      }
    } 
    else if (currentState === STATE.CHINA_ACTIVE) {
      controls.update();
      
      // Update China flowing lights continuously
      chinaFlowingLights.update(time);
      
      // Update China ripple and neighbors continuously
      if (chinaRipple) {
        chinaRipple.setVisible(true);
        chinaRipple.update(stateElapsed, 1000, 8000, true);
      }
      if (chinaNeighbors) {
        chinaNeighbors.setVisible(true);
        chinaNeighbors.setOpacity(1.0);
      }
      
      // Update raycaster for hovering
      if (mouseMoved) {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(chinaMap.mapGroup.children, true);
        updateHover(intersects);
      }
    } 
    else if (currentState === STATE.PROVINCE_LOADING) {
      // ─── Concurrent Zoom-in, Fade-out (Parent) & Fade-in (Child) Transition ───
      const duration = 1000;
      const progress = Math.min(stateElapsed / duration, 1);
      const eased = easeInOutCubic(progress);

      // Smoothly glide camera from click position to CAMERA_PROV_FINAL
      camera.position.lerpVectors(clickStartCamPos, CAMERA_PROV_FINAL, eased);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();

      // Fade out Parent map
      setParentMapOpacity(1 - eased);

      // If sub-map data is loaded, build and scale it concurrently
      if (provinceLoaded) {
        if (!provinceBuilt) {
          buildProvinceMapInScene();
          provBuiltTime = performance.now();
        }

        const provElapsed = time - provBuiltTime;
        const provDuration = 800; // 800ms for sub-map grow and fade-in
        const provProgress = Math.min(provElapsed / provDuration, 1);
        const provEased = easeInOutCubic(provProgress);

        // Interpolate scale and position concurrently from parent coordinates to screen center
        const parentScale = (mapStack.length > 0) ? mapStack[mapStack.length - 1].scale : chinaMap.scale;
        const relativeScale = parentScale / activeProvinceMap.scale;
        const provScaleVal = relativeScale + provEased * (1.0 - relativeScale);
        const currentPos = new THREE.Vector3().lerpVectors(clickTarget3D, new THREE.Vector3(0, 0, 0), provEased);

        if (activeProvinceMap.mapGroup) {
          activeProvinceMap.mapGroup.position.copy(currentPos);
          
          activeProvinceMap.outlineGroup.position.copy(currentPos);
          activeProvinceMap.outlineGroup.position.y += (activeProvinceMap.extrudeDepth + 0.01) * provEased;
          
          activeProvinceMap.topEdges.position.copy(currentPos);
          activeProvinceMap.topEdges.position.y += (activeProvinceMap.extrudeDepth + 0.015) * provEased;
          
          activeProvinceMap.flowingLights.group.position.copy(currentPos);
          activeProvinceMap.labels.group.position.copy(currentPos);
          activeProvinceMap.neighbors.group.position.copy(currentPos);

          activeProvinceMap.mapGroup.scale.set(provScaleVal, provScaleVal, provScaleVal);
          activeProvinceMap.outlineGroup.scale.set(provScaleVal, provScaleVal, provScaleVal);
          activeProvinceMap.topEdges.scale.set(provScaleVal, provScaleVal, provScaleVal);
        }
        if (activeProvinceMap.flowingLights && activeProvinceMap.flowingLights.group) {
          activeProvinceMap.flowingLights.group.scale.set(provScaleVal, provScaleVal, provScaleVal);
        }
        if (activeProvinceMap.labels && activeProvinceMap.labels.group) {
          activeProvinceMap.labels.group.scale.set(provScaleVal, provScaleVal, provScaleVal);
        }
        if (activeProvinceMap.neighbors && activeProvinceMap.neighbors.group) {
          activeProvinceMap.neighbors.group.scale.set(provScaleVal, provScaleVal, provScaleVal);
        }

        setProvinceMapOpacity(provEased);

        // Update flowing lights and ripple
        activeProvinceMap.flowingLights.update(time);
        if (activeProvinceMap.ripple) {
          activeProvinceMap.ripple.update(provElapsed, animProv.rippleStart, animProv.rippleDuration);
        }
      }

      if (progress >= 1) {
        if (provinceLoaded && provinceBuilt && (time - provBuiltTime >= 800)) {
          // Transition to active province state
          currentState = STATE.PROVINCE_ACTIVE;
          controls.enabled = true;

          // Set active province map elements exactly to center (0,0,0) and scale 1.0
          if (activeProvinceMap.mapGroup) {
            activeProvinceMap.mapGroup.position.set(0, 0, 0);
            activeProvinceMap.outlineGroup.position.set(0, activeProvinceMap.extrudeDepth + 0.01, 0);
            activeProvinceMap.topEdges.position.set(0, activeProvinceMap.extrudeDepth + 0.015, 0);
            activeProvinceMap.flowingLights.group.position.set(0, 0, 0);
            activeProvinceMap.labels.group.position.set(0, 0, 0);
            activeProvinceMap.neighbors.group.position.set(0, 0, 0);

            activeProvinceMap.mapGroup.scale.set(1.0, 1.0, 1.0);
            activeProvinceMap.outlineGroup.scale.set(1.0, 1.0, 1.0);
            activeProvinceMap.topEdges.scale.set(1.0, 1.0, 1.0);
            activeProvinceMap.flowingLights.group.scale.set(1.0, 1.0, 1.0);
            activeProvinceMap.labels.group.scale.set(1.0, 1.0, 1.0);
            activeProvinceMap.neighbors.group.scale.set(1.0, 1.0, 1.0);
          }

          // Show Back button
          const backBtn = document.getElementById('back-btn');
          backBtn.style.display = 'flex';

          // Hide parent map components completely
          if (mapStack.length > 0) {
            const parent = mapStack[mapStack.length - 1];
            if (parent.mapGroup) parent.mapGroup.visible = false;
            if (parent.outlineGroup) parent.outlineGroup.visible = false;
            if (parent.topEdges) parent.topEdges.visible = false;
            if (parent.flowingLights && parent.flowingLights.group) parent.flowingLights.group.visible = false;
            if (parent.labels && parent.labels.group) parent.labels.group.visible = false;
            if (parent.neighbors) parent.neighbors.setVisible(false);
            if (parent.ripple) parent.ripple.setVisible(false);
          } else {
            if (chinaMap) {
              chinaMap.mapGroup.visible = false;
              chinaMap.outlineGroup.visible = false;
              chinaMap.topEdges.visible = false;
            }
            if (chinaLabels && chinaLabels.group) {
              chinaLabels.group.visible = false;
            }
            if (chinaFlowingLights && chinaFlowingLights.group) {
              chinaFlowingLights.group.visible = false;
            }
            if (chinaNeighbors) chinaNeighbors.setVisible(false);
            if (chinaRipple) chinaRipple.setVisible(false);
          }

          updateBackButtonText();

          document.getElementById('loading-overlay').classList.remove('visible');
        } else {
          // Keep showing loader overlay if network request is slow
          const loadingOverlay = document.getElementById('loading-overlay');
          const loadingText = document.getElementById('loading-text');
          loadingOverlay.classList.add('visible');
          loadingText.innerText = `正在加载 ${PROVINCE_NAME_MAP[loadingProvinceName] || loadingProvinceName} 3D数据...`;
        }
      }
    }
    else if (currentState === STATE.PROVINCE_ACTIVE) {
      controls.update();
      
      // Update flowing lights
      activeProvinceMap.flowingLights.update(time);
      
      // Update breathing outline
      const breathe = 0.35 + 0.10 * Math.sin(time * 0.002);
      activeProvinceMap.outlineGroup.children.forEach(line => {
        line.material.opacity = breathe;
      });
      
      // Update ripples
      if (activeProvinceMap.ripple) {
        activeProvinceMap.ripple.update(stateElapsed, animProv.rippleStart, animProv.rippleDuration, true);
      }

      // Update raycaster for hovering in active sub-map
      if (mouseMoved) {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(activeProvinceMap.mapGroup.children, true);
        updateHover(intersects);
      }
    } 
    else if (currentState === STATE.TRANSITION_TO_CHINA) {
      // Fade out sub-map, fade in parent, glide camera back to parent view
      const t = Math.min(stateElapsed / 1500, 1);
      const eased = easeInOutCubic(t);
      
      camera.position.lerpVectors(camBackStartPos, camBackTargetPos, eased);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();
      
      // Slide and scale active sub-map back to its slot on the parent map
      if (activeProvinceMap.mapGroup) {
        const parentScale = poppedParent ? poppedParent.scale : chinaMap.scale;
        const relativeScale = parentScale / activeProvinceMap.scale;
        const provScaleVal = 1.0 - eased * (1.0 - relativeScale);
        const currentPos = new THREE.Vector3().lerpVectors(new THREE.Vector3(0, 0, 0), clickTarget3D, eased);

        activeProvinceMap.mapGroup.position.copy(currentPos);
        
        activeProvinceMap.outlineGroup.position.copy(currentPos);
        activeProvinceMap.outlineGroup.position.y += (activeProvinceMap.extrudeDepth + 0.01) * (1.0 - eased);
        
        activeProvinceMap.topEdges.position.copy(currentPos);
        activeProvinceMap.topEdges.position.y += (activeProvinceMap.extrudeDepth + 0.015) * (1.0 - eased);
        
        activeProvinceMap.flowingLights.group.position.copy(currentPos);
        activeProvinceMap.labels.group.position.copy(currentPos);
        activeProvinceMap.neighbors.group.position.copy(currentPos);

        activeProvinceMap.mapGroup.scale.set(provScaleVal, provScaleVal, provScaleVal);
        activeProvinceMap.outlineGroup.scale.set(provScaleVal, provScaleVal, provScaleVal);
        activeProvinceMap.topEdges.scale.set(provScaleVal, provScaleVal, provScaleVal);
        activeProvinceMap.flowingLights.group.scale.set(provScaleVal, provScaleVal, provScaleVal);
        activeProvinceMap.labels.group.scale.set(provScaleVal, provScaleVal, provScaleVal);
        activeProvinceMap.neighbors.group.scale.set(provScaleVal, provScaleVal, provScaleVal);
      }
      
      // Fade out active sub-map components sequentially (0 to 500ms)
      const fadeOutProgress = Math.min(stateElapsed / 500, 1);
      setProvinceMapOpacity(1 - fadeOutProgress);

      if (stateElapsed >= 500) {
        // Hide sub-map components completely so they don't overlap with parent map
        if (activeProvinceMap.mapGroup) activeProvinceMap.mapGroup.visible = false;
        if (activeProvinceMap.outlineGroup) activeProvinceMap.outlineGroup.visible = false;
        if (activeProvinceMap.topEdges) activeProvinceMap.topEdges.visible = false;
        if (activeProvinceMap.flowingLights && activeProvinceMap.flowingLights.group) activeProvinceMap.flowingLights.group.visible = false;
        if (activeProvinceMap.labels && activeProvinceMap.labels.group) activeProvinceMap.labels.group.visible = false;
        if (activeProvinceMap.neighbors) activeProvinceMap.neighbors.setVisible(false);
        if (activeProvinceMap.ripple) activeProvinceMap.ripple.setVisible(false);

        // Fade in parent map components (500 to 1500ms)
        if (poppedParent) {
          if (poppedParent.mapGroup) poppedParent.mapGroup.visible = true;
          if (poppedParent.outlineGroup) poppedParent.outlineGroup.visible = true;
          if (poppedParent.topEdges) poppedParent.topEdges.visible = true;
          if (poppedParent.flowingLights && poppedParent.flowingLights.group) poppedParent.flowingLights.group.visible = true;
          if (poppedParent.labels && poppedParent.labels.group) poppedParent.labels.group.visible = true;
          if (poppedParent.neighbors) poppedParent.neighbors.setVisible(true);
          if (poppedParent.ripple) poppedParent.ripple.setVisible(true);
          
          const fadeInProgress = Math.min((stateElapsed - 500) / 1000, 1);
          setMapOpacityDirect(poppedParent, fadeInProgress);
          
          if (poppedParent.ripple) {
            poppedParent.ripple.update(stateElapsed - 500, 0, 8000, true);
          }
        } else {
          chinaMap.mapGroup.visible = true;
          chinaMap.outlineGroup.visible = true;
          chinaMap.topEdges.visible = true;
          chinaLabels.group.visible = true;
          chinaFlowingLights.group.visible = true;
          if (chinaNeighbors) chinaNeighbors.setVisible(true);
          if (chinaRipple) chinaRipple.setVisible(true);
          
          const fadeInProgress = Math.min((stateElapsed - 500) / 1000, 1);
          setChinaMapOpacity(fadeInProgress);

          if (chinaRipple) {
            chinaRipple.update(stateElapsed - 500, 0, 8000, true);
          }
        }
      }
      
      if (t >= 1) {
        if (poppedParent) {
          currentState = STATE.PROVINCE_ACTIVE;
          
          // Dispose the sub-map that we just exited
          disposeActiveProvince();
          
          activeProvinceMap = poppedParent;
          poppedParent = null;
          
          setProvinceMapOpacity(1.0);
          
          controls.enabled = true;
          stateStartTime = performance.now();
          updateBackButtonText();
          document.getElementById('back-btn').style.display = 'flex';
        } else {
          currentState = STATE.CHINA_ACTIVE;
          controls.enabled = true;
          stateStartTime = performance.now(); // reset clock for ripple loop
          
          // Delay disposal of active province elements to prevent micro-stutter at animation end
          setTimeout(() => {
            disposeActiveProvince();
          }, 50);
        }
      }
    }

    background.update(time);
    composer.render();
  }

  requestAnimationFrame(animate);
}

// ─── Easing Functions ───
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Window Event Listeners ───
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('mousemove', (event) => {
  mouseMoved = true;
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  
  // Position tooltip
  tooltip.style.left = (event.clientX + 15) + 'px';
  tooltip.style.top = (event.clientY + 15) + 'px';
});

// Click logic with drag threshold to ignore camera rotations
let isDragging = false;
let mouseDownPos = { x: 0, y: 0 };

window.addEventListener('mousedown', (e) => {
  isDragging = false;
  mouseDownPos.x = e.clientX;
  mouseDownPos.y = e.clientY;
});

window.addEventListener('mouseup', (e) => {
  const dx = e.clientX - mouseDownPos.x;
  const dy = e.clientY - mouseDownPos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 5) {
    isDragging = true;
  }
});

window.addEventListener('click', () => {
  if (isDragging) return;
  
  if (currentState === STATE.CHINA_ACTIVE && hoveredProvinceName) {
    const clickedName = hoveredProvinceName;
    const provinceFeature = chinaDataGlobal.features.find(f => f.properties.name === clickedName);
    if (provinceFeature) {
      const id = provinceFeature.properties.id;
      loadProvinceMap(clickedName, id);
    }
  } else if (currentState === STATE.PROVINCE_ACTIVE && hoveredProvinceName && mapStack.length === 0) {
    const clickedName = hoveredProvinceName;
    const cityFeature = activeProvinceMap.geoData.features.find(f => f.properties.name === clickedName);
    if (cityFeature) {
      const adcode = cityFeature.properties.adcode;
      loadProvinceMap(clickedName, adcode);
    }
  }
});

document.getElementById('back-btn').addEventListener('click', () => {
  if (currentState === STATE.PROVINCE_ACTIVE) {
    mouseMoved = false; // Reset hover flag so we don't auto-select on return
    camBackStartPos.copy(camera.position);
    
    if (mapStack.length > 0) {
      poppedParent = mapStack.pop();
      camBackTargetPos.copy(CAMERA_PROV_FINAL);
      
      // Determine the slot (clickTarget3D) of the sub-map on the parent map
      let parentCenter = poppedParent.center;
      let parentScale = poppedParent.scale;
      let parentFeatures = poppedParent.geoData.features;
      
      const clickedFeature = parentFeatures.find(f => f && f.properties && f.properties.name === activeProvinceMap.name);
      let targetX = 0;
      let targetZ = 0;
      if (clickedFeature) {
        let centroid = clickedFeature.properties.centroid || clickedFeature.properties.center || (clickedFeature.properties.longitude ? [clickedFeature.properties.longitude, clickedFeature.properties.latitude] : null);
        if (!centroid || typeof centroid[0] !== 'number' || typeof centroid[1] !== 'number') {
          centroid = getGeometryCenter(clickedFeature);
        }
        targetX = (centroid[0] - parentCenter[0]) * parentScale;
        targetZ = -(centroid[1] - parentCenter[1]) * parentScale;
      }
      clickTarget3D.set(targetX, 0, targetZ);
    } else {
      poppedParent = null;
      camBackTargetPos.copy(CAMERA_CHINA_FINAL);
      
      // Determine the slot on China map
      const clickedFeature = chinaDataGlobal.features.find(f => f && f.properties && f.properties.name === activeProvinceMap.name);
      let targetX = 0;
      let targetZ = 0;
      if (clickedFeature) {
        let centroid = clickedFeature.properties.centroid || clickedFeature.properties.center || (clickedFeature.properties.longitude ? [clickedFeature.properties.longitude, clickedFeature.properties.latitude] : null);
        if (!centroid || typeof centroid[0] !== 'number' || typeof centroid[1] !== 'number') {
          centroid = getGeometryCenter(clickedFeature);
        }
        targetX = (centroid[0] - chinaMap.center[0]) * chinaMap.scale;
        targetZ = -(centroid[1] - chinaMap.center[1]) * chinaMap.scale;
      }
      clickTarget3D.set(targetX, 0, targetZ);
    }

    currentState = STATE.TRANSITION_TO_CHINA;
    stateStartTime = performance.now();
    document.getElementById('back-btn').style.display = 'none';
    controls.enabled = false;
  }
});

function updateBackButtonText() {
  const backBtn = document.getElementById('back-btn');
  if (!backBtn) return;
  
  let labelText = '返回中国地图';
  if (mapStack.length > 0) {
    const parentName = mapStack[mapStack.length - 1].name;
    const parentChineseName = PROVINCE_NAME_MAP[parentName] || parentName;
    labelText = `返回${parentChineseName}地图`;
  }
  
  backBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: -2px;">
      <line x1="19" y1="12" x2="5" y2="12"></line>
      <polyline points="12 19 5 12 12 5"></polyline>
    </svg>
    ${labelText}
  `;
}

init();
