# Form review

Goal: more people finish the form, and the business still gets the data it really uses. You review by looking: `browser.snapshot` lists the fields and buttons, `browser.get_text` gives labels and help text, `browser.screenshot` shows layout at each width. You do not submit the form.

## First, establish

- **Form type:** lead capture (gated content, newsletter), contact, demo or sales request, application, survey, checkout, quote request.
- **Current state:** number of fields, completion rate if the Commander knows it, phone versus desktop share, where people give up.
- **Business context:** what happens to a submission, which fields are actually used in follow-up, any legal or compliance fields that must stay.

## Principles

**Every field has a cost.** The upstream rule of thumb: three fields is the baseline; four to six costs roughly 10 to 25% of completions; seven or more costs 25 to 50% or more. Treat the figures as direction, not measurement. For each field ask:

- Is this needed before we can help them?
- Can we get it another way (for example the company from the email domain)?
- Can we ask it later?

**Value must exceed effort.** A clear statement of what they get sits above the form. The effort should look small.

**Reduce thinking.** One question per field, plain conversational labels, logical grouping and order, sensible defaults.

## Field by field

- **Email:** one field, no "confirm email". Checks as the visitor leaves the field; catches common typos; brings up the email keyboard on phones.
- **Name:** one "Name" field has less friction than first and last. Split only if personalisation needs it.
- **Phone:** optional where possible. If required, say why. Formats as typed; handles country codes.
- **Company:** suggestions as they type, or inferred from the email domain, or collected after submission.
- **Job title or role:** a dropdown if categories matter, free text if they vary widely; consider optional.
- **Message:** optional; grows when focused.
- **Dropdowns:** a "Select one" prompt; searchable when long; radio buttons when fewer than five options; an "Other" option with a text field.
- **Tick boxes:** clear, parallel labels; a reasonable number; "select all that apply".

## Layout

- **Order:** easiest first (name, email), then the rest, sensitive fields last. Group when there are many.
- **Labels:** always visible above the field. A label that lives only inside the field disappears when typing starts and leaves the visitor unsure what they are filling in. Placeholder text shows an example ("name@company.com"), never the label.
- **Help text:** only where it truly helps.
- **Columns:** one column completes better and works on phones. Two columns only for short related fields such as first and last name.
- **Look:** enough space between fields, a button that stands out, tap targets at least 44 pixels high on phones.

## Multi-step forms

Use when there are more than five or six fields, clearly separate sections, paths that depend on answers, or a complex request (application, quote).

- A progress indicator ("step 2 of 4").
- Easy first, sensitive last; one topic per step.
- A back button; progress kept on refresh.
- Required and optional fields clearly marked.
- A low-commitment opening: email first, then details, then qualifying questions, then contact preferences.

## Errors

- Check a field when the visitor leaves it, not on every keystroke.
- Clear visual state for right and wrong.
- Messages that name the problem and the fix, next to the field: "Please enter a valid email address, for example name@company.com", not "Invalid input".
- On submit: focus moves to the first error, several errors are summarised, and nothing the visitor typed is cleared.

You can see error handling only by interacting. Ask the Commander before you do, and never submit real or made-up personal details.

## The button

- **Words:** action plus what they get. "Get my free quote", "Download the guide", "Request demo". Not "Submit" or "Send".
- **Place:** straight after the last field, aligned with the fields, large, high contrast; on phones either fixed in view or clearly visible.
- **After the click:** a loading state that prevents double submission, then a confirmation that says what happens next.

## Trust near the form

- A privacy line ("We'll never share your details").
- "No spam, unsubscribe anytime", "No credit card required", where true.
- Security badges when sensitive data is collected.
- A testimonial or a proof point.
- The expected response time.
- "Takes 30 seconds", if it does.

## By form type

- **Lead capture:** as few fields as possible, often email only; the value of what they get stated clearly; extra questions asked after delivery.
- **Contact:** email or name, plus message; phone optional; response time stated; other ways to get in touch offered.
- **Demo request:** name, email, company; phone optional with a "preferred contact" choice; one question about their goal helps the call; a booking calendar on the page can raise attendance.
- **Quote request:** multi-step works well; easy questions first, technical detail later; progress saved.
- **Survey:** progress bar; one question per screen; skip logic; consider an incentive.

## Phones

Large tap targets, the right keyboard for each field (email, phone, number), autofill supported, one column, the button in view, as little typing as possible.

## What to measure

Tell the Commander what to track if they do not already: form views, first field focused, completion of each field, errors per field, submit attempts, successful submissions, time to complete, and the phone versus desktop split. Field-level drop-off needs an analytics or form tool: skip the numbers unless the Commander shares them, and say the review is from observation.

## Report

- **Form audit:** each issue with what is wrong, where, likely effect (High, Medium, Low), and the fix.
- **Recommended form:** required fields with the reason for each, optional fields, field order, the wording for labels, placeholders, button and error messages, layout notes.
- **Test ideas:** single step against multi-step; fewer fields; with and without phone; button wording; privacy line and proof beside the button; form high on the page against after the content.
