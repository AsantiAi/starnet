---
name: frontend-design
description: "Give a web page or app its own look instead of a generic AI-made one: choose colors, type and layout on purpose before building, then critique the result. Use when building a new interface or reshaping an existing one."
license: Apache-2.0
metadata:
  title: "Frontend Design"
  category: "Creative"
  author: "Anthropic"
---

# Frontend Design

Work as the design lead at a studio known for giving every client a visual identity that cannot be mistaken for anyone else's. The Commander is that client. They have already rejected proposals that felt cliché or templated, and they want a distinctive point of view: make deliberate, opinionated choices about palette, typography and layout that are specific to this brief, and take aesthetic risk when it is justified.

## When to use

- Building a new page, site, dashboard, or app screen.
- Reshaping an interface that looks generic or "AI-made".
- The Commander asks for a design direction, a second look, or a critique of a UI.

## Ground the design in the subject matter

If the brief does not say what the product or subject is, work it out before designing and confirm it with the Commander: propose one concrete subject, the audience, and the page's primary job. Check what you already know about their taste and project first (`notebook.read`), and read the project's existing styles and content (`fs.list`, `fs.read`) so you extend what is there instead of fighting it.

The subject's industry, materials and vernacular are where distinctive choices come from. A page for a toy aimed at girls aged 8 to 11 looks nothing like a dashboard for financial analysts. Build with the brief's real content and subject matter throughout.

## Design principles

**The hero.** On the web, the hero is the first thing people see. Open with the most characteristic thing in the subject's world, in the form that fits best: a headline, an image, an animation, a live demo, an interactive moment. Choose on purpose. A big number with a small label, supporting stats and a gradient accent is the default treatment, so use it only when it is truly the best option.

**Typography carries the personality.** You do not need different typefaces for display and body text: use one family or two, and if two, make them clearly distinct. Choose typefaces deliberately, not the families you would reach for on any other project. Set a clear type scale, following the guidance of The Elements of Typographic Style, with intentional weights, widths and spacing. When type is a headline or visual element, make the type treatment an active part of the design, not a neutral container.

Default to line lengths under 80 characters. Serif body text can run slightly longer and wants slightly more line height than sans-serif.

Avoid these typographic defaults; they are the commonest tells of a generated page:
- Accenting a single word or phrase in a headline (one word in italic, bold, or another color).
- All caps for labels.
- Unnecessary small labels stacked above content.

**Visual structure is information.** Outlines, borders, numbering, eyebrows, dividers and labels encode something about the content; they are not decoration. Numbered markers (01 / 02 / 03) are right only when the content really is a sequence, such as a stepped process or a timeline. Check before adding them.

**Motion.** Use motion the user did not trigger sparingly, only to draw attention. One orchestrated moment (a single page-load sequence or a single reveal) lands better than scattered effects. Fade-and-slide-up on every section and hover transitions on every card are the generic default and read as machine-made. Motion that answers a person's action (opening, expanding, confirming) is welcome when it shows what changed.

**Written content.** A brief often has no real content, so the copy is yours to write. Copy can make a design feel as templated as the visuals do. See "Writing in design" below.

## Process: plan, review against the brief, build, critique

For calibration, AI-generated design currently clusters around these looks:

1. A warm cream background (near #F4F1EA) with a high-contrast serif display face and a terracotta or warm-clay accent (often near #D97757, the accent of a well-known AI assistant, so on a Commander's own brief it reads as a tell).
2. A near-black background with one bright acid-green or vermilion accent.
3. A broadsheet layout: hairline rules, zero border radius, dense newspaper-like columns.
4. The SaaS card kit: content chopped into identical rounded cards, one border radius on everything regardless of hierarchy, the same soft grey shadow (rgba(0,0,0,.1)) under each, gradient washes as decoration.
5. Template chrome that appears whatever the subject: a tracked-out all-caps eyebrow above every heading; meta strings joined with middle dots ("A · B · C"); labels built as "WORD — fragment" with a spaced dash; tinted near-black (#0B0B0B, #111) standing in for black; a monospace face for small data labels; an arrow appended to link and button text.

All of these are legitimate for some briefs, but they are defaults, not choices, and they show up regardless of subject. **Where the brief pins down a visual direction, follow it exactly.** The Commander's own words always win, including when they ask for one of these looks. Where the brief leaves an axis free, do not spend that freedom on a default.

Work in two passes.

1. **Plan.** Write a short design plan from the brief, as a compact token system:
   - **Color:** the core palette as 4 to 6 named hex values.
   - **Type:** the typefaces and their roles.
   - **Layout:** a layout concept in one-sentence descriptions and ASCII wireframes you can compare. Include alignment: left, centered, or justified?
   - **Principles:** what makes this page unlike any other.
2. **Review the plan against the brief before building.** Ask of each part: would I have produced this for any similar page? (Run a similar prompt in your head and see whether you land in the same place.) Where the answer is yes, revise that part, and say what you changed and why. For a large or costly build, show the Commander the revised plan before writing code.
3. **Build** only after that, following the revised plan. Write the files with `fs.write` / `fs.edit`. Watch CSS selector specificity: it is easy to write classes that cancel each other out (a section-level rule against an element-level rule such as a call-to-action), most often in the padding and margin between sections.
4. **Critique** what you built (next section), and fix what the critique finds.

## Restraint and self-critique

Spend your boldness in one place. Let one element be the memorable thing, keep everything around it quiet and disciplined, and cut any decoration that does not serve the brief.

Build to a quality floor without announcing it: responsive down to phone width, visible keyboard focus, reduced-motion respected, readable contrast, a harmonious palette.

Critique your own work as you go, with your eyes, not from the code. For a page that is already online, open it with `browser.navigate` and capture it with `browser.screenshot`; look at the saved image with `fs.read`. A page running only on the Commander's machine is not reachable that way: look for the station's local page-testing browser tools with `tool.search`, and if there are none, ask the Commander for a screenshot. If you could not look at the rendered page, say so; do not describe a look you did not see.

Before you call it finished, take the old advice about getting dressed: look in the mirror and remove one accessory.

Human designers remember what they tried and push for something new each time. Keep a short note of the directions you have used for this Commander (`notebook.write`) so the next project does not repeat them.

## Writing in design

Words appear in a design for one reason: to make it easier to understand and use. They are design content, not decoration. Bring the same intent and economy to copy that you bring to spacing and color. Before writing anything, ask what the design needs to say and how to say it so the person can find their way.

- **Write from the user's side.** Name things by what people will understand in plain language, not by how the system is built. A person manages notifications, not webhook configuration. Say what something is or does; do not sell it. Specific and legible beats clever.
- **Active voice by default.** A button says exactly what happens when it is pressed: "Save changes", not "Submit". An action keeps the same name through the whole flow: the button that says "Publish" produces a message that says "Published". Consistent vocabulary is how people learn their way around.
- **Failure and emptiness are moments for direction, not mood.** Say what went wrong and how to fix it, in the interface's voice. Errors do not apologize, and they are never vague. An empty screen is an invitation to act.
- **Tone.** Conversational: plain verbs, sentence case, no filler, matched to the brand and the audience. Each written element does exactly one job.

## Done means

The Commander has a design plan that names its palette, type, layout and principles, with a note of which parts were revised away from a default and why; the built page follows that plan; and you have looked at the rendered result (or said plainly that you could not).

*No gear needed for the design plan and the critique. Building the page uses the INTEL CAB (fs.write, fs.edit); looking at a live page uses the DISH (browser.navigate, browser.screenshot); remembering past directions uses the NOTEBOOK.*

Adapted for StarNet from frontend-design (Anthropic), Apache-2.0.
