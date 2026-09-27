/**
 * The shipped clip an exported grip or grip spin is keyed on. A workbench
 * counterweight variant of a strike (`…Offhand50`) holds the weapon exactly as
 * the strike it was built from.
 */
export const gripClipKey = (clip: string | null): string => (clip ?? '').replace(/Offhand\d+$/, '');
