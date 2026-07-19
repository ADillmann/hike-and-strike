/** Client-side skill slot helpers (mirrors backend skill_slots). */

const MELEE_THRESHOLDS = [10, 15, 20];
const RANGE_THRESHOLDS = [10, 13, 16, 19, 20];
const SUPPORT_THRESHOLDS = [10, 13, 16, 19, 20];

export const SLOT_KINDS = ['melee', 'range', 'support'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
/** Heal / passives: range or support only (melee slots stay melee-only). */
export const FLEXIBLE_SLOT_KINDS: SlotKind[] = ['range', 'support'];

function thresholdCount(value: number, thresholds: number[]): number {
  return thresholds.filter((t) => value >= t).length;
}

export function normalizeEffectType(type?: string): string {
  if (type === 'power_strike') return 'melee';
  if (type === 'arcane_bolt') return 'range';
  return type || 'none';
}

export function slotCapacity(stats: Record<string, number>) {
  const strength = stats.strength ?? 8;
  const dexterity = stats.dexterity ?? 8;
  const intelligence = stats.intelligence ?? 8;
  const charisma = stats.charisma ?? 8;
  return {
    melee: thresholdCount(strength, MELEE_THRESHOLDS) + thresholdCount(dexterity, MELEE_THRESHOLDS),
    range: thresholdCount(intelligence, RANGE_THRESHOLDS),
    support: thresholdCount(charisma, SUPPORT_THRESHOLDS),
  };
}

export function allowedSlotsForEffect(effectType?: string): SlotKind[] {
  const kind = normalizeEffectType(effectType);
  if (kind === 'melee' || kind === 'range' || kind === 'support') return [kind];
  return [...FLEXIBLE_SLOT_KINDS];
}

export function needsSlotChoice(effectType?: string): boolean {
  const kind = normalizeEffectType(effectType);
  return kind === 'heal' || kind === 'none';
}

export function resolveSlot(effectType: string | undefined, chosen: SlotKind | null | undefined): SlotKind {
  const allowed = allowedSlotsForEffect(effectType);
  const kind = normalizeEffectType(effectType);
  if (kind === 'melee' || kind === 'range' || kind === 'support') return kind;
  if (!chosen || !allowed.includes(chosen)) {
    throw new Error('Choose a skill slot (range or support)');
  }
  return chosen;
}

export function slotUsageFromKinds(slotKinds: string[]) {
  const used = { melee: 0, range: 0, support: 0 };
  for (const kind of slotKinds) {
    if (kind === 'melee' || kind === 'range' || kind === 'support') used[kind] += 1;
  }
  return used;
}

export function canAddResolved(
  stats: Record<string, number>,
  ownedSlotKinds: string[],
  newSlotKind: string,
): boolean {
  if (newSlotKind !== 'melee' && newSlotKind !== 'range' && newSlotKind !== 'support') return false;
  const capacity = slotCapacity(stats);
  const used = slotUsageFromKinds(ownedSlotKinds);
  return used[newSlotKind] < capacity[newSlotKind];
}

export function formatSlotSummary(
  stats: Record<string, number>,
  slotKinds: string[],
): string {
  const capacity = slotCapacity(stats);
  const used = slotUsageFromKinds(slotKinds);
  return `Melee ${used.melee}/${capacity.melee} · Range ${used.range}/${capacity.range} · Support ${used.support}/${capacity.support}`;
}
