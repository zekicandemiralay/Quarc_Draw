# Harbour at Dusk

An oil painting made **inside Quarc Draw**: `frontend/scripts/paint-artwork.mjs` opens the real app and drives it with pen events
(position + pressure), so every mark comes from the app's own Oil Bristle brush, airbrush and layers. It is seeded, so it paints
the same picture every time.

```bash
cd frontend && npm run build && npm run paint          # repaints it; add `-- --final` to export the files below
```

| file | what | in git? |
|---|---|---|
| `harbour-at-dusk.qdraw` | the layered project (9 layers) — open it with *File ▸ Open* | no (13 MB) |
| `harbour-at-dusk.png` | 2560 × 1440 | no (7 MB) |
| `../frontend/public/art/harbour-at-dusk.webp` | 1920 × 1080 copy shown on the home screen and in the About box | yes |
