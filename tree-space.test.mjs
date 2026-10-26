import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from 'three';
import { addDepth, projectPoint, viewProgress, gizmoProgress } from './tree-space.js';
import { behindScene, labelDepthMask, sceneDepth } from './label-depth.js';

function tree() {
  const root = { start: { path: '', len: 200 }, children: [] };
  const kid = { name: 'folder', x: 140, y: -50, parent: root, children: [], start: { path: '/folder', len: 120 } };
  const stem = { i: 1, len: 80, path: [{ x: 100, y: 20, d: 0 }, { x: 120, y: -10, d: 40 }, { x: 140, y: -50, d: 80 }], stalk: true };
  kid.stem = stem; root.children.push(kid);
  root.branch = { owner: root, pts: [{ x: 0, y: 0, t: 0, w: 6 }, { x: 100, y: 20, t: .5, w: 4 }, { x: 200, y: 0, t: 1, w: 1 }],
    twigs: [stem, { i: 2, a: -.6, len: 64, seed: 4, fork: { at: .5, da: .4, len: .4 } }],
    moss: [{ i: 1, side: -1, off: 2, r: 4, seed: 12 }], blossoms: [{ i: 1, x: 135, y: -48 }] };
  kid.branch = { owner: kid, pts: [{ x: 142, y: -44, t: 0, w: 3 }, { x: 190, y: -100, t: .5, w: 2 }, { x: 230, y: -140, t: 1, w: 1 }],
    twigs: [], moss: [], blossoms: [] };
  return root;
}
const root = tree(), kid = root.children[0];
const xy = root.branch.pts.map(p => [p.x, p.y]);
addDepth(kid);
assert.deepEqual(root.branch.pts.map(p => [p.x, p.y]), xy, 'depth preserves the original planar silhouette');
assert.equal(kid.stem.path[0].z, root.branch.pts[1].z, 'shoot attaches at the parent depth');
assert.equal(kid.stem.path.at(-1).z, kid.z, 'folder sits at the shoot endpoint depth');
assert.equal(kid.branch.pts[0].z, kid.z, 'the opened branch inherits the folder depth');
assert.equal(root.branch.blossoms[0].z > kid.z - 7 && root.branch.blossoms[0].z < kid.z + 7, true, 'flowers stay around their shoot tip');
for (const b of [root.branch, kid.branch]) {
  for (const p of [...b.pts, ...b.twigs.flatMap(t => [...t.points3d, ...(t.forkPoints3d || [])])]) assert.ok(Number.isFinite(p.z));
}
const again = tree(); addDepth(again.children[0]);
assert.deepEqual(root.branch.pts.map(p => p.z), again.branch.pts.map(p => p.z), 'depth repeats for the same paths');
assert.deepEqual(kid.branch.pts.map(p => p.z), again.children[0].branch.pts.map(p => p.z), 'nested depth repeats');
root.branch.twigs[1].len = 20; root.branch.twigs[1].fork = null; root.branch.spatialReady = false;
addDepth(root);
assert.equal(root.branch.twigs[1].points3d.at(-1).d, 20, 'shortened twigs rebuild at their new length');
assert.equal(root.branch.twigs[1].forkPoints3d, null, 'removed forks leave no stale 3D geometry');

const pivot = { x: 75, y: -28, z: 14 };
for (const yaw of [-Math.PI, -Math.PI / 2, 0, .6, Math.PI / 2, Math.PI]) for (const pitch of [-Math.PI / 2, 0, .5, Math.PI / 2]) {
  const matrix = new Matrix4().makeTranslation(pivot.x, -pivot.y, pivot.z)
    .multiply(new Matrix4().makeRotationX(pitch)).multiply(new Matrix4().makeRotationY(yaw))
    .multiply(new Matrix4().makeTranslation(-pivot.x, pivot.y, -pivot.z));
  for (const p of [...root.branch.pts, ...kid.branch.pts]) {
    const projected = projectPoint(p, yaw, pitch, pivot), actual = new Vector3(p.x, -p.y, p.z).applyMatrix4(matrix);
    assert.ok(Math.abs(projected.x - actual.x) < 1e-8 && Math.abs(projected.y + actual.y) < 1e-8 && Math.abs(projected.z - actual.z) < 1e-8,
      'DOM label projection agrees with the WebGL scene at every orbit angle');
  }
  const center = projectPoint(pivot, yaw, pitch, pivot);
  assert.deepEqual(center, pivot, 'orbit keeps its pivot stationary');
}
assert.deepEqual(projectPoint({ x: 13, y: -7, z: 90 }), { x: 13, y: -7, z: 90 }, 'front view preserves x/y exactly');
assert.notEqual(projectPoint({ x: 13, y: -7, z: 90 }, .5).x, projectPoint({ x: 13, y: -7, z: 0 }, .5).x, 'orbit reveals spatial depth');
console.log('3D depth, junctions, regrowth, and camera projection ok');

assert.deepEqual(viewProgress(0), { blend: 0, front: 0 }, 'entry begins with the complete 2D rendering');
assert.deepEqual(viewProgress(1), { blend: 1, front: 0 }, 'entry ends in the complete 3D rendering');
assert.equal(viewProgress(.55, true).blend, 1, 'exit aligns the camera before showing the flat rendering');
assert.equal(viewProgress(.7, true).front, 1, 'camera alignment finishes before the crossfade ends');
assert.ok(viewProgress(1, true).blend < 1e-10 && viewProgress(1, true).front === 1, 'exit ends at the exact front view');
let lastBlend = 1, lastFront = 0;
for (let t = 0; t <= 1; t += .025) {
  const phase = viewProgress(t, true);
  assert.ok(phase.blend <= lastBlend + 1e-10 && phase.front >= lastFront - 1e-10, 'exit moves continuously toward 2D');
  lastBlend = phase.blend; lastFront = phase.front;
}
console.log('3D mode transition sequencing ok');

