---
name: flashcards
description: "Study with spaced repetition: turn your notes or a chapter into question-and-answer cards, get quizzed, be graded honestly, and see each card again just before you would forget it."
license: MIT
metadata:
  title: "Flashcards"
  category: "Planning"
  author: "StarNet"
---

Spaced repetition works only when two things are true: the cards ask for real recall, and the grading is honest. A deck graded kindly schedules itself too far out and the Commander forgets the material while the numbers say otherwise.

## Method
1. **Get the material and the goal.** Read the Commander's notes, chapter or document with `fs.read` (or take pasted text). Ask what it is for — an exam date, a language, a job — and how many minutes a day they will study. That sets the deck size.
2. **Write the cards.** One fact per card. The question must force recall: no yes/no, no answer hidden in the wording, no "which of these". The answer is short — a word, a number, one sentence. A list of five things becomes five cards, or one card per missing item. Add the reverse card only when both directions matter (term to meaning, meaning to term). Every card records where in the source it came from.
3. **Let the Commander prune.** Show the draft deck with a count. Cut cards they already know cold, reword the unclear ones, and flag anything in the source that looked wrong or thin instead of quietly fixing it.
4. **Save the deck as a file.** `flashcards/<deck-name>.csv` with one row per card: `id, question, answer, source, due, interval_days, ease, reviews, misses`. New cards start with `due` = today, `interval_days` = 0, `ease` = 2.5. Keep rows sorted by `due`, earliest first, so the cards to study are always the top of the file. Quote fields that contain commas. Read the file back after writing it.
5. **Run the session.** Take today's date from the run; never guess it. Pick cards with `due` on or before today, oldest first, then at most ten new cards unless the Commander set another number. Ask ONE question, then stop and wait for the answer. No hints, and no answer shown before they reply.
6. **Grade against the card, not against your own knowledge.** `right` = every fact in the card's answer is present and nothing in the reply contradicts it; spelling slips and different wording are fine. `partly` = some of it. `wrong` = missing, contradicting or "I don't know". When in doubt between two grades, give the lower one. Then show the card's answer and what was missed, in one or two lines.
7. **Reschedule by rule.** Wrong: interval 1 day, ease down 0.2 (never below 1.3), misses up one. Partly: interval 1 day, ease unchanged. Right: an interval of 0 becomes 1 day, 1 becomes 3 days, and anything longer becomes the last interval times ease, rounded; ease up 0.05 (never above 2.8). Every review adds one to `reviews`, and `due` = today + interval. Do the date sums in `code.run` rather than in your head.
8. **Save as you go.** Write the updated rows with `fs.write` every few cards and at the end, so a dropped session loses nothing. If the write is refused because the file changed, read it again and re-apply.
9. **Show progress.** After the session: cards reviewed, right · partly · wrong, how many come due tomorrow and over the next seven days, and the "sticky" cards missed four times or more. Offer to split or reword sticky cards; change them only with the Commander's yes.
10. **Offer a daily reminder (optional).** With `routine.create`, set a routine at the Commander's study time whose prompt is complete on its own: read the deck files in `flashcards/`, count rows with `due` on or before today, and reply with one line giving the count. Create it from the chat where the reminder should arrive and pass `deliver: origin`, so each reply lands there; a scheduled run cannot send with `channel.send`, because a send needs an approval nobody is present to give. Tell it to reply exactly `[SILENT]` when nothing is due. A scheduled run cannot wait for answers, so it reminds; it never quizzes or regrades. Do not count on `code.run` there — that is why the deck stays sorted by date.

## Rules
- **Never grade generously.** A lenient "right" pushes a card weeks away; the Commander pays for it later.
- **Never invent facts.** Every answer comes from the Commander's material. If the material does not say it, there is no card. Outside knowledge goes in only when the Commander asks, and those cards are marked as added.
- **Never reveal the answer before the Commander has tried.**
- **Never change a card's answer during a session to match a reply.** If the reply shows the card is wrong, flag it and fix it afterwards with the source open.
- One question per message in a session. No lectures between cards unless asked.
- If the send in a reminder run is refused, the run's result must say so.

## Done means
The deck file exists and reads back with every card carrying a due date; after a session, every reviewed card has a new due date that follows the rule for its grade, and the counts reported match the file.

## Output
The deck path and card count; after each session the score, what is due next, and the sticky cards. If a reminder was set: its schedule, where it sends, and what the tool returned.

*Needs the INTEL CAB (fs.read, fs.write). The daily reminder also needs the ORCHESTRATOR (routine.create), which every run the Commander starts from chat carries.*
