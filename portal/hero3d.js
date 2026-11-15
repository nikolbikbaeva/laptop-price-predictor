/* FairSpec hero: a real-time 3D laptop (Three.js).
 * Brushed-aluminium body with a soft iridescent sheen, pastel studio lights, the lid opens on load,
 * the laptop follows the pointer, and the screen is a live canvas showing a fair price.
 * If WebGL is unavailable, the page falls back to the CSS laptop (body.no-webgl).
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.getElementById("heroCanvas");
const host = document.getElementById("stage3d");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function fail() { document.body.classList.add("no-webgl"); }

try {
  if (!canvas || !host) throw new Error("no canvas");
  start();
} catch (e) {
  fail();
}

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 2.35, 8.2);
  camera.lookAt(0, 0.75, 0);

  // pastel studio lights (mint / pink / sky), like the brand palette
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe6ff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(3, 6, 5); scene.add(key);
  const mint = new THREE.PointLight(0x6ff2d6, 26, 14); mint.position.set(-4.2, 2.2, 2.5); scene.add(mint);
  const pink = new THREE.PointLight(0xff8cc6, 24, 14); pink.position.set(4.4, 1.6, 1.8); scene.add(pink);
  const sky = new THREE.PointLight(0x8fb2ff, 18, 14); sky.position.set(0, 3.4, -3.5); scene.add(sky);

  // materials
  const aluminium = new THREE.MeshPhysicalMaterial({
    color: 0xe3e7ee, metalness: 1, roughness: 0.3,
    clearcoat: 0.55, clearcoatRoughness: 0.25,
    iridescence: 0.45, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
  });
  const darkAlu = new THREE.MeshPhysicalMaterial({ color: 0xc9cfd8, metalness: 1, roughness: 0.42 });
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.55, metalness: 0.2 });
  const bezelMat = new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });

  // live screen texture
  const sc = document.createElement("canvas"); sc.width = 1280; sc.height = 800;
  const sctx = sc.getContext("2d");
  const screenTex = new THREE.CanvasTexture(sc);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });

  const W = 3.3, D = 2.25, H = 0.13;
  const laptop = new THREE.Group();
  scene.add(laptop);

  // base
  const base = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.065), aluminium);
  laptop.add(base);
  // keyboard well + keys
  const well = new THREE.Mesh(new RoundedBoxGeometry(W * 0.86, 0.02, D * 0.42, 3, 0.01), darkAlu);
  well.position.set(0, H / 2 - 0.004, -0.26); laptop.add(well);
  const cols = 14, rows = 5, kw = 0.172, kd = 0.15, gap = 0.028;
  const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(kw, 0.025, kd, 2, 0.008), keyMat, cols * rows);
  const m = new THREE.Matrix4(); let k = 0;
  const totalW = cols * kw + (cols - 1) * gap, totalD = rows * kd + (rows - 1) * gap;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    m.makeTranslation(-totalW / 2 + kw / 2 + c * (kw + gap), H / 2 + 0.01, -0.26 - totalD / 2 + kd / 2 + r * (kd + gap));
    keys.setMatrixAt(k++, m);
  }
  laptop.add(keys);
  // trackpad
  const pad = new THREE.Mesh(new RoundedBoxGeometry(1.15, 0.006, 0.68, 3, 0.003), darkAlu);
  pad.position.set(0, H / 2 + 0.001, 0.66); laptop.add(pad);

  // lid with hinge at the back edge
  const hinge = new THREE.Group();
  hinge.position.set(0, H / 2, -D / 2 + 0.03);
  laptop.add(hinge);
  const LH = 2.18, LT = 0.075;
  const lid = new THREE.Mesh(new RoundedBoxGeometry(W, LH, LT, 6, 0.04), aluminium);
  lid.position.set(0, LH / 2, 0); hinge.add(lid);
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.08, LH - 0.08), bezelMat);
  bezel.position.set(0, LH / 2, LT / 2 + 0.001); hinge.add(bezel);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.26, LH - 0.3), screenMat);
  display.position.set(0, LH / 2 + 0.02, LT / 2 + 0.002); hinge.add(display);
  // tiny glossy logo on the back of the lid
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.16, 48), new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05, iridescence: 1, iridescenceIOR: 1.6 }));
  logo.position.set(0, LH / 2, -LT / 2 - 0.001); logo.rotation.y = Math.PI; hinge.add(logo);

  // soft contact shadow
  const sh = document.createElement("canvas"); sh.width = sh.height = 256;
  const g = sh.getContext("2d"); const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(40,45,80,.55)"); grad.addColorStop(.55, "rgba(40,45,80,.18)"); grad.addColorStop(1, "rgba(40,45,80,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const shTex = new THREE.CanvasTexture(sh); shTex.colorSpace = THREE.SRGBColorSpace;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, D * 1.9), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -H / 2 - 0.35; scene.add(shadow);

  laptop.position.y = 0.15;

  // ---------- screen drawing ----------
  let screenData = { model: "FairSpec", price: "—", label: "Fair market value", bars: [0.6, 0.5, 0.5, 0.4], badge: "", badgeCls: "fair" };
  function roundRect(x, y, w, h, r) { sctx.beginPath(); sctx.moveTo(x + r, y); sctx.arcTo(x + w, y, x + w, y + h, r); sctx.arcTo(x + w, y + h, x, y + h, r); sctx.arcTo(x, y + h, x, y, r); sctx.arcTo(x, y, x + w, y, r); sctx.closePath(); }
  function drawScreen(t = 0) {
    const w = sc.width, h = sc.height;
    const bg = sctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#c9f7ea"); bg.addColorStop(0.4, "#b5dbff"); bg.addColorStop(0.75, "#d6c6ff"); bg.addColorStop(1, "#ffd0e6");
    sctx.fillStyle = bg; sctx.fillRect(0, 0, w, h);
    // glow orb
    const ox = w * (0.78 + 0.04 * Math.sin(t / 1400)), oy = h * 0.28;
    const orb = sctx.createRadialGradient(ox, oy, 10, ox, oy, 360);
    orb.addColorStop(0, "rgba(255,255,255,.75)"); orb.addColorStop(1, "rgba(255,255,255,0)");
    sctx.fillStyle = orb; sctx.fillRect(0, 0, w, h);
    // window chrome
    sctx.fillStyle = "rgba(12,13,16,.18)";
    [0, 1, 2].forEach((i) => { sctx.beginPath(); sctx.arc(70 + i * 34, 64, 10, 0, Math.PI * 2); sctx.fill(); });
    sctx.fillStyle = "rgba(12,13,16,.5)"; sctx.font = '500 24px "Geist Mono", monospace'; sctx.fillText("fairspec.app", 190, 72);
    // card
    sctx.fillStyle = "rgba(255,255,255,.55)"; roundRect(60, 120, w - 120, h - 180, 40); sctx.fill();
    sctx.fillStyle = "rgba(12,13,16,.62)"; sctx.font = '600 38px "Geist", sans-serif';
    sctx.fillText(screenData.model.slice(0, 34), 110, 200);
    sctx.fillStyle = "rgba(12,13,16,.45)"; sctx.font = '500 24px "Geist Mono", monospace';
    sctx.fillText(screenData.label.toUpperCase(), 110, 252);
    sctx.fillStyle = "#0c0d10"; sctx.font = '700 168px "Bricolage Grotesque", sans-serif';
    sctx.fillText(screenData.price, 100, 412);
    // bars
    const labels = ["CPU", "GPU", "RAM", "SSD"];
    labels.forEach((lb, i) => {
      const y = 480 + i * 52;
      sctx.fillStyle = "rgba(12,13,16,.55)"; sctx.font = '500 24px "Geist Mono", monospace'; sctx.fillText(lb, 110, y + 18);
      sctx.fillStyle = "rgba(12,13,16,.1)"; roundRect(200, y, 520, 18, 9); sctx.fill();
      const bw = Math.max(20, 520 * Math.min(1, screenData.bars[i] || 0));
      const bg2 = sctx.createLinearGradient(200, 0, 720, 0); bg2.addColorStop(0, "#4fdcc6"); bg2.addColorStop(.5, "#5b8cff"); bg2.addColorStop(1, "#8d6bff");
      sctx.fillStyle = bg2; roundRect(200, y, bw, 18, 9); sctx.fill();
    });
    // badge
    if (screenData.badge) {
      const colors = { good: ["#d6f7e8", "#0f9e6e"], fair: ["#e1e9ff", "#3d63e0"], bad: ["#ffe3df", "#d4473a"] }[screenData.badgeCls] || ["#e1e9ff", "#3d63e0"];
      sctx.font = '700 30px "Geist", sans-serif';
      const tw = sctx.measureText(screenData.badge).width + 56;
      sctx.fillStyle = colors[0]; roundRect(w - 110 - tw, h - 150, tw, 64, 32); sctx.fill();
      sctx.fillStyle = colors[1]; sctx.fillText(screenData.badge, w - 110 - tw + 28, h - 107);
    }
    screenTex.needsUpdate = true;
  }

  window.FairHero = {
    setScreen(d) { screenData = Object.assign({}, screenData, d); drawScreen(performance.now()); },
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => drawScreen(0));
  drawScreen(0);
  window.dispatchEvent(new Event("fairhero:ready"));

  // ---------- sizing ----------
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the laptop fully in frame on narrow screens
    camera.position.z = w / h < 0.9 ? 10.6 : w / h < 1.2 ? 9.2 : 8.2;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------- interaction ----------
  let tx = 0, ty = 0;
  if (matchMedia("(pointer:fine)").matches) {
    window.addEventListener("pointermove", (e) => {
      tx = (e.clientX / innerWidth - 0.5) * 2;
      ty = (e.clientY / innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  // ---------- animation ----------
  const CLOSED = Math.PI / 2 - 0.02, OPEN = -0.24;
  hinge.rotation.x = reduceMotion ? OPEN : CLOSED;
  const t0 = performance.now();
  let visible = true, raf = 0, lastScreen = 0;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(tick); }, { threshold: 0.01 });
  io.observe(host);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && visible && !raf) raf = requestAnimationFrame(tick); });

  const ease = (x) => 1 - Math.pow(1 - x, 4);
  function tick(now) {
    raf = 0;
    if (!visible || document.hidden || document.body.dataset.view !== "home") { return; }
    const t = now - t0;
    // lid opens after a short beat
    if (!reduceMotion) {
      const p = Math.min(1, Math.max(0, (t - 350) / 1600));
      hinge.rotation.x = CLOSED + (OPEN - CLOSED) * ease(p);
    }
    // turn toward pointer, idle drift
    const idle = reduceMotion ? 0 : Math.sin(t / 2600) * 0.12;
    laptop.rotation.y += (-0.5 + tx * 0.35 + idle - laptop.rotation.y) * 0.05;
    laptop.rotation.x += (0.06 + ty * 0.08 - laptop.rotation.x) * 0.05;
    laptop.position.y = 0.15 + (reduceMotion ? 0 : Math.sin(t / 1300) * 0.06);
    shadow.material.opacity = 0.85 - (laptop.position.y - 0.15) * 2;
    mint.position.x = -4.2 + Math.sin(t / 3000) * 0.8;
    pink.position.x = 4.4 + Math.cos(t / 3400) * 0.8;
    if (now - lastScreen > 120) { drawScreen(now); lastScreen = now; }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  window.addEventListener("hashchange", () => { if (!raf) raf = requestAnimationFrame(tick); });
}
