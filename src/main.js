/* GLB 角色动画播放器 —— Three.js 实现
 * 结构：人物 GLB（可自带动画） + 独立动作 GLB（提取 AnimationClip，按骨骼名重定向）
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* ============================================================
 * 0. 工具与全局状态
 * ========================================================== */
const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp;
const fmtTime = (s) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
};
const fmtCount = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

const state = {
  modelId: 0,
  modelName: '内置演示角色',
  isDemo: true,
  modelRoot: null,
  mixer: null,
  actions: [],
  clipSources: [],
  currentIndex: -1,
  playing: true,
  speed: 1,
  loop: true,
  pingpong: false,
  scale: 1,
  fitScale: 1,
  rotateSpeed: 1,
  autoRotate: false,
  shadows: true,
  showSkeleton: false,
  wireframe: false,
  showGround: true,
  showGrid: true,
  showBox: false,
  bg: 'dark',
  ignoreRootMotion: true,
  crossfade: true,
  seeking: false,
  light: 1,
};

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 4600 : 3200);
}
const showLoading = (text) => { $('loadingText').textContent = text || '正在解析模型…'; $('loading').classList.remove('hidden'); };
const hideLoading = () => $('loading').classList.add('hidden');

/* ============================================================
 * 1. 渲染器 / 场景 / 相机 / 控制器
 * ========================================================== */
const canvas = $('scene');
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b111b, 7, 22);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 120);
camera.position.set(2.55, 1.85, 4.15);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.target.set(0, 0.9, 0);
controls.minDistance = 0.9;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.92;
controls.enablePan = true;

const hemi = new THREE.HemisphereLight(0xc9e2ff, 0x1b2433, 1.25);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
keyLight.position.set(3.2, 6, 4.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 22;
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -2;
keyLight.shadow.bias = -0.0006;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x78b8ff, 0.85);
fillLight.position.set(-4, 2.5, -3.5);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(0x62f0d8, 0.7);
rimLight.position.set(0, 3, -5);
scene.add(rimLight);

/* 舞台：地面 + 网格 + 光晕 + 角色容器 */
function makeFadeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#e8e8e8');
  g.addColorStop(0.72, '#5a5a5a');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x13202e, roughness: 0.92, metalness: 0.05,
  transparent: true, opacity: 0.9, alphaMap: makeFadeTexture(), depthWrite: false,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.006;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(24, 48, 0x5e8ba0, 0x284052);
