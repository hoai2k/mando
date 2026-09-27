/**
 * The shipped clip an exported grip is keyed on. Workbench variants of a
 * strike — a counterweight strength (`…Offhand50`) or a wrist study
 * (`…Wrist`, `…WristDrag`) — hold the weapon with their base strike's grip,
 * so the comparison is the motion and nothing else.
 */
export const gripClipKey = (clip: string | null): string =>
  (clip ?? '').replace(/(?:Offhand\d+|Wrist[A-Za-z]*)$/, '');
