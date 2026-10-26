export function sceneDepth(data, width, height, x, y) {
  if (!data || x < 0 || y < 0 || x >= width || y >= height) return 1;
  const i = ((height - 1 - y) * width + x) * 4;
  return (data[i] * 65536 + data[i + 1] * 256 + data[i + 2]) / 16777215;
}

export const behindScene = (scene, label) => scene < label - .00002;

export function labelDepthMask(data, width, height, pixels, rect, depth) {
  const x0 = Math.floor(rect.x / pixels), x1 = Math.ceil((rect.x + rect.width) / pixels);
  const y0 = Math.floor(rect.y / pixels), y1 = Math.ceil((rect.y + rect.height) / pixels);
  let path = '', hidden = 0, visible = 0;
  for (let y = y0; y < y1; y++) {
    let start = null;
    for (let x = x0; x <= x1; x++) {
      const show = x < x1 && !behindScene(sceneDepth(data, width, height, x, y), depth);
      if (x < x1) { if (show) visible++; else hidden++; }
      if (show && start === null) start = x;
      if (!show && start !== null) {
        const left = start * pixels - rect.x, top = y * pixels - rect.y, length = (x - start) * pixels;
        path += `M${left.toFixed(2)} ${top.toFixed(2)}h${length}v${pixels}h${-length}z`;
        start = null;
      }
    }
  }
  if (!hidden) return null;
  return { hidden: !visible, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rect.width} ${rect.height}" preserveAspectRatio="none"><path fill="white" d="${path}"/></svg>` };
}