grid.position.y = 0.001;
grid.material.transparent = true;
grid.material.opacity = 0.32;
grid.material.depthWrite = false;
scene.add(grid);

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 6, 128, 128, 128);
  g.addColorStop(0, 'rgba(90,225,210,0.42)');
  g.addColorStop(0.42, 'rgba(70,160,220,0.14)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glow = new THREE.Mesh(
  new THREE.PlaneGeometry(4.2, 4.2),
  new THREE.MeshBasicMaterial({ map: makeGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
);
glow.rotation.x = -Math.PI / 2;
glow.position.y = 0.004;
scene.add(glow);

const characterPivot = new THREE.Group();
characterPivot.name = 'CharacterPivot';
scene.add(characterPivot);
let content = null;

let skeletonHelper = null;
const boxForHelper = new THREE.Box3();
const boxHelper = new THREE.Box3Helper(boxForHelper, 0x42e0c8);
boxHelper.material.transparent = true;
boxHelper.material.opacity = 0.65;
boxHelper.visible = false;
scene.add(boxHelper);

const bgThemes = {
  dark:     { ground: 0x13202e, gridOpacity: 0.32, glow: 1,    shot: 0x0b111b },
  light:    { ground: 0xd9e2ed, gridOpacity: 0.42, glow: 0.35, shot: 0xe7edf5 },
  gradient: { ground: 0x1a2148, gridOpacity: 0.3,  glow: 1,    shot: 0x141c38 },
  studio:   { ground: 0x3a3630, gridOpacity: 0.26, glow: 0.8,  shot: 0x2a2825 },
};
function applyBackground() {
  viewport.dataset.bg = state.bg;
  const t = bgThemes[state.bg] || bgThemes.dark;
  groundMat.color.setHex(t.ground);
  scene.fog.color.setHex(t.shot);
  grid.material.opacity = t.gridOpacity;
  glow.material.opacity = t.glow;
  hemi.intensity = 1.25 * state.light * (state.bg === 'light' ? 1.15 : 1);
  renderer.toneMappingExposure = 1.05 * state.light;
}

/* GLTF 加载器 */
const loader = new GLTFLoader();
try {
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  loader.setDRACOLoader(draco);
} catch (e) { /* Draco 为可选增强 */ }

/* ============================================================
 * 2. 内置演示角色（骨骼层级 + 程序化动画）
 * ========================================================== */
function createDemoCharacter() {
  const root = new THREE.Group();
  root.name = 'DemoCharacter';
  const bones = {};

  const shell = new THREE.MeshStandardMaterial({ color: 0xdde7f2, roughness: 0.42, metalness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x283346, roughness: 0.6, metalness: 0.4 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x141c28, roughness: 0.75, metalness: 0.2 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x3ee0c4, emissive: 0x0d6f63, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2b3e, roughness: 0.15, metalness: 0.7 });

  function bone(name, parent, x, y, z) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    (parent || root).add(b);
    bones[name] = b;
    return b;
  }
  function mesh(parent, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);
  const ball = (r) => new THREE.SphereGeometry(r, 18, 14);

  const hips = bone('Hips', null, 0, 1.02, 0);
  const spine = bone('Spine', hips, 0, 0.17, 0);
  const spine1 = bone('Spine1', spine, 0, 0.22, 0);
  const spine2 = bone('Spine2', spine1, 0, 0.22, 0);
  const neck = bone('Neck', spine2, 0, 0.16, 0);
  const head = bone('Head', neck, 0, 0.1, 0);

  const sides = [
    { s: 'Left', sign: -1 },
    { s: 'Right', sign: 1 },
  ];
  for (const { s, sign } of sides) {
    const sh = bone(s + 'Shoulder', spine2, 0.15 * sign, 0.1, 0);
    const arm = bone(s + 'Arm', sh, 0.1 * sign, -0.03, 0);
    const fore = bone(s + 'ForeArm', arm, 0, -0.28, 0);
    const hand = bone(s + 'Hand', fore, 0, -0.25, 0);
    const upLeg = bone(s + 'UpLeg', hips, 0.11 * sign, -0.1, 0);
    const leg = bone(s + 'Leg', upLeg, 0, -0.42, 0);
    const foot = bone(s + 'Foot', leg, 0, -0.4, 0);

    mesh(sh, ball(0.075), joint);
    mesh(arm, cap(0.072, 0.2), shell, 0, -0.14, 0);
    mesh(arm, ball(0.076), dark, 0, -0.28, 0);
    mesh(fore, cap(0.06, 0.18), shell, 0, -0.13, 0);
    mesh(hand, ball(0.068), dark, 0, -0.035, 0);
    mesh(upLeg, cap(0.093, 0.28), shell, 0, -0.21, 0);
    mesh(leg, ball(0.079), joint, 0, -0.42, 0);
    mesh(leg, cap(0.072, 0.28), dark, 0, -0.2, 0);
    mesh(foot, new THREE.BoxGeometry(0.16, 0.09, 0.27), dark, 0, -0.035, 0.06);
    mesh(foot, new THREE.BoxGeometry(0.165, 0.018, 0.05), accent, 0, -0.075, 0.17);
  }

  mesh(hips, cap(0.13, 0.08), dark, 0, -0.02, 0);
  mesh(spine, cap(0.155, 0.26), shell, 0, 0.19, 0);
  mesh(spine1, new THREE.BoxGeometry(0.3, 0.035, 0.2), dark, 0, 0.05, 0);
  mesh(spine2, ball(0.07), accent, 0, 0.07, 0.14);
  mesh(spine2, new THREE.TorusGeometry(0.062, 0.014, 8, 22), accent, 0, 0.07, 0.16);
  mesh(neck, cap(0.048, 0.06), joint, 0, 0.03, 0);
  mesh(head, ball(0.155), glass, 0, 0.12, 0);
  mesh(head, new THREE.BoxGeometry(0.19, 0.055, 0.035), accent, 0, 0.135, 0.138);
  mesh(head, ball(0.022), shell, -0.065, 0.135, 0.15);
  mesh(head, ball(0.022), shell, 0.065, 0.135, 0.15);
  mesh(head, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), dark, 0, 0.29, 0);
  mesh(head, ball(0.032), accent, 0, 0.36, 0);

  /* --- 动画生成 ------------------------------------------------ */
  const CH = [
    'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
  ];
  const basePos = { Hips: hips.position.clone() };

  function newPose() {
    const p = {};
    for (const n of CH) p[n] = { rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0 };
    return p;
  }
  const PI2 = Math.PI * 2;
  const anims = [
    {
      name: '待机 Idle', duration: 3.2,
      fn: (t, d, p) => {
        const a = PI2 * t / d;
        p.Hips.py = 0.012 * Math.sin(a * 2);
        p.Hips.ry = 0.035 * Math.sin(a);
        p.Spine.rx = 0.022 * Math.sin(a);
        p.Spine1.ry = 0.03 * Math.sin(a + 0.6);
        p.Spine2.rx = 0.028 * Math.sin(a + 1.2);
        p.Head.ry = 0.13 * Math.sin(a * 0.5);
        p.Head.rx = 0.04 * Math.sin(a + 0.4);
        p.LeftArm.rz = -0.08 - 0.035 * Math.sin(a);
        p.RightArm.rz = 0.08 + 0.035 * Math.sin(a);
        p.LeftForeArm.rx = -0.12 - 0.05 * Math.sin(a + 1);
        p.RightForeArm.rx = -0.12 - 0.05 * Math.sin(a + 1);
      },
    },
    {
      name: '行走 Walk', duration: 1.2,
      fn: (t, d, p) => {
        const a = PI2 * t / d;
        const s = Math.sin(a);
        p.LeftUpLeg.rx = 0.52 * s;
        p.RightUpLeg.rx = -0.52 * s;
        p.LeftLeg.rx = 0.34 * Math.max(0, -s) + 0.05;
        p.RightLeg.rx = 0.34 * Math.max(0, s) + 0.05;
        p.LeftFoot.rx = -0.2 * Math.max(0, s);
        p.RightFoot.rx = -0.2 * Math.max(0, -s);
        p.LeftArm.rz = -0.1;
        p.RightArm.rz = 0.1;
        p.LeftArm.rx = -0.38 * s;
        p.RightArm.rx = 0.38 * s;
        p.LeftForeArm.rx = -0.22;
        p.RightForeArm.rx = -0.22;
        p.Spine1.ry = -0.09 * s;
        p.Spine2.ry = 0.06 * s;
        p.Hips.py = 0.03 * Math.abs(Math.sin(a * 2));
        p.Hips.ry = 0.05 * s;
      },
    },
    {
      name: '奔跑 Run', duration: 0.78,
      fn: (t, d, p) => {
        const a = PI2 * t / d;
        const s = Math.sin(a);
        p.Hips.rx = 0.16;
        p.Spine.rx = -0.06;
        p.LeftUpLeg.rx = 0.95 * s;
        p.RightUpLeg.rx = -0.95 * s;
        p.LeftLeg.rx = 0.75 * Math.max(0, -s) + 0.12;
        p.RightLeg.rx = 0.75 * Math.max(0, s) + 0.12;
        p.LeftArm.rz = -0.16;
        p.RightArm.rz = 0.16;
        p.LeftArm.rx = -0.95 * s - 0.2;
        p.RightArm.rx = 0.95 * s - 0.2;
        p.LeftForeArm.rx = -1.05;
        p.RightForeArm.rx = -1.05;
        p.Spine1.ry = -0.14 * s;
        p.Hips.py = 0.07 * Math.abs(Math.sin(a * 2));
        p.Head.rx = -0.08;
      },
    },
    {
      name: '挥手 Wave', duration: 2.4,
      fn: (t, d, p) => {
        const a = PI2 * t / d;
        const lift = Math.min(1, t / 0.35) * Math.min(1, Math.max(0, (d - t) / 0.35));
        p.RightArm.rz = 2.05 * lift;
        p.RightArm.rx = -0.18 * lift;
        p.RightForeArm.rz = 0.5 + 0.55 * Math.sin(a * 3) * lift;
        p.LeftArm.rz = -0.09;
        p.Head.ry = -0.16 * lift;
        p.Spine1.ry = 0.05 * Math.sin(a);
        p.Hips.py = 0.01 * Math.sin(a * 2);
      },
    },
    {
      name: '舞蹈 Dance', duration: 2.0,
      fn: (t, d, p) => {
        const a = PI2 * t / d;
        const s = Math.sin(a);
        p.Hips.py = 0.07 * Math.max(0, Math.sin(a * 2));
        p.Hips.ry = 0.32 * s;
        p.Hips.rz = 0.09 * Math.sin(a * 2);
        p.Spine.rz = -0.14 * s;
        p.Spine1.ry = 0.26 * s;
        p.Spine2.rx = 0.12 * Math.sin(a * 2);
        p.Head.rz = -0.16 * s;
        p.Head.ry = 0.2 * Math.sin(a * 2);
        p.LeftArm.rz = -1.25 - 0.9 * Math.max(0, s);
        p.RightArm.rz = 1.25 + 0.9 * Math.max(0, -s);
        p.LeftForeArm.rx = -0.55 * s;
        p.RightForeArm.rx = 0.55 * s;
        p.LeftUpLeg.rx = 0.32 * s;
        p.RightUpLeg.rx = -0.32 * s;
        p.LeftLeg.rx = 0.24 * Math.max(0, -s);
        p.RightLeg.rx = 0.24 * Math.max(0, s);
      },
    },
    {
      name: '跳跃 Jump', duration: 1.25,
      fn: (t, d, p) => {
        const x = t / d;
        let h = 0, crouch = 0, air = 0;
        if (x < 0.2) crouch = Math.sin(x / 0.2 * Math.PI / 2);
        else if (x < 0.72) { const u = (x - 0.2) / 0.52; h = 4 * u * (1 - u) * 0.62; air = Math.sin(u * Math.PI); }
        else crouch = Math.sin((1 - x) / 0.28 * Math.PI / 2) * 0.6;
        p.Hips.py = h - 0.14 * crouch;
        p.Spine.rx = 0.22 * crouch - 0.1 * air;
        p.LeftUpLeg.rx = 0.5 * crouch + 0.45 * air;
        p.RightUpLeg.rx = 0.5 * crouch + 0.45 * air;
        p.LeftLeg.rx = -0.85 * crouch - 0.7 * air;
        p.RightLeg.rx = -0.85 * crouch - 0.7 * air;
        p.LeftFoot.rx = 0.3 * crouch;
        p.RightFoot.rx = 0.3 * crouch;
        p.LeftArm.rz = -0.2 - 2.1 * air - 0.3 * crouch;
        p.RightArm.rz = 0.2 + 2.1 * air + 0.3 * crouch;
        p.LeftForeArm.rx = -0.2 - 0.3 * air;
        p.RightForeArm.rx = -0.2 - 0.3 * air;
      },
    },
  ];

  const clips = anims.map(({ name, duration, fn }) => {
    const fps = 30;
    const n = Math.round(duration * fps) + 1;
    const times = new Float32Array(n);
    const qValues = {}, pValues = {};
    for (const c of CH) qValues[c] = new Float32Array(n * 4);
    pValues.Hips = new Float32Array(n * 3);

    const pose = newPose();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const t = Math.min(i / fps, duration);
      times[i] = t;
      for (const c of CH) { const v = pose[c]; v.rx = v.ry = v.rz = v.px = v.py = v.pz = 0; }
      fn(t, duration, pose);
      for (let j = 0; j < CH.length; j++) {
        const c = CH[j], v = pose[c];
        e.set(v.rx, v.ry, v.rz, 'XYZ');
        q.setFromEuler(e);
        qValues[c][i * 4] = q.x; qValues[c][i * 4 + 1] = q.y;
        qValues[c][i * 4 + 2] = q.z; qValues[c][i * 4 + 3] = q.w;
      }
      const hp = pose.Hips;
      pValues.Hips[i * 3] = basePos.Hips.x + hp.px;
      pValues.Hips[i * 3 + 1] = basePos.Hips.y + hp.py;
      pValues.Hips[i * 3 + 2] = basePos.Hips.z + hp.pz;
    }
    const tracks = CH.map((c) => new THREE.QuaternionKeyframeTrack(`${bones[c].name}.quaternion`, times, qValues[c]));
    tracks.push(new THREE.VectorKeyframeTrack(`${bones.Hips.name}.position`, times, pValues.Hips));
    return new THREE.AnimationClip(name, duration, tracks);
  });

  return { root, clips };
}

