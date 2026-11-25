// The paintings made inside Quarc Draw itself (frontend/scripts/paint-artwork.mjs) that the app shows: one at a time on the home
// screen, and the same one in the About box. Each time the app opens it shows the next one; swipe the banner (or use its dots) for
// another, and tap it to see the painting whole, in a frame (PaintingViewer).

import { prefs } from '../app/store';

export interface Painting {
  src: string;
  title: string;
  /** which part of the picture to keep when the banner crops it (CSS object-position) */
  pos: string;
}

export const PAINTINGS: Painting[] = [
  { src: '/art/harbour-at-dusk.webp', title: 'Harbour at Dusk', pos: '50% 64%' },
  { src: '/art/sunflowers.webp', title: 'Sunflowers', pos: '50% 33%' },
  { src: '/art/campfire-by-the-lake.webp', title: 'Campfire by the Lake', pos: '50% 74%' },
];

const wrap = (i: number) => ((i % PAINTINGS.length) + PAINTINGS.length) % PAINTINGS.length;

// once per launch (this module loads when the app starts): move on to the next painting
prefs.set({ heroIndex: wrap((prefs.get().heroIndex ?? -1) + 1) });

/** the painting being shown now, and a way to pick another (remembered, so the next launch carries on from there) */
export function useCurrentPainting(): [number, Painting, (i: number) => void] {
  const i = prefs.useSelect((p) => wrap(p.heroIndex ?? 0));
  return [i, PAINTINGS[i], (k: number) => prefs.set({ heroIndex: wrap(k) })];
}
