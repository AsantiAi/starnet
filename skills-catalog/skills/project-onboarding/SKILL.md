---
name: project-onboarding
description: "Learn a new project folder before touching it: get the folder trusted, read its house rules and layout, find how it builds and tests, and save a short, sourced map to the notebook."
license: MIT
metadata:
  title: "Project Onboarding"
  category: "Engineering"
  author: "StarNet"
---

The first hour in a new folder decides whether every later run works with the project or against it. Read before you write, and save what you learned so the next run starts from the map instead of from zero.

## Method
1. **Get the folder trusted.** Your file tools start in your private workspace. Pass the folder's absolute path: the first time you reach into it, the station asks the Commander whether you may work there (always, once, or no). Only a run the Commander is watching can ask — an unattended run is simply refused. If the answer is no, stop.
2. **Read the house rules first.** AGENTS.md, CLAUDE.md or .cursorrules at the root are loaded into project-anchored sessions automatically; read them anyway (fs.read) and follow them over your own habits.
3. **Map the layout.** fs.list the root (not recursive), then list the source folders one at a time — a recursive list stops at 500 entries and does not skip dependency folders. fs.search with `target: "files"` skips node_modules and ignored files, so use it to survey by name. Read the entry points: README, the manifest (package.json, pyproject.toml, Cargo.toml, go.mod), build config, CI config, docs. Note what is generated or vendored and leave it out of the map.
4. **Find how it runs.** From the manifest and CI config: install, build, test and start commands, plus the runtime versions. With a WORKBENCH, run the test command once (shell.exec; the Commander approves) and record the real result — pass, fail, or not runnable and why. Without one, label the commands "from config, not run".
5. **Find where things live (fs.search, `target: "content"`).** The entry file, routing, data models, config loading, the tests. Read the two or three files everything else imports, with fs.read `numbered: true` so you can cite lines.
6. **Read the recent past.** With a WORKBENCH, `git log --oneline -20` and `git status` show what is moving and what is uncommitted. Uncommitted work belongs to someone; leave it alone.
7. **Note the traps.** Generated files that must not be hand-edited, tests that need a service running, paths the house rules forbid. (.env files and .git internals are closed to your file tools regardless.)
8. **Write the map (notebook.write, `scope: stream`).** Short declarative facts, each with where you saw it: "Tests: `npm test` (package.json scripts; ran 2026-09-29, all passing)." One note per topic — layout, commands, conventions, traps — not one giant note. Pin only rules the Commander confirms.
9. **Report what you learned and what you could not confirm,** and ask the one question the files could not answer, if there is one.

## Rules
- **Read-only until the map is written.** No edits, installs or formatting passes during onboarding.
- **Never state a command works because the README says so.** Either you ran it, or it is labeled unverified.
- **Never read or copy secrets.** Refer to configuration by variable name only.
- Save where things are and how they work — never file contents or code — to the notebook.

## Done means
The folder is trusted, the house rules are read, the map notes exist in the notebook with sources, and every command in them is marked verified or unverified.

## Output
A one-screen project brief: what it is, stack, layout, commands (verified or not), conventions, traps and open questions — plus the titles of the notes saved.

*Needs the INTEL CAB (fs.list / fs.search / fs.read) and the NOTEBOOK (the map). Pairs with the WORKBENCH to run the tests and read git history.*