/* ============================================================
 * 3. 模型装载 / 归一化 / 清理
 * ========================================================== */
function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      for (const k in m) {
        const v = m[k];
        if (v && v.isTexture) v.dispose();
      }
      m.dispose();
    }
  });
}

function clearCharacter() {
  if (state.mixer) { state.mixer.stopAllAction(); state.mixer = null; }
  if (skeletonHelper) { scene.remove(skeletonHelper); skeletonHelper.geometry.dispose(); skeletonHelper.material.dispose(); skeletonHelper = null; }
  if (content) {
    characterPivot.remove(content);
    disposeObject(content);
    content = null;
  }
  state.modelRoot = null;
  state.actions = [];
  state.currentIndex = -1;
}

function fitCharacter() {
  characterPivot.scale.setScalar(1);
  content.position.set(0, 0, 0);
  characterPivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(content);
  if (box.isEmpty()) { state.fitScale = 1; return; }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, 0.001);
  state.fitScale = 1.75 / h;
  content.position.set(-center.x, -box.min.y, -center.z);
  characterPivot.scale.setScalar(state.fitScale * state.scale);
  controls.target.set(0, 0.88 * state.scale, 0);
  camera.position.set(2.55, 1.85, 4.15);
  controls.update();
}

function prepareModel(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (m) m.wireframe = state.wireframe;
  });
  skeletonHelper = new THREE.SkeletonHelper(characterPivot);
  skeletonHelper.material.transparent = true;
  skeletonHelper.material.opacity = 0.75;
  skeletonHelper.visible = state.showSkeleton;
  scene.add(skeletonHelper);
}

