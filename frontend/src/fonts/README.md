# Fonts

Latin subsets of three variable fonts, self-hosted through `next/font/local` so Next.js preloads
them from the page head and sizes fallback fonts to match (no layout shift when they swap in).

| File | Font | License |
|---|---|---|
| `inter-latin-wght-normal.woff2` | Inter | SIL Open Font License 1.1 (`inter-OFL.txt`) |
| `space-grotesk-latin-wght-normal.woff2` | Space Grotesk | SIL Open Font License 1.1 (`space-grotesk-OFL.txt`) |
| `jetbrains-mono-latin-wght-normal.woff2` | JetBrains Mono | SIL Open Font License 1.1 (`jetbrains-mono-OFL.txt`) |

Copied from the `@fontsource-variable/*` packages. Characters outside Latin (for example λ and χ)
fall back to the system font.
