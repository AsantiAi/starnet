---
name: publish-site
description: "Put a finished website online on the Commander's own hosting account (GitHub Pages, Cloudflare Pages or Netlify): preview it, publish a saved version, check the live address really works, and keep a way to roll back."
license: MIT
metadata:
  title: "Publish Site"
  category: "Engineering"
  author: "Nous Research"
---

# Publish Site

Take a website, dashboard, or web app the Commander built (or you built for them) and put it online on infrastructure the Commander owns: GitHub Pages by default, Cloudflare Pages or Netlify when they need more. The discipline: preview locally for sign-off, version every deploy with a git tag, confirm the target, deploy through a provider ladder, verify the live URL with a real request, and keep rollback one step away.

This covers static sites and single-page-app build output (plain HTML/CSS/JS, or the `dist/` or `build/` folder from Vite, a Next.js static export, Astro and the like). It does not cover server-side runtimes; for those, `deploy-checklist` is the closer fit.

## When to use

- **Put a site online:** "publish this", "host this somewhere", "give me a link I can share".
- **Deploy a dashboard, report, portfolio, docs site, or prototype** you just made.
- **Update an already-published site** with new content (a redeploy is a new version).
- **Roll back** a bad deploy to the previous version.
- **Pick a host:** they do not care where, they just want a URL.

## Prerequisites: check before anything else

This skill relies on command-line tools that must ALREADY be installed and signed in on the Commander's machine. Check with `shell.exec`, in this order, and read each result:

| Provider | Installed? | Signed in? |
|---|---|---|
| (always) | `git --version` | |
| GitHub Pages (default) | `gh --version` | `gh auth status` |
| Cloudflare Pages | `wrangler --version` | `wrangler whoami` |
| Netlify | `netlify --version` | `netlify status` |

You need `git` plus at least ONE provider that is both installed and signed in.

**If none is ready, stop.** Tell the Commander plainly: "Publishing needs one of these tools, installed and signed in: the GitHub CLI (cli.github.com), Cloudflare's Wrangler (developers.cloudflare.com), or the Netlify CLI (docs.netlify.com). Install one from its official site, sign in with its own login command, then ask me again." Do not install a CLI yourself, do not start a sign-in flow, and never ask for a token or password in chat.

Also needed: a folder of static output to publish (the site root, or a `dist/` or `build/` folder). If the project has a build step, run it first and publish the output folder, never the source.

This skill cannot run in a scheduled run or as a dispatched worker: those have no shell and nobody to confirm the deploy.

## How it runs

Commands run through `shell.exec` from the site's project folder (the preview server through `terminal.start`). On Windows `shell.exec` uses `cmd.exe`: quote with double quotes and fill in dates and names yourself instead of using shell substitutions. The pipeline is always the same five moves:

1. Build → 2. Preview for sign-off → 3. Commit and tag (version before deploy) → 4. Confirm the target, then deploy via the provider ladder → 5. Verify the live URL and report it.

## Quick reference

| Step | Command |
|---|---|
| Local preview | `python -m http.server 8080 --directory dist` (in a `terminal.start` session) |
| Version a deploy | `git add -A`, `git commit -m "deploy: <what>"`, `git tag deploy-YYYYMMDD-HHMM` |
| GitHub Pages (branch mode) | `git subtree push --prefix dist origin gh-pages` |
| Enable Pages on the repo | `gh api "repos/{owner}/{repo}/pages" -X POST -f "source[branch]=gh-pages" -f "source[path]=/"` |
| Cloudflare Pages | `wrangler pages deploy dist --project-name <name>` |
| Netlify | `netlify deploy --prod --dir dist` |
| Rollback | `git checkout <previous-tag> -- .`, commit, redeploy (or the provider dashboard) |
| Verify live | `web_request` GET on the live URL: expect status 200 and the page's own content |

## Procedure

### 1. Build and preview locally

