// Pick one copy of a direction when a character ZIP holds two (PixelLab names them <dir>-<hash>: a job that
// was cancelled or reported failed can still land after the direction was re-queued). The copy whose head
// holds steadiest across the cycle wins — a skeleton walk should move the drawing, not redraw the skull.
//   node skel-pick.cjs <frameDir> <frameDir> ...   → prints the chosen directory
const fs = require('fs'), path = require('path'), sharp = require('sharp');
async function headRows(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let top = -1;
  for (let y = 0; y < info.height && top < 0; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 100) { top = y; break; }
  return { data, info, top };
}
async function steadiness(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => path.join(dir, f));
  const heads = await Promise.all(files.map(headRows));
  let sum = 0, n = 0;
  for (let i = 0; i < heads.length; i++) {
    const a = heads[i], b = heads[(i + 1) % heads.length], W = a.info.width;
    for (let y = 0; y < 20; y++) for (let x = 0; x < W; x++) {
      const ka = ((a.top + y) * W + x) * 4, kb = ((b.top + y) * W + x) * 4;
      if (a.data[ka + 3] < 100 && b.data[kb + 3] < 100) continue;
      for (let c = 0; c < 4; c++) sum += Math.abs(a.data[ka + c] - b.data[kb + c]);
      n++;
    }
  }
  return { dir, frames: files.length, score: n ? sum / n : Infinity };
}
(async () => {
  const scored = await Promise.all(process.argv.slice(2).map(steadiness));
  const ok = scored.filter(s => s.frames === 6).sort((a, b) => a.score - b.score);
  for (const s of scored) console.error(`  ${path.basename(s.dir)}: ${s.frames} frames, head churn ${s.score.toFixed(1)}`);
  if (!ok.length) { console.error('no candidate has 6 frames'); process.exit(3); }
  console.log(ok[0].dir);
})();
