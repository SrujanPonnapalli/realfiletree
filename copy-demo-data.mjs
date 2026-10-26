import { copyFile } from 'node:fs/promises';

for (const file of ['tree.txt', 'video-tree.txt']) {
  await copyFile(file, new URL(`./dist/${file}`, import.meta.url));
}