assert.deepEqual(gizmoProgress(0), { axes: 0, origin: 0 }, 'the helper starts completely hidden');
assert.deepEqual(gizmoProgress(.3), { axes: 0, origin: 1 }, 'the origin appears before any axes unfold');
assert.deepEqual(gizmoProgress(1), { axes: 1, origin: 1 }, 'the helper finishes fully extended');
assert.equal(gizmoProgress(.7).origin, 1, 'the origin stays visible while axes retract');
assert.equal(gizmoProgress(.15).axes, 0, 'the axes are closed before the origin disappears');
assert.ok(gizmoProgress(.15).origin > 0 && gizmoProgress(.15).origin < 1, 'the final stage fades the origin');
console.log('Axis unfolding and origin disappearance sequencing ok');

const depthPixels = new Uint8Array(4 * 2 * 4).fill(255);
const putDepth = (x, y, depth) => {
  const value = Math.floor(depth * 16777215), i = ((1 - y) * 4 + x) * 4;
  depthPixels[i] = value >> 16; depthPixels[i + 1] = (value >> 8) & 255; depthPixels[i + 2] = value & 255;
};
putDepth(1, 0, .2);
assert.ok(Math.abs(sceneDepth(depthPixels, 4, 2, 1, 0) - .2) < 1e-7, 'packed GPU depth retains fine precision and flips framebuffer Y');
assert.equal(sceneDepth(depthPixels, 4, 2, 1, 1), 1, 'an uncovered pixel remains at background depth');
assert.equal(behindScene(.2, .3), true, 'foreground geometry covers a label');
assert.equal(behindScene(.4, .3), false, 'background geometry leaves a label visible');
assert.equal(behindScene(.300001, .3), false, 'nearly coplanar surfaces do not flicker');
const labelRect = { x: 0, y: 0, width: 4, height: 2 };
const partialMask = labelDepthMask(depthPixels, 4, 2, 1, labelRect, .3);
assert.equal(partialMask.hidden, false);
assert.match(partialMask.svg, /M0.00 0.00h1v1h-1zM2.00 0.00h2v1h-2z/, 'only the occluded part of a label is removed');
assert.equal(labelDepthMask(depthPixels, 4, 2, 1, labelRect, .1), null, 'labels in front need no mask');
for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) putDepth(x, y, .2);
assert.equal(labelDepthMask(depthPixels, 4, 2, 1, labelRect, .3).hidden, true, 'fully occluded labels stop intercepting mouse clicks');
console.log('GPU depth decoding and partial label occlusion ok');

// Exercise the actual pointer handlers so Alt-drag cannot also pan or click a folder.
const { readFileSync } = await import('node:fs');
const vm = await import('node:vm');
const source = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const handlers = new Map(), moves = [], pans = [], captures = [];
const orbitView = { setPivot: () => ({ x: 0, y: 0 }), orbit: (x, y) => moves.push([x, y]), reset() {} };
const input = vm.createContext({ view3d: orbitView, orbitDragging: false, cam: { x: 0, y: 0 }, cv: { setPointerCapture: id => captures.push(id) },
  focus: { branch: { pts: [{ x: 10, y: 20, z: 3 }] } }, autoZoomControl: { checked: false }, manual: false,
  zoomTarget: null, wake() {}, zoomAt() {}, panBy: (x, y) => pans.push([x, y]),
  folderMenu: { hidden: true }, document: { body: { classList: { add() {}, remove() {} } } },
  setTimeout: fn => fn(), addEventListener: (name, fn) => handlers.set(name, fn),
});
vm.runInContext(source.slice(source.indexOf('function beginOrbit()'), source.indexOf('const src =')) +
  ';globalThis.dragState = () => ({ dragged, count: pointers.size });', input);
const event = (x, y, altKey = true) => ({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, altKey,
  target: { closest: () => null }, preventDefault() {} });
handlers.get('pointerdown')(event(100, 100));
handlers.get('pointermove')(event(102, 100));
assert.equal(moves.length, 0, 'small movements remain clicks');
assert.equal(captures.length, 0, 'ordinary clicks never capture replaceable icon fragments');
handlers.get('pointermove')(event(125, 110));
assert.equal(moves.length, 1, 'Alt-drag rotates the 3D view');
assert.deepEqual(captures, [1], 'actual drags capture their stable target');
assert.equal(pans.length, 0, 'orbit never also pans');
assert.equal(input.dragState().dragged, true, 'orbit suppresses the following folder click');
handlers.get('pointercancel')(event(125, 110));
assert.equal(input.dragState().count, 0, 'cancelled gestures release their pointer');
assert.equal(input.orbitDragging, false, 'cancelled gestures release the auto-fit hold');
handlers.get('pointerdown')(event(100, 100, false));
handlers.get('pointermove')(event(125, 110, false));
assert.equal(pans.length, 1, 'ordinary drag still pans in 3D');
handlers.get('pointerup')(event(125, 110, false));
input.view3d = null;
handlers.get('pointerdown')(event(100, 100));
handlers.get('pointermove')(event(125, 110));
assert.equal(pans.length, 2, 'Alt-drag preserves 2D panning when the feature is off');
console.log('3D pointer routing and click suppression ok');
