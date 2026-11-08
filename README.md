<p align="center"><img src="assets/icon.svg" width="96" height="96" alt="GF Boost logo"></p>

<h1 align="center">GF Boost</h1>

<p align="center"><a href="README.ru.md">Читать на русском</a> · <a href="CHANGELOG.md">Changelog</a></p>

A userscript that adds the missing tools to [Google Fonts](https://fonts.google.com/): italic and weight previews and a tidier catalog, quality ratings for Cyrillic fonts, and on font pages OpenType features, an optical size slider (for fonts with that axis) and marks for named styles on the axis sliders.

## Catalog

### Italic

- **[I]** next to the weight picker switches the cards to italic.
- **Show Upright & *Italic*** under the weight slider shows both, the upright with the italic below it. The text size shrinks so both fit the card.
- `I` hot key turns italic on and off. `Shift+I` turns the two-style view on, along with [I], and back off, returning to what you had before.
- Hold `Shift` and hover a card to see the other style in that card alone.
- The *I* mark before the style count means the family has an italic.

About 20% of the Google Fonts families have an italic.

### Weight

Under the text size:

- a picker with the named weights, from Thin 100 to ExtraBlack 1000;
- a slider with a stop at every hundred;
- `W` and `Shift+W` hot keys for one step heavier or lighter.

All cards show their family at the chosen weight. Weight is not remembered: each visit starts at Regular, unless the link you open sets another one (`gfb=700`).

### Missing styles

If a family lacks the chosen style, its card goes grey but stays clickable. It shows the closest style the family has and says what is missing.

The labels end with a kaomoji for a bit of silliness: the same ones Google Fonts shows when a search finds nothing. Move the pointer over the sample next to the “Kaomoji” checkbox at the very bottom of the filters to meet them all, or untick it to turn them off.

### Ratings

With the Cyrillic writing system selected, rated families get a mark after their name: green is good, yellow is so-so, red is bad.

- [type.today](https://type.today/) ratings come from its "Cyrillic on Google Fonts" reviews. A click opens the review.
- Other ratings come from the authors of this script. They look the same; the tooltip tells you whose rating it is.

A rating is a reason to look closer, not a verdict. Read why a font got “so-so” or “bad”: those flaws may not matter in your case, and you can keep using the font knowing what they are.

### A tidier page

- Knowledge articles above the results are collapsed. **Knowledge**, left of “About these results”, opens them.
- Row / Grid / Sample show icons only, to save width. Their names are in the tooltips.
- The filter chip for your preview text says “Preview text” instead of repeating the text. The address still holds it, and the cross clears it as usual.
- The filter sections go Language, Serif, Sans Serif, Calligraphy, Technology, Properties. Feeling, Appearance and Seasonal move to the end and start collapsed.
- The writing system list starts with “All writing systems”, then Latin, Cyrillic, Greek, Arabic and Hebrew, then the rest A–Z.
- **Reset all** also resets the script's settings.

### Card details

Hover “N styles” for the list of styles. Hover “Variable (N axes)” for the axes with their ranges; custom axes appear under their names (Optical Size, not OPSZ).

## Font pages

- **OpenType features** under Variable Axes. Only the ones the font has, most interesting first: Alternates (stylistic sets and character variants first), Ligatures, Figures, Case, Spacing. Below them, a language list for localised forms.
- **Optical size slider**, only for fonts with an `opsz` axis. With the site's switch on, the slider shows the automatic value. With it off, you set the value by hand. Wide ranges such as Playfair's 5–1200 use a logarithmic scale.
- **Marks on the axis sliders** show the font's named styles. Moving slowly, the slider holds on a mark for a few pixels; stopping or letting go near one snaps to it. Moving fast passes straight through.
- **The preview stays in view** below the tab bar while you scroll the controls on the left.
- **Language markup.** Previews get `lang=""` from the language chosen on the page. With only a writing system chosen: Russian for Cyrillic, Greek for Greek, English for Latin.

Try them on [Playfair](https://fonts.google.com/specimen/Playfair).

## Links

Settings live in the address, in one parameter, `gfb`, so a link opens the page the same way:

- catalog: `gfb=ri,700`: style (`i` italic, `ri` upright and italic), weight;
- font page: `gfb=o24,smcp,-liga,TRK`: `o` + optical size, features (`-` turns one off), OpenType language tag.

Default values are left out of the address. The catalog style is also remembered between visits.

## Install

You need a userscript manager, a browser extension that runs scripts on websites.

| Browser | Manager |
|---|---|
| Chrome, Edge, Brave, Opera, Vivaldi, Yandex Browser | [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) |
| Firefox | [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/) or [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) |

1. Install a manager.
2. Chrome 138 and later: open `chrome://extensions`, click “Details” on the manager and turn on “Allow User Scripts”. In earlier versions, turn on “Developer mode” on the same page.
3. Open [gf-boost.user.js](https://github.com/Tranya/gf-boost/raw/main/gf-boost.user.js) and click “Install” in the manager's window.
4. Open [fonts.google.com](https://fonts.google.com/).

The manager installs updates by itself.

**Requirements:** Chrome or Edge 111+, Firefox 121+. The script targets the site's desktop layout.

## Plans

- Safari support.
- A browser extension in the Chrome Web Store.

## Privacy

The script talks only to Google Fonts:

- `fonts.googleapis.com` and `fonts.gstatic.com`, for fonts;
- `fonts.google.com/metadata/fonts/<family>` and `fonts.google.com/download/list?family=<family>`, for styles, axes, features and font files. Font files are read in parts where possible (HTTP Range).

A type.today review opens as a normal link when you click it. There is no analytics, and nothing else is sent anywhere. Your manager checks this GitHub repository for updates. Settings and a 7-day cache of which families have an italic are kept in the manager's storage, not the site's.

## Limitations

- On narrow screens the site hides some elements, and some features may not appear.
- Google changes the site from time to time, and the script can stop working. If something looks wrong, [open an issue](https://github.com/Tranya/gf-boost/issues) with a screenshot and your browser and manager versions.

## Contributing

Tell us what is missing in the userscript: [open an issue](https://github.com/Tranya/gf-boost/issues) and describe what you are trying to do. Pull requests with new features, improvements and fixes are welcome, and LLM-written PRs are welcome too. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0-or-later](LICENSE). You can use, change and share the userscript, as long as the result stays open source under the GPL.

---

Made by Dmitry Sivukhin, Rustam Mushraipov, Magomed Vagabov.

Not affiliated with or endorsed by Google or type.today. Google Fonts is a trademark of Google LLC.