function setModel(gltf, displayName, isDemo = false) {
  clearCharacter();
  state.modelId += 1;
  state.modelName = displayName;
  state.isDemo = isDemo;
  state.clipSources = state.clipSources.filter((s) => !s.native);

  const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!root) throw new Error('该文件中没有可用的场景节点');
  content = new THREE.Group();
  content.name = 'FitContent';
  content.add(root);
  characterPivot.add(content);
  state.modelRoot = root;

  fitCharacter();
  prepareModel(root);
  applyDisplayState();

  state.mixer = new THREE.AnimationMixer(characterPivot);
  state.mixer.timeScale = state.speed;
  state.mixer.addEventListener('finished', () => {
    if (!state.loop && !state.pingpong) { state.playing = false; updatePlayUI(); }
  });

  const clips = gltf.animations || [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    state.clipSources.push({
      clip: c,
      name: c.name || `${displayName.replace(/\.(glb|gltf)$/i, '')} 动画 ${i + 1}`,
      label: displayName,
      native: true,
      owner: state.modelId,
      srcIdx: null,
    });
  }
  rebuildActions();
  playClip(0, { instant: true });
  updateModelUI();
}

function loadDemo() {
  const { root, clips } = createDemoCharacter();
  state.clipSources = [];
  setModel({ scene: root, animations: clips }, '内置演示角色', true);
  $('sourceNote').textContent = '当前：内置程序化角色，含 6 段示例动画。可拖入 GLB 替换为真实模型。';
  toast('已载入内置演示角色，可直接试用全部播放功能');
}

/* ============================================================
 * 4. 骨骼名称匹配与动作重定向
 * ========================================================== */
const CANON = {
  pelvis: 'hips', hip: 'hips', root: 'hips', rootnode: 'hips', cha01: 'hips', bip01: 'hips',
  spine0: 'spine', spine01: 'spine', spinea: 'spine',
  chest: 'spine1', spine02: 'spine1', upperchest: 'spine2', spine03: 'spine2',
  neck1: 'neck', head1: 'head',
  leftthigh: 'leftupleg', leftupperleg: 'leftupleg', uplegl: 'leftupleg', lupperleg: 'leftupleg', lthigh: 'leftupleg',
  rightthigh: 'rightupleg', rightupperleg: 'rightupleg', uplegr: 'rightupleg', rupperleg: 'rightupleg', rthigh: 'rightupleg',
  leftcalf: 'leftleg', leftlowerleg: 'leftleg', leftshin: 'leftleg', lleg: 'leftleg',
  rightcalf: 'rightleg', rightlowerleg: 'rightleg', rightshin: 'rightleg', rleg: 'rightleg',
  lefttoebase: 'leftfoot', lefttoe: 'leftfoot', righttoebase: 'rightfoot', righttoe: 'rightfoot',
  leftupperarm: 'leftarm', leftuparm: 'leftarm', luparm: 'leftarm', lupperarm: 'leftarm', upperarml: 'leftarm',
  rightupperarm: 'rightarm', rightuparm: 'rightarm', ruparm: 'rightarm', rupperarm: 'rightarm', upperarmr: 'rightarm',
  leftlowerarm: 'leftforearm', leftelbow: 'leftforearm', llowerarm: 'leftforearm',
  rightlowerarm: 'rightforearm', rightelbow: 'rightforearm', rlowerarm: 'rightforearm',
  leftcollar: 'leftshoulder', leftclavicle: 'leftshoulder',
  rightcollar: 'rightshoulder', rightclavicle: 'rightshoulder',
};
function normName(n) {
  return String(n || '').toLowerCase()
    .replace(/^mixamorig[:_]?/, '')
    .replace(/^bip\d+/, '')
    .replace(/^armature[|._:\-]?/, '')
    .replace(/^character[|._:\-]?\d*/, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
const canonical = (n) => CANON[n] || n;

function buildNodeIndex(root) {
  const byName = new Map(), byNorm = new Map(), byAlias = new Map(), byId = new Map();
  let bones = 0;
  if (!root) return { byName, byNorm, byAlias, byId, bones };
  root.traverse((o) => {
    if (o.isBone) bones++;
    byId.set(o.uuid, o);
    if (!o.name) return;
    byName.set(o.name.toLowerCase(), o);
    const n = normName(o.name);
    if (!n) return;
    if (!byNorm.has(n)) byNorm.set(n, o);
    const c = canonical(n);
    if (!byAlias.has(c)) byAlias.set(c, o);
  });
  return { byName, byNorm, byAlias, byId, bones };
}

function remapClip(clip, charIdx, srcIdx) {
  let matched = 0, dropped = 0;
  const tracks = [];
  for (const tr of clip.tracks) {
    let parsed;
    try { parsed = THREE.PropertyBinding.parseTrackName(tr.name); } catch (e) { dropped++; continue; }
    if (!parsed || !parsed.propertyName) { dropped++; continue; }

    let srcName = parsed.nodeName || '';
    if (srcIdx && srcIdx.byId.has(srcName)) srcName = srcIdx.byId.get(srcName).name || srcName;
    const n = normName(srcName);
    const c = canonical(n);
    const target = charIdx.byNorm.get(n) || charIdx.byAlias.get(c) || charIdx.byName.get(srcName.toLowerCase());

    if (!target) { dropped++; continue; }
    if (parsed.propertyName === 'position' && state.ignoreRootMotion && /^(hips|pelvis|root)$/.test(c)) { dropped++; continue; }

    const dot = tr.name.lastIndexOf('.');
    const suffix = dot >= 0 ? tr.name.slice(dot) : '.' + parsed.propertyName;
    const nt = tr.clone();
    nt.name = target.uuid + suffix;   // 用 uuid 确保绑定唯一且稳定
    tracks.push(nt);
    matched++;
  }
  if (!tracks.length) return { clip: null, matched, dropped, ratio: 0 };
  const out = new THREE.AnimationClip(clip.name || '动画', clip.duration, tracks);
  return { clip: out, matched, dropped, ratio: matched / (matched + dropped) };
}

function rebuildActions() {
  if (!state.mixer || !state.modelRoot) return;
  state.mixer.stopAllAction();
  const prevName = state.currentIndex >= 0 && state.actions[state.currentIndex] ? state.actions[state.currentIndex].name : null;
  const charIdx = buildNodeIndex(characterPivot);
  const items = [];
  for (const s of state.clipSources) {
    let clip = s.clip, ratio = null;
    if (!s.native || s.owner !== state.modelId) {
      const r = remapClip(s.clip, charIdx, s.srcIdx);
      if (!r.clip) continue;
      clip = r.clip;
      ratio = r.ratio;
    }
    const action = state.mixer.clipAction(clip);
    items.push({ name: s.name, label: s.label, clip, action, ratio, src: s });
  }
  state.actions = items;
  let idx = items.findIndex((i) => i.name === prevName);
  if (idx < 0) idx = 0;
  state.currentIndex = items.length ? idx : -1;
  renderClipList();
  updateMeta();
}

/* ============================================================
 * 5. 文件 / URL 加载
 * ========================================================== */
function parseBuffer(buf, name) {
  return new Promise((resolve, reject) => {
    try {
      loader.parse(buf, '', (g) => resolve(g), (err) => reject(err instanceof Error ? err : new Error(String(err && err.message || err))));
    } catch (e) { reject(e); }
  });
}

function hasVisibleMesh(root) {
  let has = false;
  root && root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) has = true; });
  return has;
}

