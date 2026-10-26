import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from './parse.js';

const names = n => n.children.map(k => k.name + (k.children ? '/' : ''));

const t = parse('# comment\n./a/b.txt\n\na/c/\na/b.txt\nd.md\nwin\\x\\y.txt\n');
assert.deepEqual(names(t), ['a/', 'd.md', 'win/']);
assert.deepEqual(names(t.children[0]), ['b.txt', 'c/']);      // dedupes, keeps order, empty folder
assert.deepEqual(names(t.children[2].children[0]), ['y.txt']); // backslash paths

const demo = parse(readFileSync(new URL('./tree.txt', import.meta.url), 'utf8'));
assert.deepEqual(names(demo), ['woodland/', 'seeds.txt', 'meadow/', 'orchard/', 'river/', 'almanac.md', 'weather.csv', 'field-lab/']);
console.log('ok');
