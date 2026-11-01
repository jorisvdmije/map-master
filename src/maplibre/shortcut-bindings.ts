import { bindingModifiers, keyboardActions, resolveKeyboardShortcuts, type KeyboardAction, type KeyboardShortcuts, type KeyBinding, type ResolvedKeyboardShortcuts } from '../core/keyboard-shortcuts.js';

/** Shared by canvas commands and gesture handlers, so runtime changes apply everywhere. */
export class ShortcutBindings {
  private bindings: ResolvedKeyboardShortcuts;
  readonly apple: boolean;

  constructor(shortcuts: KeyboardShortcuts | false | undefined, navigator: Navigator) {
    this.bindings = resolveKeyboardShortcuts(shortcuts);
    this.apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  }

  get(): ResolvedKeyboardShortcuts { return resolveKeyboardShortcuts({}, this.bindings); }
  set(update: KeyboardShortcuts | false): void { this.bindings = resolveKeyboardShortcuts(update, this.bindings); }

  matches(action: KeyboardAction, event: KeyboardEvent, gestureModifiers: readonly ('Shift' | 'Alt')[] = []): boolean {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')) return false;
    // A deliberate exact binding takes priority over ignoring a held gesture modifier.
    if (gestureModifiers.length && keyboardActions.some(other => other !== action && this.matches(other, event))) return false;
    const key = Array.from(event.key).length === 1 ? event.key.toLowerCase() : event.key;
    return this.bindings[action].some(binding => {
      const modifiers = bindingModifiers(binding, this.apple);
      return key === binding.key && event.ctrlKey === modifiers.includes('Control') && event.metaKey === modifiers.includes('Meta')
        && (event.altKey === modifiers.includes('Alt') || event.altKey && !modifiers.includes('Alt') && gestureModifiers.includes('Alt'))
        && (event.shiftKey === modifiers.includes('Shift') || event.shiftKey && !modifiers.includes('Shift') && gestureModifiers.includes('Shift'));
    });
  }

  private format(binding: KeyBinding, aria: boolean): string {
    const names = bindingModifiers(binding, this.apple).map(modifier => aria ? modifier : modifier === 'Control' ? 'Ctrl' : modifier === 'Meta' ? 'Cmd' : modifier);
    return [...names, binding.key.length === 1 ? binding.key.toUpperCase() : binding.key].join('+');
  }
  label(action: KeyboardAction): string { return this.bindings[action].map(binding => this.format(binding, false)).join(' / '); }
  aria(action: KeyboardAction): string { return this.bindings[action].map(binding => this.format(binding, true)).join(' '); }

  describeControl(element: HTMLElement, instructions: string, navigation: string): void {
    element.title = `${instructions} ${this.label('finish') || 'Apply button'} applies; ${this.label('cancel') || 'Cancel button'} cancels.`;
    element.setAttribute('aria-keyshortcuts', [navigation, this.aria('finish'), this.aria('cancel')].filter(Boolean).join(' '));
  }
}
