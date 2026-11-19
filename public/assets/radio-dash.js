import * as THREE from '../vendor/three/three.module.js';
import { CSS3DObject, CSS3DRenderer } from '../vendor/three/CSS3DRenderer.js';

const SCREEN_W = 400;
const SCREEN_H = 760;
const WORLD_W = 0.25;

function canvasTex(draw, w = 512, h = 512) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeMaps() {
  const leather = canvasTex((g, w, h) => {
    g.fillStyle = '#6a6e74';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 14000; i++) {
      const v = 16 + Math.random() * 22;
      g.fillStyle = `rgba(${v},${v},${v + 2},${0.12 + Math.random() * 0.2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(255,255,255,.035)';
    g.lineWidth = 1;
    for (let y = 0; y < h; y += 4) {
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(w * 0.3, y + 1.5, w * 0.7, y - 1.5, w, y);
      g.stroke();
    }
  });
  leather.wrapS = leather.wrapT = THREE.RepeatWrapping;
  leather.repeat.set(2.2, 2.2);
  const knurl = canvasTex((g, w, h) => {
    g.fillStyle = '#9a9aa0';
    g.fillRect(0, 0, w, h);
    g.lineWidth = 4;
    for (let i = -12; i < 24; i++) {
      g.strokeStyle = i % 2 ? '#f2f2f4' : '#3a3a40';
      g.beginPath();
      g.moveTo(i * 12, 0);
      g.lineTo(i * 12 + h, h);
      g.stroke();
    }
  }, 128, 128);
  knurl.wrapS = knurl.wrapT = THREE.RepeatWrapping;
  knurl.repeat.set(10, 3);
  const badge = canvasTex((g, w, h) => {
    g.fillStyle = '#121316';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c8c6c0';
    g.lineWidth = 8;
    g.strokeRect(18, 18, w - 36, h - 36);
    g.fillStyle = '#f3f1ec';
    g.font = '800 92px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('YBI', w / 2, h / 2 + 4);
  }, 320, 180);
  return { leather, knurl, badge };
}

function envTexture() {
  const mk = (top, bot) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 32);
    grd.addColorStop(0, top);
    grd.addColorStop(1, bot);
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return c;
  };
  const tex = new THREE.CubeTexture([
    mk('#3a3d44', '#1a1c20'),
    mk('#2a2d32', '#121416'),
    mk('#5a5e66', '#2a2c30'),
    mk('#0c0c0e', '#050506'),
    mk('#d0d4da', '#2a2e34'),
    mk('#1a1c20', '#0c0d10')
  ]);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clusterTexture(station, playing) {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#07080c';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.08)';
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#9aa0a8';
    g.font = '600 22px sans-serif';
    g.textAlign = 'left';
    g.fillText('YBI', 28, 44);
    g.textAlign = 'right';
    g.fillText(playing ? 'LIVE' : 'PARK', w - 28, 44);
    g.fillStyle = '#f4f6f8';
    g.textAlign = 'center';
    g.font = '700 78px sans-serif';
    g.fillText('0', w / 2, 130);
    g.font = '500 18px sans-serif';
    g.fillStyle = '#9aa0a8';
    g.fillText('KM/H', w / 2, 158);
    g.fillStyle = '#f4f6f8';
    g.font = '600 26px sans-serif';
    g.fillText((station || 'YBI RADIO').toUpperCase(), w / 2, 210);
  }, 640, 280);
}

export function mountDash(root, screenEl, hooks) {
  const { leather, knurl, badge } = makeMaps();
  const env = envTexture();
  const leatherMat = new THREE.MeshStandardMaterial({ map: leather, roughness: 0.78, metalness: 0.05, color: '#ffffff' });
  const chrome = new THREE.MeshStandardMaterial({ color: '#e4e6ea', metalness: 1, roughness: 0.22, envMap: env, envMapIntensity: 1.05 });
  const piano = new THREE.MeshStandardMaterial({ color: '#07080a', metalness: 0.92, roughness: 0.07, envMap: env, envMapIntensity: 1.25 });
  const stitchMat = new THREE.MeshStandardMaterial({ color: '#d5d2cb', roughness: 0.55, metalness: 0.05 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#121214', roughness: 0.9, metalness: 0 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#070910', roughness: 0.05, metalness: 0.15, transparent: true, opacity: 0.92, envMap: env });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05060a');
  scene.fog = new THREE.Fog('#05060a', 1.6, 3.2);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 12);
  const look = new THREE.Vector3(0.02, 0.0, 0);
  const lookWant = new THREE.Vector3();
  const camBase = new THREE.Vector3();
  const camWant = new THREE.Vector3();
  const pointer = { x: 0, y: 0 };

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'rx-gl';

  const css = new CSS3DRenderer();
  css.domElement.className = 'rx-css';

  root.append(renderer.domElement, css.domElement);

  scene.add(new THREE.HemisphereLight('#c5ccd6', '#1a1c20', 1.15));
  const key = new THREE.DirectionalLight('#fff6ea', 2.6);
  key.position.set(0.4, 1.3, 1.1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.2;
  key.shadow.camera.far = 4;
  key.shadow.camera.left = -1.2;
  key.shadow.camera.right = 1.2;
  key.shadow.camera.top = 1;
  key.shadow.camera.bottom = -1;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#8aa0c0', 0.35);
  fill.position.set(-0.8, 0.4, 0.6);
  scene.add(fill);

  const dash = new THREE.Group();
  scene.add(dash);

  function mesh(geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    dash.add(m);
    return m;
  }

  function stitches(x, y, z, len, axis) {
    for (const off of [-0.004, 0.004]) {
      const g = axis === 'x' ? new THREE.BoxGeometry(len, 0.0016, 0.0016) : new THREE.BoxGeometry(0.0016, 0.0016, len);
      const s = mesh(g, stitchMat, x + (axis === 'z' ? off : 0), y, z + (axis === 'x' ? off : 0));
      s.castShadow = false;
    }
  }

  // Dark glass across the top. The camera stays below it.
  mesh(new THREE.PlaneGeometry(2.6, 0.55), glassMat, 0, 0.72, -0.35);

  const pad = mesh(new THREE.BoxGeometry(1.7, 0.1, 0.36), leatherMat, 0, 0.16, -0.2);
  pad.rotation.x = -0.22;
  stitches(0, 0.2, -0.02, 1.4, 'x');
  // Main dash stops behind the centre stack so it cannot cover the screen.
  mesh(new THREE.BoxGeometry(2.3, 0.28, 0.4), leatherMat, 0, -0.04, -0.08);
  stitches(-0.48, 0.08, 0.02, 0.42, 'x');
  stitches(0.55, 0.08, 0.02, 0.4, 'x');

  const plaqueFace = mesh(new THREE.PlaneGeometry(0.14, 0.032), new THREE.MeshBasicMaterial({ map: badge }), -0.55, 0.08, 0.05);
  plaqueFace.castShadow = false;

  function vent(x) {
    mesh(new THREE.BoxGeometry(0.22, 0.08, 0.025), chrome, x, 0.1, 0.06);
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(0.16, 0.006, 0.01), piano, x, 0.078 + i * 0.014, 0.075);
  }
  vent(-0.72);
  vent(0.72);

  // Housing sits behind the display and shows as a frame around it.
  mesh(new THREE.BoxGeometry(0.34, 0.62, 0.06), piano, 0, 0.06, 0.1);

  const scale = WORLD_W / SCREEN_W;
  screenEl.classList.add('rx-ui');
  screenEl.style.width = SCREEN_W + 'px';
  screenEl.style.height = SCREEN_H + 'px';
  screenEl.style.position = 'absolute';
  screenEl.style.left = '0';
  screenEl.style.top = '0';
  screenEl.style.pointerEvents = 'auto';
  css.domElement.style.pointerEvents = 'none';
  const cssObj = new CSS3DObject(screenEl);
  cssObj.position.set(0, 0.07, 0.14);
  cssObj.scale.set(scale, scale, 1);
  dash.add(cssObj);

  const knobGeo = new THREE.CylinderGeometry(0.036, 0.04, 0.034, 48);
  const knobMat = new THREE.MeshStandardMaterial({ color: '#d5d7dc', metalness: 1, roughness: 0.32, envMap: env, bumpMap: knurl, bumpScale: 0.012 });
  const volKnob = new THREE.Mesh(knobGeo, knobMat);
  volKnob.castShadow = true;
  volKnob.position.set(-0.2, -0.24, 0.2);
  volKnob.rotation.x = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.007, 8, 28), knobMat);
  volKnob.userData.role = 'vol';
  ring.userData.role = 'vol';
  volKnob.add(ring);
  dash.add(volKnob);
  const tuneKnob = volKnob.clone();
  tuneKnob.position.x = 0.2;
  tuneKnob.traverse(o => { o.userData.role = 'tune'; });
  dash.add(tuneKnob);

  const presets = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: i % 2 ? '#c8c8cc' : '#1a1a1c', metalness: i % 2 ? 0.9 : 0.1, roughness: i % 2 ? 0.3 : 0.7 });
    const b = mesh(new THREE.BoxGeometry(0.032, 0.014, 0.01), mat, -0.12 + i * 0.034, -0.28, 0.16);
    b.userData.role = 'preset';
    b.userData.index = i;
    presets.push(b);
  }

  // Gear dial
  const dial = mesh(new THREE.CylinderGeometry(0.045, 0.048, 0.02, 32), chrome, 0.16, -0.34, 0.22);
  dial.rotation.x = Math.PI / 2.4;
  mesh(new THREE.BoxGeometry(0.28, 0.02, 0.16), piano, 0.05, -0.36, 0.18);

  // Doors
  const doorL = mesh(new THREE.BoxGeometry(0.08, 0.7, 0.85), leatherMat, -1.02, 0.0, 0.05);
  doorL.rotation.y = 0.15;
  stitches(-0.98, 0.12, 0.1, 0.5, 'z');
  const doorR = mesh(new THREE.BoxGeometry(0.08, 0.7, 0.85), leatherMat, 1.02, 0.0, 0.05);
  doorR.rotation.y = -0.15;

  // Rear-view mirror
  const mirror = mesh(new THREE.BoxGeometry(0.22, 0.07, 0.02), piano, 0, 0.48, 0.05);
  mesh(new THREE.BoxGeometry(0.19, 0.045, 0.004), new THREE.MeshStandardMaterial({ color: '#1a2030', metalness: 1, roughness: 0.05, envMap: env }), 0, 0.48, 0.062);

  // RHD wheel
  const wheel = new THREE.Group();
  wheel.position.set(0.58, -0.06, 0.34);
  wheel.rotation.y = -0.55;
  wheel.rotation.x = -0.4;
  dash.add(wheel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.016, 16, 48), leatherMat);
  rim.castShadow = true;
  wheel.add(rim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.11, 0.012), piano);
    spoke.position.y = 0.02;
    spoke.rotation.z = i * (Math.PI * 2 / 3);
    spoke.castShadow = true;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 24), chrome);
  hub.rotation.x = Math.PI / 2;
  hub.castShadow = true;
  wheel.add(hub);
  const hubFace = new THREE.Mesh(new THREE.CircleGeometry(0.032, 24), new THREE.MeshBasicMaterial({ map: badge }));
  hubFace.position.z = 0.011;
  wheel.add(hubFace);
  for (const side of [-1, 1]) {
    const btn = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.008), piano);
    btn.position.set(side * 0.07, -0.02, 0.02);
    wheel.add(btn);
  }

  // Cluster behind the wheel
  const clusterMat = new THREE.MeshBasicMaterial({ map: clusterTexture('YBI RADIO', false) });
  const cluster = mesh(new THREE.PlaneGeometry(0.34, 0.16), clusterMat, 0.48, 0.16, 0.02);
  cluster.rotation.y = -0.5;
  cluster.castShadow = false;

  const mobileQuery = window.matchMedia('(max-width: 760px)');
  function placeCamera(immediate) {
    const mobile = mobileQuery.matches;
    camBase.set(mobile ? 0 : 0.0, mobile ? 0.07 : -0.02, mobile ? 0.84 : 0.98);
    lookWant.set(0, mobile ? 0.07 : -0.02, 0);
    if (immediate) { camWant.copy(camBase); look.copy(lookWant); }
  }
  placeCamera(true);
  camera.position.copy(camBase);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function hitRole(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([volKnob, tuneKnob, ...presets], true);
    return hits[0] && hits[0].object.userData;
  }

  let drag = null;
  renderer.domElement.addEventListener('pointerdown', e => {
    const role = hitRole(e.clientX, e.clientY);
    if (!role) return;
    drag = { role, x: e.clientX, y: e.clientY, moved: 0, vol: hooks.getVolume() };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', e => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    if (drag.role.role === 'vol') {
      hooks.onVolume(drag.vol + (drag.y - e.clientY) / 180);
      volKnob.rotation.y = -hooks.getVolume() * 5;
    } else if (drag.role.role === 'tune') {
      const steps = Math.trunc((drag.x - e.clientX) / 48);
      if (steps !== drag.steps) {
        const dir = steps > (drag.steps || 0) ? -1 : 1;
        if (drag.steps != null) hooks.onSeek(dir);
        drag.steps = steps;
      }
    }
  });
  function endDrag(e) {
    if (!drag) return;
    if (drag.moved < 6) {
      if (drag.role.role === 'vol') hooks.onMute();
      else if (drag.role.role === 'tune') hooks.onSeek(1);
      else if (drag.role.role === 'preset') hooks.onPreset(drag.role.index);
    }
    drag = null;
  }
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);
  renderer.domElement.addEventListener('wheel', e => {
    const role = hitRole(e.clientX, e.clientY);
    if (!role) return;
    e.preventDefault();
    if (role.role === 'vol') hooks.onVolume(hooks.getVolume() + (e.deltaY < 0 ? 0.04 : -0.04));
    else if (role.role === 'tune') hooks.onSeek(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  root.addEventListener('pointermove', e => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  function resize() {
    const w = root.clientWidth || 1;
    const h = root.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    css.setSize(w, h);
    placeCamera(false);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  resize();

  let alive = true;
  function frame() {
    if (!alive || !renderer.domElement.isConnected) { dispose(); return; }
    requestAnimationFrame(frame);
    placeCamera(false);
    const par = mobileQuery.matches ? 0.012 : 0.035;
    camWant.set(camBase.x + pointer.x * par, camBase.y + -pointer.y * par * 0.6, camBase.z);
    camera.position.lerp(camWant, 0.06);
    look.lerp(lookWant, 0.08);
    camera.lookAt(look);
    volKnob.rotation.y = -hooks.getVolume() * 5;
    renderer.render(scene, camera);
    css.render(scene, camera);
  }
  requestAnimationFrame(frame);

  function dispose() {
    if (!alive) return;
    alive = false;
    ro.disconnect();
    renderer.dispose();
    renderer.domElement.remove();
    css.domElement.remove();
  }

  return {
    dispose,
    sync(state) {
      clusterMat.map.dispose();
      clusterMat.map = clusterTexture(state.station || 'YBI RADIO', state.playing);
      clusterMat.needsUpdate = true;
      const idx = state.presetIndex;
      presets.forEach((b, i) => {
        const on = i === idx;
        b.material.color.set(on ? '#f4f6f8' : (i % 2 ? '#c8c8cc' : '#1a1a1c'));
        b.material.emissive = b.material.emissive || new THREE.Color();
        b.material.emissive.set(on ? '#334' : '#000');
      });
    }
  };
}
