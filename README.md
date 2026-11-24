<p align="center"><img src="logo.png" width="112" alt="Quarc Draw logo" /></p>

<h1 align="center">Quarc Draw</h1>
<p align="center">A professional layered <b>raster + vector drawing studio</b> with <b>Notes</b> and <b>PDF Reader</b> modes — local-first, offline-capable, and syncable through the folder, server or WebDAV share you already trust.</p>

<p align="center"><i>By QuarcNet</i></p>

---

Quarc Draw is a single web app (TypeScript · React · Canvas 2D) that runs in any modern browser and installs as a desktop / tablet app (PWA). One engine powers three workspaces:

| Workspace | Think… | What it is |
|---|---|---|
| 🎨 **Studio** | Photoshop · Krita · Procreate · Illustrator | Pixel layers + vector layers, pressure-sensitive brushes, selections, filters, adjustment layers, effects, masks, symmetry, text, bezier paths |
| ✍️ **Notes** | GoodNotes · Notability · OneNote | Multi-page notebooks with lined / grid / dotted / Cornell / music paper, **vector ink** (erase or lasso whole strokes, hold-to-snap shapes), sticky notes, images, laser pointer, presentation mode |
| 📄 **Reader** | Acrobat · Xodo · Preview | Open a PDF, search it, highlight / underline / strike / squiggle selected text, add ink, text, notes and signatures, then **export the marks inside the original PDF** |

Switch workspaces any time from the title bar — they share documents, layers and tools.

## Features

### Drawing & painting (Studio)
- **Layers**: pixel, vector, group, and **adjustment layers**; 17 blend modes, opacity, clipping masks, alpha lock, raster **layer masks** (paint black/white), colour labels, drag-and-drop reordering, thumbnails
- **Non-destructive layer effects**: drop shadow, inner shadow, outer glow, stroke, colour overlay
- **Brush engine**: dab-based with pressure / tilt dynamics, stabiliser, spacing, scatter, jitter, angle-follows-stroke, procedural grain textures (paper / canvas / rough), wet colour mixing, image tips — **42 presets** (pencils, inks, markers, oil, acrylic, watercolour, charcoal, pastel, spray, stars, leaves, erasers…) plus a full settings editor and "save as brush"
- **Retouch tools**: smudge, blur, sharpen, dodge, burn, clone stamp
- **Selections**: rectangle, ellipse, lasso, polygon lasso, magic wand, selection brush; add / subtract / intersect, feather, grow, shrink, smooth, border, invert, save as mask, move the selection outline
- **Fill & gradient**: flood fill (tolerance, contiguous, expand, all-layers), linear / radial / angle / reflected / diamond gradients with an editor
- **Vector tools**: bezier pen, node editor, rectangle, ellipse, polygon, star, line, arrow, freeform; **boolean operations** (union / subtract / intersect / exclude), align & distribute, group, arrange, convert to path, stroke options (dash, caps, joins), gradient & pattern fills, shadows
- **Text**: in-place editing, any installed or imported font, weight / italic / underline / strike, alignment, leading, tracking, text boxes
- **Transform**: free transform with scale / rotate / flip, crop with aspect ratios, canvas & image size, rotate / flip canvas, trim
- **Filters** (live preview): Gaussian / box / motion / zoom / spin blur, unsharp mask, noise, median, emboss, find edges, pixelate, halftone, oil paint, glow, vignette, chromatic aberration, twirl, spherize, ripple, wave
- **Adjustments** (destructive *or* as editable layers): brightness/contrast, hue/saturation, levels (with histogram), **curves**, exposure, vibrance, colour balance, photo filter, gradient map, invert, B&W, sepia, threshold, posterize
- **Drawing aids**: symmetry (vertical / horizontal / quadrant / radial), perspective guides, rulers with units (px / in / cm / mm / pt), draggable guides, grid + isometric grid, snapping to grid / guides / objects, pixel grid at high zoom, view rotation & flip
- **Colour**: HSV picker with alpha, harmony generator, 11 built-in palettes + your own, eyedropper (1–11 px averaging)

### Notes & reading
- **Pages** with thumbnails, drag-to-reorder, bookmarks, free / vertical / horizontal / spread / grid layouts; **14 procedural paper templates**
- **Vector ink**: pen, fountain pen, pencil, marker, brush pen, highlighter — pressure-variable width, palm rejection, pen-only mode, pen-eraser end, **stroke eraser** (whole or partial), object **lasso**, hold-still **shape recognition** (line / ellipse / rectangle / polygon)
- **PDF**: lazy high-resolution rendering, full-text **search**, outline, **text markup**, copy text, annotation list with comments, signature pad, **export into the original PDF**
- Sticky notes, images as movable objects, hyperlinks (URL or page), laser pointer, **presentation mode**

### Files, import & export
| | Import | Export |
|---|---|---|
| Native project `.qdraw` | ✅ | ✅ (all layers, masks, vectors, assets, thumbnail) |
| PNG · JPEG · WebP · AVIF · BMP · GIF · ICO | ✅ | ✅ (scale, quality, transparency; animated GIF from pages; ICO multi-size) |
| SVG | ✅ editable vectors (paths, arcs, gradients, CSS, transforms, text) | ✅ |
| PDF | ✅ annotatable pages | ✅ flattened pages **or** annotate-the-original |
| PSD | ✅ layers, groups, blend modes | ✅ layered |
| OpenRaster `.ora` (Krita / GIMP) | ✅ | ✅ |
| Clipboard images, drag & drop, fonts (`ttf/otf/woff`), print | ✅ | ✅ copy PNG, share, print |

