import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, isSkillCapError } from '../../api/client';
import { AlertDialog } from '../../components/AlertDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SOLVER_MODALS } from '../../components/secrets/solverRegistry';
import { EQUIP_SLOTS } from '../../game/equipment';
import { Layout } from '../../components/Layout';
import { useLocale } from '../../context/LocaleContext';
import type { Character } from '../../api/client';
import {
  allowedSlotsForEffect,
  canAddResolved,
  needsSlotChoice,
  type SlotKind,
} from '../../utils/skillSlots';

type InvItem = Character['inventory'][number];
type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

interface PartyMember {
  character_id: number;
  name: string;
  is_self?: boolean;
}

type ItemAction = 'equip' | 'use' | 'secret' | 'passive' | 'none';

function isSecretItem(item: InvItem): boolean {
  return (item.item_type || '').toLowerCase() === 'secret';
}

function getItemAction(item: InvItem): ItemAction {
  if (item.equipped_slot) return 'none';
  const type = (item.item_type || '').toLowerCase();
  if (type === 'secret') return 'secret';
  if (type === 'consumable') return 'use';
  if (item.bag_only || item.stats.passive) return 'passive';
  if (type === 'key' || type === 'spell') return 'passive';
  if (item.equippable && (item.equip_slots?.length ?? 0) > 0) return 'equip';
  return 'passive';
}

function showQuantity(item: InvItem): boolean {
  return (item.item_type || '').toLowerCase() === 'consumable' && item.quantity > 1;
}

function equipSlotName(slot: string, t: TranslateFn): string {
  return t(`inventory.equip_${slot}`);
}

function formatStats(stats: Record<string, unknown>, t: TranslateFn, teachesSkillName?: string | null): string[] {
  const lines: string[] = [];
  if (teachesSkillName) lines.push(t('inventory.stat_teaches', { name: teachesSkillName }));
  if (stats.passive) lines.push(t('inventory.stat_passive'));
  if (stats.two_handed) lines.push(t('inventory.stat_two_handed'));
  if (typeof stats.damage === 'number') lines.push(t('inventory.stat_damage', { n: stats.damage }));
  if (stats.weapon_class === 'range') lines.push(t('inventory.stat_ranged_weapon'));
  else if (stats.weapon_class === 'melee' || stats.damage) lines.push(t('inventory.stat_melee_weapon'));
  if (typeof stats.range === 'number' && stats.weapon_class === 'range') {
    lines.push(t('inventory.stat_range_cells', { n: stats.range }));
  }
  if (typeof stats.armor_bonus === 'number') lines.push(t('inventory.stat_armor', { n: stats.armor_bonus }));
  if (typeof stats.heal === 'number' && stats.heal > 0) lines.push(t('inventory.stat_heals', { n: stats.heal }));
  for (const key of ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'] as const) {
    const val = stats[key];
    if (typeof val === 'number' && val !== 0) {
      lines.push(`${t(`stats.${key}_full`)} ${val > 0 ? '+' : ''}${val}`);
    }
  }
  if (stats.finesse) lines.push(t('inventory.stat_finesse'));
  return lines;
}

function passiveHint(item: InvItem, t: TranslateFn): string {
  const type = (item.item_type || '').toLowerCase();
  if (type === 'secret') return t('inventory.hint_secret');
  if (type === 'key') return t('inventory.hint_key');
  if (type === 'spell') return t('inventory.hint_spell');
  return t('inventory.hint_passive');
}

function equipSlotLabel(item: InvItem, slot: string, t: TranslateFn): string {
  if (item.stats.two_handed && (slot === 'left_hand' || slot === 'right_hand')) {
    return t('inventory.equip_two_handed');
  }
  return t('inventory.equip_slot', { slot: equipSlotName(slot, t) });
}

