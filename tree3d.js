import * as THREE from 'three';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { addDepth, projectPoint, gizmoProgress } from './tree-space.js';
import { behindScene, labelDepthMask, sceneDepth } from './label-depth.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const hash = (a, b = 0) => { const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return n - Math.floor(n); };
const palette = ['#1e1c1a', '#5a4c40', '#8d8a82', '#a9a69d', '#c2aba0'].map(c => new THREE.Color(c));
const greens = ['#3e8f17', '#9fe01b', '#cdf23f', '#eef77a'].map(c => new THREE.Color(c));
const depthShader = `
  uniform bool depthPass;
  vec4 packedDepth() {
    float value = floor(gl_FragCoord.z * 16777215.0);
    return vec4(floor(value / 65536.0), floor(mod(value, 65536.0) / 256.0), mod(value, 256.0), 255.0) / 255.0;
  }`;

function woodGeometry(b) {
  const data = { position: [], radial: [], radius: [], birth: [], arc: [], around: [], dotted: [] }, indices = [];
  const tube = (points, radiusAt, birthAt, dotted = 0) => {
    if (points.length < 2) return;
    const sides = 8, start = data.radius.length;
    let normal, distance = 0;
    points.forEach((p, i) => {
      const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
      const tangent = new THREE.Vector3(after.x - before.x, before.y - after.y, after.z - before.z).normalize();
      if (!normal) normal = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 0, 1));
      normal.addScaledVector(tangent, -normal.dot(tangent));
      if (normal.lengthSq() < .0001) normal = new THREE.Vector3(1, 0, 0).cross(tangent);
      normal.normalize();
      const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
      if (i) distance += Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z);
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        const radial = normal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
        data.position.push(p.x, -p.y, p.z); data.radial.push(radial.x, radial.y, radial.z);
        data.radius.push(radiusAt(p, i)); data.birth.push(birthAt(p, i));
        data.arc.push(distance); data.around.push(j); data.dotted.push(dotted);
        if (i && j < sides) {
          const a = start + (i - 1) * (sides + 1) + j, c = start + i * (sides + 1) + j;
          indices.push(a, c, a + 1, c, c + 1, a + 1);
        }
      }
    });
    for (const [i, reverse] of [[0, true], [points.length - 1, false]]) {
      const p = points[i], center = data.radius.length, ring = start + i * (sides + 1);
      data.position.push(p.x, -p.y, p.z); data.radial.push(0, 0, 0); data.radius.push(0);
      data.birth.push(birthAt(p, i)); data.arc.push(i ? distance : 0); data.around.push(0); data.dotted.push(dotted);
      for (let j = 0; j < sides; j++) indices.push(center, ring + j + (reverse ? 1 : 0), ring + j + (reverse ? 0 : 1));
    }
  };
  tube(b.pts, p => p.w * 2, p => p.tr * b.dur);
  for (const tw of b.twigs) {
    if (tw.len <= 0) continue;
    const start = b.pts[tw.i], birth = p => start.tr * b.dur + tw.delay + p.d / 220;
    const radius = p => tw.stalk ? Math.max(.65, start.w * 2 * Math.max(0, 1 - p.d / tw.len) ** .7) : .9;
    tube(tw.points3d, radius, birth, tw.stalk ? 0 : 1);
    if (tw.forkPoints3d) tube(tw.forkPoints3d, () => .7, birth, 1);
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(data)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, ['position', 'radial'].includes(name) ? 3 : 1));
  geometry.setIndex(indices);
  return geometry;
}

function woodMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { age: { value: 0 }, thickness: { value: 1 }, time: { value: 0 }, colors: { value: palette }, depthPass: { value: false } },
    side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 radial;
      attribute float radius, birth, arc, around, dotted;
      uniform float age, thickness;
      varying float vAge, vArc, vAround, vDotted;
      varying vec3 vNormal;
      void main() {
        vAge = age - birth; vArc = arc; vAround = around; vDotted = dotted;
        float growth = clamp((vAge - .12) / 1.8, 0.0, 1.0);
        float r = radius == 0.0 ? 0.0 : mix(.65, max(.65, radius * thickness), growth);
        vNormal = normalize(normalMatrix * (radial + vec3(0.0, 0.0, .0001)));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + radial * r, 1.0);
      }`,
    fragmentShader: `
      ${depthShader}
      uniform vec3 colors[5];
      uniform float time;
      varying float vAge, vArc, vAround, vDotted;
      varying vec3 vNormal;
      float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        if (vAge < 0.0) discard;
        vec2 cell = floor(vec2(vArc / 4.0, vAround));
        float n = noise(cell);
        if (vDotted > .5 && noise(vec2(cell.x, 1.0)) < .36) discard;
        if (vAge < .12 && mod(cell.x, 3.0) > .9) discard;
        if (depthPass) { gl_FragColor = packedDepth(); return; }
        float shade = dot(normalize(vNormal), normalize(vec3(-.35, .65, 1.0)));
        vec3 color = shade < -.35 ? colors[0] : shade < .05 ? colors[1] : shade < .7 ? colors[2] : colors[3];
        if (abs(vNormal.z) < .45) color = mix(colors[0], colors[1], step(.5, n));
        if (n < .24) color = mix(color, colors[1], .65);
        if (n > .91 && shade > .0) color = colors[3];
        if (noise(vec2(cell.x * 7.0 + cell.y, floor(time * 8.0))) < .05) color = mix(color, colors[3], .25);
        if (vAge < .12) color = colors[4];
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function decorationGeometry(b, flowers) {
  const data = { position: [], offset: [], color: [], birth: [], duration: [], size: [], angle: [] }, bounds = [];
  const add = (p, offset, color, birth, duration, size, angle = 0) => {
    data.position.push(p.x, -p.y, p.z); data.offset.push(offset.x, -offset.y, offset.z);
    data.color.push(color.r, color.g, color.b); data.birth.push(birth); data.duration.push(duration);
    data.size.push(size); data.angle.push(angle);
  };
  if (flowers) for (const f of b.blossoms) {
    add(f, { x: 0, y: 0, z: 0 }, new THREE.Color(f.petal), b.pts[f.i].tr * b.dur + f.delay, .65, (f.size * 2 + 4) * 4, f.angle);
    for (const sign of [-1, 1]) bounds.push({ x: f.x + sign * 22, y: f.y + sign * 22, z: f.z + sign * 8 });
  } else for (const m of b.moss) {
    const r = m.r * 3.2, count = clamp(Math.round(r * r * .35), 14, 180);
    for (let i = 0; i < count; i++) {
      const azimuth = hash(m.seed + i, 2) * Math.PI * 2, h = hash(m.seed + i, 3) * 2 - 1;
      const radial = Math.sqrt(1 - h * h) * Math.cbrt(hash(m.seed + i, 4));
      const offset = { x: Math.cos(azimuth) * radial * r * m.ax, y: h * r, z: Math.sin(azimuth) * radial * r * .8 };
      const n = hash(m.seed + i, 5), color = greens[n < .15 ? 0 : n < .58 ? 1 : n < .95 ? 2 : 3];
      add(m.center3d, offset, color, b.pts[m.i].tr * b.dur + m.delay, m.dur, 3.5 + hash(i, m.seed) * 3, m.seed);
    }
    for (const sign of [-1, 1]) bounds.push({ x: m.center3d.x + sign * r * m.ax, y: m.center3d.y + sign * r, z: m.center3d.z + sign * r });
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(data)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, ['position', 'offset', 'color'].includes(name) ? 3 : 1));
  return { geometry, bounds };
}

