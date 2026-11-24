// The native apps (Android, Windows) carry their own copy of the page, so API calls must go to the Quarc server's
// address. It is baked in at build time (VITE_API_URL); the web app, which the server itself serves, uses relative paths.
export const API_BASE: string = import.meta.env.VITE_API_URL || '';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
