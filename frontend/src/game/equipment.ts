export const EQUIP_SLOTS = [
  'head',
  'left_hand',
  'right_hand',
  'armor',
  'gloves',
  'legs',
  'shoes',
  'ring_1',
  'ring_2',
  'necklace',
] as const;

export type EquipSlot = (typeof EQUIP_SLOTS)[number];

export const SLOT_LABELS: Record<string, string> = {
  head: 'Head',
  left_hand: 'Left hand',
  right_hand: 'Right hand',
  armor: 'Armor',
  gloves: 'Gloves',
  legs: 'Legs',
  shoes: 'Shoes',
  ring_1: 'Ring 1',
  ring_2: 'Ring 2',
  necklace: 'Necklace',
};

export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot] || slot.replace(/_/g, ' ');
}

export const ARMOR_TYPES = ['head', 'armor', 'gloves', 'legs', 'shoes', 'shield'];
export const HAND_TYPES = ['weapon', 'shield'];