async function loadModelSource(gltf, name) {
  setModel(gltf, name, false);
  const n = (gltf.animations || []).length;
  toast(`已载入人物模型「${name}」${n ? `，自带 ${n} 段动画` : '（无动画，可添加动作模型）'}`);
}

async function loadClipSource(gltf, name) {
  const clips = gltf.animations || [];
  if (!clips.length) { toast(`「${name}」中未找到动画片段，无法作为动作模型使用`, true); return; }
  const srcRoot = gltf.scene || (gltf.scenes && gltf.scenes[0]);
  const srcIdx = buildNodeIndex(srcRoot);
  const charIdx = buildNodeIndex(characterPivot);
  let matched = 0, total = 0;
  for (const c of clips) {
    const r = remapClip(c, charIdx, srcIdx);
    matched += r.matched;
    total += r.matched + r.dropped;
  }
  const ratio = total ? matched / total : 0;

  if (ratio < 0.25 && hasVisibleMesh(srcRoot)) {
    state.clipSources = [];
    setModel(gltf, name + ' · 独立角色', false);
    $('sourceNote').textContent = `骨骼名称匹配率仅 ${Math.round(ratio * 100)}%，已自动改为直接播放该文件中的角色与动画。`;
    toast(`骨骼名称匹配率仅 ${Math.round(ratio * 100)}%，与当前人物骨架不匹配；\n已改为独立播放「${name}」中的角色与动画。`);
    return;
  }

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    state.clipSources.push({
      clip: c,
      name: c.name || `${name.replace(/\.(glb|gltf)$/i, '')} ${i + 1}`,
      label: name,
      native: false,
      owner: -1,
      srcIdx,
    });
  }
  rebuildActions();
  if (state.currentIndex >= 0) playClip(state.currentIndex, { instant: true });
  $('sourceNote').textContent = `已追加 ${clips.length} 段动作：骨骼匹配率 ${Math.round(ratio * 100)}%（${matched}/${total} 条轨道）`;
  toast(`已从「${name}」追加 ${clips.length} 段动作，骨骼匹配率 ${Math.round(ratio * 100)}%`);
}

async function parseFile(file) {
  showLoading(`正在解析 ${file.name} …`);
  try {
    const buf = await file.arrayBuffer();
    const gltf = await parseBuffer(buf, file.name);
    hideLoading();
    return gltf;
  } catch (e) {
    hideLoading();
    throw new Error(`解析「${file.name}」失败：${e.message || e}。若为 .gltf，请确认外部 .bin / 贴图可访问，或改用 .glb 单文件。`);
  }
}

async function handleFiles(files, role) {
  const list = Array.from(files).filter((f) => /\.(glb|gltf)$/i.test(f.name));
  if (!list.length) { toast('请选择 .glb 或 .gltf 文件', true); return; }
  try {
    if (role === 'model') {
      const gltf = await parseFile(list[0]);
      await loadModelSource(gltf, list[0].name);
      for (let i = 1; i < list.length; i++) {
        const g = await parseFile(list[i]);
        await loadClipSource(g, list[i].name);
      }
    } else {
      for (const f of list) {
        const gltf = await parseFile(f);
        await loadClipSource(gltf, f.name);
      }
    }
  } catch (e) { toast(e.message || String(e), true); hideLoading(); }
}

async function loadFromUrl(url, role, name) {
  if (!/^https?:\/\//i.test(url)) { toast('请填写完整的 http(s) 地址', true); return; }
  showLoading('正在下载模型…');
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const gltf = await parseBuffer(buf, name);
    hideLoading();
    if (role === 'model') await loadModelSource(gltf, name);
    else await loadClipSource(gltf, name);
  } catch (e) {
    hideLoading();
    toast(`加载失败：${e.message || e}\n请检查网络连通性与 CORS 跨域设置（在线示例需联网）`, true);
  }
}

/* ============================================================
 * 6. 播放控制
 * ========================================================== */
function activeItem() { return state.actions[state.currentIndex] || null; }

function applyLoopTo(action) {
  if (!action) return;
  if (state.pingpong) action.setLoop(THREE.LoopPingPong, Infinity);
  else if (state.loop) action.setLoop(THREE.LoopRepeat, Infinity);
  else action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = !state.loop && !state.pingpong;
}

function playClip(index, opts = {}) {
  if (!state.actions.length || !state.mixer) return;
  const i = ((index % state.actions.length) + state.actions.length) % state.actions.length;
  const prev = activeItem() ? state.actions[state.currentIndex].action : null;
  const item = state.actions[i];
  const a = item.action;
  state.currentIndex = i;
  a.reset();
  a.paused = false;
  a.enabled = true;
  a.setEffectiveTimeScale(1);
  a.setEffectiveWeight(1);
  applyLoopTo(a);
  a.play();
  if (prev && prev !== a) {
    if (state.crossfade && !opts.instant) { prev.fadeOut(0.32); a.fadeIn(0.32); }
    else prev.stop();
  }
  state.playing = true;
  renderClipList();
  updateMeta();
  updatePlayUI();
  updateSeekUI();
}

