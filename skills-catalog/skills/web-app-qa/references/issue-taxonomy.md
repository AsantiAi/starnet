# Issue Taxonomy

Use this taxonomy to classify the issues found during exploratory QA of a web app.

## Severity levels

### Critical
The issue makes a core feature completely unusable or causes data loss.

**Examples:**
- The application crashes or shows a blank page.
- A form submission silently loses the user's data.
- Authentication is completely broken (nobody can log in).
- The payment flow fails and charges the user without completing the order.
- A security problem (for example script injection, or credentials exposed in the console).

### High
The issue significantly impairs functionality, but a workaround may exist.

**Examples:**
- A key button does nothing when clicked (but refreshing fixes it).
- Search returns no results for valid queries.
- Form validation rejects valid input.
- The page loads but critical content is missing or garbled.
- A navigation link leads to a "not found" page or to the wrong page.
- Uncaught script exceptions in the console on core pages.

### Medium
The issue is noticeable and affects the experience, but does not block core functionality.

**Examples:**
- Layout is misaligned or overlapping in parts of the screen.
- Images fail to load (broken image icons).
- Slow performance (visible loading delays over 3 seconds).
- A form field gives no validation feedback (no error message on bad input).
- Console warnings that point at deprecated or misconfigured features.
- Inconsistent styling between similar pages.

### Low
Minor polish issues that do not affect functionality.

**Examples:**
- Typos or grammatical errors in the text.
- Minor spacing or alignment inconsistencies.
- Placeholder text left in production ("Lorem ipsum").
- A missing favicon.
- Console info or debug messages that should not be in production.
- Subtle color contrast issues that still pass the WCAG requirements.

## Categories

### Functional
Features that do not work as expected.

- Buttons or links that do not respond.
- Forms that do not submit, or submit incorrectly.
- Broken user flows (a multi-step process cannot be completed).
- Incorrect data displayed.
- Features that work only partially.

### Visual
Problems with how the page is presented.

- Layout problems (overlapping elements, broken grids).
- Broken images or missing media.
- Styling inconsistencies.
- Responsive design failures.
- Stacking problems (elements hidden behind others).
- Text overflow or truncation.

### Accessibility
Problems that prevent or hinder access for users with disabilities.

- Missing alt text on meaningful images.
- Poor color contrast (fails WCAG AA).
- Elements that cannot be reached with the keyboard.
- Missing form labels or ARIA attributes.
- Focus indicators missing or unclear.
- Content a screen reader cannot use.

### Console
Problems detected through the browser console and the network log.

- Uncaught exceptions and unhandled promise rejections.
- Failed network requests (4xx and 5xx responses).
- Deprecation warnings.
- Cross-origin (CORS) errors.
- Mixed content warnings (HTTP resources on an HTTPS page).
- Excessive logging left over from development.

### UX (user experience)
The feature works, but the experience is poor.

- Confusing navigation or information architecture.
- Missing loading indicators (the user cannot tell something is happening).
- No feedback after an action (a button click with no visible result).
- Inconsistent interaction patterns.
- No confirmation before a destructive action.
- Poor error messages that do not help the user recover.

### Content
Problems with the text, media, or information on the page.

- Typos and grammatical errors.
- Placeholder or dummy content in production.
- Outdated information.
- Missing content (empty sections).
- Broken or dead links to external resources.
- Incorrect or misleading labels.