function ItemCard({
  item,
  party,
  hasParty,
  onEquip,
  onUnequip,
  onUse,
  onExamine,
  onSolve,
  onGive,
  onTrash,
  secretMessage,
}: {
  item: InvItem;
  party: PartyMember[];
  hasParty: boolean;
  onEquip?: (id: number, slot: string) => void;
  onUnequip?: (id: number) => void;
  onUse?: (id: number) => void;
  onExamine?: (id: InvItem) => void;
  onSolve?: (item: InvItem) => void;
  onGive?: (item: InvItem, targetId: number) => void;
  onTrash?: (item: InvItem) => void;
  secretMessage?: string;
}) {
  const { t } = useLocale();
  const [giveOpen, setGiveOpen] = useState(false);
  const [targetId, setTargetId] = useState(() => party.find((p) => !p.is_self)?.character_id || 0);
  const statLines = formatStats(item.stats, t, item.teaches_skill_name);
  const inBag = !item.equipped_slot;
  const action = getItemAction(item);
  const revealed = Boolean(item.secret_state?.revealed);
  const displayDescription = isSecretItem(item)
    ? (revealed ? (item.revealed_description || item.description) : item.description)
    : item.description;
  const slots = item.equip_slots || [];
  const twoHanded = Boolean(item.stats.two_handed);
  const equipOptions = twoHanded
    ? slots.filter((s) => s === 'left_hand' || s === 'right_hand').slice(0, 1)
    : slots;

  useEffect(() => {
    const others = party.filter((p) => !p.is_self);
    if (others[0]) setTargetId(others[0].character_id);
  }, [party]);

  return (
    <div className="mb-3 rounded border border-dungeon-600 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-dungeon-200">
            {item.name}
            {showQuantity(item) && <span className="text-stone-400"> {t('inventory.qty', { n: item.quantity })}</span>}
          </div>
          <div className="text-xs text-stone-500">
            {item.item_type} · {t('inventory.tier', { n: item.tier })}
            {item.price_display && <span> · {item.price_display}</span>}
            {item.equipped_slot && (
              <>
                {' · '}
                {item.stats.two_handed && item.equipped_slot.includes('hand')
                  ? t('inventory.both_hands')
                  : equipSlotName(item.equipped_slot, t)}
              </>
            )}
          </div>
        </div>
        {inBag && action === 'passive' && (
          <span className="rounded bg-dungeon-700 px-2 py-0.5 text-xs text-dungeon-300">{t('inventory.bag_item')}</span>
        )}
      </div>

      {displayDescription && (
        <p className={`mt-2 ${isSecretItem(item) && !revealed ? 'italic text-stone-500' : 'text-stone-400'}`}>
          {displayDescription}
        </p>
      )}

      {secretMessage && isSecretItem(item) && (
        <p className="mt-2 text-sm text-dungeon-300">{secretMessage}</p>
      )}

      {statLines.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-stone-500">
          {statLines.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {item.equipped_slot && onUnequip && (
          <button type="button" className="btn-secondary text-xs" onClick={() => onUnequip(item.id)}>{t('inventory.unequip')}</button>
        )}

        {inBag && action === 'use' && onUse && (
          <button type="button" className="btn-primary text-xs" onClick={() => onUse(item.id)}>{t('inventory.use')}</button>
        )}

        {inBag && action === 'secret' && !revealed && onExamine && (
          <button type="button" className="btn-primary text-xs" onClick={() => onExamine(item)}>{t('inventory.examine')}</button>
        )}

        {inBag && action === 'secret' && revealed && onSolve && (
          <button type="button" className="btn-secondary text-xs" onClick={() => onSolve(item)}>{t('inventory.solve')}</button>
        )}

        {inBag && action === 'equip' && onEquip && equipOptions.map((slot) => (
          <button
            key={slot}
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onEquip(item.id, slot)}
          >
            {equipSlotLabel(item, slot, t)}
          </button>
        ))}

        {inBag && action === 'passive' && passiveHint(item, t) && (
          <span className="text-xs text-stone-500 italic">{passiveHint(item, t)}</span>
        )}

        {inBag && onGive && (
          <>
            {!giveOpen ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={!hasParty}
                title={hasParty ? t('inventory.give_title') : t('inventory.give_disabled')}
                onClick={() => hasParty && setGiveOpen(true)}
              >
                {t('inventory.give_to')}…
              </button>
            ) : (
              <div className="flex w-full flex-wrap items-center gap-1">
                <select className="input flex-1 py-1 text-xs" value={targetId} onChange={(e) => setTargetId(+e.target.value)}>
                  {party.filter((p) => !p.is_self).map((p) => (
                    <option key={p.character_id} value={p.character_id}>{p.name}</option>
                  ))}
                </select>
                <button type="button" className="btn-primary text-xs" onClick={() => { onGive(item, targetId); setGiveOpen(false); }}>{t('inventory.give')}</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setGiveOpen(false)}>{t('common.cancel')}</button>
              </div>
            )}
          </>
        )}

        {onTrash && (
          <button type="button" className="btn-danger text-xs" onClick={() => onTrash(item)}>{t('inventory.discard')}</button>
        )}
      </div>
    </div>
  );
}

