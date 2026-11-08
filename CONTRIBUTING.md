# Contributing

## Ideas and bugs

[Open an issue](../../issues). For a bug, add a screenshot, the page address and your browser and userscript manager versions. For an idea, describe what you want to do on Google Fonts and what gets in the way.
	
## Pull requests

- The script is one file, `gf-boost.user.js`, with no build step. Install your copy in a userscript manager and test on fonts.google.com, in Chrome and in Firefox.
- It runs as a content script, away from the page's own JavaScript. Use `window` rather than `unsafeWindow`, absolute URLs in `fetch()`, and `Store` for settings: it hides the differences between managers.
- Keep the site's own markup intact. Add elements next to the site's, restyle with CSS, and do not move or remove nodes the site renders.
- Reuse the site's components and design tokens (`--sys-*`, `--mat-*`) so additions look native in light and dark themes.
- The site enforces Trusted Types: build DOM with `createElement`, never with HTML strings.
- Update both READMEs (English and Russian) and the changelog when behaviour changes.

LLM-written PRs are welcome. Please test them the same way before sending.

By contributing, you agree that your work is licensed under GPL-3.0-or-later.