function decorationMaterial(flowers) {
  return new THREE.ShaderMaterial({
    uniforms: { age: { value: 0 }, scale: { value: 1 }, pixels: { value: 3 }, blossom: { value: 1 }, time: { value: 0 }, depthPass: { value: false } },
    vertexColors: true,
    vertexShader: `
      attribute vec3 offset;
      attribute float birth, duration, size, angle;
      uniform float age, scale, pixels, blossom, time;
      varying vec3 vColor;
      varying float vGrowth, vAngle;
      void main() {
        float t = clamp((age - birth) / duration, 0.0, 1.0);
        vGrowth = t * t * (3.0 - 2.0 * t); vColor = color; vAngle = angle;
        float breath = ${flowers ? '1.0' : '1.0 + .08 * sin(time * 1.7 + angle) * vGrowth'};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + offset * vGrowth * breath, 1.0);
        gl_PointSize = max(1.0, size * scale / pixels * vGrowth ${flowers ? '* blossom' : ''});
      }`,
    fragmentShader: flowers ? `
      ${depthShader}
      varying vec3 vColor;
      varying float vGrowth, vAngle;
      void main() {
        if (vGrowth < .01) discard;
        vec2 cell = floor(gl_PointCoord * 13.0) - 6.0;
        bool petal = false;
        for (int i = 0; i < 5; i++) {
          float a = vAngle + float(i) * 1.256637;
          vec2 p = floor(vec2(cos(a), sin(a)) * 3.5 + .5);
          if (max(abs(cell.x - p.x), abs(cell.y - p.y)) <= 1.5) petal = true;
        }
        bool core = max(abs(cell.x), abs(cell.y)) < 1.0;
        if (!petal && !core) discard;
        if (depthPass) { gl_FragColor = packedDepth(); return; }
        gl_FragColor = vec4(core ? vec3(.905, .68, .16) : vColor, 1.0);
        #include <colorspace_fragment>
      }` : `
      ${depthShader}
      varying vec3 vColor;
      varying float vGrowth;
      void main() {
        if (vGrowth < .01) discard;
        if (depthPass) { gl_FragColor = packedDepth(); return; }
        gl_FragColor = vec4(vColor, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function create3DView(canvas, onContextLost, controls = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' });
  let background = '#ffffff';
  renderer.setPixelRatio(1); renderer.setClearColor(background);
  const scene = new THREE.Scene(), group = new THREE.Group(), objects = new Map();
  scene.add(group); group.matrixAutoUpdate = false;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 100000);
  const state = { yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, pivot: { x: 0, y: 0, z: 0 } };
  const depthTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const maskedNodes = new Set(), maskCache = new WeakMap(), sizes = new WeakMap();
  let depthData = null, depthStamp = '', depthVersion = 0, revision = 0, gizmoAmount = 1, drawGizmo = () => {}, disposeGizmo = () => {};
  const clearMask = node => {
    for (const el of [node.el, node.back].filter(Boolean)) { el.style.maskImage = ''; el.style.webkitMaskImage = ''; }
    node.el.style.pointerEvents = '';
  };
  const lost = event => { event.preventDefault(); onContextLost(); };
  canvas.addEventListener('webglcontextlost', lost);
  const disposeObject = object => {
    group.remove(object.group);
    object.group.children.forEach(child => { child.geometry.dispose(); child.material.dispose(); });
  };
  const api = {
    state,
    setBackground(color) { background = color; renderer.setClearColor(color); },
    setGizmoProgress(value) { gizmoAmount = value; },
    sync(branches) {
      const active = new Set(branches);
      for (const [b, object] of objects) if (!active.has(b)) { disposeObject(object); objects.delete(b); revision++; }
      for (const b of branches) {
        const signature = b.twigs.map(tw => `${tw.len}:${tw.fork?.len ?? 0}`).join(',');
        const previous = objects.get(b);
        if (previous?.signature === signature) continue;
        if (previous) disposeObject(previous);
        b.spatialReady = false; addDepth(b.owner);
        const branchGroup = new THREE.Group(), wood = new THREE.Mesh(woodGeometry(b), woodMaterial());
        const moss = decorationGeometry(b, false), blooms = decorationGeometry(b, true);
        const mossPoints = new THREE.Points(moss.geometry, decorationMaterial(false));
        const flowers = new THREE.Points(blooms.geometry, decorationMaterial(true));
        branchGroup.add(wood, mossPoints, flowers); group.add(branchGroup);
        branchGroup.children.forEach(child => { child.frustumCulled = false; });
        const bounds = [...b.pts, ...b.twigs.flatMap(tw => [...tw.points3d, ...(tw.forkPoints3d || [])]), ...moss.bounds, ...blooms.bounds];
        objects.set(b, { group: branchGroup, wood, moss: mossPoints, flowers, bounds, signature });
        revision++;
      }
    },
    project(p) { return projectPoint(p, state.yaw, state.pitch, state.pivot); },
    bounds(b) { return objects.get(b)?.bounds || b.pts; },
    setPivot(pivot) {
      const before = api.project({ x: 0, y: 0, z: 0 }); state.pivot = { ...pivot };
      const after = api.project({ x: 0, y: 0, z: 0 });
      return { x: after.x - before.x, y: after.y - before.y };
    },
    orbit(dx, dy) {
      state.targetYaw += dx * .006;
      state.targetPitch = clamp(state.targetPitch + dy * .006, -Math.PI / 2, Math.PI / 2);
    },
    snap(yaw, pitch) {
      state.targetYaw = state.yaw + Math.atan2(Math.sin(yaw - state.yaw), Math.cos(yaw - state.yaw));
      state.targetPitch = pitch;
    },
    reset() { api.snap(0, 0); },
    step(dt, instant) {
      const k = instant ? 1 : 1 - Math.exp(-dt * 20);
      state.yaw += (state.targetYaw - state.yaw) * k; state.pitch += (state.targetPitch - state.pitch) * k;
      const busy = Math.abs(state.yaw - state.targetYaw) + Math.abs(state.pitch - state.targetPitch) > .0001;
      if (!busy) { state.yaw = state.targetYaw; state.pitch = state.targetPitch; }
      return busy;
    },
    resize(width, height, pixels) {
      const w = Math.ceil(width / pixels), h = Math.ceil(height / pixels);
      renderer.setSize(w, h, false);
      if (depthTarget.width !== w || depthTarget.height !== h) {
        depthTarget.setSize(w, h); depthData = new Uint8Array(w * h * 4); depthStamp = '';
      }
      canvas.style.width = w * pixels + 'px'; canvas.style.height = h * pixels + 'px';
    },
    render(cam, zoom, width, height, pixels, thickness, blossom, time) {
      camera.left = -width / zoom / 2; camera.right = (depthTarget.width * pixels - width / 2) / zoom;
      camera.top = height / zoom / 2; camera.bottom = -(depthTarget.height * pixels - height / 2) / zoom;
      camera.position.set(cam.x, -cam.y, 30000); camera.updateProjectionMatrix();
      const p = state.pivot;
      group.matrix.makeTranslation(p.x, -p.y, p.z)
        .multiply(new THREE.Matrix4().makeRotationX(state.pitch))
        .multiply(new THREE.Matrix4().makeRotationY(state.yaw))
        .multiply(new THREE.Matrix4().makeTranslation(-p.x, p.y, -p.z));
      let breathing = false;
      for (const [b, object] of objects) {
        object.wood.material.uniforms.age.value = b.age; object.wood.material.uniforms.thickness.value = thickness;
        object.wood.material.uniforms.time.value = time;
        breathing ||= object.moss.geometry.getAttribute('position').count > 0;
        for (const points of [object.moss, object.flowers]) {
          const u = points.material.uniforms; u.age.value = b.age; u.scale.value = zoom; u.pixels.value = pixels; u.blossom.value = blossom; u.time.value = time;
        }
      }
      renderer.render(scene, camera);
      const stamp = [revision, cam.x, cam.y, zoom, width, height, pixels, thickness, blossom, breathing ? time : 0,
        state.yaw, state.pitch, p.x, p.y, p.z, ...[...objects.keys()].map(b => b.age)].map(n => n.toFixed(5)).join(',');
      if (depthData && stamp !== depthStamp) {
        const materials = [...objects.values()].flatMap(object => object.group.children.map(child => child.material));
        for (const material of materials) material.uniforms.depthPass.value = true;
        try {
          // White encodes empty space in the packed depth map, regardless of theme.
          renderer.setClearColor('#ffffff');
          renderer.setRenderTarget(depthTarget); renderer.render(scene, camera);
          renderer.readRenderTargetPixels(depthTarget, 0, 0, depthTarget.width, depthTarget.height, depthData);
          depthStamp = stamp; depthVersion++;
        } finally {
          renderer.setRenderTarget(null); renderer.setClearColor(background);
          for (const material of materials) material.uniforms.depthPass.value = false;
        }
      }
      drawGizmo();
    },
    occludeLabels(nodes, zoom, q, cam, width, height, pixels) {
      const active = new Set(nodes);
      for (const node of maskedNodes) if (!active.has(node)) { clearMask(node); maskedNodes.delete(node); }
      for (const node of nodes) {
        maskedNodes.add(node);
        const anchor = api.project(node), scale = zoom * q;
        const depth = (30000 - anchor.z - camera.near) / (camera.far - camera.near);
        for (const el of [node.el, node.back].filter(Boolean)) {
          if (!sizes.has(el)) sizes.set(el, { width: el.offsetWidth, height: el.offsetHeight });
          const size = sizes.get(el);
          const rect = { x: (anchor.x - cam.x) * zoom + width / 2 - (node.children ? 9 : 6.5) * scale,
            y: (anchor.y - cam.y) * zoom + height / 2 - size.height * scale / 2,
            width: size.width * scale, height: size.height * scale };
          const key = [depthVersion, rect.x, rect.y, rect.width, rect.height, depth].join(',');
          if (maskCache.get(el) === key) continue;
          const mask = rect.width && rect.height ? labelDepthMask(depthData, depthTarget.width, depthTarget.height, pixels, rect, depth) : null;
          const image = mask ? `url("data:image/svg+xml,${encodeURIComponent(mask.svg)}")` : '';
          el.style.maskImage = image; el.style.webkitMaskImage = image;
          el.style.maskSize = '100% 100%'; el.style.maskRepeat = 'no-repeat';
          if (el === node.el) el.style.pointerEvents = mask?.hidden ? 'none' : '';
          maskCache.set(el, key);
        }
      }
    },
    labelPointVisible(node, x, y) {
      const depth = (30000 - api.project(node).z - camera.near) / (camera.far - camera.near);
      const pixels = parseFloat(canvas.style.width) / depthTarget.width;
      return !behindScene(sceneDepth(depthData, depthTarget.width, depthTarget.height, Math.floor(x / pixels), Math.floor(y / pixels)), depth);
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', lost);
      for (const object of objects.values()) disposeObject(object);
      for (const node of maskedNodes) clearMask(node);
      maskedNodes.clear(); objects.clear(); depthTarget.dispose(); disposeGizmo(); renderer.dispose();
    },
  };
  if (controls.gizmo) {
    const element = controls.gizmo;
    const gizmoRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    gizmoRenderer.setPixelRatio(Math.min(devicePixelRatio, 2)); gizmoRenderer.setSize(128, 128);
    gizmoRenderer.setClearColor('#ffffff', 0); element.append(gizmoRenderer.domElement); element.hidden = false;
    const gizmoCamera = new THREE.PerspectiveCamera(), helper = new ViewHelper(gizmoCamera, gizmoRenderer.domElement);
    helper.setLabels('X', 'Y', 'Z'); helper.setLabelStyle('30px system-ui', '#ffffff', 22);
    for (const object of helper.children) {
      if (object.isSprite) { object.position.multiplyScalar(1.15); object.scale.setScalar(1.1); }
      else object.scale.x = 1.15;
    }
    const axes = helper.children.map(object => ({ object, position: object.position.clone(), scale: object.scale.clone() }));
    const origin = new THREE.Mesh(new THREE.SphereGeometry(.105, 12, 8), new THREE.MeshBasicMaterial({ color: '#65715d' }));
    helper.add(origin);
    helper.location.left = 0; helper.location.top = 0;
    let pointer = null, orientation = '';
    drawGizmo = () => {
      const next = `${state.yaw},${state.pitch},${gizmoAmount}`;
      if (orientation === next) return;
      orientation = next;
      const phase = gizmoProgress(gizmoAmount);
      for (const { object, position, scale } of axes) {
        object.visible = phase.axes > .001;
        if (object.isSprite) {
          object.position.copy(position).multiplyScalar(phase.axes); object.scale.copy(scale).multiplyScalar(phase.axes);
        } else object.scale.set(scale.x * phase.axes, scale.y, scale.z);
      }
      origin.visible = phase.origin > .001; origin.scale.setScalar(phase.origin);
      gizmoCamera.quaternion.setFromEuler(new THREE.Euler(state.pitch, state.yaw, 0, 'XYZ')).invert();
      gizmoCamera.position.set(0, 0, 5).applyQuaternion(gizmoCamera.quaternion);
      gizmoRenderer.clear(); helper.render(gizmoRenderer);
    };
    const down = event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); element.focus({ preventScroll: true });
      element.setPointerCapture(event.pointerId);
      pointer = { x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, dragged: false };
      controls.onOrbitStart?.();
    };
    const move = event => {
      if (!pointer) return;
      event.preventDefault(); event.stopPropagation();
      if (!pointer.dragged && Math.hypot(event.clientX - pointer.sx, event.clientY - pointer.sy) < 3) return;
      pointer.dragged = true;
      api.orbit(event.clientX - pointer.x, event.clientY - pointer.y);
      pointer.x = event.clientX; pointer.y = event.clientY; controls.onChange?.();
    };
    const up = event => {
      if (!pointer) return;
      event.preventDefault(); event.stopPropagation();
      if (!pointer.dragged && event.type === 'pointerup' && helper.handleClick(event)) {
        helper.update(1000);
        const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(gizmoCamera.quaternion);
        api.snap(Math.atan2(-direction.x, direction.z), Math.asin(clamp(direction.y, -1, 1)));
      }
      pointer = null; controls.onOrbitEnd?.(); controls.onChange?.();
    };
    const key = event => {
      const axis = { x: [-Math.PI / 2, 0], y: [0, Math.PI / 2], z: [0, 0], Home: [0, 0] }[event.key];
      if (!axis && !event.key.startsWith('Arrow')) return;
      event.preventDefault(); event.stopPropagation();
      controls.onOrbitStart?.();
      if (axis) api.snap(...axis);
      else api.orbit(event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0, event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0);
      controls.onOrbitEnd?.(); controls.onChange?.();
    };
    const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, keydown: key };
    for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener);
    disposeGizmo = () => {
      for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener);
      origin.geometry.dispose(); origin.material.dispose();
      helper.dispose(); gizmoRenderer.dispose(); gizmoRenderer.forceContextLoss(); gizmoRenderer.domElement.remove(); element.hidden = true;
    };
  }
  return api;
}
