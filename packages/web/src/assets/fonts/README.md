# Custom local fonts

`Basic-Regular.ttf` is installed here (56,244 bytes), moved from `src/assets/Basic-Regular.ttf`. Its internal metadata identifies family **Basic**, subfamily **Regular**, full name **Basic Regular**, PostScript name **Basic-Regular**, weight **400**, upright style, and no variable axes.

The supplied Basic file is preserved but is no longer registered, preloaded, or used by the application. Instrument Serif is also inactive; its installed package is retained. Do not delete supplied font files without user confirmation.

Geist Sans is the primary family for all application-owned headings and interface text. Its bundled variable face supports real weights from 100 to 900, including the wordmark at 700, page heading at 700, and reader subject at 675. Geist Mono is reserved for email addresses, verification codes, and technical metadata. Both active faces are locally bundled, preloaded, and registered in `fonts.css`; no external font requests are required. `--font-brand` and `--font-display` alias `--font-sans` to keep existing heading utilities consistent.

To add further fonts, place your downloaded, licensed `.woff2`, `.woff`, `.ttf`, or `.otf` files here and follow the instructions below.

## Register supplied fonts

1. Inspect each file's internal font metadata rather than relying on its filename. Record its family, subfamily, weight, italic/normal style, and any variable `wght` axis range. Use a font inspector or a tool that can read OpenType metadata. Retain any required font license alongside the files.
2. Add the verified faces to `../../fonts.css`. Source URLs are relative to that stylesheet and must start with `./assets/fonts/` followed by the exact, case-sensitive filename. Prefer WOFF2; add another format as a fallback only when appropriate. Use `format("woff2")`, `format("woff")`, `format("truetype")`, or `format("opentype")` to match the actual file format.
3. Give related faces the same verified `font-family`. Register static weights separately with their actual numeric weight and `font-style: normal` or `italic`. A variable font should declare only the weight range reported by its metadata. Set `font-display: swap` for every new custom face. Do not register absent weights or styles, or add declarations pointing to files that do not exist.
4. In `../../index.css`, replace the first family in `--font-sans` with the registered custom sans family. Keep the existing system fallbacks (and optionally Geist Sans before them). If a custom monospace family was supplied, register it the same way and update `--font-mono`; otherwise retain Geist Mono.
5. Update the sans font preload in `../../../index.html` to the real custom asset under `/src/assets/fonts/`. Keep the Geist Mono preload unless that family is also replaced. Preload only the primary faces actually used. Vite rewrites these URLs to fingerprinted assets during the production build.

`../../main.tsx` already imports `fonts.css` before `index.css`. No additional component imports are needed. Body text and controls inherit `--font-sans`; generated addresses, plain-text verification codes, and technical metadata use `--font-mono`. Preserve the existing typography scale and weights. Supplied custom files remain available for a future explicit font change. Font synthesis remains disabled.

Do not inject these styles into the received HTML email iframe. Its document remains independent of the application's font rules.

## Verify

From the repository root, run:

```powershell
pnpm --filter @inboxzero/web typecheck
pnpm --filter @inboxzero/web build
```

Check font responses in the browser's Network panel and loaded faces with `document.fonts`. Production CSS URLs and preload links must point to emitted font files, with no 404s or external font requests. Test long addresses and small screens. With `font-display: swap`, evaluate fallback layout shifts using the real supplied fonts; any metric adjustments must be measured from those fonts rather than guessed.
