export interface TempEffect {
  id: number;
  label: string;
  stat_modifiers: Record<string, number>;
  battle_modifiers?: Record<string, number>;
  active_in_battle?: boolean;
  cleared_on_rest?: boolean;
}

export function formatStatMods(mods: Record<string, number>): string {
  return Object.entries(mods)
    .filter(([, v]) => v)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k.slice(0, 3)}`)
    .join(', ');
}

export function formatBattleMods(activeInBattle?: boolean, battleModifiers?: Record<string, number>): string {
  if (!activeInBattle) return '';
  const b = battleModifiers || {};
  const parts: string[] = [];
  if (b.damage_dealt_mod) parts.push(`${b.damage_dealt_mod > 0 ? '+' : ''}${b.damage_dealt_mod} dmg dealt`);
  if (b.heal_mod) parts.push(`${b.heal_mod > 0 ? '+' : ''}${b.heal_mod} heal`);
  return parts.length ? `Battle: ${parts.join(', ')}` : '';
}