function EquipmentPanel({
  inventory,
  onUnequip,
}: {
  inventory: InvItem[];
  onUnequip: (id: number) => void;
}) {
  const { t } = useLocale();
  const bySlot = new Map<string, InvItem>();
  for (const item of inventory) {
    if (!item.equipped_slot) continue;
    if (item.stats.two_handed && item.equipped_slot.includes('hand')) {
      bySlot.set('left_hand', item);
      bySlot.set('right_hand', item);
    } else {
      bySlot.set(item.equipped_slot, item);
    }
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {EQUIP_SLOTS.map((slot) => {
        const item = bySlot.get(slot);
        return (
          <div key={slot} className="rounded border border-dungeon-700 p-2 text-sm">
            <div className="text-xs uppercase text-stone-500">{equipSlotName(slot, t)}</div>
            {item ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-medium text-dungeon-200">{item.name}</span>
                {!(item.stats.two_handed && slot === 'right_hand') && (
                  <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => onUnequip(item.id)}>
                    {t('inventory.unequip')}
                  </button>
                )}
                {item.stats.two_handed && slot === 'right_hand' && (
                  <span className="text-xs text-stone-500">{t('inventory.two_handed_marker')}</span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-stone-600 italic">{t('inventory.empty_slot')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function InventoryPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [partyLoaded, setPartyLoaded] = useState(false);
  const [error, setError] = useState('');
  const [trashItem, setTrashItem] = useState<InvItem | null>(null);
  const [solveItem, setSolveItem] = useState<InvItem | null>(null);
  const [solveBusy, setSolveBusy] = useState(false);
  const [secretMessages, setSecretMessages] = useState<Record<number, string>>({});
  const [solveRewardSummary, setSolveRewardSummary] = useState<string[] | null>(null);
  const [replaceScroll, setReplaceScroll] = useState<{
    inventoryItemId: number;
    skills: { id: number; name: string }[];
    skillToLearn: string;
    selectedSkillId: number;
    slotKind: SlotKind | null;
    needsSlot: boolean;
    effectType: string;
  } | null>(null);
  const [slotPick, setSlotPick] = useState<{
    inventoryItemId: number;
    skillName: string;
    effectType: string;
    slotKind: SlotKind | null;
  } | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const navigate = useNavigate();
  const { t } = useLocale();

  const load = () => {
    api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));
    api.get<PartyMember[]>('/characters/me/party')
      .then((members) => { setParty(members); setPartyLoaded(true); })
      .catch(() => { setParty([]); setPartyLoaded(true); });
  };

  useEffect(() => { load(); }, [navigate]);

  const ownedSlotKinds = (character?.skills || []).map((s) => s.slot_kind || 'support');

  const equip = async (inventoryItemId: number, slot: string) => {
    setError('');
    try {
      await api.post('/characters/me/equip', { inventory_item_id: inventoryItemId, slot });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory.err_equip'));
    }
  };

  const unequip = async (inventoryItemId: number) => {
    await api.post('/characters/me/equip', { inventory_item_id: inventoryItemId, slot: null });
    load();
  };

  const useItem = async (
    inventoryItemId: number,
    replaceSkillId?: number,
    slotKind?: SlotKind | null,
  ) => {
    setError('');
    try {
      await api.post('/characters/me/use-item', {
        inventory_item_id: inventoryItemId,
        ...(replaceSkillId != null ? { replace_skill_id: replaceSkillId } : {}),
        ...(slotKind ? { slot_kind: slotKind } : {}),
      });
      setReplaceScroll(null);
      setSlotPick(null);
      load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && isSkillCapError(err.detail)) {
        const firstSkill = err.detail.skills[0];
        const effectType = err.detail.skill_to_learn.effect_type
          || character?.inventory.find((i) => i.id === inventoryItemId)?.teaches_skill_effect_type
          || 'none';
        setReplaceScroll({
          inventoryItemId,
          skills: err.detail.skills,
          skillToLearn: err.detail.skill_to_learn.name,
          selectedSkillId: firstSkill?.id ?? 0,
          slotKind: null,
          needsSlot: needsSlotChoice(effectType),
          effectType,
        });
        return;
      }
      setError(err instanceof Error ? err.message : t('inventory.err_use'));
    }
  };

  const confirmReplaceScroll = async () => {
    if (!replaceScroll || !replaceScroll.selectedSkillId) return;
    if (replaceScroll.needsSlot && !replaceScroll.slotKind) {
      setError(t('inventory.choose_skill_slot_err'));
      return;
    }
    setReplaceBusy(true);
    setError('');
    try {
      await useItem(
        replaceScroll.inventoryItemId,
        replaceScroll.selectedSkillId,
        replaceScroll.slotKind,
      );
    } finally {
      setReplaceBusy(false);
    }
  };

  const handleUseItem = (inventoryItemId: number) => {
    const item = character?.inventory.find((i) => i.id === inventoryItemId);
    const isScroll = Boolean(item?.skill_template_id);
    const effectType = item?.teaches_skill_effect_type || 'none';
    const atCap = (character?.skills.length ?? 0) >= 20;
    if (isScroll && atCap && character) {
      setReplaceScroll({
        inventoryItemId,
        skills: character.skills.map((s) => ({ id: s.id, name: s.name })),
        skillToLearn: item?.teaches_skill_name || t('inventory.new_spell'),
        selectedSkillId: character.skills[0]?.id ?? 0,
        slotKind: null,
        needsSlot: needsSlotChoice(effectType),
        effectType,
      });
      return;
    }
    if (isScroll && needsSlotChoice(effectType)) {
      setSlotPick({
        inventoryItemId,
        skillName: item?.teaches_skill_name || t('inventory.new_spell'),
        effectType,
        slotKind: null,
      });
      return;
    }
    void useItem(inventoryItemId);
  };

  const examineSecret = async (item: InvItem) => {
    setError('');
    setSecretMessages((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      const res = await api.post<{
        success: boolean;
        message: string;
        revealed_description?: string;
      }>('/characters/me/examine-secret-item', { inventory_item_id: item.id });
      setSecretMessages((prev) => ({ ...prev, [item.id]: res.message }));
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory.err_examine'));
    }
  };

  const submitSolve = async (guess: string) => {
    if (!solveItem) return;
    setError('');
    setSolveBusy(true);
    try {
      const res = await api.post<{ success: boolean; message: string; rewards_summary: string[]; character: Character }>(
        '/characters/me/solve-secret-item',
        { inventory_item_id: solveItem.id, guess },
      );
      setSecretMessages((prev) => {
        const next = { ...prev };
        delete next[solveItem.id];
        return next;
      });
      if (res.success) {
        setSolveItem(null);
        setCharacter(res.character);
        setSolveRewardSummary(res.rewards_summary ?? []);
        api.get<PartyMember[]>('/characters/me/party').then(setParty).catch(() => setParty([]));
      } else {
        setSecretMessages((prev) => ({ ...prev, [solveItem.id]: res.message }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory.err_solve'));
    } finally {
      setSolveBusy(false);
    }
  };

  const giveItem = async (item: InvItem, targetCharacterId: number) => {
    setError('');
    try {
      await api.post('/characters/me/give-item', {
        inventory_item_id: item.id,
        target_character_id: targetCharacterId,
        quantity: (item.item_type || '').toLowerCase() === 'consumable' ? 1 : item.quantity,
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory.err_give'));
    }
  };

  const discardItem = async () => {
    if (!trashItem) return;
    setError('');
    try {
      await api.post('/characters/me/discard-item', { inventory_item_id: trashItem.id });
      setTrashItem(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('inventory.err_discard'));
    }
  };

  const trashLabel = (item: InvItem) => {
    const qty = showQuantity(item) ? ` (${t('inventory.qty', { n: item.quantity })})` : '';
    const slot = item.equipped_slot
      ? ` ${t('inventory.from_slot', { slot: equipSlotName(item.equipped_slot, t) })}`
      : '';
    return `${item.name}${qty}${slot}`;
  };

  if (!character) return <Layout title={t('inventory.title')}>{t('common.loading')}</Layout>;

  const bag = character.inventory.filter((i) => !i.equipped_slot);
  const hasParty = party.some((p) => !p.is_self);
  const partyNames = party.filter((p) => !p.is_self).map((p) => p.name).join(', ');

  return (
    <Layout title={t('inventory.title')}>
      {error && <p className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-red-400">{error}</p>}

      {partyLoaded && !hasParty && (
        <p className="mb-4 rounded border border-dungeon-700 bg-dungeon-900/50 p-3 text-sm text-stone-400">
          {t('inventory.party_required')}
        </p>
      )}
      {hasParty && (
        <p className="mb-4 text-sm text-stone-500">
          {t('inventory.group_label', { names: partyNames || t('inventory.just_you') })}
        </p>
      )}

      <section className="card mb-4">
        <h2 className="mb-1 font-semibold text-dungeon-300">{t('inventory.wallet')}</h2>
        <p className="text-lg text-dungeon-200">{character.wallet_display || t('inventory.wallet_zero')}</p>
        {character.wallet_copper != null && (
          <p className="text-xs text-stone-500">{t('inventory.copper_total', { n: character.wallet_copper })}</p>
        )}
      </section>

      <section className="card mb-4">
        <h2 className="mb-3 font-semibold text-dungeon-300">{t('inventory.equipment')}</h2>
        <EquipmentPanel inventory={character.inventory} onUnequip={unequip} />
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold text-dungeon-300">{t('inventory.backpack')}</h2>
        {bag.length === 0 ? (
          <p className="text-stone-400">{t('inventory.empty')}</p>
        ) : (
          bag.map((i) => (
            <ItemCard
              key={i.id}
              item={i}
              party={party}
              hasParty={hasParty}
              onEquip={equip}
              onUse={handleUseItem}
              onExamine={examineSecret}
              onSolve={setSolveItem}
              onGive={giveItem}
              onTrash={setTrashItem}
              secretMessage={secretMessages[i.id]}
            />
          ))
        )}
      </section>

      {trashItem && (
        <ConfirmDialog
          title={t('inventory.confirm_discard_title')}
          message={t('inventory.confirm_discard_message', { name: trashLabel(trashItem) })}
          confirmLabel={t('inventory.discard')}
          onConfirm={discardItem}
          onCancel={() => setTrashItem(null)}
        />
      )}

      {solveItem && (() => {
        const solverType = solveItem.secret_solver_type || 'codeword';
        const Modal = SOLVER_MODALS[solverType];
        if (!Modal) return null;
        return (
          <Modal
            itemName={solveItem.name}
            hints={solveItem.secret_solver_hints || {}}
            onSubmit={submitSolve}
            onClose={() => setSolveItem(null)}
            busy={solveBusy}
          />
        );
      })()}

      {replaceScroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold text-dungeon-200">{t('inventory.replace_spell_title')}</h3>
            <p className="text-sm text-stone-400">
              {t('inventory.replace_spell_help', { name: replaceScroll.skillToLearn })}
            </p>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {replaceScroll.skills.map((skill) => (
                <label key={skill.id} className="flex cursor-pointer items-center gap-2 rounded border border-dungeon-700 p-2 text-sm">
                  <input
                    type="radio"
                    name="replace-skill"
                    checked={replaceScroll.selectedSkillId === skill.id}
                    onChange={() => setReplaceScroll({ ...replaceScroll, selectedSkillId: skill.id })}
                  />
                  <span>{skill.name}</span>
                </label>
              ))}
            </div>
            {replaceScroll.needsSlot && (
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-xs text-stone-400">{t('inventory.place_in')}</span>
                {allowedSlotsForEffect(replaceScroll.effectType).map((slot) => {
                  const withoutReplaced = (character?.skills || [])
                    .filter((s) => s.id !== replaceScroll.selectedSkillId)
                    .map((s) => s.slot_kind || 'support');
                  const fits = canAddResolved(character?.stats || {}, withoutReplaced, slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={`btn-secondary px-2 py-0.5 text-xs ${
                        replaceScroll.slotKind === slot ? 'ring-1 ring-dungeon-300' : ''
                      }`}
                      disabled={!fits}
                      onClick={() => setReplaceScroll({ ...replaceScroll, slotKind: slot })}
                    >
                      {t(`slots.${slot}`)}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={
                  !replaceScroll.selectedSkillId
                  || replaceBusy
                  || (replaceScroll.needsSlot && !replaceScroll.slotKind)
                }
                onClick={confirmReplaceScroll}
              >
                {replaceBusy ? t('inventory.learning') : t('inventory.learn_spell')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setReplaceScroll(null)} disabled={replaceBusy}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {slotPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold text-dungeon-200">{t('inventory.choose_skill_slot')}</h3>
            <p className="text-sm text-stone-400">
              {t('inventory.where_skill_goes', { name: slotPick.skillName })}
            </p>
            <div className="flex flex-wrap gap-2">
              {allowedSlotsForEffect(slotPick.effectType).map((slot) => {
                const fits = canAddResolved(character?.stats || {}, ownedSlotKinds, slot);
                return (
                  <button
                    key={slot}
                    type="button"
                    className={`btn-secondary px-2 py-0.5 text-xs ${
                      slotPick.slotKind === slot ? 'ring-1 ring-dungeon-300' : ''
                    }`}
                    disabled={!fits}
                    onClick={() => setSlotPick({ ...slotPick, slotKind: slot })}
                  >
                    {t(`slots.${slot}`)}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={!slotPick.slotKind}
                onClick={() => void useItem(slotPick.inventoryItemId, undefined, slotPick.slotKind)}
              >
                {t('inventory.learn')}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setSlotPick(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {solveRewardSummary !== null && (
        <AlertDialog
          title={t('inventory.secret_solved')}
          onClose={() => setSolveRewardSummary(null)}
        >
          {solveRewardSummary.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-sm text-stone-300">
              {solveRewardSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">{t('inventory.nothing_found')}</p>
          )}
        </AlertDialog>
      )}
    </Layout>
  );
}
