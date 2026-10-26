import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Eye, EyeOff, RotateCcw, Option, Command, Sun, Moon } from 'lucide';
import { parse } from './parse.js';
import { viewProgress, gizmoProgress } from './tree-space.js';

// Run the actual layout and drawing functions with a minimal DOM.
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = html.split('<script type="module">')[1].split('const cv =')[0]
  .replace(/^import .*;$/gm, '');
const motion = { matches: true };
const metrics = { width: 7 };
const element = () => ({
  addEventListener() {}, setAttribute() {}, append() {}, remove() {}, style: {}, firstElementChild: { innerHTML: '' }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, animations: [],
  getAnimations() { return this.animations; },
  animate(frames, options) {
    const animation = { ...options, frames, cancel() { this.cancelled = true; } };
    this.animations.push(animation); return animation;
  },
});
const context = vm.createContext({
  Eye, EyeOff, RotateCcw, Option, Command, Sun, Moon, createIcons() {}, parse, viewProgress, gizmoProgress,
  addEventListener() {}, getComputedStyle: () => ({ getPropertyValue: () => '#fff' }),
  localFiles: null, view3d: null, orbitDragging: false, open: new Set(), dragged: false, matchMedia: () => motion, document: {
  createElement: tag => tag === 'canvas' ? { getContext: () => ({ measureText: s => ({ width: s.length * metrics.width }) }) } : element(),
  querySelectorAll: () => [], documentElement: { dataset: { theme: 'light' } },
  body: { append() {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, style: { setProperty() {} } },
} });
vm.runInContext(script + `
  globalThis.folderFrames = FOLDER_FRAMES;
  globalThis.fileIcon = fileIcon;
  globalThis.bounceItem = bounce;
  globalThis.getGeometry = geometry; globalThis.growNode = grow; globalThis.discardNode = discard;
  globalThis.build = (text, route = []) => {
    labels = []; placedLabels = []; branches = [];
    const root = parse(text); open = new Set([root]);
    root.start = { x: 0, y: 0, a: -.08, depth: 0, path: '', len: Math.max(950, 70 * root.children.length + 300) };
    grow(root);
    let node = root;
    for (const name of route) { node = node.children.find(k => k.name === name); open.add(node); grow(node); }
    return root;
  };
`, context);
const iconExamples = {
  image: ['landscape.PNG', 'drawing.svg', 'slide.tif'], code: ['app.tsx', 'settings.json', 'script.py'],
  audio: ['birdsong.wav', 'song.mp3'], video: ['growth.mp4', 'clip.MOV'],
  table: ['measurements.xlsx', 'weather.csv'], archive: ['specimens.zip', 'backup.tar.gz'],
  document: ['notes.txt', 'guide.pdf', 'README', 'unknown.xyz'],
};
const marks = new Set();
for (const [type, names] of Object.entries(iconExamples)) {
  const icon = context.fileIcon(names[0]);
  assert.match(icon, new RegExp('class="file-' + type + '"'));
  assert.match(icon, /fill="var\(--canvas-bg\)"/, 'file icons remain opaque');
  assert.match(icon, /viewBox="0 0 13 16"/, 'all file types retain the same layout size');
  marks.add(icon.replace(/class="[^"]*"/, ''));
  for (const name of names) assert.equal(context.fileIcon(name), icon, 'extensions map consistently, ignoring case');
}
assert.equal(marks.size, Object.keys(iconExamples).length, 'each file type has a distinct pixel glyph');
for (const file of ['tree.txt', 'video-tree.txt']) {
  const root = context.build(readFileSync(new URL(file, import.meta.url), 'utf8'), ['woodland']);
  const folders = root.children.filter(k => k.branch);
  for (const parent of [root, ...folders]) for (const kid of parent.children.filter(k => k.children)) {
    assert.ok(parent.branch.twigs.includes(kid.stem), `${kid.name} needs its own parent shoot`);
    const tip = kid.stem.path.at(-1), half = kid.children ? 9 : 6.5;
    const dx = Math.max(0, Math.abs(tip.x - kid.x) - half * 1.9);
    const dy = Math.max(0, Math.abs(tip.y - kid.y) - 8 * 1.9);
    assert.ok(Math.max(dx, dy) >= 6 && Math.max(dx, dy) < 14, 'shoot ends with a small icon gap');
    assert.equal(kid.stem.width, parent.branch.pts[kid.stem.i].w, 'shoot inherits its origin thickness');
  }
  for (const parent of [root, ...folders]) for (const kid of parent.children) {
    const b = kid.rect;
    assert.ok(!parent.branch.pts.some(p => p.x > b.x0 - 24 && p.x < b.x1 + 24 &&
      p.y > b.y0 - 24 && p.y < b.y1 + 24), `${kid.name} must clear its parent branch`);
  }
  for (const parent of [root, ...folders]) {
    const shoots = parent.children.map(k => k.stem);
    assert.equal(new Set(shoots.map(tw => tw.i)).size, shoots.length, 'siblings need distinct branch junctions');
    for (const kid of parent.children) {
      const tw = kid.stem;
      assert.ok(kid.tr * parent.branch.dur >= parent.branch.pts[tw.i].tr * parent.branch.dur + tw.delay + tw.len / 220 - 1e-8,
        'icons appear after their connecting shoots reach them');
    }
    for (const tw of shoots) {
      assert.ok(tw.path.every((p, i) => !i || p.d > tw.path[i - 1].d), 'growth follows increasing arc distance');
      const a = tw.path[0], b = tw.path.at(-1), middle = tw.path[Math.floor(tw.path.length / 2)];
      assert.ok(Math.abs((middle.x - a.x) * (b.y - a.y) - (middle.y - a.y) * (b.x - a.x)) > 1, 'shoots should curve');
    }
    assert.equal(parent.branch.pts[0].w, parent === root ? 6 : 3, 'each folder resets branch thickness, with the original root width');
    if (parent !== root) {
      const start = parent.branch.pts[0], next = parent.branch.pts[1];
      assert.ok(next.y < start.y, 'growth exits upward through the opening before it can bend down');
    }
    for (const flower of parent.branch.blossoms) {
      assert.ok(flower.size >= 2, 'blossoms use larger petal clusters');
      const shoot = shoots.find(tw => tw.i === flower.i);
      assert.ok(flower.delay > shoot.delay + shoot.len / 220, 'flowers open after their shoot reaches the tip');
      assert.ok(Math.hypot(flower.x - shoot.path.at(-1).x, flower.y - shoot.path.at(-1).y) < 24, 'flowers form tip clusters');
    }
  }
  for (const folder of folders) {
    assert.ok(folder.branch.pts.length > 20, 'open branches need a clear route with room for their children');
    assert.equal(folder.back.hidden, true, 'backs stay hidden until their labels appear');
  }
  for (let i = 0; i < folders.length; i++) for (const other of folders.slice(i + 1)) {
    const a = folders[i].branch.pts, b = other.branch.pts;
    const near = a.filter((p, j) => j % 3 === 0 && b.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 24));
    assert.equal(near.length, 0, `${folders[i].name} overlaps ${other.name}`);
  }
}

function checkActive(root) {
  const nodes = [], labels = [];
  const visit = n => { if (!n.branch) return; nodes.push(n); labels.push(...n.children); n.children.forEach(visit); };
  visit(root);
  for (const n of nodes) for (const p of n.branch.pts) for (const kid of labels) {
    const b = kid.rect;
    const radius = p.w * 4 / 2;
    assert.ok(!(p.x > b.textX0 - radius && p.x < b.x1 + radius && p.y > b.y0 - radius && p.y < b.y1 + radius),
      `${n.name || 'root'} crosses text for ${kid.name}`);
  }
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i];
    assert.equal(n.branch.pts[0].w, 3, 'nested folders restart at full branch thickness');
    assert.ok(n.branch.pts[1].y < n.branch.pts[0].y, 'every outlet first grows through the upper mouth');
    for (const older of nodes.slice(0, i)) {
      const wood = context.getGeometry(older.branch, n.stem, true);
      for (const p of n.branch.pts.slice(8)) assert.ok(!wood.some(q => Math.hypot(p.x - q.x, p.y - q.y) < (q.r || 0) + 8),
        `${n.name} crosses older branch ${older.name}`);
    }
  }
}
const demoText = readFileSync(new URL('./tree.txt', import.meta.url), 'utf8');
const folderRoutes = [];
function routes(n, path = []) {
  for (const k of n.children || []) if (k.children) { const next = [...path, k.name]; folderRoutes.push(next); routes(k, next); }
}
routes(parse(demoText));
for (const route of folderRoutes) {
  checkActive(context.build(demoText, route));
}
const river = context.build(demoText, ['river']).children.find(k => k.name === 'river');
let flat = 0, longestFlat = 0;
for (let i = 1; i < river.branch.pts.length; i++) {
  const a = river.branch.pts[i - 1], b = river.branch.pts[i];
  flat = Math.abs(b.y - a.y) < Math.hypot(b.x - a.x, b.y - a.y) * .025 ? flat + Math.hypot(b.x - a.x, b.y - a.y) : 0;
  longestFlat = Math.max(longestFlat, flat);
}
assert.ok(longestFlat < 96, 'river routing must not contain a long horizontal grid shelf');
const hedgerowRoot = context.build(demoText, ['meadow', 'hedgerow']);
const hedgerow = hedgerowRoot.children.find(k => k.name === 'meadow').children.find(k => k.name === 'hedgerow');
const text = hedgerow.rect;
assert.ok(hedgerow.branch.pts.some(p => p.x > text.textX0 - 18 && p.x < text.x1 + 18 &&
  p.y > text.y0 - 18 && p.y < text.y1 + 18), 'branches can enter the old oversized text clearance zone');