function togglePlay() {
  if (!state.actions.length) return;
  const item = activeItem();
  state.playing = !state.playing;
  if (state.playing && item) {
    // 停止 / 单次播放结束后，动作会停留在暂停或末帧状态，需要恢复
    if (item.action.time >= item.clip.duration - 0.002) playClip(state.currentIndex, { instant: true });
    else item.action.paused = false;
  }
  updatePlayUI();
}
function stopPlayback() {
  const item = activeItem();
  if (!item || !state.mixer) return;
  item.action.stop();
  item.action.reset();
  item.action.play();
  item.action.paused = true;
  state.mixer.update(0);
  state.playing = false;
  updatePlayUI();
  updateSeekUI();
}
function seekTo(ratio) {
  const item = activeItem();
  if (!item || !state.mixer) return;
  item.action.time = clamp(ratio, 0, 1) * item.clip.duration * 0.9999;
  state.mixer.update(0);
  updateSeekUI();
  $('timeLabel').textContent = `${fmtTime(item.action.time)} / ${fmtTime(item.clip.duration)}`;
  $('statTime').textContent = item.action.time.toFixed(2) + ' s';
}

/* 键盘切换片段：暂停时保持暂停，并静态显示新片段的首帧 */
function selectClipByKey(index) {
  if (!state.actions.length) return;
  const wasPlaying = state.playing;
  playClip(index, { instant: !wasPlaying });
  if (!wasPlaying) {
    state.playing = false;
    if (state.mixer) state.mixer.update(0);
    updatePlayUI();
    updateSeekUI();
  }
}

function updatePlayUI() {
  $('playIcon').innerHTML = state.playing
    ? '<path d="M8 5h3v14H8zM14 5h3v14h-3z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  $('btnPlay').title = state.playing ? '暂停 (空格)' : '播放 (空格)';
  $('playState').textContent = state.actions.length ? (state.playing ? '播放中' : '已暂停') : '无动画';
  $('topStat').textContent = state.actions.length
    ? `${state.modelName} · ${state.actions.length} 段动画 · ${state.speed.toFixed(2)}×`
    : `${state.modelName} · 无动画`;
}
function updateMeta() {
  const item = activeItem();
  $('clipTitle').textContent = item ? item.name : '暂无动画片段';
  $('statDuration').textContent = item ? item.clip.duration.toFixed(2) + ' s' : '--';
  $('clipCount').textContent = `${state.actions.length} 段`;
  $('speedHint').textContent = `${state.speed.toFixed(2)}× ${state.speed === 1 ? '实时' : state.speed > 1 ? '加速' : '慢放'}`;
  $('timeLabel').textContent = item
    ? `${fmtTime(item.action.time)} / ${fmtTime(item.clip.duration)}`
    : '00:00 / 00:00';
}
function updateSeekUI() {
  const item = activeItem();
  if (!item || state.seeking) return;
  const r = item.clip.duration ? item.action.time / item.clip.duration : 0;
  $('seek').value = String(Math.round(clamp(r, 0, 1) * 1000));
}

function renderClipList() {
  const box = $('clipList');
  if (!state.actions.length) {
    box.innerHTML = '<div class="clip-empty">暂无动画片段<br>加载人物模型或添加动作模型</div>';
    return;
  }
  const scroll = box.scrollTop;
  box.innerHTML = state.actions.map((it, i) => {
    const meta = `${it.clip.duration.toFixed(2)}s · ${it.label}${it.ratio !== null && it.ratio !== undefined ? ` · 匹配 ${Math.round(it.ratio * 100)}%` : ''}`;
    return `<div class="clip-item ${i === state.currentIndex ? 'active' : ''}" data-i="${i}">
      <span class="clip-idx">${i + 1}</span>
      <div class="clip-main"><b title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</b><span title="${escapeHtml(meta)}">${escapeHtml(meta)}</span></div>
      <button class="clip-del" data-del="${i}" title="移除该片段"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>`;
  }).join('');
  box.scrollTop = scroll;
  // 上下切换片段时，保持当前项在可视区域内
  const active = box.querySelector('.clip-item.active');
  if (active) {
    const br = box.getBoundingClientRect(), ar = active.getBoundingClientRect();
    if (ar.top < br.top) box.scrollTop -= (br.top - ar.top);
    else if (ar.bottom > br.bottom) box.scrollTop += (ar.bottom - br.bottom);
  }
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function updateModelUI() {
  $('modelName').textContent = state.modelName;
  $('assetName').textContent = state.modelName;
  $('emptyHint').classList.toggle('hidden', !!state.modelRoot);
  if (!state.isDemo) $('sourceNote').textContent = `当前角色：${state.modelName}；可继续追加动作模型。`;
  updateStats();
  updatePlayUI();
}

function updateStats() {
  let tris = 0, meshes = 0, bones = 0;
  if (content) {
    content.traverse((o) => {
      if (o.isBone) bones++;
      if (o.isMesh) {
        meshes++;
        const g = o.geometry;
        if (g) {
          const c = g.index ? g.index.count : (g.attributes && g.attributes.position ? g.attributes.position.count : 0);
          tris += Math.floor(c / 3) * (o.isInstancedMesh ? o.count : 1);
        }
      }
    });
  }
  $('statTris').textContent = fmtCount(tris);
  $('statMeshes').textContent = String(meshes);
  $('statBones').textContent = String(bones);
}

/* ============================================================
 * 7. 显示状态 / 视角 / 截图
 * ========================================================== */
function applyDisplayState() {
  keyLight.castShadow = state.shadows;
  ground.visible = state.showGround;
  glow.visible = state.showGround;
  grid.visible = state.showGrid;
  boxHelper.visible = state.showBox;
  if (skeletonHelper) skeletonHelper.visible = state.showSkeleton;
  if (content) {
    content.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && 'wireframe' in m) m.wireframe = state.wireframe;
    });
  }
  applyBackground();
}

function syncToggles() {
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.classList.toggle('active', !!state[b.dataset.toggle]);
  });
}

