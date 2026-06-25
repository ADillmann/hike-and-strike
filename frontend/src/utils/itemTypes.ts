export type ItemTypeFilter =
  | 'all'
  | 'weapon_melee'
  | 'weapon_range'
  | 'weapon'
  | 'shield'
  | 'head'
  | 'armor'
  | 'gloves'
  | 'legs'
  | 'shoes'
  | 'ring'
  | 'necklace'
  | 'spell'
  | 'consumable'
  | 'key'
  | 'secret';

export const ITEM_TYPE_FILTER_OPTIONS: { id: ItemTypeFilter; label: string }[] = [
  { id: 'all', label: 'Any type' },
  { id: 'weapon_melee', label: 'Melee weapons' },
  { id: 'weapon_range', label: 'Ranged weapons' },
  { id: 'shield', label: 'Shields' },
  { id: 'head', label: 'Head' },
  { id: 'armor', label: 'Armor' },
  { id: 'gloves', label: 'Gloves' },
  { id: 'legs', label: 'Legs' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'ring', label: 'Rings' },
  { id: 'necklace', label: 'Necklaces' },
  { id: 'spell', label: 'Spells' },
  { id: 'consumable', label: 'Consumables' },
  { id: 'key', label: 'Keys' },
  { id: 'secret', label: 'Secrets' },
];

export function itemTypeFilterLabel(id: ItemTypeFilter | string | undefined): string {
  if (!id || id === 'all') return 'any type';
  return ITEM_TYPE_FILTER_OPTIONS.find((o) => o.id === id)?.label.toLowerCase() ?? id;
}
