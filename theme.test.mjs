import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const startup = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const changeHandler = html.slice(html.indexOf('const themeControl ='), html.indexOf('const toggleUiButton ='));

for (const [saved, systemDark, expected] of [
  [null, false, 'light'], [null, true, 'dark'], ['light', true, 'light'], ['dark', false, 'dark'], ['invalid', true, 'dark'],
]) {
  const root = { dataset: {} };
  vm.runInNewContext(startup, { document: { documentElement: root },
    localStorage: { getItem: () => saved }, matchMedia: () => ({ matches: systemDark }) });
  assert.equal(root.dataset.theme, expected, 'saved choices override the initial system preference');
}

for (const blocked of [false, true]) {
  const root = { dataset: {} }, listeners = {}, saved = [], backgrounds = [];
  const control = { checked: false, addEventListener: (event, fn) => listeners[event] = fn };
  let wakes = 0;
  const context = vm.createContext({
    document: { documentElement: root, getElementById: () => control },
    localStorage: {
      getItem() { if (blocked) throw new Error('Storage blocked'); return 'dark'; },
      setItem(key, value) { if (blocked) throw new Error('Storage blocked'); saved.push([key, value]); },
    },
    matchMedia: () => ({ matches: true }),
    getComputedStyle: () => ({ getPropertyValue: () => root.dataset.theme === 'dark' ? '#171b19' : '#fff' }),
    view3d: { setBackground: value => backgrounds.push(value) }, wake: () => wakes++,
  });
  vm.runInContext(startup + changeHandler, context);
  assert.equal(control.checked, true, 'the switch reflects the initial theme even with storage blocked');
  control.checked = false; listeners.change();
  assert.equal(root.dataset.theme, 'light');
  assert.deepEqual(backgrounds, ['#fff'], 'theme changes reach the active 3D renderer');
  assert.equal(wakes, 1, 'the idle canvas redraws on a theme change');
  context.view3d = null;
  control.checked = true; listeners.change();
  assert.equal(root.dataset.theme, 'dark', 'the same switch works in 2D');
  assert.deepEqual(saved, blocked ? [] : [['theme', 'light'], ['theme', 'dark']]);
}
console.log('Theme defaults, persistence, blocked storage, and 2D/3D updates ok');
