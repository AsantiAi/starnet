---
name: studio-video
description: "Turn a script into a narrated video edit: voiceover takes, matching stills, and a DaVinci Resolve timeline the Commander can open — by import in free Resolve, or live in Resolve Studio."
license: MIT
metadata:
  title: "Studio Video"
  category: "Studio"
  author: "StarNet"
---

The studio cuts a video from parts it makes itself: voiceover takes from voice_generate, stills from image_generate, and an edit decision list from resolve_timeline_file. The narration is the spine — pictures are timed to the voice, never the other way round.

## Method
1. **Write the script as numbered beats.** One beat = one idea, one or two sentences of narration, one picture. Note for each beat what is on screen. Spoken narration runs roughly 150 words a minute; size the script to the target length.
2. **Get the script approved before rendering anything.** Voice and images cost money; a rewrite after rendering pays twice.
3. **Record one take per beat (voice_generate).** Plain prose, no markup. Name each take with `path` so the order is obvious: `audio/v01-intro.mp3`, `audio/v02-problem.mp3`. Use the same `voice` and `style` for every take. Text over 4,000 characters is refused, so split long beats — never truncate.
4. **Make the stills (image_generate).** One shape for all: `aspect_ratio: "16:9"` for widescreen, `"9:16"` for phone video. Write one shared style line and repeat it word for word in every prompt; only the subject changes. Name stills to match the takes: `images/v01-intro.png`. For a frame that must show readable words, use the premium model the tool description names.
5. **Look before you cut (image_analyze).** Check each still for garbled text, the wrong subject, or style drift. Regenerate failures; do not cut around them.
6. **Measure the takes.** Each still holds for the length of its take. With a WORKBENCH, read real durations with ffprobe through shell.exec; without one, estimate from word count and let the timeline tool check you — it reads durations with ffprobe when available and notes any out-point past the end of a file.
7. **Build the timeline (resolve_timeline_file).** Main track (lane 0): the stills in beat order, each with `in: 0` and `out` = its hold in seconds; they play back to back. Voiceover: each take on lane -1 with `at` = the second its beat starts. Add a marker per beat, named for the beat. Set `fps` (24 unless asked) and the `width`/`height` that match the stills. The file lands at `edits/<name>.fcpxml` unless you pass `path`.
8. **Read the tool's notes.** A "past the media end" or "not probed" note means the cut is wrong or unverified — fix the numbers and rebuild.
9. **Open it.** Call resolve_status. If live control is YES (Resolve Studio), use resolve_control action=import_timeline with the file; render only when asked (action=render writes under `renders/`, then action=render_status). If live control is NO, tell the Commander: in Resolve, File > Import > Timeline, and pick the file.
10. **Name the deliverable (deliverable_note)** with the timeline file as `main`.

## Rules
- **Never claim the video is rendered** unless render_status says the job finished.
- **Never claim live control** unless resolve_status said YES; free Resolve cannot be driven from outside.
- Keep voice, style line, aspect ratio and fps identical across the whole piece.
- Music, footage or any media you did not generate goes in only when the Commander supplied the file.

## Done means
Every beat has a take and a still, the timeline file exists with no warning notes, it imported (or the Commander has the import step), and its length matches the sum of the takes.

## Output
The beat sheet, the file list (takes, stills, timeline), total running time, how to open it, and any beat that needs another pass.

*Needs the STUDIO object (voice, images, Resolve). Pairs with the WORKBENCH to measure takes and the CABINET to keep the script as a file.*