Per-layer export, selection-only export and 1×–6× scaling are built in.

### Library & sync
- **Documents library**: folders, tags, favourites, search, sort, trash, thumbnails, autosave to IndexedDB (works offline)
- **Sync** is local-first and conflict-safe (per-document revisions; if both sides changed, **both versions are kept**; deletions propagate; remote deletions go to the trash). Pick a provider in *File ▸ Sync settings*:
  - **Folder** — any folder kept in sync by a desktop client (Proton Drive, Dropbox, OneDrive, Google Drive, Syncthing…) using the File System Access API (Chromium browsers)
  - **Quarc server** — the dependency-free Node server in [`server/`](server) with token auth, optimistic concurrency and live push (SSE)
  - **WebDAV** — Nextcloud, ownCloud, any WebDAV share
  - **Dropbox** — via an access token

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build / preview:

```bash
npm run build        # type-checks, then bundles to dist/
npm run preview      # http://localhost:4173
```

Install it as an app from the browser's address bar (Chrome / Edge: *Install Quarc Draw*) for full keyboard-shortcut support — browsers reserve `Ctrl+N/T/W` inside normal tabs.

### Sync server

```bash
npm run server                         # :8787 — prints an access token on first start
node server/index.mjs --new-token anna # add another user
node server/index.mjs --static dist    # also host the built app (one process does everything)
```

Environment: `PORT`, `QUARC_DATA`, `QUARC_ORIGIN` (CORS origin — set this when exposing it), `QUARC_MAX_MB`. Put it behind HTTPS (e.g. a reverse proxy) when used over the internet; the token is the credential.

## Keyboard & input

`Ctrl+K` command palette · `F1` all shortcuts (rebindable) · `V` move · `B` brush · `E` eraser · `M` marquee · `L` lasso · `W` wand · `G` bucket · `P` pen · `T` text · `I` eyedropper · `Space`-drag pan · `[` `]` brush size · `X` swap colours · `Ctrl+Z / Ctrl+Shift+Z` undo / redo · `Ctrl+T` free transform · `Ctrl+Shift+E` export.
Touch & pen: pinch to zoom/rotate, two-finger tap = undo, three-finger tap = redo, optional **pen-only** mode and **palm rejection**, pressure curve in *Preferences*.

## Project layout

```
src/
  core/      document model, renderer (blend / masks / clipping / effects), selection, history, vector geometry, viewport
  brush/     brush engine + presets
  filters/   pure pixel algorithms + filter registry (unit-tested)
  editor/    Editor controller + layer / page / object / raster operations
  tools/     every tool (brush, selection, transform, vector, ink, text, crop…)
  io/        .qdraw, SVG, PSD, ORA, exporters, importers
  pdf/       pdf.js wrapper, text markup, search
  sync/      engine + providers (folder, WebDAV, Quarc server, Dropbox)
  app/       commands, preferences, storage (IndexedDB), workspace
  ui/        React shell, panels, dialogs
server/      zero-dependency sync server
tests/       unit (Vitest) + end-to-end (Playwright driving Edge / Chrome)
```

Design notes: vector objects are immutable and raster surfaces are shared by reference, so undo snapshots are just shallow copies of the layer tree (cheap even for large documents); raster edits are recorded as before/after patches of the dirty rectangle; the same renderer draws the screen, the thumbnails and every exporter.

## Tests

```bash
npm run typecheck
npm test                     # 36 unit tests (geometry, colour, filters, selection, flood fill, history, SVG paths, shape recognition…)
npm run build && npm run test:e2e    # browser end-to-end suite (needs Edge or Chrome installed)
```

The e2e suite drives the production build: painting with every brush preset, layers & masks, selections, vector tools, text, filters, notebooks with pen-pressure ink and shape snapping, PDF import / search / markup / annotated export, round-tripping every file format, two-device sync with conflicts and deletions (against a real server and a mock WebDAV server), pixel-level checks of blend modes, clipping, adjustment layers and effects, and more.
Run a single group: `node tests/e2e/run.mjs notes` (`studio`, `notes`, `reader`, `io`, `sync`, `render`, `ui`). Screenshots land in `tests/e2e/out/`.

## Known limitations

Being upfront about what is *not* (yet) here:

- Colour is sRGB only — no CMYK / ICC profiles, no 16-bit or HDR canvases.
- No liquify / mesh-warp, no animation timeline (pages can be exported as an animated GIF "flipbook").
- No handwriting recognition / OCR, no PDF form filling, no real-time multi-user co-editing (sync is per document with conflict copies).
- PSD export rasterises text / vector layers and skips adjustment layers; SVG import ignores filters, masks and clip-paths; exported PDF marks are an image overlay on the original page rather than native PDF annotation objects.
- Folder sync needs a Chromium-based browser (File System Access API).
- Very large canvases (≥ 8000 px) are limited by browser memory; each pixel layer costs width × height × 4 bytes.

## Privacy

Everything stays on your device unless you configure sync. Sync credentials are stored in the browser's local storage on that device; the app makes no network requests of its own.
