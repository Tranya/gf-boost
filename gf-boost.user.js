// ==UserScript==
// @name         GF Boost
// @namespace    https://github.com/Tranya/gf-boost
// @version      1.0.0
// @description  Extra tools for Google Fonts: italic and weight preview, ratings and a tidier catalog; OpenType features, optical size and axis stops on font pages.
// @author       Dmitry Sivukhin, Rustam Mushraipov, Magomed Vagabov
// @license      GPL-3.0-or-later
// @homepageURL  https://github.com/Tranya/gf-boost
// @supportURL   https://github.com/Tranya/gf-boost/issues
// @updateURL    https://raw.githubusercontent.com/Tranya/gf-boost/main/gf-boost.user.js
// @downloadURL  https://raw.githubusercontent.com/Tranya/gf-boost/main/gf-boost.user.js
// @match        https://fonts.google.com/*
// @icon         https://raw.githubusercontent.com/Tranya/gf-boost/main/assets/icon.svg
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// @inject-into  content
// @noframes
// ==/UserScript==

/*
 * GF Boost — https://github.com/Tranya/gf-boost
 * Copyright (C) 2026 the GF Boost authors, see AUTHORS.md. Licensed under GPL-3.0-or-later.
 */

(function () {
    'use strict';

    // ─── 1. Constants & data ────────────────────────────────────
    // What the cards show: upright (default), italic, or both, one under the other
    const MODES = ['R', 'RI', 'I'];

    // Our settings in the address: one parameter, comma-separated tokens,
    // each recognisable by its form, so order and missing ones never matter.
    //   catalog:   gfb=ri,700   style (i = italic, ri = upright and italic), weight
    //   font page: gfb=o24,smcp,-liga,TRK   o + optical size, feature tags
    //              (lower case, "-" = off), OpenType language tag (upper case)
    // Everything else in the address belongs to the site.
    const PARAM = 'gfb';
    const TOKEN = {
        style: /^(ri|i)$/,
        wght: /^\d{3,4}$/,
        opsz: /^o(\d+(?:\.\d+)?)$/,
        fea: /^-?[a-z][a-z0-9]{3}$/,
        lang: /^[A-Z][A-Z0-9]{1,3}$/,
    };

    const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const WEIGHT_NAMES = {
        100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium',
        600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black', 1000: 'ExtraBlack',
    };

    // Same set the site shows on an empty search (.error-kaomoji)
    const KAOMOJI = ['(·_·)', '(≥o≤)', '(;-;)', '(·.·)', '\\(^Д^)/', '\\(o_o)/', '(˚Δ˚)b', "(='X'=)", '(^-^*)', '(>_<)', '(o^^)o', '(^_^)b'];

    const API = 'https://fonts.googleapis.com/css2?family=';
    const SITE = location.origin; // content scripts have no base URL for relative addresses
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
    const TICK_MS = 400;
    const TIP_DELAY = 200;   // ms over a control before its tooltip shows
    // Grid: space between the upright and italic blocks, in em of the text size
    // (a bit more than the line spacing). Rows: no gap, tighter lines instead.
    const STYLE_GAP = 0.2;
    // Sliders: see softSnap()
    const SNAP_MAGNET = 6;   // px: holds the stop while moving slowly
    const SNAP_REACH = 12;   // px: snaps after a short rest or on release
    const SNAP_SLOW = 0.25;  // px/ms: below this, movement counts as slow
    const SNAP_DELAY = 120;  // ms of rest

    // Catalog drawer: filter sections in this order; the rest keep theirs.
    const SECTION_ORDER = {
        'Serif': 200, 'Sans Serif': 210, 'Calligraphy': 220, 'Technology': 230,
        'Properties': 300, 'Feeling': 400, 'Appearance': 410, 'Seasonal': 420,
    };
    const COLLAPSED_SECTIONS = ['Feeling', 'Appearance', 'Seasonal'];
    // Writing system list: "All writing systems", these, then the rest A–Z.
    const TOP_SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew'];

    // OpenType features shown on font pages, by group. Anything not listed
    // (required shaping features like ccmp, locl, mark) stays hidden.
    // OpenType features shown on font pages, most interesting first (stylistic
    // sets and character variants are added at the start of Alternates).
    // Anything not listed (required shaping features like ccmp, locl, mark) stays hidden.
    const FEATURE_GROUPS = [
        ['Alternates', [['salt', 'Stylistic'], ['swsh', 'Swash'], ['cswh', 'Contextual swash'], ['calt', 'Contextual'],
            ['hist', 'Historical'], ['nalt', 'Annotation'], ['rand', 'Random']]],
        ['Ligatures', [['dlig', 'Discretionary'], ['hlig', 'Historical'], ['liga', 'Standard'], ['clig', 'Contextual']]],
        ['Figures', [['onum', 'Oldstyle'], ['lnum', 'Lining'], ['tnum', 'Tabular'], ['pnum', 'Proportional'],
            ['zero', 'Slashed zero'], ['frac', 'Fractions'], ['afrc', 'Stacked fractions'],
            ['sups', 'Superscript'], ['subs', 'Subscript'], ['sinf', 'Scientific inferiors'], ['ordn', 'Ordinals']]],
        ['Case', [['smcp', 'Small caps'], ['c2sc', 'Caps to small caps'], ['pcap', 'Petite caps'],
            ['c2pc', 'Caps to petite caps'], ['unic', 'Unicase'], ['case', 'Case-sensitive forms'],
            ['titl', 'Titling'], ['cpsp', 'Capital spacing']]],
        ['Spacing', [['kern', 'Kerning']]],
    ];
    const FEATURES_ON_BY_DEFAULT = new Set(['liga', 'clig', 'calt', 'kern']);
    const FEATURES_EXCLUSIVE = [['lnum', 'onum'], ['pnum', 'tnum'], ['sups', 'subs', 'sinf']];

    // OpenType language system tags → [BCP 47, name]
    const LANGS = Object.fromEntries(('AFK:af:Afrikaans,APPH:und-fonapa:Americanist phonetic,ARA:ar:Arabic,ASM:as:Assamese,'
        + 'AZE:az:Azerbaijani,BEL:be:Belarusian,BEN:bn:Bengali,BGR:bg:Bulgarian,BOS:bs:Bosnian,BRE:br:Breton,'
        + 'BSH:ba:Bashkir,CAT:ca:Catalan,CHU:cv:Chuvash,CRT:crh:Crimean Tatar,CSY:cs:Czech,DAN:da:Danish,'
        + 'DEU:de:German,ELL:el:Greek,ENG:en:English,ESP:es:Spanish,ETI:et:Estonian,EUQ:eu:Basque,EWE:ee:Ewe,'
        + 'FAR:fa:Persian,FIN:fi:Finnish,FRA:fr:French,FRI:fy:Frisian,GAE:gd:Scottish Gaelic,GAL:gl:Galician,'
        + 'GUA:gn:Guarani,GUJ:gu:Gujarati,HAU:ha:Hausa,HEB:he:Hebrew,HIN:hi:Hindi,HRV:hr:Croatian,HUN:hu:Hungarian,'
        + 'HYE:hy:Armenian,IBO:ig:Igbo,IPPH:und-fonipa:IPA,IRI:ga:Irish,IRT:ga:Irish traditional,ISL:is:Icelandic,'
        + 'ISM:smn:Inari Sami,ITA:it:Italian,JAN:ja:Japanese,KAN:kn:Kannada,KAT:ka:Georgian,KAZ:kk:Kazakh,'
        + 'KGZ:ky:Kyrgyz,KHM:km:Khmer,KOR:ko:Korean,KSM:sjd:Kildin Sami,KUR:ku:Kurdish,LAO:lo:Lao,LAT:la:Latin,'
        + 'LSM:smj:Lule Sami,LTH:lt:Lithuanian,LVI:lv:Latvian,MAH:mh:Marshallese,MAR:mr:Marathi,MKD:mk:Macedonian,'
        + 'MLR:ml:Malayalam,MNG:mn:Mongolian,MOL:ro-MD:Moldavian,MTS:mt:Maltese,NAV:nv:Navajo,NEP:ne:Nepali,'
        + 'NLD:nl:Dutch,NOR:nb:Norwegian,NSM:se:Northern Sami,PAN:pa:Punjabi,PGR:el-polyton:Polytonic Greek,'
        + 'PLK:pl:Polish,PTG:pt:Portuguese,ROM:ro:Romanian,ROY:rm:Romansh,RUS:ru:Russian,SAN:sa:Sanskrit,'
        + 'SKS:sms:Skolt Sami,SKY:sk:Slovak,SLV:sl:Slovenian,SND:sd:Sindhi,SNH:si:Sinhala,SQI:sq:Albanian,'
        + 'SRB:sr:Serbian,SVE:sv:Swedish,TAM:ta:Tamil,TAT:tt:Tatar,TEL:te:Telugu,THA:th:Thai,TKM:tk:Turkmen,'
        + 'TRK:tr:Turkish,UKR:uk:Ukrainian,URD:ur:Urdu,UZB:uz:Uzbek,VIT:vi:Vietnamese,WEL:cy:Welsh,YOR:yo:Yoruba,'
        + 'ZHH:zh-HK:Chinese (Hong Kong),ZHS:zh-Hans:Chinese (Simplified),ZHT:zh-Hant:Chinese (Traditional)')
        .split(',').map(x => { const [tag, bcp, name] = x.split(':'); return [tag, [bcp, name]]; }));

    // Axis names from the site's axis registry (part of /metadata/fonts)
    const AXIS_NAMES = Object.fromEntries(('opsz:Optical Size,ARRR:AR Retinal Resolution,BLED:Bleed,BNCE:Bounce,CASL:Casual,CRSV:Cursive,CTRS:Contrast,EDPT:Extrusion Depth,EHLT:Edge Highlight,ELGR:Element Grid,ELSH:Element Shape,ELXP:Element Expansion,ENLA:Enlarge,FILL:Fill,FLAR:Flare,GDOP:Guides Opacity,GEOM:Geometric Form,GRAD:Grade,HEXP:Hyper Expansion,INFM:Informality,JITT:Jitter,MONO:Monospace,MORF:Morph,ROND:Roundness,SCAN:Scanlines,SHLN:Shadow Length,SHRP:Sharpness,SOFT:Softness,SPAC:Spacing,SZP1:Size of Paint 1,SZP2:Size of Paint 2,VOLM:Volume,WONK:Wonky,XELA:Horizontal Element Alignment,XOPQ:Thick Stroke,XPN1:Horizontal Position of Paint 1,XPN2:Horizontal Position of Paint 2,XROT:Rotation in X,XTRA:Counter Width,YEAR:Year,YELA:Vertical Element Alignment,YEXT:Vertical Extension,YOPQ:Thin Stroke,YPN1:Vertical Position of Paint 1,YPN2:Vertical Position of Paint 2,YROT:Rotation in Y,YTAS:Ascender Height,YTDE:Descender Depth,YTFI:Figure Height,YTLC:Lowercase Height,YTUC:Uppercase Height,ZROT:Rotation in Z,ital:Italic,slnt:Slant,wdth:Width,wght:Weight')
        .split(',').map(x => x.split(':')));
    const AXIS_TAGS = Object.fromEntries(Object.entries(AXIS_NAMES).map(([tag, name]) => [name.toLowerCase(), tag]));

    // type.today reviews of Cyrillic fonts: [name as reviewed, rating, link to the review]
    const TYPE_TODAY = [
        ['Roboto', 'soso', 'https://type.today/ru/journal/neo#Roboto'],
        ['Oswald', 'bad', 'https://type.today/ru/journal/neo#Oswald'],
        ['Nunito', 'soso', 'https://type.today/ru/journal/neo#Nunito'],
        ['IBM Plex Sans', 'good', 'https://type.today/ru/journal/neo#Plex'],
        ['Arimo', 'bad', 'https://type.today/ru/journal/neo#Arimo'],
        ['Manrope', 'bad', 'https://type.today/ru/journal/neo#Manrope'],
        ['Inter', 'soso', 'https://type.today/ru/journal/neo#Inter'],
        ['Golos Text', 'soso', 'https://type.today/ru/journal/neo#Golos'],
        ['Alumni Sans', 'bad', 'https://type.today/ru/journal/neo#Alumni'],
        ['Overpass', 'bad', 'https://type.today/ru/journal/neo#Over'],
        ['Open Sans', 'soso', 'https://type.today/ru/journal/humanist#opensans'],
        ['PT Sans', 'good', 'https://type.today/ru/journal/humanist#ptsans'],
        ['Fira Sans', 'bad', 'https://type.today/ru/journal/humanist#fira'],
        ['Ubuntu', 'soso', 'https://type.today/ru/journal/humanist#ubuntu'],
        ['Source Sans 3', 'bad', 'https://type.today/ru/journal/humanist#source'],
        ['Noto Sans', 'good', 'https://type.today/ru/journal/humanist#noto'],
        ['Exo 2', 'bad', 'https://type.today/ru/journal/humanist#exo2'],
        ['Alegreya Sans', 'soso', 'https://type.today/ru/journal/humanist#alegreya'],
        ['Arsenal', 'good', 'https://type.today/ru/journal/humanist#arsenal'],
        ['Andika', 'bad', 'https://type.today/ru/journal/humanist#andika'],
        ['Istok Web', 'bad', 'https://type.today/ru/journal/humanist#istok'],
        ['Yanone Kaffeesatz', 'good', 'https://type.today/ru/journal/humanist#yanone'],
        ['M PLUS 1p', 'bad', 'https://type.today/ru/journal/humanist#mplus1p'],
        ['Ruda', 'bad', 'https://type.today/ru/journal/humanist#ruda'],
        ['Commissioner', 'good', 'https://type.today/ru/journal/humanist#commisioner'],
        ['Finlandica', 'soso', 'https://type.today/ru/journal/humanist#finland'],
        ['Carlito', 'bad', 'https://type.today/ru/journal/humanist#carlito'],
        ['Ysabeau', 'soso', 'https://type.today/ru/journal/humanist#ysabeau'],
        ['Lunasima', 'bad', 'https://type.today/ru/journal/humanist#lunasima'],
        ['Bellota Text', 'bad', 'https://type.today/ru/journal/humanist#bellota'],
        ['Montserrat', 'soso', 'https://type.today/ru/journal/geo#Montserrat'],
        ['Jost', 'bad', 'https://type.today/ru/journal/geo#Jost'],
        ['Didact Gothic', 'bad', 'https://type.today/ru/journal/geo#Didact'],
        ['Jura', 'bad', 'https://type.today/ru/journal/geo#Jura'],
        ['Play', 'bad', 'https://type.today/ru/journal/geo#Play'],
        ['Raleway', 'soso', 'https://type.today/ru/journal/geo#Raleway'],
        ['Piazzolla', 'good', 'https://type.today/ru/journal/old-style#Piazzolla'],
        ['Alegreya', 'soso', 'https://type.today/ru/journal/old-style#Alegreya'],
        ['EB Garamond', 'soso', 'https://type.today/ru/journal/old-style#EBGaramond'],
        ['Cormorant', 'soso', 'https://type.today/ru/journal/old-style#Cormorant'],
        ['Spectral', 'good', 'https://type.today/ru/journal/old-style#Spectral'],
        ['Merriweather', 'soso', 'https://type.today/ru/journal/transitional#Merriweather'],
        ['STIX Two Text', 'soso', 'https://type.today/ru/journal/transitional#StixTwoText'],
        ['Playfair Display', 'soso', 'https://type.today/ru/journal/transitional#PlayfairDisplay'],
        ['PT Serif', 'good', 'https://type.today/ru/journal/transitional#PTSerif'],
        ['Noto Serif', 'bad', 'https://type.today/ru/journal/transitional#NotoSerif'],
        ['Source Serif Pro', 'good', 'https://type.today/ru/journal/transitional#SourceSerifPro'],
        ['Literata', 'good', 'https://type.today/ru/journal/transitional#Literata'],
        ['Tinos', 'soso', 'https://type.today/ru/journal/transitional#Tinos'],
        ['Vollkorn', 'soso', 'https://type.today/ru/journal/transitional#Vollkorn'],
        ['Alice', 'good', 'https://type.today/ru/journal/transitional#Alice'],
        ['Lora', 'good', 'https://type.today/ru/journal/transitional#Lora'],
        ['IBM Plex Serif', 'good', 'https://type.today/ru/journal/gfdidones#IBMPlexSerif'],
        ['Prata', 'soso', 'https://type.today/ru/journal/gfdidones#Prata'],
        ['Old Standard TT', 'bad', 'https://type.today/ru/journal/gfdidones#OldStandartTT'],
        ['Ledger', 'bad', 'https://type.today/ru/journal/gfdidones#Ledger'],
        ['Brygada 1918', 'bad', 'https://type.today/ru/journal/gfdidones#Brygada1918'],
        ['Marck Script', 'bad', 'https://type.today/ru/journal/scripts#MarckScript'],
        ['Bad Script', 'soso', 'https://type.today/ru/journal/scripts#BadScript'],
        ['Lobster', 'soso', 'https://type.today/ru/journal/scripts#Lobster'],
        ['Pacifico', 'soso', 'https://type.today/ru/journal/scripts#Pacifico'],
        ['Caveat', 'soso', 'https://type.today/ru/journal/scripts#Caveat'],
        ['Comforter', 'soso', 'https://type.today/ru/journal/scripts#Comforter'],
        ['Shantell Sans', 'good', 'https://type.today/ru/journal/scripts#Shantell%20Sans'],
        ['Dela Gothic One', 'bad', 'https://type.today/ru/journal/display#Dela'],
        ['Poiret One', 'soso', 'https://type.today/ru/journal/display#PoiretOne'],
        ['Tektur', 'soso', 'https://type.today/ru/journal/display#Tektur'],
        ['Rampart One', 'bad', 'https://type.today/ru/journal/display#RampartOne'],
        ['Kelly Slab', 'bad', 'https://type.today/ru/journal/display#KellySlab'],
        ['Reggae One', 'bad', 'https://type.today/ru/journal/display#ReggaeOne'],
        ['Stick', 'bad', 'https://type.today/ru/journal/display#Stick'],
        ['Train One', 'bad', 'https://type.today/ru/journal/display#TrainOne'],
        ['Kablammo', 'good', 'https://type.today/ru/journal/display#Kablammo'],
        ['Oi', 'good', 'https://type.today/ru/journal/display#PoiretOne'],
        ['Press Start 2P', 'soso', 'https://type.today/ru/journal/display2#PressStart'],
        ['Pixelify Sans', 'bad', 'https://type.today/ru/journal/display2#Pixelify'],
        ['Handjet', 'soso', 'https://type.today/ru/journal/display2#Handjet'],
        ['Tiny5', 'soso', 'https://type.today/ru/journal/display2#Tiny5'],
        ['Rubik Generative Fonts', 'good', 'https://type.today/ru/journal/display2#RubikGen'],
        ['Rubik Mono One', 'good'],
        ['Rubik', 'soso', 'https://type.today/ru/journal/geo#Rubik'],
        ['Ruslan Display', 'soso', 'https://type.today/ru/journal/display2#Ruslan'],
        ['Geologica', 'soso', 'https://type.today/ru/journal/geo2#Geologica'],
        ['Google Sans', 'good', 'https://type.today/ru/journal/geo2#GoogleSans'],
        ['LINE Seed', 'bad', 'https://type.today/ru/journal/geo2#LINESeed'],
        ['JetBrains Mono', 'good', 'https://type.today/ru/journal/geo2#JetBrains'],
        ['Comfortaa', 'bad', 'https://type.today/ru/journal/geo2#Comfortaa'],
        ['Wix Madefor Display', 'bad', 'https://type.today/ru/journal/geo2#WixMadefor'],
        ['Wix Madefor Text', 'bad', 'https://type.today/ru/journal/geo2#WixMadefor'],
    ];
    // Ratings from the GF Boost authors: [family, rating, tooltip, link (optional)].
    // They look the same as type.today ratings; only the tooltip and the link differ.
    const CURATED = [
        ['Roboto Flex', 'good', 'GF Boost authors: Good'],
    ];
    // Google Fonts family → name used in the review, where they differ
    const TYPE_TODAY_ALIASES = {
        'Source Serif 4': 'Source Serif Pro', 'LINE Seed JP': 'LINE Seed',
        'Finlandica Headline': 'Finlandica', 'Finlandica Text': 'Finlandica', 'Tiny5 Duo': 'Tiny5',
    };
    // Rating mark: a squircle rather than a mechanical circle. Built with DOM
    // calls: the site's Trusted Types policy blocks HTML strings.
    function squircle() {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('class', 'gfb-rating__dot');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M50 0c29 0 50 21 50 50s-21 50-50 50S0 79 0 50 21 0 50 0');
        svg.append(path);
        return svg;
    }
    const RATINGS = {
        good: { label: 'Good', color: '#34a853' },
        soso: { label: 'So-so', color: '#fbbc04' },
        bad: { label: 'Bad', color: '#ea4335' },
    };

    // ─── 2. Small helpers ───────────────────────────────────────
    const isCatalog = () => location.pathname === '/';
    const isSpecimen = () => location.pathname.startsWith('/specimen/');

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function isEditable(node) {
        if (!node || node.nodeType !== 1) return false;
        return node.isContentEditable
            || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)
            || !!node.closest('[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="combobox"]');
    }

    function hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) >>> 0;
        return h;
    }

    const kaomojiFor = family => KAOMOJI[hash(family) % KAOMOJI.length];
    const normName = s => s.replace(/\s+/g, ' ').trim().toLowerCase(); // also folds no-break spaces

    // Our own font-family names, so loaded faces never clash with the site's
    const alias = (kind, family) => `gfb-${kind} ${family}`.replace(/['"\\]/g, '');

    // The card link is /specimen/Family+Name?… — always the API family name,
    // unlike the visible title, which can be a display name.
    function familyOf(tile) {
        const href = tile.querySelector('a.gf-block-anchor')?.getAttribute('href') || '';
        const m = href.match(/\/specimen\/([^?#/]+)/);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    }

    function specimenFamily() {
        const m = location.pathname.match(/^\/specimen\/([^/?#]+)/);
        return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    }

    // Text of a filter panel title without its icon ligature
    function panelTitle(node) {
        const title = node?.querySelector('mat-panel-title');
        if (!title) return '';
        return [...title.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    }

    function setOrder(node, order) {
        if (node.style.order !== String(order)) node.style.order = String(order);
    }

    function debounce(fn, ms) {
        let t = 0;
        return () => { clearTimeout(t); t = setTimeout(fn, ms); };
    }

    // Replaces (or removes, with value null) one axis in a font-variation-settings string.
    function withAxis(settings, tag, value) {
        const parts = (settings === 'normal' ? '' : settings).split(',').map(x => x.trim())
            .filter(x => x && !new RegExp(`^["']${tag}["']`).test(x));
        if (value != null) parts.push(`"${tag}" ${value}`);
        return parts.join(', ');
    }

    // ─── 3. Storage ─────────────────────────────────────────────
    // Data lives in the userscript manager's storage, not in the site's
    // localStorage: the site syncs its own settings (theme included) between
    // tabs through localStorage events, and our writes must not feed into that.
    // localStorage is only the last resort, for a manager with no storage at all.
    //
    // GM.getValue is asynchronous in the modern API, so everything is read once
    // before boot() into `data`; after that get() is synchronous, and set()
    // updates `data` at once and writes in the background.
    const backends = [
        {   // Tampermonkey, Violentmonkey, Userscripts for Safari
            ok: () => typeof GM !== 'undefined' && typeof GM.getValue === 'function' && typeof GM.setValue === 'function',
            read: key => GM.getValue(key),
            write: (key, value) => GM.setValue(key, value),
        },
        {   // older managers
            ok: () => typeof GM_getValue === 'function' && typeof GM_setValue === 'function',
            read: key => GM_getValue(key),
            write: (key, value) => GM_setValue(key, value),
        },
        {
            ok: () => typeof localStorage !== 'undefined',
            read(key) {
                const raw = localStorage.getItem(`gf-boost:${key}`);
                return raw === null ? undefined : JSON.parse(raw);
            },
            write: (key, value) => localStorage.setItem(`gf-boost:${key}`, JSON.stringify(value)),
        },
    ];

    const Store = {
        keys: ['mode', 'has', 'kaomoji', 'guidance'],
        data: {},
        usable: [],

        async load() {
            this.usable = backends.filter(b => { try { return b.ok(); } catch { return false; } });
            await Promise.all(this.keys.map(async key => {
                for (const backend of this.usable) {
                    try {
                        const value = await backend.read(key);
                        if (value !== undefined) this.data[key] = value;
                        return;
                    } catch { /* blocked: try the next one */ }
                }
            }));
        },

        get(key, fallback) {
            return key in this.data ? this.data[key] : fallback;
        },

        set(key, value) {
            this.data[key] = value;
            this.write(key, value, 0);
        },

        async write(key, value, from) {
            for (const backend of this.usable.slice(from)) {
                try {
                    await backend.write(key, value);
                    return;
                } catch { /* blocked: try the next one */ }
            }
        },
    };

    // ─── 4. URL ─────────────────────────────────────────────────
    // The site rewrites the address on every filter change: it drops our
    // parameters or puts back stale copies. So our parameters are read once,
    // when the page opens (a shared link), and after that always rewritten
    // from the current state. Each page keeps only its own parameters.
    const Url = {
        get(name) { return new URLSearchParams(location.search).get(name); },

        tokens() { return (this.get(PARAM) || '').split(',').map(t => t.trim()).filter(Boolean); },

        // Edits the query string by hand: URLSearchParams would re-encode
        // the site's own parameters (categoryFilters etc.).
        write() {
            const url = new URL(location.href);
            const parts = url.search.slice(1).split('&').filter(p => p && p.split('=')[0] !== PARAM);
            const value = desiredTokens().join(',');
            if (value) parts.push(`${PARAM}=${encodeURIComponent(value).replace(/%2C/gi, ',')}`);
            url.search = parts.length ? `?${parts.join('&')}` : '';
            if (url.href === location.href) return;
            window.history.replaceState(window.history.state, '', url.href); // keep the router's state
            Router.last = location.href;
        },
    };

    function desiredTokens() {
        const t = [];
        if (isCatalog()) {
            if (State.mode !== 'R') t.push(State.mode.toLowerCase());
            if (State.wght !== 400) t.push(String(State.wght));
        }
        if (isSpecimen() && Spec.family === specimenFamily()) {
            if (!Opsz.auto && Opsz.value != null) t.push(`o${Opsz.value}`);
            t.push(...OT.tokens());
            if (OT.lang) t.push(OT.lang);
        }
        return t;
    }

    // Settings from the address the page was opened with
    function linkSettings() {
        const tokens = Url.tokens();
        const pick = re => tokens.filter(t => re.test(t));
        const style = pick(TOKEN.style)[0];
        return {
            mode: style ? style.toUpperCase() : null,
            wght: parseInt(pick(TOKEN.wght)[0], 10),
            opsz: pick(TOKEN.opsz)[0]?.slice(1),
            fea: pick(TOKEN.fea).join(','),
            lang: pick(TOKEN.lang)[0],
        };
    }

    const Router = {
        last: '',
        check() {
            if (location.href === this.last) return;
            this.last = location.href;
            Url.write();
            if (isCatalog()) Tiles.markAll(); // e.g. the writing system changed (ratings)
        },
    };

    // ─── 5. State (catalog) ─────────────────────────────────────
    const State = {
        mode: 'R',
        wght: 400,
        beforeBoth: 'R', // where "Show Upright & Italic" returns to

        // Weight always starts at Regular unless a link says otherwise;
        // the style is remembered between visits.
        init() {
            const link = isCatalog() ? linkSettings() : {};
            const saved = Store.get('mode', null);
            this.mode = MODES.includes(link.mode) ? link.mode : (MODES.includes(saved) ? saved : 'R');
            this.wght = WEIGHTS.includes(link.wght) ? link.wght : 400;
        },

        set(mode) {
            if (!MODES.includes(mode) || mode === this.mode) return;
            this.mode = mode;
            Store.set('mode', mode);
            render();
        },

        // The [I] button and the I key: on in both views, so off leaves both.
        toggleItalic() {
            this.set(this.mode === 'R' ? 'I' : 'R');
        },

        // "Show Upright & Italic" and Shift+I: leaving it restores what was on before.
        toggleBoth() {
            if (this.mode === 'RI') { this.set(this.beforeBoth); return; }
            this.beforeBoth = this.mode;
            this.set('RI');
        },

        setWeight(w) {
            if (!WEIGHTS.includes(w) || w === this.wght) return;
            this.wght = w;
            render();
        },

        changed() {
            return this.mode !== 'R' || this.wght !== 400 || !Kaomoji.on;
        },

        // Everything back to the defaults, for the site's "Reset all"
        reset() {
            this.mode = 'R';
            this.wght = 400;
            this.beforeBoth = 'R';
            Store.set('mode', 'R');
            Kaomoji.set(true);
            Guidance.set(false);
            render();
        },
    };

    // ─── 6. Fonts: style detection & loading ────────────────────
    const Fonts = {
        has: {},             // family → [1|0, checkedAt]: has an italic at all
        detecting: new Set(),
        sheets: new Map(),   // request key → Promise<boolean>
        avail: new Map(),    // 'kind|family|weight' → the exact style exists
        near: new Map(),     // 'kind|family|weight' → the weight to show instead
        ready: new Set(),    // 'kind|family|weight' with a face loaded (exact or fallback)
        loading: new Set(),

        init() {
            const now = Date.now();
            for (const [family, entry] of Object.entries(Store.get('has', {}))) {
                if (Array.isArray(entry) && now - entry[1] < CACHE_TTL) this.has[family] = entry;
            }
        },

        save: debounce(() => Store.set('has', Fonts.has), 1000),

        // 'yes' | 'no' | 'pending'
        status(family) {
            const entry = this.has[family];
            if (entry) return entry[0] ? 'yes' : 'no';
            this.detect(family);
            return 'pending';
        },

        // The API answers 400 when a family has no italic.
        detect(family) {
            if (this.detecting.has(family)) return;
            this.detecting.add(family);
            this.sheet(family, 'i', ':ital,wght@1,400').then(ok => {
                this.has[family] = [ok ? 1 : 0, Date.now()];
                this.save();
                Tiles.markFamily(family);
            }, () => {
                setTimeout(() => this.detecting.delete(family), 60000); // network error: retry later
            });
        },

        // Fetches the API stylesheet once and injects it under our alias.
        // Fonts themselves download only when something uses them.
        sheet(family, kind, spec, extra = '') {
            const key = [kind, family, spec, extra].join('|');
            if (!this.sheets.has(key)) {
                const url = `${API}${encodeURIComponent(family).replace(/%20/g, '+')}${spec}&display=block${extra}`;
                // A 400 ("no such style") comes without CORS headers, so fetch()
                // fails exactly like a network error. Tell them apart with a probe.
                const promise = fetch(url).catch(err => this.probe().then(online => {
                    if (online) return null;
                    throw err;
                })).then(async res => {
                    if (!res) return false;
                    if (!res.ok) {
                        if (res.status >= 400 && res.status < 500) return false;
                        throw new Error(`HTTP ${res.status}`);
                    }
                    const css = (await res.text()).replace(/font-family:\s*'[^']*'/g, `font-family: '${alias(kind, family)}'`);
                    const style = el('style', null, css);
                    style.dataset.gfBoost = key;
                    document.head.append(style);
                    return true;
                });
                promise.catch(() => this.sheets.delete(key));
                this.sheets.set(key, promise);
            }
            return this.sheets.get(key);
        },

        // Is the Fonts API reachable at all? Cached for 30 s.
        probe() {
            if (!this.probeAt || Date.now() - this.probeAt > 30000) {
                this.probeAt = Date.now();
                this.probeResult = fetch(`${API}Roboto&text=a`).then(r => r.ok, () => false);
            }
            return this.probeResult;
        },

        // kind 'i': the italic. kind 'r': our own copy of the upright, so the
        // layer does not depend on the site's per-keystroke font subsets.
        isReady(kind, family, weight) {
            return this.ready.has(`${kind}|${family}|${weight}`);
        },

        // true / false once known: the family has this exact style
        exists(kind, family, weight) {
            return this.avail.get(`${kind}|${family}|${weight}`);
        },

        // The weight actually drawn for a request, once it is ready
        shown(kind, family, weight) {
            return this.near.get(`${kind}|${family}|${weight}`) ?? weight;
        },

        // The closest style the family has, what a slider would stop on last.
        // The API only answers yes or no, so this takes the family's metadata.
        async nearest(kind, family, weight) {
            const fonts = await Meta.get(family).then(m => m.fonts || {}, () => ({}));
            const weights = Object.keys(fonts).filter(k => k.endsWith('i') === (kind === 'i')).map(k => parseInt(k, 10));
            if (!weights.length) return 400;
            return weights.reduce((best, w) => {
                const d = Math.abs(w - weight) - Math.abs(best - weight);
                return d < 0 || (d === 0 && w < best) ? w : best; // a tie goes to the lighter one
            });
        },

        load(kind, family, weight, text) {
            const key = `${kind}|${family}|${weight}`;
            if (this.ready.has(key) || this.loading.has(key)) return;
            this.loading.add(key);
            const spec = w => (kind === 'i' ? `:ital,wght@1,${w}` : `:wght@${w}`);
            this.sheet(family, kind, spec(weight))
                .then(async ok => {
                    this.avail.set(key, !!ok);
                    if (ok) return;
                    const w = await this.nearest(kind, family, weight);
                    this.near.set(key, w);
                    await this.sheet(family, kind, spec(w));
                })
                .then(() => {
                    const style = kind === 'i' ? 'italic' : 'normal';
                    return document.fonts.load(`${style} ${this.shown(kind, family, weight)} 40px "${alias(kind, family)}"`, text || 'Aa');
                })
                .catch(() => { /* render with whatever loaded */ })
                .finally(() => {
                    this.loading.delete(key);
                    this.ready.add(key);
                    Tiles.markFamily(family);
                });
        },
    };

    // ─── 7. Font files: OpenType data for font pages ────────────
    // Axis ranges come from the site's per-family metadata. Features,
    // languages and named instances need the font file itself: we take the
    // file list the site's download button uses and read only the tables we
    // need (GSUB, GPOS, fvar, name) with HTTP range requests — tens of KB
    // instead of the whole file.
    const Meta = {
        cache: new Map(),
        get(family) {
            if (!this.cache.has(family)) {
                const promise = fetch(`${SITE}/metadata/fonts/${encodeURIComponent(family)}`)
                    .then(r => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
                    .then(t => JSON.parse(t.slice(t.indexOf('{'))));
                promise.catch(() => this.cache.delete(family));
                this.cache.set(family, promise);
            }
            return this.cache.get(family);
        },
    };
    const Axes = { get: family => Meta.get(family).then(m => m.axes || []) };

    const FontFile = {
        cache: new Map(),

        // A failed load (network hiccup, page still starting) is retried on
        // the next request instead of being remembered as "no data".
        get(family) {
            if (!this.cache.has(family)) {
                const promise = this.load(family).catch(() => {
                    this.cache.delete(family);
                    return null;
                });
                this.cache.set(family, promise);
            }
            return this.cache.get(family);
        },

        async load(family) {
            const list = await (await fetch(`${SITE}/download/list?family=${encodeURIComponent(family)}`)).text();
            const refs = JSON.parse(list.slice(list.indexOf('{'))).manifest?.fileRefs || [];
            const ttf = refs.filter(r => /\.ttf$/i.test(r.filename));
            const pick = ttf.find(r => !r.filename.startsWith('static/') && !/italic/i.test(r.filename))
                || ttf.find(r => /-Regular\.ttf$/i.test(r.filename))
                || ttf.find(r => !/italic/i.test(r.filename))
                || ttf[0];
            if (!pick) return null;

            const read = this.reader(pick.url);
            let head = new DataView(await read(0, 1023));
            const count = head.getUint16(4);
            if (12 + count * 16 > head.byteLength) head = new DataView(await read(0, 12 + count * 16));
            const dir = {};
            for (let i = 0; i < count; i++) {
                const at = 12 + i * 16;
                dir[tag4(head, at)] = { offset: head.getUint32(at + 8), length: head.getUint32(at + 12) };
            }
            const tables = {};
            await Promise.all(['GSUB', 'GPOS', 'fvar', 'name'].filter(t => dir[t]).map(async t => {
                tables[t] = new DataView(await read(dir[t].offset, dir[t].offset + dir[t].length - 1));
            }));

            const names = tables.name ? parseName(tables.name) : new Map();
            const gsub = parseLayout(tables.GSUB);
            const gpos = parseLayout(tables.GPOS);
            const features = new Map([...gpos.features, ...gsub.features]);
            const languages = new Set([...gsub.languages, ...gpos.languages]);
            const fvar = tables.fvar ? parseFvar(tables.fvar) : { axes: [], instances: [] };

            return {
                files: ttf,                     // all font files of the family
                features,                       // tag → name ID of its UI name, or null
                languages,                      // OpenType language system tags
                featureName: tag => names.get(features.get(tag)) || null,
                axes: fvar.axes.map(a => ({ ...a, name: names.get(a.nameId) || a.tag })),
                // Positions of named instances along one axis, plus its default
                stops(tag) {
                    const i = fvar.axes.findIndex(a => a.tag === tag);
                    if (i < 0) return [];
                    const set = new Set([fvar.axes[i].def, ...fvar.instances.map(c => c[i])]);
                    return [...set].map(v => Math.round(v * 100) / 100).sort((a, b) => a - b);
                },
                axisTag(name) {
                    const a = this.axes.find(x => normName(x.name) === normName(name));
                    return a ? a.tag : AXIS_TAGS[normName(name)] || null;
                },
            };
        },

        // Range reads; if the server ignores Range, the whole file is kept once.
        reader(url) {
            let whole = null;
            return async (start, end) => {
                if (whole) return whole.slice(start, end + 1);
                const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = await res.arrayBuffer();
                if (res.status === 200 && buf.byteLength > end - start + 1) {
                    whole = buf;
                    return buf.slice(start, end + 1);
                }
                return buf;
            };
        },
    };

    // The site and the Fonts API serve fonts with most OpenType features
    // stripped. For features and languages to work, the previews switch to the
    // family's original files. They are registered as FontFace objects: the
    // browser downloads only the files the previews actually use, once.
    const STATIC_WEIGHTS = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 };
    const FullFont = {
        done: new Set(),
        name: family => `gfb-full ${family}`.replace(/['"\\]/g, ''),

        ensure(family, info) {
            if (this.done.has(family) || !info?.files?.length) return;
            this.done.add(family);
            const variable = info.files.filter(f => !f.filename.startsWith('static/') && /VariableFont/i.test(f.filename));
            const axis = tag => info.axes.find(a => a.tag === tag);
            for (const f of variable.length ? variable : info.files) {
                const italic = /Italic/i.test(f.filename);
                const d = { style: italic ? 'italic' : 'normal' };
                if (variable.length) {
                    const w = axis('wght');
                    const st = axis('wdth');
                    if (w) d.weight = `${w.min} ${w.max}`;
                    if (st) d.stretch = `${st.min}% ${st.max}%`;
                } else {
                    const m = f.filename.match(/-([A-Za-z]+?)(Italic)?\.ttf$/i);
                    d.weight = String(STATIC_WEIGHTS[m?.[1]] || 400);
                }
                try { document.fonts.add(new FontFace(this.name(family), `url("${f.url}") format("truetype")`, d)); } catch { /* bad descriptor */ }
            }
        },
    };

    function tag4(dv, at) {
        return String.fromCharCode(dv.getUint8(at), dv.getUint8(at + 1), dv.getUint8(at + 2), dv.getUint8(at + 3));
    }

    // GSUB / GPOS: script list (→ language systems) and feature list
    function parseLayout(dv) {
        const out = { features: new Map(), languages: new Set() };
        if (!dv || dv.byteLength < 10) return out;
        try {
            const scriptList = dv.getUint16(4);
            const featureList = dv.getUint16(6);
            for (let i = 0, n = dv.getUint16(scriptList); i < n; i++) {
                const script = scriptList + dv.getUint16(scriptList + 2 + i * 6 + 4);
                for (let j = 0, m = dv.getUint16(script + 2); j < m; j++) {
                    out.languages.add(tag4(dv, script + 4 + j * 6).trim());
                }
            }
            for (let i = 0, n = dv.getUint16(featureList); i < n; i++) {
                const rec = featureList + 2 + i * 6;
                const tag = tag4(dv, rec);
                const feature = featureList + dv.getUint16(rec + 4);
                const params = dv.getUint16(feature);
                // ssXX: version, UINameID. cvXX: format, featUiLabelNameId.
                const nameId = params && /^(ss|cv)\d\d$/.test(tag) ? dv.getUint16(feature + params + 2) : null;
                if (!out.features.has(tag) || nameId) out.features.set(tag, nameId);
            }
        } catch { /* malformed table: use what was read */ }
        return out;
    }

    function parseFvar(dv) {
        const axesAt = dv.getUint16(4);
        const axisCount = dv.getUint16(8);
        const axisSize = dv.getUint16(10);
        const instanceCount = dv.getUint16(12);
        const instanceSize = dv.getUint16(14);
        const axes = [];
        for (let i = 0; i < axisCount; i++) {
            const at = axesAt + i * axisSize;
            axes.push({
                tag: tag4(dv, at),
                min: dv.getInt32(at + 4) / 65536,
                def: dv.getInt32(at + 8) / 65536,
                max: dv.getInt32(at + 12) / 65536,
                nameId: dv.getUint16(at + 18),
            });
        }
        const instances = [];
        const first = axesAt + axisCount * axisSize;
        for (let i = 0; i < instanceCount; i++) {
            const at = first + i * instanceSize + 4;
            instances.push(axes.map((_, k) => dv.getInt32(at + k * 4) / 65536));
        }
        return { axes, instances };
    }

    // English (Windows, US) names, falling back to Mac Roman
    function parseName(dv) {
        const names = new Map();
        const count = dv.getUint16(2);
        const strings = dv.getUint16(4);
        for (let i = 0; i < count; i++) {
            const at = 6 + i * 12;
            const platform = dv.getUint16(at);
            const language = dv.getUint16(at + 4);
            const id = dv.getUint16(at + 6);
            const length = dv.getUint16(at + 8);
            const offset = strings + dv.getUint16(at + 10);
            let text = '';
            if (platform === 3 && language === 0x409) {
                for (let k = 0; k < length; k += 2) text += String.fromCharCode(dv.getUint16(offset + k));
                names.set(id, text);
            } else if (platform === 1 && !names.has(id)) {
                for (let k = 0; k < length; k++) text += String.fromCharCode(dv.getUint8(offset + k));
                names.set(id, text);
            }
        }
        return names;
    }

    // ─── 8. Tooltip ─────────────────────────────────────────────
    const Focus = { keyboard: false };

    const Tip = {
        node: null,
        timer: 0,
        targets: new WeakMap(), // element → { getText, place }
        hovered: null,
        shownAt: 0,

        // Hover is watched in one place: with nested targets (the italic mark
        // inside "N styles") the innermost one under the pointer wins, and
        // moving from it to its parent counts as entering the parent.
        init() {
            document.addEventListener('pointerover', e => {
                let n = e.target;
                while (n && !this.targets.has(n)) n = n.parentElement;
                if (n !== this.hovered) this.enter(n || null);
            }, true);
            document.addEventListener('pointerout', e => {
                if (!e.relatedTarget) this.enter(null); // left the window
            }, true);
        },

        bind(target, getText, place) {
            this.targets.set(target, { getText, place });
            target.addEventListener('pointerdown', () => this.hide());
            target.addEventListener('focus', () => { if (Focus.keyboard) this.show(target, getText(), place); });
            target.addEventListener('blur', () => this.hide());
        },

        enter(target) {
            const warm = !!this.node;
            this.hide();
            this.hovered = target;
            if (!target) return;
            const { getText, place } = this.targets.get(target);
            const text = getText(); // asked now: data that takes a request starts loading at once
            text?.catch?.(() => {});
            this.timer = setTimeout(() => this.show(target, text, place), warm ? 0 : TIP_DELAY);
        },

        show(target, text, place) {
            if (text && typeof text.then === 'function') {
                text.then(t => { if (this.hovered === target) this.show(target, t, place); }, () => {});
                return;
            }
            this.hide();
            if (!target.isConnected || !text) return;
            // The site loads its tooltip CSS only after its first tooltip,
            // so the look is reproduced from the site's tooltip tokens.
            const panel = el('div', 'gfb-tip', text);
            panel.setAttribute('role', 'tooltip');
            document.body.append(panel);
            const r = target.getBoundingClientRect();
            const b = panel.getBoundingClientRect();
            const left = Math.max(8, Math.min(r.left + r.width / 2 - b.width / 2, innerWidth - b.width - 8));
            const top = place === 'above' ? r.top - b.height - 8 : r.bottom + 8;
            panel.style.left = `${Math.round(left)}px`;
            panel.style.top = `${Math.round(top)}px`;
            this.node = panel;
        },

        hide() {
            clearTimeout(this.timer);
            this.node?.remove();
            this.node = null;
        },
    };

    // ─── 9. Slider kit: ticks, soft snapping, cloned sliders ────
    // Tick marks with the site's own classes (as on the Icons page sliders).
    function renderTicks(box, track, stops, toPos, value) {
        const width = track.offsetWidth;
        const current = toPos(value);
        const shown = stops.map(toPos).filter(p => p > 0.001 && p < 0.999); // the ends have their own dot
        while (box.children.length < shown.length) box.append(el('div'));
        while (box.children.length > shown.length) box.lastElementChild.remove();
        shown.forEach((p, i) => {
            const tick = box.children[i];
            const cls = p <= current + 1e-6 ? 'mdc-slider__tick-mark--active' : 'mdc-slider__tick-mark--inactive';
            if (tick.className !== cls) tick.className = cls;
            const transform = `translateX(${(p * width).toFixed(1)}px)`;
            if (tick.style.transform !== transform) tick.style.transform = transform;
        });
    }

    // Sticking to stops, for both ways of moving a slider:
    // - moving slowly: within SNAP_MAGNET px of a stop the value holds on the
    //   stop (a small detent you can feel); moving fast passes straight through;
    // - resting or letting go within SNAP_REACH px of a stop snaps onto it.
    // Distances are in pixels, so it feels the same on every axis.
    function softSnap(input, { stops, toPos, get, set, width }) {
        let down = false;
        let timer = 0;
        let lastX = 0;
        let lastT = 0;
        let speed = 0; // px per ms, smoothed
        const nearest = reach => {
            if (!reach) return null;
            const w = width() || 1;
            const p = toPos(get()) * w;
            let best = null;
            let dist = reach;
            for (const s of stops()) {
                const d = Math.abs(toPos(s) * w - p);
                if (d <= dist) { dist = d; best = s; }
            }
            return best;
        };
        input.addEventListener('pointerdown', e => {
            down = true;
            speed = 0;
            lastX = e.clientX;
            lastT = e.timeStamp;
        });
        input.addEventListener('pointermove', e => {
            if (!down) return;
            const dt = Math.max(1, e.timeStamp - lastT);
            speed = speed * 0.5 + 0.5 * Math.abs(e.clientX - lastX) / dt;
            lastX = e.clientX;
            lastT = e.timeStamp;
        });
        input.addEventListener('input', e => {
            clearTimeout(timer);
            if (!e.isTrusted || !down) return;
            const held = nearest(speed < SNAP_SLOW ? SNAP_MAGNET : 0);
            if (held != null) { if (get() !== held) set(held); return; }
            const s = nearest(SNAP_REACH);
            if (s != null) timer = setTimeout(() => { if (down && get() !== s) set(s); }, SNAP_DELAY);
        });
        window.addEventListener('pointerup', () => {
            if (!down) return;
            down = false;
            clearTimeout(timer);
            const s = nearest(SNAP_REACH);
            if (s != null && get() !== s) set(s);
        }, true);
    }

    // A clone of one of the site's sliders, driven by us: native markup and
    // look (track, thumb, value bubble, ripples, ticks), our own values.
    class CloneSlider {
        constructor(template, o) {
            this.o = { step: 1, log: false, stops: () => [], format: String, ...o };
            this.value = o.value;
            this.disabled = false;
            this.hover = false;
            this.dragging = false;

            const root = this.root = template.cloneNode(true);
            root.removeAttribute('id');
            root.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
            root.querySelectorAll('.mdc-slider__tick-marks').forEach(n => n.remove());
            root.classList.add('gfb-slider');
            const q = s => (root.matches(s) ? root : root.querySelector(s));
            this.slider = q('mat-slider');
            this.input = q('input[type="range"]');
            this.track = q('.mdc-slider__track');
            this.fill = q('.mdc-slider__track--active_fill');
            this.thumb = q('.mdc-slider__thumb');
            this.text = q('.mdc-slider__value-indicator-text');
            this.ripple = q('.mdc-slider__thumb .mat-ripple');
            this.slider.classList.remove('mdc-slider--disabled');
            this.slider.classList.add('mdc-slider--discrete');
            this.thumb.classList.remove('mdc-slider__thumb--with-indicator', 'mdc-slider__thumb--focused',
                'mdc-slider__thumb--short-value');
            this.ripple?.replaceChildren();
            this.ticks = el('div', 'mdc-slider__tick-marks gfb-ticks');
            this.ticks.setAttribute('aria-hidden', 'true');
            this.track.append(this.ticks);

            // The native input works in 0…1000 positions; values are mapped.
            const input = this.input;
            input.removeAttribute('matsliderthumb');
            input.disabled = false;
            input.min = '0';
            input.max = '1000';
            input.step = '1';
            input.setAttribute('aria-label', this.o.label);
            input.addEventListener('input', () => this.change(this.fromPos(+input.value / 1000)));
            input.addEventListener('keydown', e => this.onKey(e));
            input.addEventListener('pointerenter', () => { this.hover = true; this.paint(); });
            input.addEventListener('pointerleave', () => { this.hover = false; this.paint(); });
            input.addEventListener('pointerdown', () => { this.dragging = true; this.paint(); });
            window.addEventListener('pointerup', () => { if (this.dragging) { this.dragging = false; this.paint(); } });
            input.addEventListener('focus', () => this.paint());
            input.addEventListener('blur', () => this.paint());
            if (this.o.snap) {
                softSnap(input, {
                    stops: this.o.stops, toPos: v => this.toPos(v), get: () => this.value, set: v => this.change(v),
                    width: () => this.track.offsetWidth,
                });
            }
            new ResizeObserver(() => this.render()).observe(this.track);
        }

        // Wide ranges (Playfair opsz: 5…1200) use a logarithmic scale, so the
        // useful small values are not squeezed into the first few pixels.
        toPos(v) {
            const { min, max, log } = this.o;
            v = this.clamp(v);
            return log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
        }

        fromPos(t) {
            const { min, max, log } = this.o;
            return log ? min * (max / min) ** t : min + t * (max - min);
        }

        clamp(v) { return Math.min(this.o.max, Math.max(this.o.min, v)); }

        round(v) {
            const st = this.o.step;
            return this.clamp(Number((Math.round(v / st) * st).toFixed(st < 1 ? 1 : 0)));
        }

        change(v) {
            v = this.round(v);
            if (v === this.value) return this.render();
            this.value = v;
            this.render();
            this.o.onInput?.(v);
        }

        set(v) {
            this.value = this.round(v);
            this.render();
        }

        setDisabled(off) {
            this.disabled = off;
            this.input.disabled = off;
            this.slider.classList.toggle('mdc-slider--disabled', off);
            this.paint();
        }

        render() {
            if (!this.root.isConnected || this.value == null) return;
            const t = this.toPos(this.value);
            const width = this.track.offsetWidth;
            const label = this.o.format(this.value);
            const transform = `translateX(${(t * width).toFixed(2)}px)`;
            if (this.thumb.style.transform !== transform) this.thumb.style.transform = transform;
            const fill = `scaleX(${t.toFixed(4)})`;
            if (this.fill && this.fill.style.transform !== fill) this.fill.style.transform = fill;
            if (this.text && this.text.textContent !== label) this.text.textContent = label;
            const pos = String(Math.round(t * 1000));
            if (this.input.value !== pos) this.input.value = pos;
            this.input.setAttribute('aria-valuetext', label);
            renderTicks(this.ticks, this.track, this.o.stops(), v => this.toPos(v), this.value);
        }

        // Same states as the site's sliders: value bubble and hover ripple on
        // hover, focus ring and pressed ripple while dragging.
        paint() {
            const on = !this.disabled;
            const focused = document.activeElement === this.input;
            this.thumb.classList.toggle('mdc-slider__thumb--with-indicator', on && (this.hover || this.dragging || focused));
            this.thumb.classList.toggle('mdc-slider__thumb--focused', on && (this.dragging || focused));
            this.rippleOn('hover', on && this.hover && !this.dragging);
            this.rippleOn('active', on && this.dragging);
            this.rippleOn('focus', on && focused && !this.dragging);
        }

        rippleOn(kind, on) {
            if (!this.ripple) return;
            const cls = `mat-mdc-slider-${kind}-ripple`;
            const existing = this.ripple.querySelector(`.${cls}`);
            if (on && !existing) {
                const r = el('div', `mat-ripple-element ${cls}`);
                Object.assign(r.style, {
                    left: '0px', top: '0px', width: '48px', height: '48px',
                    transitionDuration: kind === 'active' ? '225ms' : '0ms',
                    transform: 'scale3d(1, 1, 1)',
                });
                this.ripple.append(r);
            } else if (!on && existing) {
                existing.remove();
            }
        }

        onKey(e) {
            if (this.disabled) return;
            const { min, max, step, log } = this.o;
            const big = log ? null : (max - min) / 10;
            let v = this.value;
            switch (e.key) {
                case 'ArrowRight': case 'ArrowUp': v += step; break;
                case 'ArrowLeft': case 'ArrowDown': v -= step; break;
                case 'PageUp': v = big ? v + big : v * 1.25; break;
                case 'PageDown': v = big ? v - big : v / 1.25; break;
                case 'Home': v = min; break;
                case 'End': v = max; break;
                default: return;
            }
            e.preventDefault();
            this.change(v);
        }
    }

    // ─── 10. Catalog: toolbar ───────────────────────────────────
    // Row / Grid / Sample keep only their icons (see the styles); the names move
    // to tooltips.
    const Layout = {
        ensure() {
            for (const b of document.querySelectorAll('gf-layout-type button')) {
                if (!Tip.targets.has(b)) Tip.bind(b, () => b.getAttribute('aria-label'), 'below');
            }
        },
    };

    // The site's carousel of knowledge articles takes a lot of height, so it
    // starts folded; a button left of "About these results" opens it.
    const Guidance = {
        open: false,
        button: null,

        init() {
            this.open = !!Store.get('guidance', false);
            this.paint();
        },

        ensure() {
            this.paint();
            if (this.button?.isConnected) return;
            const template = document.querySelector('gf-grid-controls gf-info-tooltip button');
            if (!template || !document.querySelector('gf-guidance-cards')) return;
            const b = template.cloneNode(true);
            for (const a of ['aria-describedby', 'cdk-describedby-host', 'mattooltipclass']) b.removeAttribute(a);
            b.classList.remove('mat-mdc-tooltip-trigger', 'cdk-focused', 'cdk-mouse-focused');
            b.querySelector('.mat-mdc-button-ripple')?.remove();
            b.setAttribute('mat-ripple-loader-uninitialized', '');
            b.classList.add('gfb-guidance');
            b.setAttribute('aria-label', 'Knowledge articles');
            const chevron = el('span', 'gfb-ico', 'expand_more');
            chevron.setAttribute('aria-hidden', 'true');
            b.querySelector('.tooltip-button__wrapper').replaceChildren('Knowledge', chevron);
            b.addEventListener('click', e => { e.stopPropagation(); this.set(!this.open); });
            template.closest('gf-info-tooltip').before(b);
            this.button = b;
            this.paint();
        },

        set(open) {
            if (open === this.open) return;
            this.open = open;
            Store.set('guidance', open);
            this.paint();
            // the carousel measures itself; it could not while it was hidden
            if (open) window.dispatchEvent(new Event('resize'));
        },

        paint() {
            document.documentElement.classList.toggle('gfb-guidance-off', isCatalog() && !this.open);
            this.button?.setAttribute('aria-expanded', String(this.open));
        },
    };

    // ─── 11. Catalog: left drawer ───────────────────────────────
    const Drawer = {
        seen: new WeakSet(),

        ensure() {
            const drawer = document.querySelector('gf-fonts-drawer');
            if (!drawer) return;
            Weight.ensure(drawer);
            BothChip.ensure(drawer);
            Reset.ensure(drawer);
            this.order(drawer);
            this.collapse(drawer);
            Scripts.ensure(drawer);
            Kaomoji.ensure(drawer);
        },

        // Reorders the filter sections with CSS order only: the site's DOM is
        // left as it is. Filter sections live in two containers, so the inner
        // one is flattened with display: contents.
        order(drawer) {
            drawer.classList.add('gfb-drawer');
            let i = 0;
            let filters = false;
            for (const child of drawer.children) {
                if (child.classList.contains('gfb-wght-row') || child.classList.contains('gfb-check')) continue;
                const tag = child.tagName;
                let order;
                if (tag === 'GF-CATEGORY-FILTERS') {
                    filters = true;
                    for (const section of child.children) setOrder(section, SECTION_ORDER[panelTitle(section)] ?? 260);
                    continue;
                } else if (tag === 'MAT-ACCORDION') {
                    const title = panelTitle(child);
                    filters = true;
                    order = title === 'Language' ? 100 : SECTION_ORDER[title] ?? 260;
                } else if (tag === 'GF-DRAWER-SORT-BY') {
                    order = 500;
                } else {
                    order = filters ? 450 : (i += 2);
                }
                setOrder(child, order);
                if (tag === 'GF-DRAWER-FONT-SIZE-MODIFIER' && Weight.row) setOrder(Weight.row, order + 1);
            }
        },

        // Feeling, Appearance and Seasonal start collapsed (once per page view).
        collapse(drawer) {
            for (const panel of drawer.querySelectorAll('mat-expansion-panel')) {
                if (this.seen.has(panel)) continue;
                this.seen.add(panel);
                if (!COLLAPSED_SECTIONS.includes(panelTitle(panel))) continue;
                const header = panel.querySelector('mat-expansion-panel-header');
                if (header?.getAttribute('aria-expanded') === 'true') header.click();
            }
        },
    };

    // Weight under the text size control: a picker with the named weights and
    // the italic button on one line, a full-width slider under them, then
    // "Show Upright & Italic". Every card shows its family at that weight.
    const Weight = {
        row: null,
        slider: null,
        trigger: null,
        text: null,
        menu: null,

        ensure(drawer) {
            if (this.row?.isConnected) return this.sync();
            const size = drawer.querySelector('gf-drawer-font-size-modifier');
            const sliderTemplate = size?.querySelector('mat-slider');
            const selectTemplate = size?.querySelector('gf-select');
            if (!sliderTemplate || !selectTemplate) return;

            const row = el('div', 'gfb-wght-row');
            const top = el('div', 'gfb-wght-row__top');

            // The picker: a copy of the text size picker above it, with our own menu
            const select = selectTemplate.cloneNode(true);
            select.classList.add('gfb-wsel');
            select.classList.remove('mat-mdc-tooltip-trigger');
            select.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
            const trigger = select.querySelector('mat-select') || select;
            for (const a of ['aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-activedescendant']) trigger.removeAttribute(a);
            trigger.setAttribute('role', 'combobox');
            trigger.setAttribute('aria-label', 'Select a font weight');
            trigger.setAttribute('aria-expanded', 'false');
            trigger.tabIndex = 0;
            const text = el('span', 'mat-mdc-select-min-line');
            const valueText = el('span', 'mat-mdc-select-value-text');
            valueText.append(text);
            (select.querySelector('.mat-mdc-select-value') || trigger).replaceChildren(valueText);
            select.addEventListener('click', e => { e.stopPropagation(); this.toggleMenu(); });
            trigger.addEventListener('keydown', e => this.onKey(e));
            top.append(select);
            top.append(ItalicButton.build());

            const slider = new CloneSlider(sliderTemplate, {
                min: 100, max: 1000, step: 100, value: State.wght, label: 'Font weight',
                stops: () => WEIGHTS, format: v => String(v), // names do not fit the bubble
                onInput: v => State.setWeight(v),
            });
            slider.root.classList.add('gfb-wght-row__slider');
            row.append(top, slider.root);
            size.after(row);
            Object.assign(this, { row, slider, trigger, text });
            this.sync();
        },

        sync() {
            if (!this.slider) return;
            if (this.slider.value !== State.wght) this.slider.set(State.wght);
            else this.slider.render();
            const name = WEIGHT_NAMES[State.wght];
            if (this.text.textContent !== name) this.text.textContent = name;
            ItalicButton.sync();
            BothChip.sync();
        },

        onKey(e) {
            const step = { ArrowDown: 100, ArrowUp: -100 }[e.key];
            if (e.key === 'Enter' || e.key === ' ' || (step && e.altKey)) {
                e.preventDefault();
                this.toggleMenu();
            } else if (step) {
                e.preventDefault();
                State.setWeight(Math.min(1000, Math.max(100, State.wght + step)));
            } else if (e.key === 'Escape') {
                this.closeMenu();
            }
        },

        // The menu opens with Regular at the top (or the chosen weight, if
        // lighter); lighter weights are above it, a scroll away.
        toggleMenu() {
            if (this.menu) return this.closeMenu();
            const menu = el('div', 'gfb-menu');
            menu.setAttribute('role', 'listbox');
            menu.setAttribute('aria-label', 'Font weight');
            for (const w of WEIGHTS) {
                const option = el('div', 'gfb-menu__item gf-body-large', `${WEIGHT_NAMES[w]} ${w}`);
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', String(w === State.wght));
                option.dataset.w = w;
                option.addEventListener('click', e => {
                    e.stopPropagation();
                    State.setWeight(w);
                    this.closeMenu();
                    this.trigger.focus();
                });
                menu.append(option);
            }
            document.body.append(menu);
            const r = this.trigger.closest('.gfb-wsel').getBoundingClientRect();
            menu.style.left = `${Math.round(r.left)}px`;
            menu.style.top = `${Math.round(r.bottom + 4)}px`;
            menu.style.minWidth = `${Math.round(r.width)}px`;
            menu.scrollTop = menu.querySelector(`[data-w="${Math.min(400, State.wght)}"]`).offsetTop - 8;
            this.menu = menu;
            this.trigger.setAttribute('aria-expanded', 'true');
            this.outside = e => { if (!menu.contains(e.target) && !this.trigger.closest('.gfb-wsel').contains(e.target)) this.closeMenu(); };
            this.scroll = e => { if (e.target !== menu) this.closeMenu(); };
            this.esc = e => { if (e.key === 'Escape') { this.closeMenu(); this.trigger.focus(); } };
            document.addEventListener('pointerdown', this.outside, true);
            document.addEventListener('keydown', this.esc, true);
            window.addEventListener('scroll', this.scroll, true);
        },

        closeMenu() {
            if (!this.menu) return;
            this.menu.remove();
            this.menu = null;
            this.trigger?.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', this.outside, true);
            document.removeEventListener('keydown', this.esc, true);
            window.removeEventListener('scroll', this.scroll, true);
        },
    };

    // Next to the weight picker: italic on or off. Same size and shape as the
    // picker, filled like the site's selected filters when on.
    const ItalicButton = {
        node: null,

        build() {
            const b = el('button', 'gfb-italbtn');
            b.type = 'button';
            b.setAttribute('aria-label', 'Italic');
            const icon = el('span', 'gfb-ico', 'format_italic');
            icon.setAttribute('aria-hidden', 'true');
            b.append(icon);
            b.addEventListener('click', e => { e.stopPropagation(); State.toggleItalic(); });
            Tip.bind(b, () => 'Italic', 'below');
            this.node = b;
            return b;
        },

        sync() {
            this.node?.setAttribute('aria-pressed', String(State.mode !== 'R'));
        },
    };

    // "Show Upright & Italic" under the weight slider: a copy of the site's
    // filter chips, with their check mark.
    const BothChip = {
        chip: null,

        ensure(drawer) {
            if (this.chip?.isConnected) return;
            const sections = [...drawer.querySelectorAll('gf-category-filters-section')];
            const template = (sections.find(s => panelTitle(s) === 'Technology') || drawer).querySelector('mat-chip-option');
            if (!template || !Weight.row) return;
            const chip = template.cloneNode(true);
            chip.removeAttribute('id');
            chip.classList.remove('mat-mdc-chip-selected', 'mdc-evolution-chip--selected');
            const labelBox = chip.querySelector('.mdc-evolution-chip__text-label');
            const focus = [...labelBox.querySelectorAll(':scope > span')].map(n => n.cloneNode(true));
            const label = el('span', null, 'Show Upright & ');
            label.append(el('span', 'gfb-it', 'Italic'));
            labelBox.replaceChildren(label, ...focus);
            const button = chip.querySelector('button');
            button.tabIndex = 0;
            button.addEventListener('click', e => {
                e.stopPropagation();
                State.toggleBoth();
            });
            const set = el('div', 'mdc-evolution-chip-set mat-mdc-chip-set gfb-both');
            const chips = el('div', 'mdc-evolution-chip-set__chips');
            chips.setAttribute('role', 'presentation');
            chips.append(chip);
            set.append(chips);
            Weight.row.append(set);
            this.chip = chip;
            this.sync();
        },

        sync() {
            if (!this.chip) return;
            const on = State.mode === 'RI';
            this.chip.classList.toggle('mat-mdc-chip-selected', on);
            this.chip.classList.toggle('mdc-evolution-chip--selected', on);
            this.chip.querySelector('button').setAttribute('aria-selected', String(on));
            // Sample cards are pictures: nothing to show both styles in
            this.chip.closest('.gfb-both').classList.toggle('gfb-off', Tiles.layout === 'sample');
        },
    };

    // The site's "Reset all" clears our settings too. The site disables the
    // button when its own filters are at their defaults, and that state is
    // Angular's, so it stays as it is: a disabled button lets clicks through
    // to the host (pointer-events: none), and only its look changes.
    const Reset = {
        host: null,

        ensure(drawer) {
            const host = drawer.querySelector('gf-left-drawer-reset');
            if (!host) return;
            if (host !== this.host) {
                this.host = host;
                host.addEventListener('click', e => this.onClick(e), true);
            }
            this.sync();
        },

        sync() {
            this.host?.classList.toggle('gfb-dirty', State.changed());
        },

        onClick(e) {
            const button = this.host.querySelector('.reset-button__button');
            if (!button) return;
            const r = button.getBoundingClientRect();
            const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (inside || button.contains(e.target)) State.reset();
        },
    };

    // A switch at the very bottom of the drawer: kaomoji in the "No italic" and
    // "No Bold" labels (the ones the site shows when a search finds nothing),
    // on by default. Moving the pointer over the sample changes it.
    const Kaomoji = {
        on: true,
        root: null,
        box: null,

        init() {
            this.on = !!Store.get('kaomoji', true);
        },

        random(except) {
            const pool = KAOMOJI.filter(k => k !== except);
            return pool[Math.floor(Math.random() * pool.length)];
        },

        ensure(drawer) {
            if (this.root?.isConnected) return;
            const root = el('label', 'gfb-check gf-body-large');
            const box = el('input');
            box.type = 'checkbox';
            box.checked = this.on;
            box.addEventListener('change', () => this.set(box.checked));
            const face = el('span', 'gfb-check__face', this.random());
            let x = 0;
            let y = 0;
            face.addEventListener('pointermove', e => {
                if (Math.hypot(e.clientX - x, e.clientY - y) < 12) return;
                x = e.clientX;
                y = e.clientY;
                face.textContent = this.random(face.textContent);
            });
            root.append(box, el('span', null, 'Kaomoji'), face);
            setOrder(root, 430); // after Seasonal, before the site's sort control
            drawer.append(root);
            this.root = root;
            this.box = box;
        },

        set(on) {
            if (this.box) this.box.checked = on;
            if (on === this.on) return;
            this.on = on;
            Store.set('kaomoji', on);
            Reset.sync();
            Tiles.markAll();
        },
    };

    // Writing system list: "All writing systems" (always shown first by the
    // site), then the most used scripts, then the rest A–Z.
    // CSS order only; the list itself is the site's.
    const Scripts = {
        ensure(drawer) {
            const select = drawer.querySelector('gf-searchable-select[label="Writing system"]');
            if (!select || select.gfbWatched) return;
            select.gfbWatched = true;
            select.classList.add('gfb-scripts');
            new MutationObserver(() => this.order(select)).observe(select, { childList: true, subtree: true });
        },

        order(select) {
            const options = [...select.querySelectorAll('mat-list-option')];
            const tops = options.map(o => TOP_SCRIPTS.indexOf(o.textContent.trim()));
            const lastTop = Math.max(...tops);
            options.forEach((option, k) => {
                const all = option.textContent.trim() === 'All writing systems';
                setOrder(option, all ? -200 : tops[k] >= 0 ? tops[k] - 100 : 0);
                // a divider after the last top script
                option.classList.toggle('gfb-scripts__last', tops[k] >= 0 && tops[k] === lastTop);
                if (option.textContent.trim() === 'Cyrillic') this.markRated(option);
            });
        },

        // The three rating marks: fonts in this writing system get them
        markRated(option) {
            if (option.querySelector('.gfb-scale')) return;
            const scale = el('span', 'gfb-scale');
            for (const rating of Object.keys(RATINGS)) {
                const dot = el('span', `gfb-rating--${rating}`);
                dot.append(squircle());
                scale.append(dot);
            }
            Tip.bind(scale, () => 'Rated fonts', 'below');
            option.querySelector('.mdc-list-item__content')?.append(scale);
        },
    };

    // ─── 12. Catalog: ratings (Cyrillic) ────────────────────────
    const Ratings = {
        // A family rated both ways shows the authors' rating
        map: new Map([
            ...TYPE_TODAY.map(([name, rating, url]) => [normName(name), { rating, url, tip: `type.today review: ${RATINGS[rating].label}` }]),
            ...CURATED.map(([name, rating, tip, url]) => [normName(name), { rating, url, tip }]),
        ]),

        lookup(family) {
            const own = this.map.get(normName(TYPE_TODAY_ALIASES[family] || family));
            if (own) return own;
            // "Rubik Generative Fonts": all Rubik families except Rubik and Rubik Mono One
            if (/^Rubik /.test(family)) return this.map.get(normName('Rubik Generative Fonts'));
            return null;
        },

        active() { return Url.get('script') === 'Cyrl'; },

        // The badge sits right after the family name, inside the card's link,
        // so it is a span: with an article URL it opens that instead of the card.
        set(tile, family) {
            const title = tile.querySelector(':scope > .tile__header .tile__header--title');
            const old = title?.querySelector(':scope > .gfb-rating');
            const entry = family && this.active() ? this.lookup(family) : null;
            const key = entry ? `${family}|${entry.rating}` : '';
            if (old?.dataset.key === key) return;
            old?.remove();
            if (!entry || !title) return;
            const badge = el('span', `gfb-rating gfb-rating--${entry.rating}`);
            badge.dataset.key = key;
            badge.setAttribute('aria-label', entry.tip);
            if (entry.url) {
                badge.setAttribute('role', 'link');
                badge.tabIndex = 0;
                const go = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.open(entry.url, '_blank', 'noopener');
                };
                badge.addEventListener('click', go);
                badge.addEventListener('keydown', e => { if (e.key === 'Enter') go(e); });
            } else {
                badge.setAttribute('role', 'img');
            }
            badge.append(squircle());
            Tip.bind(badge, () => entry.tip, 'below');
            title.append(badge);
        },
    };

    // ─── 13. Catalog: Shift peek ────────────────────────────────
    // While Shift is held, the card under the pointer shows the opposite style.
    const Peek = {
        tile: null,
        hover: null,
        shift: false,

        init() {
            document.addEventListener('pointerover', e => {
                this.hover = e.target.closest?.('gf-tile') || null;
                this.shift = e.shiftKey && !isEditable(document.activeElement);
                this.update();
            }, true);
            document.addEventListener('keydown', e => {
                if (e.key !== 'Shift' || e.repeat || isEditable(e.target)) return;
                this.shift = true;
                this.update();
            }, true);
            document.addEventListener('keyup', e => {
                if (e.key !== 'Shift') return;
                this.shift = false;
                this.update();
            }, true);
            window.addEventListener('blur', () => { this.shift = false; this.update(); });
        },

        update() {
            const next = this.shift && isCatalog() && State.mode !== 'RI' ? this.hover : null;
            if (next === this.tile) return;
            const prev = this.tile;
            this.tile = next;
            if (prev) Tiles.mark(prev);
            if (next) Tiles.mark(next);
        },
    };

    // ─── 14. Catalog: cards ─────────────────────────────────────
    // The grid is virtual: ~15 cards live in the DOM and are reused as you
    // scroll. Card height must not change, so the italic is drawn in a layer
    // over the card's text box; the original text stays in place, transparent.
    // The layer is a child of the card, placed over the text box: the text box
    // (gf-feathering) clips and fades long text, which must not touch the layer.
    function copyText(orig, family, kind, weight) {
        const d = el('div', 'gfb-text', orig.textContent);
        d.style.cssText = orig.style.cssText;
        // font-size goes on the wrapping part (see Tiles.applyScale)
        for (const prop of ['opacity', 'transition-property', 'transition-duration', 'font-size']) d.style.removeProperty(prop);
        d.setAttribute('translate', 'no');
        d.style.fontFamily = `"${alias(kind, family)}", Tofu`;
        d.style.fontStyle = kind === 'i' ? 'italic' : 'normal';
        d.style.fontWeight = String(weight);
        d.style.fontSynthesis = 'none';
        return d;
    }

    // Set in the site's UI font, like the kaomoji on the site's empty search page.
    const missingLabel = (family, text) => el('div', 'gfb-none', Kaomoji.on ? `${text} ${kaomojiFor(family)}` : text);

    // What a card says about the style it cannot show, or null. The weight and
    // the italic go in one label: "No italic", "No Bold", "No Bold italic".
    function missingText(family, mode, status, w) {
        const name = WEIGHT_NAMES[w];
        const upright = mode !== 'I' && w !== 400 && Fonts.exists('r', family, w) === false;
        const italic = mode !== 'R' && (status === 'no' || (w !== 400 && status === 'yes' && Fonts.exists('i', family, w) === false));
        if (upright && italic && status === 'yes') return `No ${name}`;
        if (italic) return w === 400 ? 'No italic' : `No ${name} italic`;
        if (upright) return mode === 'RI' ? `No ${name} upright` : `No ${name}`;
        return null;
    }

    function part(node, kind) {
        const p = el('div', `gfb-part ${kind}`);
        p.append(node);
        return p;
    }
    const textPart = node => part(node, 'gfb-tp');                            // scaled text
    const labelPart = (family, text) => part(missingLabel(family, text), 'gfb-bottom'); // its own layer at the bottom

    const Badge = {
        set(tile, show) {
            const header = tile.querySelector(':scope > .tile__header');
            const badge = header?.querySelector('.gfb-badge');
            if (!show) { badge?.remove(); return; }
            if (!header || badge) return;
            const b = el('span', 'gfb-badge', 'format_italic');
            b.setAttribute('role', 'img');
            b.setAttribute('aria-label', 'Has italic');
            Tip.bind(b, () => 'Has italic', 'below');
            const subtitle = header.querySelector('.tile__header--subtitle');
            if (subtitle) subtitle.prepend(b); else header.append(b);
        },
    };

    const num = v => String(Math.round(v * 100) / 100);
    const Details = {
        bound: new WeakSet(),

        // Bound once per header element; the family is read on hover, because
        // the site reuses cards for other families as you scroll.
        bind(tile) {
            const sub = tile.querySelector(':scope > .tile__header .tile__header--subtitle');
            if (!sub || this.bound.has(sub)) return;
            this.bound.add(sub);
            sub.classList.add('gfb-details');
            Tip.bind(sub, () => this.text(familyOf(tile), sub.textContent), 'below');
            // raised above the card's link for the hover, so pass clicks on to it
            sub.addEventListener('click', () => tile.querySelector('a.gf-block-anchor')?.click());
        },

        async text(family, label) {
            if (!family) return '';
            const meta = await Meta.get(family);
            if (/variable/i.test(label) && meta.axes?.length) {
                const lines = meta.axes.map(a => `${AXIS_NAMES[a.tag] || a.tag} ${num(a.min)}–${num(a.max)}`);
                // the site counts the italic as an axis; metadata lists it as styles
                if (Object.keys(meta.fonts || {}).some(k => k.endsWith('i')) && !meta.axes.some(a => a.tag === 'ital')) lines.push('Italic');
                return lines.join('\n');
            }
            const keys = Object.keys(meta.fonts || {})
                .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.length - b.length);
            return keys.map(k => {
                const w = parseInt(k, 10);
                return `${WEIGHT_NAMES[w] || ''} ${w}${k.endsWith('i') ? ' Italic' : ''}`.trim();
            }).join('\n');
        },
    };

    const isOwn = n => n.nodeType === 1
        && (n.classList.contains('gfb-layer') || n.classList.contains('gfb-badge') || n.classList.contains('gfb-rating'));

    const Tiles = {
        container: null,
        observer: null,
        layout: '',
        dirty: new Set(),
        raf: 0,
        families: new WeakMap(),
        sizes: null,
        watched: new WeakSet(),
        metrics: null, // per-layout constants: text box bottom margin

        sync() {
            const host = document.querySelector('gf-font-tiles');
            const container = host?.querySelector('.tiles-container') || null;
            // Sample cards carry both layout--grid and layout--sample
            const cls = host?.className || '';
            const layout = /\blayout--sample\b/.test(cls) ? 'sample' : cls.match(/layout--(\w+)/)?.[1] || '';
            if (container !== this.container) {
                this.detach();
                this.container = container;
                if (container) {
                    this.observer = new MutationObserver(records => this.onMutations(records));
                    this.observer.observe(container, {
                        childList: true, subtree: true, characterData: true,
                        attributes: true, attributeFilter: ['style', 'href'],
                    });
                }
                this.markAll();
            }
            if (layout !== this.layout) {
                this.layout = layout;
                this.metrics = null;
                BothChip.sync();
                this.markAll();
            }
        },

        // ResizeObserver reports every element once when observed; only real
        // size changes after that should rebuild a layer.
        watch(tile, orig) {
            if (!this.sizes) {
                const last = new WeakMap();
                this.sizes = new ResizeObserver(entries => this.resized(entries.filter(e => {
                    const size = `${Math.round(e.contentRect.width)}x${Math.round(e.contentRect.height)}`;
                    const changed = last.has(e.target) && last.get(e.target) !== size;
                    last.set(e.target, size);
                    return changed;
                })));
            }
            for (const node of [tile, orig]) {
                if (this.watched.has(node)) continue;
                this.watched.add(node);
                this.sizes.observe(node);
            }
        },

        metricsFor(feather) {
            if (!this.metrics) this.metrics = { marginBottom: parseFloat(getComputedStyle(feather).marginBottom) || 0 };
            return this.metrics;
        },

        detach() {
            this.observer?.disconnect();
            this.observer = null;
            this.container = null;
        },

        onMutations(records) {
            for (const r of records) {
                const node = r.target.nodeType === 1 ? r.target : r.target.parentElement;
                if (!node || node.closest('.gfb-layer, .gfb-badge, .gfb-rating')) continue;
                if (r.type === 'childList') {
                    const changed = [...r.addedNodes, ...r.removedNodes];
                    if (changed.length && changed.every(isOwn)) continue;
                    if (node === this.container) { // cards added to the grid
                        r.addedNodes.forEach(n => { if (n.nodeName === 'GF-TILE') this.mark(n); });
                        continue;
                    }
                }
                const tile = node.closest('gf-tile');
                if (tile) this.mark(tile);
            }
        },

        // Card or text box resized (window width, the site's font finishing
        // loading, a taller neighbour in the grid row): rebuild that card's layer.
        resized(entries) {
            for (const { target } of entries) {
                const tile = target.closest('gf-tile');
                const layer = tile?.querySelector(':scope > .gfb-layer');
                if (layer) layer.gfbQuick = null;
                if (tile) this.dirty.add(tile);
            }
            this.schedule();
        },

        mark(tile) {
            this.dirty.add(tile);
            this.schedule();
        },

        markAll() {
            this.container?.querySelectorAll('gf-tile').forEach(t => this.dirty.add(t));
            this.schedule();
        },

        markFamily(family) {
            this.container?.querySelectorAll('gf-tile').forEach(t => {
                if (this.families.get(t) === family) this.dirty.add(t);
            });
            this.schedule();
        },

        schedule() {
            if (this.raf) return;
            this.raf = requestAnimationFrame(() => {
                this.raf = 0;
                this.flush();
            });
        },

        // Reads for all dirty cards first, then writes, then the size fitting,
        // all in the same frame: nothing is painted at the wrong size.
        flush() {
            if (!isCatalog()) { this.dirty.clear(); return; }
            const jobs = [...this.dirty].filter(t => t.isConnected).map(t => this.read(t));
            this.dirty.clear();
            for (const job of jobs) this.write(job);
            for (const job of jobs) if (job.layer) this.fitScale(job.layer);
        },

        // New letters typed into the preview arrive as new font subsets; once
        // they load, text metrics change, so fit the layers again (no rebuild).
        refit() {
            if (this.refitRaf || !this.container) return;
            this.refitRaf = requestAnimationFrame(() => {
                this.refitRaf = 0;
                this.container?.querySelectorAll('.gfb-layer').forEach(l => this.fitScale(l));
            });
        },

        applyScale(layer, s) {
            const px = layer.gfbBase * s;
            const texts = layer.querySelectorAll(':scope > .gfb-tp');
            for (const p of texts) p.style.fontSize = `${px.toFixed(2)}px`;
            const gap = texts.length > 1 && !layer.classList.contains('gfb-row');
            layer.style.rowGap = gap ? `${(px * STYLE_GAP).toFixed(1)}px` : '0px';
        },

        // All the text has to fit the card's text box (above the "No italic"
        // label, if any), so all styles are scaled down by the same factor
        // until it does (never scaled up).
        fitScale(layer) {
            const texts = layer.querySelectorAll(':scope > .gfb-tp');
            if (!texts.length) return;
            const label = layer.querySelector(':scope > .gfb-bottom:not(.gfb-side)');
            const limit = layer.clientHeight + 1 - (label ? label.offsetHeight + 4 : 0);
            const last = texts[texts.length - 1];
            const used = () => last.offsetTop + last.offsetHeight;
            const fits = s => { this.applyScale(layer, s); return used() <= limit; };
            if (fits(1)) return;
            // Wrapped text grows roughly with the square of the size, a single line linearly.
            const est = layer.classList.contains('gfb-row') ? limit / used() : Math.sqrt(Math.max(limit, 1) / used());
            let lo = est * 0.85;
            let hi = Math.min(1, est * 1.2);
            if (!fits(lo)) { hi = lo; lo = 0.05; }
            for (let i = 0; i < 5; i++) {
                const mid = (lo + hi) / 2;
                if (fits(mid)) lo = mid; else hi = mid;
            }
            this.applyScale(layer, lo);
        },

        read(tile) {
            const family = familyOf(tile);
            const feather = tile.querySelector(':scope > gf-feathering');
            const orig = feather?.querySelector(':scope > .tile__text');
            const old = tile.querySelector(':scope > .gfb-layer');
            const job = { tile, old, family, build: false, badge: false, dim: false };
            if (!family) return job;

            this.families.set(tile, family);
            const status = Fonts.status(family);
            const w = State.wght;
            let mode = State.mode;
            if (Peek.tile === tile) mode = mode === 'R' ? 'I' : 'R';
            job.badge = status === 'yes'; // in every mode and layout, Sample included
            job.label = missingText(family, mode, status, w);
            job.dim = !!job.label;
            if (!orig) return job;
            if (mode === 'R' && w === 400) return job;   // the site's own preview
            job.needsLayer = true;
            if (mode !== 'R' && status === 'pending') return job;

            // While our fonts load, keep the current layer of this family on
            // screen instead of flashing the bare card.
            const same = old?.gfbFamily === family;
            const hold = () => { job.hold = same; return job; };
            // The site renders new text with its placeholder font (Tofu) until its
            // own subset loads. A new card waits for that (its size is not final
            // yet); a card we already show keeps its size and updates at once.
            const siteLoading = /^\s*Tofu\b/.test(orig.style.fontFamily);
            if (siteLoading && !same) return job;

            const needs = [];
            if (mode !== 'I') needs.push('r');
            if (mode !== 'R' && status === 'yes') needs.push('i');
            const missing = needs.filter(kind => !Fonts.isReady(kind, family, w));
            if (missing.length) {
                for (const kind of missing) Fonts.load(kind, family, w, orig.textContent);
                return hold();
            }

            Object.assign(job, { build: true, feather, orig, status, mode, w, layout: this.layout || 'grid' });
            this.watch(tile, orig);

            // Nothing changed since the layer was built: skip all measuring.
            // The site animates opacity and swaps font aliases; neither matters to our copies.
            const style = orig.style.cssText.replace(/(^|;)\s*(opacity|transition[\w-]*|transform|font-family)\s*:[^;]*/g, '$1');
            job.quick = [mode, job.layout, family, status, w, job.label, Kaomoji.on, style, orig.textContent].join('\u0001');
            if (old && old.gfbQuick === job.quick) { job.keep = true; return job; }

            job.base = parseFloat(orig.style.fontSize) || parseFloat(getComputedStyle(orig).fontSize) || 40;
            const { marginBottom } = this.metricsFor(feather);
            let height = orig.offsetHeight;
            if (siteLoading) height = old.gfbHeight; // placeholder metrics are not the real size
            else if (this.layout === 'grid') {
                // Grid cards have a fixed minimum height; use the free space below the text too.
                height = Math.max(height, tile.clientHeight - feather.offsetTop - marginBottom);
            }
            job.height = Math.round(height);
            job.box = { top: feather.offsetTop, left: feather.offsetLeft, width: feather.offsetWidth };
            return job;
        },

        write(job) {
            const { tile, old } = job;
            Badge.set(tile, job.badge);
            Ratings.set(tile, job.family);
            Details.bind(tile);
            if (tile.hasAttribute('data-gfb-dim') !== job.dim) tile.toggleAttribute('data-gfb-dim', job.dim);
            // A card that will get a layer shows nothing until then, rather than
            // the site's own text flashing in first (fast scrolling reuses cards).
            const pending = !!job.needsLayer && !job.build && !job.hold;
            if (tile.hasAttribute('data-gfb-pending') !== pending) tile.toggleAttribute('data-gfb-pending', pending);
            if (job.hold) return;
            if (!job.build) { old?.remove(); return; }
            if (job.keep) return;

            const { family, orig, status, mode, layout, w } = job;
            const layer = el('div', `gfb-layer gfb-${layout}`);
            layer.setAttribute('aria-hidden', 'true');
            layer.style.top = `${job.box.top}px`;
            layer.style.left = `${job.box.left}px`;
            layer.style.width = `${job.box.width}px`;
            layer.style.height = `${job.height}px`;

            // Upright, italic or both, each at the chosen weight or the closest
            // one the family has; a label says what is missing.
            if (mode !== 'I') layer.append(textPart(copyText(orig, family, 'r', Fonts.shown('r', family, w))));
            if (mode !== 'R' && status === 'yes') layer.append(textPart(copyText(orig, family, 'i', Fonts.shown('i', family, w))));
            if (job.label) {
                const label = labelPart(family, job.label);
                // Rows have no height to spare: next to the text, not under it
                if (layout === 'row' && layer.firstChild) label.classList.add('gfb-side');
                layer.append(label);
            }
            if (layout === 'row' && layer.querySelectorAll(':scope > .gfb-tp').length > 1) layer.classList.add('gfb-tight');

            layer.gfbQuick = job.quick;
            layer.gfbBase = job.base;
            layer.gfbFamily = family;
            layer.gfbHeight = job.height;
            this.applyScale(layer, 1);
            if (old) old.replaceWith(layer); else tile.append(layer);
            job.layer = layer;
        },
    };

    // ─── 15. Font pages ─────────────────────────────────────────
    const Spec = {
        family: null,
        info: null,      // FontFile data, once loaded
        initial: null,   // our parameters from the address the page was opened with

        ensure() {
            const family = specimenFamily();
            if (family !== this.family) {
                Opsz.reset();
                OT.reset();
                this.family = family;
                this.info = null;
                this.retryAt = 0;
            }
            // Load the font data; after a failure, try again a few seconds later
            if (!this.info && !this.loading && Date.now() >= this.retryAt) {
                this.loading = true;
                FontFile.get(family).then(info => {
                    this.loading = false;
                    if (this.family !== family) return;
                    if (info) { this.info = info; this.ensure(); } else this.retryAt = Date.now() + 3000;
                });
            }
            Opsz.ensure();
            AxisTicks.ensure();
            OT.ensure();
            this.markLang();
            this.stickyTop();
        },

        // The preview sticks just below the site's header bar, whose height
        // changes with the page width; read it rather than guess.
        stickyTop() {
            // The tab bar itself is static; a sticky or fixed ancestor carries it.
            let bottom = 0;
            for (const bar of document.querySelectorAll('.gf-header__secondary-nav, gf-header')) {
                for (let n = bar; n && n !== document.body; n = n.parentElement) {
                    const pos = getComputedStyle(n).position;
                    if (pos === 'sticky' || pos === 'fixed') {
                        bottom = Math.max(bottom, bar.getBoundingClientRect().bottom);
                        break;
                    }
                }
            }
            const top = `${Math.round(Math.max(0, bottom)) + 16}px`;
            if (this.top !== top) {
                this.top = top;
                document.documentElement.style.setProperty('--gfb-sticky-top', top);
            }
        },

        // The preview language picked on the page (kept by the site in the
        // address as preview.lang=ru_Cyrl) goes into lang="" on the hero and
        // the previews, so the browser shapes the text for that language.
        // With only a writing system picked: Russian for Cyrillic, Greek for
        // Greek, English for Latin (and by default).
        markLang() {
            const code = Url.get('preview.lang');
            const script = Url.get('preview.script');
            const lang = code ? code.replace('_', '-') : ({ Cyrl: 'ru', Grek: 'el', Latn: 'en' }[script] || (script ? '' : 'en'));
            for (const node of document.querySelectorAll('gf-specimen-hero, .preview-wrapper')) {
                if (lang) {
                    if (node.getAttribute('lang') !== lang) node.setAttribute('lang', lang);
                    node.gfbLang = true;
                } else if (node.gfbLang) {
                    node.removeAttribute('lang');
                    node.gfbLang = false;
                }
            }
        },

        previews() {
            const playground = document.querySelector('gf-mini-playground') || document;
            return playground.querySelectorAll('.preview__content [contenteditable]');
        },

        // One watcher for the site rewriting preview styles, new text areas
        // and the opsz toggle; our own controls are ignored.
        watch() {
            const playground = document.querySelector('gf-mini-playground');
            if (!playground || playground === this.watched) return;
            this.watched = playground;
            this.observer?.disconnect();
            this.observer = new MutationObserver(records => {
                if (records.every(r => r.target.closest?.('.gfb-slider, .gfb-ot, .gfb-ticks'))) return;
                if (this.raf) return;
                this.raf = requestAnimationFrame(() => {
                    this.raf = 0;
                    Opsz.sync();
                    AxisTicks.render();
                    OT.apply();
                });
            });
            this.observer.observe(playground, {
                subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'aria-checked', 'aria-valuetext'],
            });
        },

        // Called once the page's own controls are in place
        takeInitial(key) {
            if (!this.initial || this.initial.family !== this.family) return null;
            const v = this.initial[key];
            this.initial[key] = null;
            return v;
        },
    };

    // Stops on the site's axis sliders (named instances), with soft snapping
    const AxisTicks = {
        items: [],

        ensure() {
            const info = Spec.info;
            if (!info?.axes.length) return;
            for (const container of document.querySelectorAll('.axis-container')) {
                const slider = container.querySelector('gf-axis-slider:not(.gfb-slider) mat-slider');
                if (!slider || slider.gfbTicks) continue;
                const input = slider.querySelector('input[type="range"]');
                const name = input?.getAttribute('aria-label')?.match(/Change (.+) axis/)?.[1];
                const tag = name && info.axisTag(name);
                const stops = tag ? info.stops(tag) : [];
                if (!stops.length) continue;
                slider.gfbTicks = true;
                const track = slider.querySelector('.mdc-slider__track');
                const box = el('div', 'mdc-slider__tick-marks gfb-ticks');
                box.setAttribute('aria-hidden', 'true');
                track.append(box);
                const min = () => parseFloat(input.min);
                const max = () => parseFloat(input.max);
                const toPos = v => (v - min()) / (max() - min() || 1);
                const item = { box, track, input, stops, toPos };
                this.items.push(item);
                softSnap(input, {
                    stops: () => stops, toPos, get: () => parseFloat(input.value), width: () => track.offsetWidth,
                    set: v => {
                        input.value = String(v);
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    },
                });
                input.addEventListener('input', () => this.render());
                new ResizeObserver(() => this.render()).observe(track);
            }
            Spec.watch();
            this.render();
        },

        render() {
            this.items = this.items.filter(i => i.box.isConnected);
            for (const { box, track, input, stops, toPos } of this.items) {
                renderTicks(box, track, stops, toPos, parseFloat(input.value));
            }
        },
    };

    // Optical size slider. For the opsz axis the site only has an on/off
    // toggle ("auto": opsz follows the text size). We add a slider like the
    // Weight one; the range comes from the site's per-family metadata.
    const Opsz = {
        family: null,
        axis: null,
        slider: null,
        container: null,
        toggle: null,
        auto: true,
        value: null,

        ensure() {
            const family = Spec.family;
            if (family !== this.family) {
                this.reset();
                this.family = family;
                Axes.get(family).then(axes => {
                    if (this.family !== family) return;
                    this.axis = axes.find(a => a.tag === 'opsz') || null;
                    this.ensure();
                }, () => {
                    // try again on a later tick
                    setTimeout(() => { if (this.family === family) this.family = null; }, 3000);
                });
                return;
            }
            if (!this.axis) return;
            const container = [...document.querySelectorAll('.axis-container')].find(c =>
                c.querySelector('.axis__title')?.textContent.trim() === 'Optical Size'
                || /Optical Size/.test(c.querySelector('gf-axis-toggle button')?.getAttribute('aria-label') || ''));
            if (!container) return;
            if (this.slider?.root.isConnected && this.container === container) {
                this.slider.render(); // the font file (stops) may have arrived
                return;
            }
            const template = document.querySelector('.axis-container gf-axis-slider:not(.gfb-slider)');
            if (template) this.build(container, template);
        },

        reset() {
            this.slider?.root.remove();
            Object.assign(this, { family: null, axis: null, slider: null, container: null, value: null, auto: true });
        },

        build(container, template) {
            this.slider?.root.remove();
            const { min, max } = this.axis;
            this.slider = new CloneSlider(template, {
                min, max, log: min > 0 && max / min >= 8, step: max - min > 10 ? 1 : 0.1,
                value: this.autoValue(), label: 'Change Optical Size axis', snap: true,
                stops: () => Spec.info?.stops('opsz') || [],
                onInput: v => { this.value = v; this.apply(); Url.write(); },
            });
            this.slider.root.classList.add('gfb-opsz');
            this.container = container;
            this.toggle = container.querySelector('gf-axis-toggle button[role="switch"]');
            (container.querySelector('.axis__header') || container.lastElementChild).after(this.slider.root);
            Spec.watch();

            // Opened from a link with a manual value: switch the toggle off and use it.
            const fromLink = parseFloat(Spec.takeInitial('opsz'));
            if (!Number.isNaN(fromLink)) {
                this.value = this.slider.round(fromLink);
                if (this.toggle?.getAttribute('aria-checked') !== 'false') this.toggle?.click();
            }
            this.sync();
        },

        sync() {
            if (!this.slider?.root.isConnected) return;
            const auto = this.toggle?.getAttribute('aria-checked') !== 'false';
            if (auto !== this.auto) {
                this.auto = auto;
                // Switching to manual starts from what auto showed: no visible jump.
                if (!auto && this.value == null) this.value = this.slider.round(this.autoValue());
                Url.write();
            }
            this.slider.setDisabled(auto);
            this.slider.set(auto ? this.autoValue() : this.value);
            this.apply();
        },

        // In auto mode the browser uses the text size in px as opsz.
        autoValue() {
            const box = Spec.previews()[0]?.closest('gf-content-editable');
            const size = parseFloat(box?.style.fontSize) || this.axis.defaultValue;
            return Math.min(this.axis.max, Math.max(this.axis.min, size));
        },

        apply() {
            if (!this.slider) return;
            const v = this.auto ? null : this.value;
            for (const node of Spec.previews()) {
                const current = node.style.fontVariationSettings;
                const next = withAxis(current, 'opsz', v);
                if (next !== (current === 'normal' ? '' : current)) node.style.fontVariationSettings = next;
            }
        },
    };

    // OpenType features (and language) for the previews, grouped, only those
    // the font has. Placed under Variable axes.
    const OT = {
        root: null,
        state: new Map(),  // tag → 1 | 0, only where it differs from the default
        lang: '',
        chips: [],

        reset() {
            this.root?.remove();
            this.root = null;
            this.resetButton = null;
            this.state.clear();
            this.lang = '';
            this.chips = [];
        },

        ensure() {
            const info = Spec.info;
            const explorer = document.querySelector('gf-design-space-explorer');
            if (!info || !explorer) return;
            if (this.root?.isConnected) return;
            const groups = this.groups(info);
            const languages = [...info.languages].filter(t => t !== 'dflt').sort();
            if (!groups.length && !languages.length) return;
            this.fromLink(info);
            this.build(explorer, groups, languages, info);
            Spec.watch();
            this.apply();
            Url.write();
        },

        groups(info) {
            const out = [];
            for (const [name, list] of FEATURE_GROUPS) {
                const items = [];
                if (name === 'Alternates') {
                    const sets = [...info.features.keys()].filter(t => /^(ss|cv)\d\d$/.test(t)).sort();
                    for (const tag of sets) {
                        const n = parseInt(tag.slice(2), 10);
                        items.push({ tag, label: tag, title: `${tag.startsWith('ss') ? 'Stylistic set' : 'Character variant'} ${n}` });
                    }
                }
                items.push(...list.filter(([tag]) => info.features.has(tag)).map(([tag, label]) => ({ tag, label })));
                if (items.length) out.push([name, items]);
            }
            return out;
        },

        fromLink(info) {
            const fea = Spec.takeInitial('fea');
            if (fea) {
                for (const item of fea.split(',')) {
                    const off = item.startsWith('-');
                    const tag = item.replace(/^-/, '');
                    if (info.features.has(tag)) this.set(tag, off ? 0 : 1, false);
                }
            }
            const lang = Spec.takeInitial('lang');
            if (lang && info.languages.has(lang)) this.lang = lang;
        },

        build(explorer, groups, languages, info) {
            const root = el('div', 'gfb-ot');
            // Header: a copy of the site's "Variable axes" header, with its reset button
            const head = explorer.querySelector('.axis__reset-wrapper')?.cloneNode(true) || el('div', 'gfb-ot__head');
            head.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
            const title = head.querySelector('.axis__reset-title');
            if (title) title.textContent = 'OpenType features'; else head.append(el('div', 'gf-title-medium', 'OpenType features'));
            const reset = this.resetButton = head.querySelector('button');
            if (reset) {
                reset.removeAttribute('aria-describedby');
                reset.setAttribute('mat-ripple-loader-uninitialized', '');
                reset.classList.remove('mat-mdc-tooltip-trigger', 'cdk-focused', 'cdk-mouse-focused');
                reset.setAttribute('aria-label', 'Reset OpenType features');
                reset.addEventListener('click', e => {
                    e.stopPropagation();
                    this.state.clear();
                    this.lang = '';
                    if (this.select) this.select.value = '';
                    this.refresh();
                });
            }
            root.append(head);

            this.chips = [];
            for (const [name, items] of groups) {
                const group = el('div', 'gfb-ot__group');
                group.append(el('div', 'gfb-ot__label gf-label-large', name));
                const box = el('div', 'gfb-ot__chips');
                for (const item of items) {
                    const chip = el('button', 'gfb-chip gf-label-large', item.label);
                    chip.type = 'button';
                    chip.dataset.tag = item.tag;
                    const fontName = info.featureName(item.tag);
                    const tip = `${item.title || item.label}${fontName ? ` — ${fontName}` : ''} (${item.tag})`;
                    chip.setAttribute('aria-label', tip);
                    Tip.bind(chip, () => tip, 'below');
                    chip.addEventListener('click', () => this.toggle(item.tag));
                    box.append(chip);
                    this.chips.push(chip);
                }
                group.append(box);
                root.append(group);
            }

            if (languages.length) {
                const group = el('div', 'gfb-ot__group');
                group.append(el('div', 'gfb-ot__label gf-label-large', 'Language'));
                const select = el('select', 'gfb-select gf-body-large');
                select.setAttribute('aria-label', 'OpenType language');
                select.append(new Option('Default (preview language)', ''));
                for (const tag of languages) select.append(new Option(LANGS[tag]?.[1] || tag, tag));
                select.value = this.lang;
                select.addEventListener('change', () => { this.lang = select.value; this.refresh(); });
                group.append(select);
                root.append(group);
                this.select = select;
            }

            explorer.append(root);
            this.root = root;
            this.paint();
        },

        value(tag) {
            return this.state.has(tag) ? this.state.get(tag) : (FEATURES_ON_BY_DEFAULT.has(tag) ? 1 : 0);
        },

        set(tag, v, refresh = true) {
            const def = FEATURES_ON_BY_DEFAULT.has(tag) ? 1 : 0;
            if (v === def) this.state.delete(tag); else this.state.set(tag, v);
            if (refresh) this.refresh();
        },

        toggle(tag) {
            const on = !this.value(tag);
            if (on) {
                for (const group of FEATURES_EXCLUSIVE) {
                    if (group.includes(tag)) for (const other of group) if (other !== tag) this.set(other, 0, false);
                }
            }
            this.set(tag, on ? 1 : 0);
        },

        refresh() {
            this.paint();
            this.apply();
            Url.write();
        },

        paint() {
            for (const chip of this.chips) chip.setAttribute('aria-pressed', String(!!this.value(chip.dataset.tag)));
            // Reset is active only when something differs from the defaults (like the site's)
            if (this.resetButton) {
                const off = !this.state.size && !this.lang;
                this.resetButton.disabled = off;
                this.resetButton.classList.toggle('mat-mdc-button-disabled', off);
            }
        },

        tokens() {
            return [...this.state].map(([tag, v]) => (v ? tag : `-${tag}`));
        },

        apply() {
            if (!this.root) return;
            const css = [...this.state].map(([tag, v]) => `"${tag}" ${v}`).join(', ');
            const lang = LANGS[this.lang]?.[0] || '';
            // Features and languages need the original font files (see FullFont)
            const full = !!(css || this.lang);
            const fullName = `"${FullFont.name(Spec.family)}"`;
            if (full) FullFont.ensure(Spec.family, Spec.info);
            // The browser re-serializes these values ("smcp" 1 → "smcp"), so what
            // we wrote is remembered on the node instead of compared as text.
            for (const node of Spec.previews()) {
                const family = node.style.fontFamily;
                const ours = family.startsWith(fullName);
                if (full && !ours) node.style.fontFamily = `${fullName}, ${family}`;
                else if (!full && ours) node.style.fontFamily = family.slice(fullName.length).replace(/^\s*,\s*/, '');
                const has = !!node.style.fontFeatureSettings;
                if (css && (node.gfbFea !== css || !has)) node.style.fontFeatureSettings = css;
                else if (!css && has && node.gfbFea) node.style.removeProperty('font-feature-settings');
                node.gfbFea = css;
                // lang drives the shaper's language system; font-language-override
                // covers tags without a language code (Firefox)
                if (this.lang) {
                    if (lang && node.getAttribute('lang') !== lang) node.setAttribute('lang', lang);
                    if (node.gfbLang !== this.lang || !node.style.getPropertyValue('font-language-override')) {
                        node.style.setProperty('font-language-override', `"${this.lang.padEnd(4, ' ')}"`);
                    }
                    node.gfbLang = this.lang;
                } else if (node.gfbLang) {
                    node.removeAttribute('lang');
                    node.style.removeProperty('font-language-override');
                    node.gfbLang = '';
                }
            }
        },
    };

    // ─── 16. Hotkeys ────────────────────────────────────────────
    function initHotkeys() {
        document.addEventListener('keydown', e => {
            // e.code: works in any keyboard layout
            if (!isCatalog() || (e.code !== 'KeyI' && e.code !== 'KeyW')) return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isEditable(e.target)) return;
            e.preventDefault();
            const step = e.shiftKey ? -1 : 1;
            if (e.code === 'KeyW') State.setWeight(Math.min(1000, Math.max(100, State.wght + step * 100)));
            else if (e.shiftKey) State.toggleBoth();
            else State.toggleItalic();
        });
    }

    // ─── 17. Styles ─────────────────────────────────────────────
    function injectStyles() {
        const link = el('link');
        link.rel = 'stylesheet';
        link.href = `${API}Material+Symbols:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=expand_more,format_italic&display=block`;
        document.head.append(link);

        const style = el('style');
        style.id = 'gf-boost-style';
        style.textContent = `
        /* Toolbar: Row / Grid / Sample as icons only */
        gf-layout-type .layout__label { display: none; }

        .gfb-it { font-style: italic; }
        .gfb-ico, .gfb-badge {
            font-family: 'Material Symbols', sans-serif;
            font-weight: normal;
            font-style: normal;
            line-height: 1;
            letter-spacing: normal;
            text-transform: none;
            white-space: nowrap;
            direction: ltr;
            font-feature-settings: 'liga';
            -webkit-font-smoothing: antialiased;
        }
        .gfb-ico {
            display: inline-block;
            vertical-align: middle;
            width: 20px;
            height: 20px;
            font-size: 20px;
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 20;
        }

        /* Knowledge articles: folded until the button opens them */
        html.gfb-guidance-off gf-guidance-cards { display: none; }
        gf-grid-controls { display: flex; align-items: center; gap: 4px; }
        .gfb-guidance .gfb-ico { margin-left: 4px; transition: transform .2s; }
        .gfb-guidance[aria-expanded="true"] .gfb-ico { transform: rotate(180deg); }

        /* Filter chip of the preview text: a short name, whatever its length.
           The site's text stays in the element (and in aria-label), only hidden. */
        mat-chip[aria-label^="Preview:"] .remove__wrapper { font-size: 0; letter-spacing: 0; }
        mat-chip[aria-label^="Preview:"] .remove__wrapper::before {
            content: 'Preview text';
            font-size: var(--mat-chip-label-text-size, 14px);
            letter-spacing: var(--mat-chip-label-text-tracking, normal);
        }

        /* "Reset all" with only our settings changed. The site keeps the button
           disabled; clicks pass through it to the host, see Reset. */
        gf-left-drawer-reset.gfb-dirty button[disabled] { pointer-events: none; }
        gf-left-drawer-reset.gfb-dirty button[disabled],
        gf-left-drawer-reset.gfb-dirty button[disabled] * { color: var(--sys-primary) !important; }

        /* Drawer: filter sections reordered with CSS order only */
        gf-fonts-drawer.gfb-drawer { display: flex; flex-direction: column; }
        gf-fonts-drawer.gfb-drawer > gf-category-filters { display: contents; }

        /* Weight: [picker] [I] on one line, the slider under them, then the
           "Show Upright & Italic" chip. Lined up with the site's text size row
           above: the picker starts where "40px" starts (8px in), the row ends
           where the size slider's track ends. */
        .gfb-wght-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 8px 16px 8px 8px;
        }
        .gfb-wght-row__top { display: flex; align-items: center; gap: 8px; }
        .gfb-wsel { flex: 1; min-width: 0; cursor: pointer; }
        .gfb-wsel .mat-mdc-form-field { width: 100%; }
        .gfb-italbtn {
            flex: none;
            display: grid;
            place-items: center;
            align-self: flex-start;
            width: 48px;
            height: 48px;
            padding: 0;
            border: 0;
            border-radius: 8px;
            background: var(--sys-surface-container-high);
            color: var(--sys-on-surface-variant);
            cursor: pointer;
            transition: background-color .15s, color .15s;
        }
        .gfb-italbtn .gfb-ico { width: 24px; height: 24px; font-size: 24px; }
        .gfb-italbtn:hover { background: color-mix(in srgb, var(--sys-on-surface) 8%, var(--sys-surface-container-high)); }
        .gfb-italbtn:focus-visible { outline: 2.5px solid var(--sys-primary); outline-offset: 1px; }
        .gfb-italbtn[aria-pressed="true"] {
            background: var(--sys-secondary-container);
            color: var(--sys-on-secondary-container);
        }
        .gfb-italbtn[aria-pressed="true"]:hover {
            background: color-mix(in srgb, var(--sys-on-secondary-container) 8%, var(--sys-secondary-container));
        }
        .gfb-wght-row .gfb-wght-row__slider { width: calc(100% - 16px); max-width: calc(100% - 16px); margin: 0 8px; }
        .gfb-both { margin: 4px 0 0; }
        .gfb-both .mdc-evolution-chip-set__chips, .gfb-both .mat-mdc-chip { margin: 0; }
        .gfb-both.gfb-off { opacity: .38; } /* Sample layout: nothing to show it on */
        .gfb-menu {
            position: fixed;
            z-index: 10000;
            box-sizing: border-box;
            max-height: 256px;
            overflow-y: auto;
            padding: 8px 0;
            border-radius: 4px;
            background: var(--sys-surface-container, var(--sys-surface));
            box-shadow: 0 2px 6px 2px rgba(0, 0, 0, .15), 0 1px 2px rgba(0, 0, 0, .3);
        }
        .gfb-menu__item {
            display: flex;
            align-items: center;
            height: 48px;
            padding: 0 16px;
            color: var(--sys-on-surface);
            white-space: nowrap;
            cursor: pointer;
        }
        .gfb-menu__item:hover { background: color-mix(in srgb, var(--sys-on-surface) 8%, transparent); }
        .gfb-menu__item[aria-selected="true"] {
            background: var(--sys-secondary-container);
            color: var(--sys-on-secondary-container);
        }

        /* Kaomoji switch at the bottom of the drawer */
        .gfb-check {
            display: flex;
            align-items: center;
            gap: 12px;
            margin: 16px 0;
            color: var(--sys-on-surface);
            cursor: pointer;
        }
        .gfb-check input { width: 18px; height: 18px; margin: 0; accent-color: var(--sys-primary); cursor: pointer; }
        .gfb-check__face { color: var(--sys-on-surface-variant); }

        /* "N styles" / "Variable (N axes)": above the card's link, for the tooltip;
           the padding makes the hover zone taller without moving anything */
        .gfb-details { position: relative; z-index: 2; cursor: pointer; padding: 8px 0; }

        /* Font page: the preview stays in view while you scroll through the
           controls on the left, until the end of the playground */
        .playground__container > .preview-wrapper {
            position: sticky;
            top: var(--gfb-sticky-top, 16px);
            align-self: flex-start;
        }

        /* Writing system list: top scripts, then "All writing systems";
           the rating marks at the right of Cyrillic */
        gf-searchable-select.gfb-scripts mat-selection-list { display: flex; flex-direction: column; }
        gf-searchable-select.gfb-scripts .gfb-scripts__last { border-bottom: 1px solid var(--sys-outline-variant); }
        gf-searchable-select.gfb-scripts .mdc-list-item__content:has(.gfb-scale) { display: flex; align-items: center; }
        .gfb-scale { display: inline-flex; gap: 2px; margin-inline-start: auto; }
        .gfb-scale .gfb-rating__dot { display: block; width: 12px; height: 12px; }

        /* Cards without the requested style */
        gf-tile[data-gfb-dim] { opacity: .38; transition: opacity .2s; }

        /* Rating next to the family name */
        .gfb-rating {
            position: relative;
            z-index: 2;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            margin: -4px 0 -4px 4px;
            vertical-align: middle;
            top: -2px; /* optical centre of the name, not of its line box */
            border-radius: 50%;
        }
        .gfb-rating[role="link"] { cursor: pointer; }
        .gfb-rating[role="link"]:hover { background: color-mix(in srgb, var(--sys-on-surface) 8%, transparent); }
        .gfb-rating__dot { width: 14px; height: 14px; }
        .gfb-rating--good .gfb-rating__dot { fill: ${RATINGS.good.color}; }
        .gfb-rating--soso .gfb-rating__dot { fill: ${RATINGS.soso.color}; }
        .gfb-rating--bad .gfb-rating__dot { fill: ${RATINGS.bad.color}; }

        /* Italic mark before the style count in the card header.
           Sized to the cap height of the 14px text next to it and sitting on
           its baseline; light weight to match the text's colour density. */
        .gfb-badge {
            display: inline-block;
            font-size: 16px;
            width: 1em;
            vertical-align: -0.21em;
            margin-inline-end: 4px;
            color: inherit;
            font-variation-settings: 'FILL' 0, 'wght' 320, 'GRAD' 0, 'opsz' 20;
            position: relative;
            z-index: 2;
            padding: 8px 0;
        }

        /* Our sliders: the value bubble must not cover controls above it */
        .gfb-slider .mdc-slider__value-indicator-container { pointer-events: none; }
        .gfb-ticks { pointer-events: none; }

        /* OpenType features on font pages */
        .gfb-ot { margin-top: 24px; }
        .gfb-ot__group { margin-top: 12px; }
        .gfb-ot__label { color: var(--sys-on-surface-variant); margin-bottom: 6px; }
        .gfb-ot__chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .gfb-chip {
            height: 32px;
            padding: 0 12px;
            border: 1px solid var(--sys-outline-variant);
            border-radius: 8px;
            background: transparent;
            color: var(--sys-on-surface-variant);
            cursor: pointer;
            transition: background-color .15s, color .15s, border-color .15s;
        }
        .gfb-chip:hover { background: color-mix(in srgb, var(--sys-on-surface-variant) 8%, transparent); }
        .gfb-chip:focus-visible { outline: 2.5px solid var(--sys-primary); outline-offset: 1px; }
        .gfb-chip[aria-pressed="true"] {
            background: var(--sys-secondary-container);
            color: var(--sys-on-secondary-container);
            border-color: transparent;
        }
        .gfb-chip[aria-pressed="true"]:hover {
            background: color-mix(in srgb, var(--sys-on-secondary-container) 8%, var(--sys-secondary-container));
        }
        .gfb-select {
            width: 100%;
            height: 40px;
            padding: 0 12px;
            border: 1px solid var(--sys-outline);
            border-radius: 4px;
            background: transparent;
            color: var(--sys-on-surface);
        }
        .gfb-select:focus-visible { outline: 2px solid var(--sys-primary); outline-offset: -1px; }

        /* Card layer */
        gf-tile:has(> .gfb-layer) > gf-feathering > .tile__text,
        gf-tile[data-gfb-pending] > gf-feathering > .tile__text {
            opacity: 0 !important;
            transition: none !important;
        }
        .gfb-layer {
            position: absolute;
            display: flex;
            flex-direction: column;
            pointer-events: none;
        }
        .gfb-part {
            flex: none;
            min-width: 0;
        }
        /* "No italic", "No Bold": its own layer, pinned to the bottom of the text box */
        .gfb-part.gfb-bottom {
            position: absolute;
            left: 0;
            bottom: 0;
        }
        .gfb-part.gfb-side {
            left: auto;
            right: 0;
            bottom: 50%;
            transform: translateY(50%);
            padding-left: 32px;
            background: linear-gradient(to right, transparent, var(--sys-surface) 24px);
        }
        /* Grid: whatever does not fit is clipped. Rows: one line per style, cut
           at the card edge (under the site's own fade) but free to show
           ascenders and descenders above and below. */
        .gfb-layer:not(.gfb-row) > .gfb-tp { overflow: hidden; }
        .gfb-row > .gfb-tp {
            overflow-x: clip;
            overflow-y: visible;
        }
        .gfb-tight .gfb-text { line-height: 1.05 !important; }
        .gfb-text {
            display: block;
            width: 100%;
            margin: 0;
            word-break: break-word;
        }
        .gfb-row .gfb-text { white-space: nowrap; }
        .gfb-sample .gfb-text { text-align: center; }
        .gfb-none {
            font-family: var(--m3-ui-family), sans-serif;
            font-size: 16px;
            line-height: 24px;
            font-weight: 400;
            color: var(--sys-on-surface-variant);
            opacity: .7;
            white-space: nowrap;
        }

        .gfb-tip {
            position: fixed;
            z-index: 10000;
            pointer-events: none;
            box-sizing: border-box;
            max-width: 240px;
            min-height: 24px;
            padding: 4px 8px;
            border-radius: var(--mat-tooltip-container-shape, 4px);
            background: var(--mat-tooltip-container-color, var(--sys-inverse-surface));
            color: var(--mat-tooltip-supporting-text-color, var(--sys-inverse-on-surface));
            font: var(--sys-body-large, 400 16px/24px sans-serif); /* what the site's tooltips render with */
            letter-spacing: var(--mat-tooltip-supporting-text-tracking, normal);
            overflow-wrap: anywhere;
            white-space: pre-line; /* lists: one item per line */
            animation: gfb-tip-in 150ms cubic-bezier(0, 0, .2, 1);
        }
        @keyframes gfb-tip-in {
            from { opacity: 0; transform: scale(.8); }
            to { opacity: 1; transform: scale(1); }
        }
        `;
        document.head.append(style);
    }

    // ─── 18. Boot ───────────────────────────────────────────────
    function render() {
        Weight.sync();
        Reset.sync();
        Peek.update();
        Tiles.markAll();
        Url.write();
    }

    function tick() {
        Router.check();
        if (isCatalog()) {
            Layout.ensure();
            Guidance.ensure();
            Drawer.ensure();
            Tiles.sync();
        } else {
            Guidance.paint();
            Tiles.detach();
        }
        if (isSpecimen()) Spec.ensure();
        else if (Spec.family) { Spec.family = null; Opsz.reset(); OT.reset(); }
    }

    function boot() {
        injectStyles();
        Fonts.init();
        Kaomoji.init();
        Guidance.init();
        State.init();
        if (isSpecimen()) {
            const link = linkSettings();
            Spec.initial = { family: specimenFamily(), opsz: link.opsz, fea: link.fea, lang: link.lang };
        }
        Tip.init();
        Peek.init();
        initHotkeys();

        document.addEventListener('keydown', e => {
            if (e.key === 'Tab' || e.key.startsWith('Arrow')) Focus.keyboard = true;
        }, true);
        document.addEventListener('pointerdown', () => { Focus.keyboard = false; }, true);
        window.addEventListener('scroll', () => {
            Tip.hide();
            if (isSpecimen()) Spec.stickyTop();
        }, { capture: true, passive: true });
        window.addEventListener('popstate', tick);
        document.fonts?.addEventListener('loadingdone', () => { if (isCatalog()) Tiles.refit(); });

        tick();
        setInterval(tick, TICK_MS);
    }

    // Settings first: the modern GM API is asynchronous
    Store.load().catch(() => {}).then(() => {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    });
})();
