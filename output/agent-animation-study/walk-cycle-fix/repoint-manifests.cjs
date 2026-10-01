// Repoint approved_<id>.walk.<dir> tracks to the canonical walk_<dir>_1..8.png files.
// Sets that predate the 1..8 layout (android, bear, blank_*, pepe, vaultboy) still listed
// walk_<dir>_0..7 or walk_<dir>_repair_0..7 in both manifests, so the runtime kept loading the
// old MiniMax cycle for them even after the new frames were installed.
const fs = require('fs'), path = require('path');
// node repoint-manifests.cjs [set ...] — with no args, the original 1..8 migration list. A set whose walk.json
// declares "frames" (skeleton-v3 walks ship 6) is pointed at exactly that many drawings.
const ARGS = process.argv.slice(2);
const SETS = ARGS.length ? ARGS : ['android', 'bear', 'blank_amber', 'blank_blue', 'blank_green', 'blank_red', 'pepe', 'vaultboy'];
const DIRS = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
const files = [
  ['frontend/assets/sprites/manifest.json', id => `approved_${id}/`, 'frontend/assets/sprites'],
  ['frontend/agent-demo/manifest.json', id => `../agent-demo/approved-motion/${id}/`, 'frontend/assets/sprites'],
  // the selected-refresh record test/world-immersion-characters.test.js compares byte-for-byte against the manifest
  ['frontend/assets/skin-study-0914/runtime-motion.json', id => `../agent-demo/approved-motion/${id}/`, 'frontend/assets/sprites'],
];
for (const [file, prefix, base] of files) {
  const man = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  for (const id of SETS) for (const dir of DIRS) {
    const key = `approved_${id}.walk.${dir}`;
    if (!man.sprites[key]) throw new Error('missing track ' + key + ' in ' + file);
    const fr = (() => { const p = path.join(__dirname, id, "walk.json"); return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")).frames || 8) : 8; })();
    const want = Array.from({ length: fr }, (_, i) => `${prefix(id)}walk_${dir}_${i + 1}.png`);
    for (const rel of want) if (!fs.existsSync(path.resolve(base, rel))) throw new Error('missing file ' + rel);
    if (JSON.stringify(man.sprites[key]) !== JSON.stringify(want)) { man.sprites[key] = want; changed++; }
  }
  fs.writeFileSync(file, JSON.stringify(man, null, 2) + '\n');
  console.log(file, 'tracks repointed:', changed);
}
