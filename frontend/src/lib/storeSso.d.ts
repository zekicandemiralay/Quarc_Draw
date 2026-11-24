// Types for storeSso.js, the Quarc Store single sign-on kit (copied from Quarc_Store/sso-kit/web).
export type SyncResult = { result: 'unavailable' | 'denied' | 'unchanged' | 'none' | 'signed_in' | 'signed_out' | 'error' | 'timeout'; user?: { id?: string; username?: string; role?: string } };
export function syncFromStore(opts?: { force?: boolean }): Promise<SyncResult>;
export function peekStore(): Promise<{ installed: boolean; available: boolean; state?: 'none' | 'signed_in' | 'signed_out'; user?: { id?: string; username?: string; role?: string } }>;
export function openStore(target?: string): Promise<boolean>;
export function watchStoreSession(onChange: (r: SyncResult) => void): void;
export function compareVersions(a: string, b: string): number;
export function updateViaStore(): Promise<boolean>;
export function shouldPromoteStore(): Promise<boolean>;
export function openStoreDownload(): Promise<void>;
export const STORE_DOWNLOAD_URL: string;
