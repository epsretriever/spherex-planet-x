# Fonts

Latin subset of one variable font, self-hosted through `next/font/local` so Next.js preloads it
from the page head and sizes the fallback font to match (no layout shift when it swaps in).

| File | Font | Axes | License |
|---|---|---|---|
| `archivo-latin-wdth-wght-normal.woff2` | Archivo (Omnibus-Type) | weight 100–900, width 62–125% | SIL Open Font License 1.1 (`archivo-OFL.txt`) |

Copied from `@fontsource-variable/archivo` (`archivo-latin-standard-normal.woff2`, which carries both
axes). Width does the typographic work: expanded for headlines, normal for reading, condensed with
tabular figures for data. Characters outside Latin (for example λ, χ and arrows) fall back to the
system font.
