# Round-1 bureau dispute templates

`round1-bureau.md` is the letter. `disputed-item.md` is the partial included once per account.

The renderer in `sidecar/credit/template.js` fills `{{path}}`, `{{#each}}` (with `{{this}}` and 1-based `{{@number}}`), and the `{{> disputed-item}}` partial. It does not call a model.

Generated letters are drafts. The Word line-spacing note stays in the letter metadata, not in the body. Confirm the bureau address in `sidecar/credit/constants.js` is still current before anyone mails a copy. This package does not mail it.