Build if needed (`npm run build` or the project's own command, through `verify.run` so you get a clear pass or fail) and identify the output folder. Confirm it contains an `index.html`.

Serve it for the Commander to look at. If the project has its own preview command (for example `npm run preview`), use that; otherwise check `python --version` and start a named `terminal.start` session with:

```
python -m http.server 8080 --directory dist
```

Read the session with `terminal.read` to confirm it is serving, give the Commander the local address (`http://localhost:8080`), and get their sign-off before deploying. Stop the preview session afterwards (the terminal tools include a stop; find it with `tool.search`).

A shareable preview for someone on another machine is already a publication: use a Netlify draft deploy (step 3, without `--prod`) and treat it like any other deploy, with the Commander's go-ahead.

### 2. Version before deploy, no exceptions

Every deploy comes from a git commit, so every deploy is reproducible and rollback is trivial.

```
git status --short
git add -A
git commit -m "deploy: <short description>"
git tag deploy-YYYYMMDD-HHMM
```

- Read `git status --short` BEFORE `git add`: no `.env` file, key, or private document may be in the list (see step 5).
- If the folder is not a git repo yet (`git rev-parse --is-inside-work-tree` fails), run `git init` first. If it already is one, just commit and tag. If that repo holds other unfinished work, stage only the site's files instead of `-A`, or ask.
- Write the tag with the real date and time, for example `deploy-20260930-1412`.
- Never deploy uncommitted files.

### 3. Confirm the target, then deploy

Publishing is outward-facing. Before the first deploy command, tell the Commander exactly what will happen and wait for a clear yes:

```
Ready to publish:
- Host: <GitHub Pages / Cloudflare Pages / Netlify>
- Account: <the account name the sign-in check printed>
- Project or repo: <name> (<new / existing>; <public / private>)
- Folder: <dist>  ->  <expected live address>
- Version: <deploy tag>

Go ahead?
```

If the Commander already named the host and told you to publish, that is the go-ahead for that target; still state the account and the visibility once. Creating a PUBLIC repository makes the whole source public, not only the site: say so.

**Rung 1: GitHub Pages** (default: free, and no extra account when `gh` is signed in):

```
gh repo create <name> --public --source . --push
git subtree push --prefix dist origin gh-pages
gh api "repos/{owner}/{repo}/pages" -X POST -f "source[branch]=gh-pages" -f "source[path]=/"
```

Skip the first line if the repo already exists on GitHub; run the last line the first time only. The site appears at `https://<owner>.github.io/<name>/`. If the site is the repo root (no build folder), push `main` and set the Pages source to `main` instead of using subtree. For projects with a build step that will redeploy often, prefer GitHub's official Pages workflow (`actions/deploy-pages`) so pushes publish automatically.

**Rung 2: Cloudflare Pages** (when the Commander wants a custom domain, redirects or headers, or Functions):

```
wrangler pages deploy dist --project-name <name>
```

The first run creates the project and prints the `https://<name>.pages.dev` URL. Custom domains are attached in the Cloudflare dashboard (Pages, the project, Custom domains); that is the Commander's step.

**Rung 3: Netlify** (fallback, or when the Commander already lives there):

```
netlify deploy --prod --dir dist
```

`netlify deploy --dir dist` without `--prod` gives a draft URL, useful as a second preview stage.

### 4. Rollback

Rollback means redeploying a previous tag. Never hand-edit live output.

```
git tag --list "deploy-*"
git checkout deploy-<previous> -- .
git commit -m "rollback to deploy-<previous>"
git tag deploy-YYYYMMDD-HHMM
```

Rebuild if the project has a build step, then rerun the same deploy command from step 3 and verify again. The rollback is a new commit on top of history, so nothing is overwritten and no force-push is ever needed. A rollback the Commander asked for is its own go-ahead; one you think is needed is a proposal, not an action.

Cloudflare Pages and Netlify also keep per-deploy history in their dashboards ("Rollback to this deploy"), which the Commander can use directly.

### 5. Secrets and environment variables

- **NEVER commit secrets, API keys, or `.env` files.** On a Pages host they would be public. Check `git status` before the first commit and keep `.env*` in `.gitignore`.
- Runtime environment variables belong in the provider's dashboard (Cloudflare Pages: Settings, Environment variables; Netlify: Site settings, Environment variables). The Commander sets them there. GitHub Pages is static only: there is no server environment, and anything embedded in the bundle is public by definition. Warn the Commander if their build inlines a key.
- Never print a token, and never put one in a command.

## Pitfalls

- **Single-page-app routes 404 on GitHub Pages.** Pages has no rewrite rules. Copy `index.html` to `404.html` in the output folder so client-side routing recovers. Cloudflare Pages and Netlify handle this with a `_redirects` file containing `/* /index.html 200`.
- **GitHub Pages build lag.** The site can take 1 to 10 minutes to appear after Pages is first enabled, and about a minute per later push. Do not declare failure on the first 404: check again a few times before investigating.
- **`git subtree push` publishes committed files only.** If the project ignores its build folder (`dist/` in `.gitignore`), there is nothing to push: use the Pages workflow, or another rung of the ladder.
- **Case-sensitive paths.** These hosts run case-sensitive Linux. A site that worked on macOS or Windows can 404 on an asset referenced as `Logo.PNG` but committed as `logo.png`. Search the HTML for mismatched casing when an asset 404s.
- **Project-page base path.** `https://<owner>.github.io/<name>/` serves under `/<name>/`, so absolute asset URLs like `/app.js` break. Use relative paths or set the build tool's base (`vite build --base=/<name>/`).
- **Signing in needs a person.** Provider sign-in opens a browser. It is the Commander's step; if a sign-in check fails, stop and say which one.
- **DNS propagation on custom domains.** New records can take minutes to hours. Verify against the provider's default URL (`*.pages.dev`, `*.netlify.app`, `*.github.io`) first, then check the custom domain separately. Do not confuse the two failures.
- **Deploying source instead of build output.** Publishing the repo root when the real site lives in `dist/` yields a file listing or raw source. Always confirm the output folder contains an `index.html`.

## Verification

Do NOT report success from the deploy log alone. Before telling the Commander anything:

1. `web_request` GET on the live URL returns status `200` (retry over about 2 minutes, up to 10 for a first GitHub Pages deploy).
2. The body it returns shows the expected `index.html` content: the page's own title or a line of its text, not a host's placeholder page. For a visual proof, open it with `browser.navigate` and capture it with `browser.screenshot`.
3. For single-page apps, also request one deep route (for example `/about`) and confirm it returns `200`, not `404`.
4. `git tag --list "deploy-*"` shows the tag for this deploy.

If any check fails, report exactly which one and what it returned. "Deployed" means the live URL answered with the site.

## Done means

The live URL returned status 200 with the site's own content in a request you made after the deploy, the deploy is tagged in git, and the Commander approved the target before the deploy command ran.

## Output

The live URL, the host and account it went to, the deploy tag to roll back to, and the result of each verification check.

*Needs the WORKBENCH (shell.exec, verify.run, terminal.start) and the DISH (web_request, browser.navigate). It also needs `git` and the `gh`, `wrangler` or `netlify` command line already installed and signed in on the Commander's machine.*

Adapted for StarNet from publish-site (Nous Research), MIT.
