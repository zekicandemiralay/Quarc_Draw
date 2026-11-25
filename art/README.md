# Paintings made in Quarc Draw

Oil paintings made **inside the app**: `frontend/scripts/paint-artwork.mjs` opens the real Quarc Draw and drives it with pen
events (position + pressure). Every mark comes from the app's own Oil Bristle brush, airbrush and gouache brush, on the app's own
layers — the scripts never draw a pixel themselves. `frontend/scripts/artwork/kit.js` is the "hand" (pen, colour mixing, fills that
follow a shape, contours); each picture is one file next to it. Everything is seeded, so a script paints the same picture every time.

```bash
cd frontend && npm run build
node scripts/paint-artwork.mjs --piece harbour-at-dusk --final --web   # --web: the 1920 px copy the app shows
node scripts/paint-artwork.mjs --piece sunflowers --final --web
```

| painting | size | layers | files here (not in git — large) |
|---|---|---|---|
| **Harbour at Dusk** — sunset over the sea, lighthouse, sailboat, rocks | 2560 × 1440 | 9 | `harbour-at-dusk.qdraw`, `.png` |
| **Sunflowers** — a cream jug of sunflowers on a wooden table, swirling blue wall | 2000 × 2500 | 11 | `sunflowers.qdraw`, `.png` |

Open a `.qdraw` with *File ▸ Open* to see every layer. The 1920 px copies in `frontend/public/art/` are what the app shows: the home
screen banner shows a different one each time the app opens (the dots switch by hand), and the About box shows the same one. To add a
painting: write `frontend/scripts/artwork/<name>.js`, paint it with `--final --web`, copy the `.webp` to `frontend/public/art/` and
list it in `frontend/src/ui/paintings.ts`.
