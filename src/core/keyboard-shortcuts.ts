/** Tools that can be assigned an optional map shortcut. */
export type KeyboardTool =
  | 'template' | 'text' | 'point' | 'line' | 'polygon' | 'rectangle' | 'circle' | 'ellipse' | 'freehand' | 'hole' | 'part'
  | 'pin' | 'unpin' | 'lasso' | 'edit' | 'remove-hole' | 'split' | 'cut' | 'reshape' | 'shared-boundary'
  | 'union' | 'difference' | 'intersection' | 'combine' | 'explode'
  | 'rotate' | 'scale' | 'buffer' | 'offset' | 'simplify' | 'duplicate' | 'delete'
  | 'geofencing' | 'guides' | 'snapping' | 'constraints' | 'tracing' | 'measure' | 'zoom' | 'undo' | 'redo';

/** Canvas commands. Delete also removes draft points or selected editable vertices. */
export type KeyboardAction = KeyboardTool | 'finish' | 'cancel'
  | 'nudge-left' | 'nudge-right' | 'nudge-up' | 'nudge-down'
  | 'nudge-left-fast' | 'nudge-right-fast' | 'nudge-up-fast' | 'nudge-down-fast';
/** Mod is Command on Apple platforms and Control elsewhere. */
export type ShortcutModifier = 'Mod' | 'Control' | 'Meta' | 'Alt' | 'Shift';
/** Matches KeyboardEvent.key, with exact modifiers. Letters are case insensitive. */
export interface KeyBinding {
  key: string;
  modifiers?: readonly ShortcutModifier[];
}
/** Each entry replaces that action's alternatives; false or [] disables it. */
export type KeyboardShortcuts = Partial<Record<KeyboardAction, readonly KeyBinding[] | false>>;
/** A complete, independent snapshot, including [] for disabled actions. */
export type ResolvedKeyboardShortcuts = Record<KeyboardAction, KeyBinding[]>;

export const keyboardTools: readonly KeyboardTool[] = [
  'template', 'text', 'point', 'line', 'polygon', 'rectangle', 'circle', 'ellipse', 'freehand', 'hole', 'part',
  'pin', 'unpin', 'lasso', 'edit', 'remove-hole', 'split', 'cut', 'reshape', 'shared-boundary',
  'union', 'difference', 'intersection', 'combine', 'explode',
  'rotate', 'scale', 'buffer', 'offset', 'simplify', 'duplicate', 'delete',
  'geofencing', 'guides', 'snapping', 'constraints', 'tracing', 'measure', 'zoom', 'undo', 'redo',
];
const nudges = ['left', 'right', 'up', 'down'] as const;
export const keyboardActions: readonly KeyboardAction[] = [
  ...keyboardTools, 'finish', 'cancel',
  ...nudges.map(direction => `nudge-${direction}` as const),
  ...nudges.map(direction => `nudge-${direction}-fast` as const),
];
const modifiers: readonly ShortcutModifier[] = ['Mod', 'Control', 'Meta', 'Alt', 'Shift'];
const namedKeys = new Set(['Enter', 'Escape', 'Delete', 'Backspace', 'Insert',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`)]);
const directions = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

export function defaultKeyboardShortcuts(): ResolvedKeyboardShortcuts {
  const result = Object.fromEntries(keyboardActions.map(action => [action, [] as KeyBinding[]])) as ResolvedKeyboardShortcuts;
  // Keep accepting both modifiers for the existing history shortcuts on every platform.
  result.undo = [{ key: 'z', modifiers: ['Control'] }, { key: 'z', modifiers: ['Meta'] }];
  result.redo = [{ key: 'z', modifiers: ['Control', 'Shift'] }, { key: 'z', modifiers: ['Meta', 'Shift'] }, { key: 'y', modifiers: ['Control'] }];
  result.delete = [{ key: 'Delete' }, { key: 'Backspace' }];
  result.finish = [{ key: 'Enter' }]; result.cancel = [{ key: 'Escape' }];
  for (const [index, direction] of nudges.entries()) {
    result[`nudge-${direction}`] = [{ key: directions[index]! }];
    result[`nudge-${direction}-fast`] = [{ key: directions[index]!, modifiers: ['Shift'] }];
  }
  return result;
}

export function bindingModifiers(binding: KeyBinding, apple: boolean): readonly ShortcutModifier[] {
  return (binding.modifiers ?? []).map(modifier => modifier === 'Mod' ? apple ? 'Meta' : 'Control' : modifier);
}

/** Canonical signature for collision detection, checked on both supported platforms. */
function signature(binding: KeyBinding, apple: boolean): string {
  return `${bindingModifiers(binding, apple).slice().sort().join('+')}:${binding.key}`;
}

export function resolveKeyboardShortcuts(update: KeyboardShortcuts | false = {}, previous = defaultKeyboardShortcuts()): ResolvedKeyboardShortcuts {
  if (update === false) return Object.fromEntries(keyboardActions.map(action => [action, [] as KeyBinding[]])) as ResolvedKeyboardShortcuts;
  if (typeof update !== 'object' || update === null || Array.isArray(update)) throw new TypeError('Keyboard shortcuts must be an object.');
  const result = Object.fromEntries(keyboardActions.map(action => [action, previous[action].map(binding => ({ ...binding, ...(binding.modifiers ? { modifiers: [...binding.modifiers] } : {}) }))])) as ResolvedKeyboardShortcuts;
  for (const [action, value] of Object.entries(update)) {
    if (!keyboardActions.includes(action as KeyboardAction)) throw new TypeError(`Unknown keyboard action: ${action}`);
    if (value !== false && !Array.isArray(value)) throw new TypeError(`Keyboard action ${action} needs an array of bindings or false.`);
    result[action as KeyboardAction] = value === false ? [] : (value as unknown[]).map(candidate => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new TypeError(`Invalid binding for ${action}.`);
      const binding = candidate as KeyBinding;
      if (Object.keys(binding).some(key => key !== 'key' && key !== 'modifiers') || typeof binding.key !== 'string'
        || !(Array.from(binding.key).length === 1 && !/\s|\p{C}/u.test(binding.key) || namedKeys.has(binding.key))) throw new TypeError(`Invalid shortcut key for ${action}.`);
      if (binding.modifiers !== undefined && (!Array.isArray(binding.modifiers) || (binding.modifiers as readonly unknown[]).some(modifier => !modifiers.some(known => known === modifier))
        || new Set(binding.modifiers).size !== binding.modifiers.length)) throw new TypeError(`Invalid modifiers for ${action}.`);
      if (binding.modifiers?.includes('Mod') && (binding.modifiers.includes('Control') || binding.modifiers.includes('Meta'))) throw new TypeError('Mod cannot be combined with Control or Meta.');
      const key = Array.from(binding.key).length === 1 ? binding.key.toLowerCase() : binding.key;
      // Arrow navigation in focused editing controls has its own fixed semantics.
      if (directions.includes(key) && !action.startsWith('nudge-')) throw new TypeError('Arrow keys are reserved for movement and control navigation.');
      return { key, ...(binding.modifiers?.length ? { modifiers: modifiers.filter(modifier => binding.modifiers!.includes(modifier)) } : {}) };
    });
  }
  for (const apple of [false, true]) {
    const assigned = new Map<string, KeyboardAction>();
    for (const action of keyboardActions) for (const binding of result[action]) {
      const key = signature(binding, apple); const other = assigned.get(key);
      if (other) throw new TypeError(`Keyboard shortcut conflict: ${other} and ${action} (${key}).`);
      assigned.set(key, action);
    }
  }
  return result;
}
