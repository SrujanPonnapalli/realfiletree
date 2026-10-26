// Builds a tree from newline-separated paths, e.g. the output of `git ls-files` or `find . -type f`.
// A trailing "/" marks an empty folder; blank lines and "#" comments are ignored. Order is preserved.
export function parse(text) {
  const root = { name: '', children: [], byName: new Map() };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\.\//, '');
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\\/]/).filter(p => p && p !== '.');
    let node = root;
    parts.forEach((name, i) => {
      let kid = node.byName.get(name);
      if (!kid) { kid = { name }; node.byName.set(name, kid); node.children.push(kid); }
      if ((i < parts.length - 1 || /[\\/]$/.test(line)) && !kid.children) { kid.children = []; kid.byName = new Map(); }
      node = kid;
    });
  }
  return root;
}
