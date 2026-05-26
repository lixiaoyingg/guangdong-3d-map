import * as THREE from 'three';
import { computeCenterAndScale } from './geoUtils.js';

const EXTRUDE_DEPTH = 0.35;

/**
 * Create city name labels as sprites above each city region
 * Uses a dimmer color to avoid Bloom over-exposure
 */
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

export function createLabels(geoData, scene, camera, isChina = false) {
  const { center, scale } = computeCenterAndScale(geoData);
  const group = new THREE.Group();

  geoData.features.forEach(feature => {
    if (!feature || !feature.properties) return;
    let { name, centroid, center: cityCenter, longitude, latitude } = feature.properties;
    if (!name) return;

    if (isChina && PROVINCE_NAME_MAP[name]) {
      name = PROVINCE_NAME_MAP[name];
    }

    const coord = centroid || cityCenter || (longitude && latitude ? [longitude, latitude] : null);
    if (!coord) return;

    const x = (coord[0] - center[0]) * scale;
    const z = -(coord[1] - center[1]) * scale;

    // Create text canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = isChina ? 28 : 36;
    canvas.width = 256;
    canvas.height = 64;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Subtle text glow - keep dim to avoid bloom overexposure
    ctx.shadowColor = 'rgba(0, 170, 255, 0.4)';
    ctx.shadowBlur = 4;
    // Use a dimmer color so bloom doesn't blow it out
    ctx.fillStyle = isChina ? 'rgba(220, 240, 255, 0.9)' : 'rgba(200, 230, 255, 0.85)';
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