let camTween = null;
let yawTween = null;
let modelYawTarget = 0;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const ROT_STEP = THREE.MathUtils.degToRad(15);
const VIEWS = {
  iso:    [2.55, 1.85, 4.15],
  front:  [0, 1.45, 4.4],
  back:   [0, 1.45, -4.4],
  left:   [-4.4, 1.45, 0],
  right:  [4.4, 1.45, 0],
  top:    [0, 5.3, 0.02],
};
function moveCamera(view) {
  yawTween = null;
  const p = VIEWS[view] || VIEWS.iso;
  const dist = camera.position.distanceTo(controls.target);
  const base = new THREE.Vector3(p[0], p[1], p[2]).normalize().multiplyScalar(Math.max(3.2, dist));
  if (view === 'iso') base.set(p[0], p[1], p[2]);
  camTween = { from: camera.position.clone(), to: base, start: performance.now(), dur: 550 };
}
controls.addEventListener('start', () => { camTween = null; yawTween = null; });

/* 方向键旋转：默认环绕视角，Shift 组合键旋转模型本体 */
function rotateByKey(dir, spinModel) {
  if (spinModel) {
    modelYawTarget += dir * ROT_STEP;
    return;
  }
  camTween = null;
  const base = yawTween ? yawTween.to.clone() : camera.position.clone();
  const to = base.clone().sub(controls.target).applyAxisAngle(Y_AXIS, dir * ROT_STEP).add(controls.target);
  yawTween = { from: camera.position.clone(), to, start: performance.now(), dur: 220 };
}

function resetView() {
  state.scale = 1;
  $('scaleRange').value = '1';
  $('scaleValue').textContent = '1.00×';
  if (state.fitScale) characterPivot.scale.setScalar(state.fitScale);
  controls.target.set(0, 0.88, 0);
  yawTween = null;
  modelYawTarget = 0;
  characterPivot.rotation.y = 0;
  moveCamera('iso');
  toast('视角、模型朝向与缩放已重置');
}