checkActive(hedgerowRoot);
const switching = context.build(demoText, ['woodland', 'birch-grove']);
const woodland = switching.children.find(k => k.name === 'woodland');
context.discardNode(woodland);
assert.equal(woodland.branch, undefined, 'collapsed geometry is discarded');
context.growNode(woodland);
context.growNode(woodland.children.find(k => k.name === 'old-oak'));
checkActive(switching);
for (const [text, route] of [
  ['', []],
  ['empty/', ['empty']],
  ['single/a/b/c/file.txt', ['single', 'a', 'b', 'c']],
  ['same/same/same/file.txt', ['same', 'same', 'same']],
  ['folder/' + 'a very long filename '.repeat(12) + '.txt\nfolder/other.txt', ['folder']],
  [Array.from({ length: 24 }, (_, i) => `wide/folder-${i}/`).join('\n'), ['wide']],
]) checkActive(context.build(text, route));
// Different font metrics must still find separate, unobstructed shoot paths.
metrics.width = 6.3;
const narrow = context.build(readFileSync(new URL('./tree.txt', import.meta.url), 'utf8'));
assert.ok(narrow.children.every(k => k.stem.path.length > 2));
metrics.width = 7;
const interactionTree = context.build('folder/file.txt\nfile.txt');
const folder = interactionTree.children[0], file = interactionTree.children[1];
assert.match(file.el.innerHTML, /fill="var\(--canvas-bg\)"/);
file.el.onclick();
assert.equal(file.el.animations.length, 0, 'reduced motion skips bounce');
motion.matches = false;
file.el.onclick();
assert.equal(file.el.animations.length, 1, 'file clicks bounce');
context.dragged = true;
file.el.onclick();
assert.equal(file.el.animations.length, 1, 'dragging does not bounce');
context.dragged = false;
context.bounceItem(folder);
assert.equal(folder.el.animations[0].duration, folder.back.animations[0].duration, 'folder layers bounce together');
const previous = folder.el.animations[0];
context.bounceItem(folder);
assert.equal(previous.cancelled, true, 'repeated clicks restart the bounce');
assert.match(html, /\.folder-back \{[^}]*pointer-events: none/);
assert.match(html, /const FOLDER_BACK = .*fill="var\(--canvas-bg\)"/);
assert.match(html, /transform: scale\(1\.06\)/);
assert.doesNotMatch(html, /skewX|skewY|rotate\(/, 'folder outlines must retain their orthogonal pixel edges');
assert.equal((folder.el.innerHTML.match(/<svg/g) || []).length, 1, 'folder has one opaque flap');
assert.equal(new Set(context.folderFrames).size, 5, 'hover and open states have distinct stepped silhouettes');
for (const frame of context.folderFrames) assert.match(frame, /fill="var\(--canvas-bg\)"/);
assert.doesNotMatch(html, /fold-closed|fold-open/, 'folder states never ghost through one another');
assert.match(html, /prefers-reduced-motion: reduce/);
assert.doesNotMatch(file.el.innerHTML, /M2 14h1/, 'document bottom row has no content line');
assert.doesNotMatch(html, /ctx\.clip/, 'branches must route around text without cutouts');
assert.doesNotMatch(html, /render\(n\.branch, n\.branch\.gh/);
// Exercise the real frame/toggle lifecycle, including removal of collapsed geometry.
let recorded = null;
const paint = { clearRect() {}, fillRect(...rect) { if (recorded) recorded.push(rect); } };
const canvas = { style: {}, getContext: () => paint };
context.document.getElementById = id => id === 'c' ? canvas : element();
Object.assign(context, { innerWidth: 1200, innerHeight: 800, performance: { now: () => 0 },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {} });
const runtime = html.split('const cv =')[1].split('const pointers = new Map();')[0];
vm.runInContext('const cv =' + runtime + `
  globalThis.live = { load, toggle, frame, resize, render, zoomAt, state: () => ({ root, focus, branches, labels, placedLabels }) };
`, context);
motion.matches = true;
context.live.resize();
context.live.load(demoText);
context.live.frame(100);
const liveRoot = context.live.state().root;
assert.equal(context.live.state().branches.length, 1, 'closed folders do not precompute branches');
const liveWoodland = liveRoot.children.find(k => k.name === 'woodland');
liveWoodland.el.onpointerenter(); context.live.frame(110);
assert.equal(liveWoodland.flapFrame, 1, 'hover opens the flap only slightly');
assert.equal(liveWoodland.el.firstElementChild.innerHTML, context.folderFrames[1]);
liveWoodland.el.onpointerleave(); context.live.frame(120);
assert.equal(liveWoodland.flapFrame, 0, 'leaving hover closes the flap');
context.live.toggle(liveWoodland); context.live.frame(200);
assert.equal(liveWoodland.flapFrame, 4, 'opening uses the fully open flap');
assert.equal(context.live.state().branches.length, 2, 'opening routes a branch against the visible tree');
checkActive(liveRoot);
const oldBranch = liveWoodland.branch;
context.live.toggle(liveWoodland); context.live.frame(300);
assert.equal(context.live.state().branches.length, 1, 'collapse releases routing obstacles');
context.live.toggle(liveWoodland); context.live.frame(400);
assert.notEqual(liveWoodland.branch, oldBranch, 'reopening plans fresh geometry');
assert.ok(liveWoodland.children.every(k => k.vis), 'reopened labels remain visible');
checkActive(liveRoot);
motion.matches = false;
context.live.toggle(liveRoot.children.find(k => k.name === 'orchard'));
context.live.frame(500);
checkActive(liveRoot);
for (let time = 600; time <= 5000; time += 100) context.live.frame(time);
assert.equal(liveWoodland.branch, undefined, 'normal-motion retraction releases the old subtree');
checkActive(liveRoot);
context.live.load('new/only.txt'); context.live.frame(5100);
assert.equal(context.live.state().branches.length, 1, 'loading replaces all cached geometry');
// Zoom-out stops at readable text size, and resizing preserves that limit.
motion.matches = true;
context.live.zoomAt(.001, 600, 400); context.live.frame(5200);
const minimumItem = context.live.state().root.children[0];
const scale = item => Number(item.el.style.transform.match(/scale\(([^)]+)\)/)[1]);
assert.ok(Math.abs(scale(minimumItem) * 13 - 18) < 1e-8, 'minimum text size is 18 screen pixels');
assert.equal(minimumItem.back.style.transform, minimumItem.el.style.transform, 'folder layers share the same minimum scale');
context.live.zoomAt(2, 600, 400); context.live.frame(5300);
assert.ok(Math.abs(scale(minimumItem) * 13 - 36) < 1e-8, 'zoom-in still scales naturally');
context.live.zoomAt(.001, 600, 400);
context.innerWidth = 400; context.live.resize(); context.live.frame(5400);
assert.ok(Math.abs(scale(minimumItem) * 13 - 18) < 1e-8, 'narrow viewports preserve readability');
// All tree marks use the exact same cell size and alignment, even during growth.
for (const z of [.5, 1.6, 4.2, 7.5]) for (const clock of [.2, 1, liveRoot.branch.cap]) {
  const cell = Math.max(1, Math.floor(z * 4 / 3));
  recorded = [];
  context.live.render(liveRoot.branch, clock, 1, 10, z, 200, 100, cell);
  assert.ok(recorded.length > 0);
  for (const [x, y, w, h] of recorded) {
    assert.equal(w, cell); assert.equal(h, cell);
    assert.ok(x % cell === 0); assert.ok(y % cell === 0);
  }
  recorded = null;
}
// Flowers follow world zoom even while the shared pixel grid remains at one cell.
const flowering = {
  pts: [{ x: 0, y: 0, tr: 0, a: 0, w: 1 }], dur: 1, twigs: [], moss: [],
  blossoms: [{ i: 0, x: 1000, y: 1000, delay: 0, size: 2.3, angle: .4, petal: '#ffb3c9', core: '#f5d76e' }],
};
const flowerWidths = [];
for (const z of [.8, 1.1, 1.4]) {
  recorded = [];
  context.live.render(flowering, 3, 1, 10, z, 0, 0, 1);
  const petals = recorded.filter(([x, y]) => x > 100 && y > 100);
  assert.ok(petals.length > 0);
  flowerWidths.push(Math.max(...petals.map(([x, , w]) => x + w)) - Math.min(...petals.map(([x]) => x)));
  assert.ok(petals.every(([x, y, w, h]) => Number.isInteger(x) && Number.isInteger(y) && w === 1 && h === 1));
}
assert.ok(flowerWidths[0] < flowerWidths[1] && flowerWidths[1] < flowerWidths[2], 'blossoms must grow continuously across zoom levels');
recorded = null;
// A perpendicular stem must never outgrow the parent at its junction during thickening.
const growth = {
  pts: [{ x: 0, y: 0, tr: 0, a: 0, w: 8 }, { x: 100, y: 0, tr: 0, a: 0, w: 8 }],
  dur: 1, moss: [], blossoms: [],
  twigs: [{ i: 0, width: 8, delay: .05, len: 24, path: [{ x: 0, y: 0, d: 0 }, { x: 0, y: 24, d: 24 }] }],
};
let matureStemWidth = 0;
for (const clock of [.1, .2, .7, 1.4, 3, .2]) {
  recorded = [];
  context.live.render(growth, clock, 1, 10, 3, 0, 0, 1);
  const parent = new Set(recorded.filter(([x]) => x === 60).map(([, y]) => y));
  const stem = new Set(recorded.filter(([, y]) => y === 9).map(([x]) => x));
  assert.ok(stem.size > 0 && stem.size <= parent.size, `stem is too thick at age ${clock}`);
  if (clock === 3) matureStemWidth = stem.size;
}
assert.ok(matureStemWidth > 1, 'stems still reach their mature taper');
// Thickening stays centered on both horizontal and vertical spines.
for (const vertical of [false, true]) for (const clock of [.2, .7, 1.4, 3]) {
  const branch = { ...growth, twigs: [], pts: growth.pts.map(p => vertical ? { ...p, x: p.y, y: p.x, a: Math.PI / 2 } : p) };
  recorded = [];
  context.live.render(branch, clock, 1, 10, 3, 0, 0, 1);
  const crossSection = recorded.filter(([x, y]) => (vertical ? y : x) === 60).map(([x, y]) => vertical ? x : y);
  const low = Math.min(...crossSection), high = Math.max(...crossSection);
  assert.ok(Math.abs((low + high) / 2) <= .5, 'growth must expand around the original centerline');
  if (clock > .2) assert.ok(low < 0 && high > 0, 'both sides of the branch must thicken');
}
recorded = null;
console.log(`layout ok (${folderRoutes.length} folder routes, edge cases, and toggle lifecycle)`);

