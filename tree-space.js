const hash = (a, b = 0) => {
  const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return n - Math.floor(n);
};
const seed = text => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
const smooth = t => t * t * (3 - 2 * t);

export function viewProgress(time, leaving = false) {
  const t = Math.max(0, Math.min(1, time));
  if (!leaving) return { blend: smooth(t), front: 0 };
  return { blend: 1 - smooth(Math.max(0, (t - .55) / .45)), front: smooth(Math.min(1, t / .7)) };
}

export function gizmoProgress(value) {
  const t = Math.max(0, Math.min(1, value));
  return { axes: smooth(Math.max(0, (t - .3) / .7)), origin: smooth(Math.min(1, t / .3)) };
}

export function projectPoint(p, yaw = 0, pitch = 0, pivot = { x: 0, y: 0, z: 0 }) {
  const x = p.x - pivot.x, y = p.y - pivot.y, z = (p.z || 0) - pivot.z;
  const u = Math.cos(yaw) * x + Math.sin(yaw) * z;
  const d = -Math.sin(yaw) * x + Math.cos(yaw) * z;
  return { x: pivot.x + u, y: pivot.y + Math.cos(pitch) * y + Math.sin(pitch) * d,
    z: pivot.z - Math.sin(pitch) * y + Math.cos(pitch) * d };
}

export function addDepth(node) {
  const b = node.branch;
  if (!b || b.spatialReady) return;
  if (node.parent) addDepth(node.parent);
  const key = seed(node.start.path + '#depth'), base = node.z || 0, length = node.start.len;
  const drift = (hash(key, 1) - .5) * Math.min(280, length * .36);
  const amplitude = Math.min(90, length * .11), phase = hash(key, 2) * Math.PI * 2;
  for (const p of b.pts) p.z = base + drift * smooth(p.t) + Math.sin(Math.PI * p.t) * Math.sin(p.t * 5 + phase) * amplitude;
  for (const kid of node.children) {
    const tw = kid.stem, origin = b.pts[tw.i], childSeed = seed(node.start.path + '/' + kid.name);
    kid.z = origin.z + (hash(childSeed, 3) - .5) * 120;
    for (const p of tw.path) {
      const t = p.d / tw.len;
      p.z = origin.z + (kid.z - origin.z) * smooth(t) + Math.sin(Math.PI * t) * (hash(childSeed, 4) - .5) * 24;
    }
  }
  for (const tw of b.twigs) {
    const origin = b.pts[tw.i];
    tw.forkPoints3d = null;
    if (tw.path) tw.points3d = tw.path;
    else {
      const count = Math.max(1, Math.ceil(tw.len / 4)), dz = (hash(tw.seed, 6) - .5) * tw.len * .9;
      tw.points3d = Array.from({ length: count + 1 }, (_, i) => {
        const t = i / count, d = tw.len * t;
        return { x: origin.x + Math.cos(tw.a) * d, y: origin.y + Math.sin(tw.a) * d,
          z: origin.z + dz * t + Math.sin(Math.PI * t) * dz * .25, d };
      });
    }
    if (tw.fork) {
      const f = tw.fork, length = f.len * tw.len, count = Math.max(1, Math.ceil(length / 4));
      const at = Math.min(tw.points3d.length - 1, Math.round(f.at * (tw.points3d.length - 1)));
      const start = tw.points3d[at], dz = (hash(tw.seed, 7) - .5) * length;
      tw.forkPoints3d = Array.from({ length: count + 1 }, (_, i) => {
        const d = length * i / count;
        return { x: start.x + Math.cos(tw.a + f.da) * d, y: start.y + Math.sin(tw.a + f.da) * d,
          z: start.z + dz * i / count, d: f.at * tw.len + d };
      });
    }
  }
  for (const f of b.blossoms) {
    const stalk = b.twigs.find(tw => tw.stalk && tw.i === f.i);
    f.z = (stalk?.points3d.at(-1).z ?? b.pts[f.i].z) + (hash(f.x, f.y) - .5) * 12;
  }
  for (const m of b.moss) {
    const p = b.pts[m.i], side = hash(m.seed, 8) < .22 ? -1 : 1;
    m.center3d = { x: p.x - Math.sin(p.a) * m.side * m.off, y: p.y + Math.cos(p.a) * m.side * m.off,
      z: p.z + side * (p.w * 1.3 + m.r) };
  }
  b.spatialReady = true;
}
