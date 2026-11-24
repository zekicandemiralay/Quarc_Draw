// Global UI event bus: lets non-React code (tools, commands) open dialogs, toasts, file pickers.

import { Emitter } from '../core/util';

export type DialogName =
  | 'new' | 'open-library' | 'export' | 'import' | 'image-size' | 'canvas-size' | 'prefs' | 'shortcuts' | 'about' | 'sync'
  | 'filter' | 'adjust' | 'effects' | 'gradient-editor' | 'page-setup' | 'note' | 'palette' | 'help' | 'templates' | 'save-as'
  | 'rename' | 'stroke-selection' | 'fill' | 'curves' | 'signature' | 'brush-editor' | 'present' | 'tutorial' | 'share' | 'prompt' | 'doc-info';

/** generic numeric prompt: { title, fields:[{key,label,min,max,step,value}], ok: (values)=>void } */
export interface PromptPayload {
  title: string;
  fields: { key: string; label: string; min?: number; max?: number; step?: number; value: number | string | boolean; type?: 'number' | 'text' | 'bool' | 'select'; options?: { value: string; label: string }[] }[];
  okLabel?: string;
  ok: (v: Record<string, any>) => void;
}

export interface BusEvents {
  dialog: { name: DialogName; payload?: any };
  toast: { message: string; kind?: 'info' | 'error' | 'success' };
  'pick-image': { asObject?: boolean };
  'pick-file': { accept: string; handler: (files: File[]) => void; multiple?: boolean };
  'text-edit': { editorId: string };
  workspace: { name: 'studio' | 'notes' | 'reader' };
  'command-palette': void;
  'context-menu': { x: number; y: number };
  'toggle-panel': { id: string };
  'refresh-library': void;
}
export const bus = new Emitter<BusEvents>();
export const toast = (message: string, kind: 'info' | 'error' | 'success' = 'info') => bus.emit('toast', { message, kind });
export const openDialog = (name: DialogName, payload?: any) => bus.emit('dialog', { name, payload });