function takeShot() {
  const t = bgThemes[state.bg] || bgThemes.dark;
  const prev = scene.background;
  scene.background = new THREE.Color(t.shot);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.background = prev;
  const a = document.createElement('a');
  a.href = url;
  a.download = `glb-player-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已导出当前画面 PNG');
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
}
function openHelp() { $('helpModal').classList.remove('hidden'); }
function closeHelp() { $('helpModal').classList.add('hidden'); }
function nudgeTime(dir) {
  const it = activeItem();
  if (it) seekTo((it.action.time + dir * it.clip.duration * 0.05) / it.clip.duration);
}

/* ============================================================
 * 8. UI 事件绑定
 * ========================================================== */
function initUI() {
  // 文件选择
  $('btnPickModel').onclick = () => $('fileModel').click();
  $('btnPickClips').onclick = () => $('fileClips').click();
  $('fileModel').onchange = (e) => { if (e.target.files.length) handleFiles(e.target.files, 'model'); e.target.value = ''; };
  $('fileClips').onchange = (e) => { if (e.target.files.length) handleFiles(e.target.files, 'clips'); e.target.value = ''; };
  $('btnDemo').onclick = () => { loadDemo(); };
  $('btnUrlModel').onclick = () => { const u = $('urlInput').value.trim(); if (u) loadFromUrl(u, 'model', u.split('/').pop().split('?')[0] || 'URL 模型'); };
  $('btnUrlClip').onclick = () => { const u = $('urlInput').value.trim(); if (u) loadFromUrl(u, 'clips', u.split('/').pop().split('?')[0] || 'URL 动作'); };
  $('urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnUrlModel').click(); });
  document.querySelectorAll('.online-list button').forEach((b) => {
    b.onclick = () => loadFromUrl(b.dataset.url, b.dataset.role, b.dataset.name);
  });

  // 播放传输
  $('btnPlay').onclick = togglePlay;
  $('btnStop').onclick = stopPlayback;
  $('btnPrev').onclick = () => playClip(state.currentIndex - 1);
  $('btnNext').onclick = () => playClip(state.currentIndex + 1);
  $('speedSelect').onchange = (e) => {
    state.speed = parseFloat(e.target.value);
    if (state.mixer) state.mixer.timeScale = state.speed;
    updateMeta(); updatePlayUI();
  };
  const seek = $('seek');
  seek.addEventListener('pointerdown', () => { state.seeking = true; });
  seek.addEventListener('input', () => seekTo(parseInt(seek.value, 10) / 1000));
  const endSeek = () => { state.seeking = false; };
  seek.addEventListener('pointerup', endSeek);
  seek.addEventListener('change', endSeek);
  seek.addEventListener('blur', endSeek);

  // 片段列表
  $('clipList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      const idx = parseInt(del.dataset.del, 10);
      const it = state.actions[idx];
      if (it) {
        const k = state.clipSources.indexOf(it.src);
        if (k >= 0) state.clipSources.splice(k, 1);
        rebuildActions();
        playClip(Math.min(idx, state.actions.length - 1), { instant: true });
      }
      return;
    }
    const item = e.target.closest('.clip-item');
    if (item) playClip(parseInt(item.dataset.i, 10));
  });

  // 复选框
  $('chkRoot').onchange = (e) => {
    state.ignoreRootMotion = e.target.checked;
    rebuildActions();
    if (state.currentIndex >= 0) playClip(state.currentIndex, { instant: true });
    toast(state.ignoreRootMotion ? '已忽略根骨骼位移，避免重定向时角色漂移' : '已启用根骨骼位移');
  };
  $('chkCrossfade').onchange = (e) => { state.crossfade = e.target.checked; };

  // 通用开关
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.toggle;
      state[k] = !state[k];
      if (k === 'loop' && state[k]) state.pingpong = false;
      if (k === 'pingpong' && state[k]) state.loop = false;
      syncToggles();
      if (k === 'loop' || k === 'pingpong') {
        for (const it of state.actions) applyLoopTo(it.action);
        if (!state.playing) { state.playing = true; updatePlayUI(); }
      } else applyDisplayState();
    };
  });
  syncToggles();

  // 滑块 / 下拉
  $('scaleRange').oninput = (e) => {
    state.scale = parseFloat(e.target.value);
    $('scaleValue').textContent = state.scale.toFixed(2) + '×';
    characterPivot.scale.setScalar(state.fitScale * state.scale);
    controls.target.set(0, 0.88 * state.scale, 0);
  };
  $('lightRange').oninput = (e) => {
    state.light = parseFloat(e.target.value);
    $('lightValue').textContent = Math.round(state.light * 100) + '%';
    applyBackground();
  };
  $('rotateRange').oninput = (e) => {
    state.rotateSpeed = parseFloat(e.target.value);
    $('rotateValue').textContent = state.rotateSpeed.toFixed(1);
  };
  $('bgSelect').onchange = (e) => { state.bg = e.target.value; applyDisplayState(); };

  // 视角
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => moveCamera(b.dataset.view); });
  $('btnResetView').onclick = resetView;

  // 顶栏
  $('btnShot').onclick = takeShot;
  $('btnFull').onclick = toggleFullscreen;
  $('btnHelp').onclick = openHelp;
  $('btnHelpClose').onclick = closeHelp;
  $('helpModal').addEventListener('click', (e) => { if (e.target === $('helpModal')) closeHelp(); });
  $('btnPanels').onclick = () => $('app').classList.toggle('panels-open');

  // 键盘：↑↓ 切换动画片段，←→ 旋转（Shift 组合键旋转模型本体）
  window.addEventListener('keydown', (e) => {
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') { closeHelp(); return; }
    const helpOpen = !$('helpModal').classList.contains('hidden');
    if (helpOpen && k !== 'h' && e.key !== '?') return;
    if (k === 'h' || e.key === '?') { e.preventDefault(); helpOpen ? closeHelp() : openHelp(); return; }
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectClipByKey(state.currentIndex - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); selectClipByKey(state.currentIndex + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); rotateByKey(-1, e.shiftKey); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); rotateByKey(1, e.shiftKey); }
    else if (e.key === '[') { e.preventDefault(); nudgeTime(-1); }
    else if (e.key === ']') { e.preventDefault(); nudgeTime(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); changeSpeed(-1); }
    else if (e.key === '=' || e.key === '+') { e.preventDefault(); changeSpeed(1); }
    else if (/^[1-9]$/.test(e.key)) selectClipByKey(parseInt(e.key, 10) - 1);
    else if (k === 'r') resetView();
    else if (k === 'f') toggleFullscreen();
    else if (k === 'w') clickToggle('wireframe');
    else if (k === 'b') clickToggle('showSkeleton');
    else if (k === 'g') clickToggle('showGrid');
    else if (k === 'a') clickToggle('autoRotate');
  });

  // 拖放
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { e.preventDefault(); if (hasFiles(e)) { dragDepth++; $('dropOverlay').classList.add('show'); } });
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const t = e.target instanceof Element ? e.target : null;
    document.querySelectorAll('.drop-target').forEach((d) => d.classList.toggle('hot', !!t && d.contains(t)));
  });
  window.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth--; if (dragDepth <= 0) { dragDepth = 0; $('dropOverlay').classList.remove('show'); } });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropOverlay').classList.remove('show');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    const zone = e.target instanceof Element ? e.target.closest('.drop-target') : null;
    const role = zone ? zone.dataset.role : (state.isDemo ? 'model' : 'clips');
    handleFiles(files, role);
  });

  // 尺寸
  const resize = () => {
    const w = viewport.clientWidth || window.innerWidth;
    const h = viewport.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport);
  resize();
}

function changeSpeed(dir) {
  const opts = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  let i = opts.findIndex((v) => v >= state.speed - 0.001);
  if (i < 0) i = opts.length - 1;
  i = clamp(i + dir, 0, opts.length - 1);
  $('speedSelect').value = String(opts[i]);
  $('speedSelect').dispatchEvent(new Event('change'));
}
function clickToggle(key) {
  const b = document.querySelector(`[data-toggle="${key}"]`);
  if (b) b.click();
}

/* ============================================================
 * 9. 渲染循环
 * ========================================================== */
let last = performance.now(), fpsLast = performance.now(), fpsFrames = 0, uiTime = 0;
function animate() {
  requestAnimationFrame(animate);
  const t = performance.now();
  const dt = clamp((t - last) / 1000, 0, 0.1);
  last = t;

  if (camTween) {
    const u = clamp((t - camTween.start) / camTween.dur, 0, 1);
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    camera.position.lerpVectors(camTween.from, camTween.to, e);
    if (u >= 1) camTween = null;
  }
  if (yawTween) {
    const u = clamp((t - yawTween.start) / yawTween.dur, 0, 1);
    const e = 1 - Math.pow(1 - u, 3);
    camera.position.lerpVectors(yawTween.from, yawTween.to, e);
    if (u >= 1) yawTween = null;
  }
  if (Math.abs(modelYawTarget - characterPivot.rotation.y) > 0.0002) {
    characterPivot.rotation.y += (modelYawTarget - characterPivot.rotation.y) * Math.min(1, dt * 12);
  }

  controls.autoRotate = state.autoRotate;
  controls.autoRotateSpeed = state.rotateSpeed;
  controls.update(dt);

  if (state.mixer && state.playing && state.actions.length) state.mixer.update(dt);
  if (state.showBox && content) boxForHelper.setFromObject(content);
  if (skeletonHelper && state.showSkeleton) skeletonHelper.updateMatrixWorld(true);

  renderer.render(scene, camera);

  fpsFrames++; uiTime += dt;
  const wall = performance.now();
  if (wall - fpsLast >= 500) {
    $('statFps').textContent = Math.round(fpsFrames * 1000 / (wall - fpsLast)) + ' fps';
    fpsFrames = 0;
    fpsLast = wall;
  }
  if (uiTime >= 0.08) {
    uiTime = 0;
    updateSeekUI();
    const item = activeItem();
    $('statTime').textContent = item ? item.action.time.toFixed(2) + ' s' : '--';
    $('timeLabel').textContent = item
      ? `${fmtTime(item.action.time)} / ${fmtTime(item.clip.duration)}`
      : '00:00 / 00:00';
  }
}

/* ============================================================
 * 10. 启动
 * ========================================================== */
initUI();
applyDisplayState();
loadDemo();
requestAnimationFrame(animate);

/* 暴露少量内部对象，便于二次开发 / 控制台调试 */
window.glbPlayer = {
  state, scene, camera, renderer, controls, loader, characterPivot,
  loadDemo, setModel, loadClipSource, playClip, rotateByKey, moveCamera, openHelp,
};
