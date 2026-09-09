# Inter-Bold.ttf

Bundled for `api/_posterOverlay.js` to render poster headline/CTA text on the
server via `sharp`'s Pango-based `text` input with an explicit `fontfile`.
Serverless runtimes (Vercel) ship no system fonts, so this embeds a real font
file directly rather than relying on font discovery.

Source: Google Fonts (`fonts.gstatic.com`), Inter v20, weight 700.
License: SIL Open Font License 1.1 -- https://scripts.sil.org/OFL
