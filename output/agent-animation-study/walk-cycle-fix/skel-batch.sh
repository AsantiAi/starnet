#!/usr/bin/env bash
# Pack a PixelLab skeleton-v3 walk (animation group named $ANIM, 6 frames x 8 directions) for one set.
#   bash output/agent-animation-study/walk-cycle-fix/skel-batch.sh <set> [anim-name]
# Run from the repo root AFTER queueing:
#   animate_character(character_id=<walk.json charId>, mode="skeleton-v3", template_animation_id="walking",
#                     animation_name="sprite-motion-skel-0930")   # all 8 directions
# Waits for the character's jobs to land, unpacks the character ZIP into <set>/raw (rotations + the group's
# frames), rewrites walk.json (the template record moves under "previous"), then runs the packer.
set -euo pipefail
SET="$1"; ANIM="${2:-sprite-motion-skel-0930}"
BASE="output/agent-animation-study/walk-cycle-fix/$SET"
CHAR=$(node -e "console.log(require('./$BASE/walk.json').charId)")
TMP="${SKEL_TMP:-${TMPDIR:-/tmp}}/skel-$SET"
until [ "$(curl -s -o /dev/null -w '%{http_code}' "https://api.pixellab.ai/mcp/characters/$CHAR/spritesheet")" = "200" ]; do sleep 15; done
rm -rf "$TMP"; mkdir -p "$TMP"
curl -s -f "https://api.pixellab.ai/mcp/characters/$CHAR/download" -o "$TMP/c.zip"
(cd "$TMP" && unzip -q c.zip)
STATE=$(ls -d "$TMP"/*/animations/"$ANIM" | head -1 | sed 's#/animations/.*##')
[ -d "$STATE/animations/$ANIM" ] || { echo "no animation $ANIM for $SET"; exit 2; }
rm -rf "$BASE/raw"; mkdir -p "$BASE/raw"
for d in south south-east east north-east north north-west west south-west; do
  cp "$STATE/rotations/$d.png" "$BASE/raw/rot_$d.png"
  n=$(ls "$STATE/animations/$ANIM/$d" | wc -l)
  [ "$n" = 6 ] || { echo "$SET $d has $n frames"; exit 3; }
  i=0; for f in $(ls "$STATE/animations/$ANIM/$d" | sort); do cp "$STATE/animations/$ANIM/$d/$f" "$BASE/raw/walk_${d}_$i.png"; i=$((i+1)); done
done
node -e "
const fs=require('fs'),p='$BASE/walk.json',o=JSON.parse(fs.readFileSync(p,'utf8'));
if (o.mode==='skeleton-v3' && o.animation==='$ANIM') { console.log('walk.json already skeleton'); process.exit(0); }
const prev={...o}; delete prev.charId; delete prev.rotT;
const j={charId:o.charId,rotT:o.rotT,template:'walking',mode:'skeleton-v3',frames:6,source:'zip',animation:'$ANIM',previous:prev};
fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
node output/agent-animation-study/walk-cycle-fix/pack-template-walk.cjs "$SET"
