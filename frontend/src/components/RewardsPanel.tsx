import { useEffect, useState } from 'react';
import { api, REWARDS_BLOCKED_DURING_BATTLE } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import { ITEM_TYPE_FILTER_OPTIONS, ItemTypeFilter, itemTypeFilterLabel } from '../utils/itemTypes';

export interface RewardsPayload {
  rewards?: Record<string, unknown>;
  punishments?: Record<string, unknown>;
}

interface PartyMember {
  id: number;
  name: string;
  current_hp?: number;
  max_hp?: number;
}

interface Item {
  id: number;
  name: string;
  tier: number;
}

export interface EffectTemplate {
  id: number;
  name: string;
  description: string;
  label: string;
  is_buff: boolean;
  stat_modifiers: Record<string, number>;
  battle_modifiers: Record<string, number>;
  active_in_battle: boolean;
  cleared_on_rest: boolean;
  cleared_on_event: boolean;
}

interface InvItem {
  id: number;
  name: string;
  character_id?: number;
}

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];

type RewardConfirmAction = 'item' | 'random' | 'buff' | 'debuff' | 'effect' | 'hp' | 'xp' | 'currency' | 'remove';

interface PendingRewardConfirm {
  action: RewardConfirmAction;
  title: string;
  message: string;
  confirmLabel?: string;
}

export function RewardsPanel({
  campaignId,
  party,
  items,
  effects,
  onApplied,
  compact,
  rewardsBlocked = false,
}: {
  campaignId: number;
  party: PartyMember[];
  items: Item[];
  effects: EffectTemplate[];
  onApplied?: () => void;
  compact?: boolean;
  rewardsBlocked?: boolean;
}) {
  const [tab, setTab] = useState<'item' | 'random' | 'buff' | 'debuff' | 'effect' | 'hp' | 'xp' | 'currency' | 'remove'>('item');
  const [rewardCharId, setRewardCharId] = useState(0);
  const [rewardItemId, setRewardItemId] = useState(0);
  const [wholeParty, setWholeParty] = useState(false);
  const [randomTier, setRandomTier] = useState(1);
  const [randomCount, setRandomCount] = useState(1);
  const [randomWholeParty, setRandomWholeParty] = useState(true);
  const [randomCharId, setRandomCharId] = useState(0);
  const [randomItemType, setRandomItemType] = useState<ItemTypeFilter>('all');
  const [buffLabel, setBuffLabel] = useState('');
  const [buffStat, setBuffStat] = useState('strength');
  const [buffValue, setBuffValue] = useState(1);
  const [buffCharId, setBuffCharId] = useState(0);
  const [hpCharId, setHpCharId] = useState(0);
  const [hpChange, setHpChange] = useState(-5);
  const [xpWholeParty, setXpWholeParty] = useState(true);
  const [xpCharId, setXpCharId] = useState(0);
  const [xpAmount, setXpAmount] = useState(100);
  const [currencyWholeParty, setCurrencyWholeParty] = useState(true);
  const [currencyCharId, setCurrencyCharId] = useState(0);
  const [currencyAmount, setCurrencyAmount] = useState(100);
  const [currencyReduce, setCurrencyReduce] = useState(false);
  const [effectWholeParty, setEffectWholeParty] = useState(false);
  const [effectCharId, setEffectCharId] = useState(0);
  const [effectTemplateId, setEffectTemplateId] = useState(0);
  const [pendingConfirm, setPendingConfirm] = useState<PendingRewardConfirm | null>(null);
  const [removeCharId, setRemoveCharId] = useState(0);
  const [removeInvId, setRemoveInvId] = useState(0);
  const [charInventory, setCharInventory] = useState<InvItem[]>([]);
  const [applyError, setApplyError] = useState('');

  useEffect(() => {
    if (party[0]) {
      setRewardCharId(party[0].id);
      setBuffCharId(party[0].id);
      setHpCharId(party[0].id);
      setXpCharId(party[0].id);
      setCurrencyCharId(party[0].id);
      setRemoveCharId(party[0].id);
      setEffectCharId(party[0].id);
      setRandomCharId(party[0].id);
    }
    if (items[0]) setRewardItemId(items[0].id);
    if (effects[0]) setEffectTemplateId(effects[0].id);
  }, [party, items, effects]);

  useEffect(() => {
    if (!removeCharId) return;
    api.get<{ id: number; name: string; inventory: { id: number; name: string }[] }>(`/characters/${removeCharId}`)
      .then((c) => setCharInventory(c.inventory.map((i) => ({ id: i.id, name: i.name, character_id: removeCharId }))))
      .catch(() => setCharInventory([]));
  }, [removeCharId]);

  const apply = async (payload: RewardsPayload) => {
    setApplyError('');
    try {
      await api.post(`/campaigns/${campaignId}/rewards`, payload);
      onApplied?.();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Could not apply rewards');
      throw err;
    }
  };

  const grantItem = async () => {
    const targets = wholeParty ? party.map((p) => p.id) : [rewardCharId];
    await apply({
      rewards: {
        items: targets.map((character_id) => ({ character_id, item_template_id: rewardItemId })),
      },
    });
  };

  const grantRandom = async () => {
    const targets = randomWholeParty ? party.map((p) => p.id) : [randomCharId];
    const entry: Record<string, unknown> = {
      tier: randomTier,
      count: randomCount,
      character_ids: targets,
    };
    if (randomItemType !== 'all') entry.item_type = randomItemType;
    await apply({ rewards: { random_tier: [entry] } });
  };

  const grantBuff = async () => {
    await apply({
      rewards: {
        temp_buffs: [{
          character_id: buffCharId,
          label: buffLabel || 'Buff',
          stat_modifiers: { [buffStat]: buffValue },
          cleared_on_rest: true,
        }],
      },
    });
  };

  const grantDebuff = async () => {
    await apply({
      punishments: {
        temp_debuffs: [{
          character_id: buffCharId,
          label: buffLabel || 'Debuff',
          stat_modifiers: { [buffStat]: -Math.abs(buffValue) },
          cleared_on_rest: true,
        }],
      },
    });
  };

  const applyHpChange = async () => {
    if (hpChange === 0) return;
    await apply({
      punishments: {
        hp_reduction: [{ character_id: hpCharId, amount: hpChange }],
      },
    });
  };

  const grantXp = async () => {
    if (xpAmount <= 0) return;
    const targets = xpWholeParty ? party.map((p) => p.id) : [xpCharId];
    await apply({
      rewards: {
        xp: targets.map((character_id) => ({ character_id, amount: xpAmount })),
      },
    });
  };

  const applyCurrency = async () => {
    if (currencyAmount <= 0) return;
    const targets = currencyWholeParty ? party.map((p) => p.id) : [currencyCharId];
    if (currencyReduce) {
      await apply({
        punishments: {
          wallet_reduction: targets.map((character_id) => ({ character_id, amount: currencyAmount })),
        },
      });
    } else {
      await apply({
        rewards: {
          wallet: targets.map((character_id) => ({ character_id, amount: currencyAmount })),
        },
      });
    }
  };

  const grantEffect = async () => {
    const targets = effectWholeParty ? party.map((p) => p.id) : [effectCharId];
    await apply({
      rewards: {
        temp_effects: targets.map((character_id) => ({
          character_id,
          effect_template_id: effectTemplateId,
        })),
      },
    });
  };

  const removeItem = async () => {
    if (!removeInvId) return;
    await apply({ punishments: { remove_items: [{ inventory_item_id: removeInvId }] } });
  };

  const selectedHpMember = party.find((p) => p.id === hpCharId);
  const previewHp =
    selectedHpMember?.current_hp != null && selectedHpMember.max_hp != null
      ? Math.max(0, Math.min(selectedHpMember.max_hp, selectedHpMember.current_hp + hpChange))
      : null;

  const requestItemConfirm = () => {
    const item = items.find((i) => i.id === rewardItemId);
    const itemName = item?.name ?? 'item';
    if (wholeParty) {
      setPendingConfirm({
        action: 'item',
        title: 'Grant Item',
        message: `Grant "${itemName}" to the whole party (${party.length} characters)?`,
        confirmLabel: 'Grant',
      });
      return;
    }
    const character = party.find((p) => p.id === rewardCharId);
    setPendingConfirm({
      action: 'item',
      title: 'Grant Item',
      message: `Grant "${itemName}" to ${character?.name ?? 'character'}?`,
      confirmLabel: 'Grant',
    });
  };

  const requestRandomConfirm = () => {
    const typeLabel = itemTypeFilterLabel(randomItemType);
    const recipientLabel = randomWholeParty
      ? `all party members (${party.length})`
      : (party.find((p) => p.id === randomCharId)?.name ?? 'character');
    setPendingConfirm({
      action: 'random',
      title: 'Grant Random Loot',
      message: `Grant tier ${randomTier} random ${typeLabel} loot (×${randomCount}) to ${recipientLabel}?`,
      confirmLabel: 'Grant',
    });
  };

  const requestBuffConfirm = () => {
    const character = party.find((p) => p.id === buffCharId);
    const label = buffLabel || 'Buff';
    const sign = tab === 'buff' ? '+' : '-';
    const value = Math.abs(buffValue);
    setPendingConfirm({
      action: tab === 'buff' ? 'buff' : 'debuff',
      title: tab === 'buff' ? 'Apply Buff' : 'Apply Debuff',
      message: `Apply ${label} (${sign}${value} ${buffStat}) to ${character?.name ?? 'character'}?`,
      confirmLabel: 'Apply',
    });
  };

  const requestHpConfirm = () => {
    if (hpChange === 0) return;
    const hpConfirmMessage = selectedHpMember
      ? hpChange > 0
        ? `Restore ${hpChange} HP to ${selectedHpMember.name}?${
            previewHp != null
              ? ` (${selectedHpMember.current_hp}/${selectedHpMember.max_hp} → ${previewHp}/${selectedHpMember.max_hp})`
              : ''
          }`
        : `Reduce ${selectedHpMember.name}'s HP by ${Math.abs(hpChange)}?${
            previewHp != null
              ? ` (${selectedHpMember.current_hp}/${selectedHpMember.max_hp} → ${previewHp}/${selectedHpMember.max_hp})`
              : ''
          }`
      : 'Apply HP change?';
    setPendingConfirm({
      action: 'hp',
      title: 'Apply HP Change',
      message: hpConfirmMessage,
      confirmLabel: 'Apply',
    });
  };

  const requestXpConfirm = () => {
    if (xpAmount <= 0) return;
    if (xpWholeParty) {
      setPendingConfirm({
        action: 'xp',
        title: 'Grant XP',
        message: `Grant ${xpAmount} XP to each party member (${party.length} characters)?`,
        confirmLabel: 'Grant',
      });
      return;
    }
    const character = party.find((p) => p.id === xpCharId);
    setPendingConfirm({
      action: 'xp',
      title: 'Grant XP',
      message: `Grant ${xpAmount} XP to ${character?.name ?? 'character'}?`,
      confirmLabel: 'Grant',
    });
  };

  const requestEffectConfirm = () => {
    const template = effects.find((e) => e.id === effectTemplateId);
    if (!template) return;
    const desc = template.description ? ` — ${template.description}` : '';
    if (effectWholeParty) {
      setPendingConfirm({
        action: 'effect',
        title: 'Apply Effect',
        message: `Apply "${template.name}"${desc} to the whole party (${party.length} characters)?`,
        confirmLabel: 'Apply',
      });
      return;
    }
    const character = party.find((p) => p.id === effectCharId);
    setPendingConfirm({
      action: 'effect',
      title: 'Apply Effect',
      message: `Apply "${template.name}"${desc} to ${character?.name ?? 'character'}?`,
      confirmLabel: 'Apply',
    });
  };

  const requestCurrencyConfirm = () => {
    if (currencyAmount <= 0) return;
    const actionLabel = currencyReduce ? 'Reduce currency' : 'Grant currency';
    if (currencyWholeParty) {
      setPendingConfirm({
        action: 'currency',
        title: actionLabel,
        message: `${currencyReduce ? 'Remove' : 'Grant'} ${currencyAmount} copper ${currencyReduce ? 'from' : 'to'} each party member (${party.length} characters)?`,
        confirmLabel: currencyReduce ? 'Reduce' : 'Grant',
      });
      return;
    }
    const character = party.find((p) => p.id === currencyCharId);
    setPendingConfirm({
      action: 'currency',
      title: actionLabel,
      message: `${currencyReduce ? 'Remove' : 'Grant'} ${currencyAmount} copper ${currencyReduce ? 'from' : 'to'} ${character?.name ?? 'character'}?`,
      confirmLabel: currencyReduce ? 'Reduce' : 'Grant',
    });
  };

  const requestRemoveConfirm = () => {
    if (!removeInvId) return;
    const character = party.find((p) => p.id === removeCharId);
    const item = charInventory.find((i) => i.id === removeInvId);
    setPendingConfirm({
      action: 'remove',
      title: 'Remove Item',
      message: `Remove "${item?.name ?? 'item'}" from ${character?.name ?? 'character'}'s inventory?`,
      confirmLabel: 'Remove',
    });
  };

  const confirmPending = async () => {
    if (!pendingConfirm) return;
    const { action } = pendingConfirm;
    setPendingConfirm(null);
    try {
      switch (action) {
        case 'item':
          await grantItem();
          break;
        case 'random':
          await grantRandom();
          break;
        case 'buff':
          await grantBuff();
          break;
        case 'debuff':
          await grantDebuff();
          break;
        case 'hp':
          await applyHpChange();
          break;
        case 'xp':
          await grantXp();
          break;
        case 'currency':
          await applyCurrency();
          break;
        case 'effect':
          await grantEffect();
          break;
        case 'remove':
          await removeItem();
          break;
      }
    } catch {
      // applyError is set in apply()
    }
  };

  const tabs = [
    { id: 'item' as const, label: 'Item' },
    { id: 'random' as const, label: 'Random' },
    { id: 'buff' as const, label: 'Buff' },
    { id: 'debuff' as const, label: 'Debuff' },
    { id: 'effect' as const, label: 'Effect' },
    { id: 'hp' as const, label: 'HP' },
    { id: 'xp' as const, label: 'XP' },
    { id: 'currency' as const, label: 'Currency' },
    { id: 'remove' as const, label: 'Remove' },
  ];

  return (
    <div className={compact ? '' : 'card'}>
      {!compact && <h2 className="mb-2 font-semibold text-dungeon-300">Rewards & Punishments</h2>}
      {rewardsBlocked && (
        <p className="mb-2 rounded border border-amber-800/60 bg-amber-950/30 p-2 text-sm text-amber-300">
          {REWARDS_BLOCKED_DURING_BATTLE}
        </p>
      )}
      {applyError && <p className="mb-2 text-sm text-red-400">{applyError}</p>}
      <fieldset disabled={rewardsBlocked} className={rewardsBlocked ? 'opacity-60' : undefined}>
      <div className="mb-2 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`px-2 py-1 text-xs rounded ${tab === t.id ? 'bg-dungeon-600 text-dungeon-200' : 'bg-dungeon-800 text-stone-400'}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'item' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wholeParty} onChange={(e) => setWholeParty(e.target.checked)} />
            Whole party
          </label>
          {!wholeParty && (
            <select className="input" value={rewardCharId} onChange={(e) => setRewardCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select className="input" value={rewardItemId} onChange={(e) => setRewardItemId(+e.target.value)}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name} (T{i.tier})</option>)}
          </select>
          <button className="btn-secondary w-full" onClick={requestItemConfirm}>Grant Item</button>
        </div>
      )}

      {tab === 'random' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={randomWholeParty} onChange={(e) => setRandomWholeParty(e.target.checked)} />
            Whole party
          </label>
          {!randomWholeParty && (
            <select className="input" value={randomCharId} onChange={(e) => setRandomCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Tier</label>
              <input className="input" type="number" min={1} max={5} value={randomTier} onChange={(e) => setRandomTier(+e.target.value)} />
            </div>
            <div>
              <label className="label">Count</label>
              <input className="input" type="number" min={1} max={5} value={randomCount} onChange={(e) => setRandomCount(+e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Item type</label>
            <select className="input" value={randomItemType} onChange={(e) => setRandomItemType(e.target.value as ItemTypeFilter)}>
              {ITEM_TYPE_FILTER_OPTIONS.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>
          <button className="btn-secondary w-full" onClick={requestRandomConfirm}>Grant Random Loot</button>
        </div>
      )}

      {(tab === 'buff' || tab === 'debuff') && (
        <div className="space-y-2">
          <select className="input" value={buffCharId} onChange={(e) => setBuffCharId(+e.target.value)}>
            {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input" placeholder="Label" value={buffLabel} onChange={(e) => setBuffLabel(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <select className="input" value={buffStat} onChange={(e) => setBuffStat(e.target.value)}>
              {STAT_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input className="input" type="number" value={buffValue} onChange={(e) => setBuffValue(+e.target.value)} />
          </div>
          <button className={tab === 'buff' ? 'btn-secondary w-full' : 'btn-danger w-full'} onClick={requestBuffConfirm}>
            Apply {tab === 'buff' ? 'Buff' : 'Debuff'}
          </button>
        </div>
      )}

      {tab === 'effect' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={effectWholeParty} onChange={(e) => setEffectWholeParty(e.target.checked)} />
            Whole party
          </label>
          {!effectWholeParty && (
            <select className="input" value={effectCharId} onChange={(e) => setEffectCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select className="input" value={effectTemplateId} onChange={(e) => setEffectTemplateId(+e.target.value)}>
            {effects.filter((e) => e.is_buff).length > 0 && (
              <optgroup label="Buffs">
                {effects.filter((e) => e.is_buff).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}{e.description ? ` — ${e.description}` : ''}</option>
                ))}
              </optgroup>
            )}
            {effects.filter((e) => !e.is_buff).length > 0 && (
              <optgroup label="Debuffs">
                {effects.filter((e) => !e.is_buff).map((e) => (
                  <option key={e.id} value={e.id}>{e.name}{e.description ? ` — ${e.description}` : ''}</option>
                ))}
              </optgroup>
            )}
          </select>
          {effects.length === 0 && (
            <p className="text-xs text-stone-500">No effect templates yet. Create them on the Effects page.</p>
          )}
          <button className="btn-secondary w-full" onClick={requestEffectConfirm} disabled={!effectTemplateId}>
            Apply Effect
          </button>
        </div>
      )}

      {tab === 'hp' && (
        <div className="space-y-2">
          <select className="input" value={hpCharId} onChange={(e) => setHpCharId(+e.target.value)}>
            {party.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.current_hp != null && p.max_hp != null ? ` (HP ${p.current_hp}/${p.max_hp})` : ''}
              </option>
            ))}
          </select>
          {selectedHpMember?.current_hp != null && selectedHpMember.max_hp != null && (
            <p className="text-sm text-dungeon-300">
              {selectedHpMember.name}: HP {selectedHpMember.current_hp} / {selectedHpMember.max_hp}
            </p>
          )}
          <div>
            <label className="label">HP change</label>
            <input
              className="input"
              type="number"
              value={hpChange}
              onChange={(e) => setHpChange(+e.target.value)}
              placeholder="e.g. -5 damage, +5 heal"
            />
            <p className="mt-1 text-xs text-stone-500">
              Negative reduces current HP; positive restores HP (capped at max). Does not change max HP.
            </p>
          </div>
          <button
            className={hpChange >= 0 ? 'btn-secondary w-full' : 'btn-danger w-full'}
            onClick={requestHpConfirm}
            disabled={hpChange === 0}
          >
            Apply HP Change
          </button>
        </div>
      )}

      {tab === 'xp' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={xpWholeParty} onChange={(e) => setXpWholeParty(e.target.checked)} />
            Whole party (same amount each)
          </label>
          {!xpWholeParty && (
            <select className="input" value={xpCharId} onChange={(e) => setXpCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div>
            <label className="label">XP amount</label>
            <input className="input" type="number" min={1} value={xpAmount} onChange={(e) => setXpAmount(+e.target.value)} />
          </div>
          <button className="btn-secondary w-full" onClick={requestXpConfirm} disabled={xpAmount <= 0}>
            Grant XP
          </button>
        </div>
      )}

      {tab === 'currency' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={currencyWholeParty} onChange={(e) => setCurrencyWholeParty(e.target.checked)} />
            Whole party (same amount each)
          </label>
          {!currencyWholeParty && (
            <select className="input" value={currencyCharId} onChange={(e) => setCurrencyCharId(+e.target.value)}>
              {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div>
            <label className="label">Amount (copper)</label>
            <input className="input" type="number" min={1} value={currencyAmount} onChange={(e) => setCurrencyAmount(+e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={currencyReduce} onChange={(e) => setCurrencyReduce(e.target.checked)} />
            Reduce instead of grant
          </label>
          <button
            className={currencyReduce ? 'btn-danger w-full' : 'btn-secondary w-full'}
            onClick={requestCurrencyConfirm}
            disabled={currencyAmount <= 0}
          >
            {currencyReduce ? 'Reduce Currency' : 'Grant Currency'}
          </button>
        </div>
      )}

      </fieldset>

      {pendingConfirm && (
        <ConfirmDialog
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={confirmPending}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {tab === 'remove' && (
        <div className="space-y-2">
          <select className="input" value={removeCharId} onChange={(e) => setRemoveCharId(+e.target.value)}>
            {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="input" value={removeInvId} onChange={(e) => setRemoveInvId(+e.target.value)}>
            <option value={0}>Select item...</option>
            {charInventory.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <button className="btn-danger w-full" onClick={requestRemoveConfirm} disabled={!removeInvId}>Remove Item</button>
        </div>
      )}
    </div>
  );
}

export function buildAdvanceRewards(
  pendingRewards: RewardsPayload | null,
): { rewards?: Record<string, unknown>; punishments?: Record<string, unknown> } {
  if (!pendingRewards) return {};
  return {
    rewards: pendingRewards.rewards,
    punishments: pendingRewards.punishments,
  };
}

type OutcomeRewardType = 'none' | 'xp' | 'currency' | 'random' | 'effect' | 'hp' | 'currency_loss';

export function formatOutcomeSummary(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload) return [];
  const lines: string[] = [];

  const xp = payload.xp as { amount?: number; whole_party?: boolean }[] | undefined;
  if (xp?.length) {
    for (const entry of xp) {
      if (typeof entry.amount === 'number' && entry.amount > 0) {
        lines.push(`+${entry.amount} XP${entry.whole_party ? ' (whole party)' : ''}`);
      }
    }
  }

  const wallet = payload.wallet as { amount?: number; whole_party?: boolean }[] | undefined;
  if (wallet?.length) {
    for (const entry of wallet) {
      if (typeof entry.amount === 'number' && entry.amount > 0) {
        lines.push(`+${entry.amount} copper${entry.whole_party ? ' (whole party)' : ''}`);
      }
    }
  }

  const randomTier = payload.random_tier as {
    tier?: number;
    count?: number;
    whole_party?: boolean;
    character_ids?: number[];
    item_type?: string;
  }[] | undefined;
  if (randomTier?.length) {
    for (const entry of randomTier) {
      const tier = entry.tier ?? 1;
      const count = entry.count ?? 1;
      const typePart = entry.item_type ? ` ${itemTypeFilterLabel(entry.item_type)}` : '';
      const who = entry.whole_party !== false && !entry.character_ids?.length
        ? ' (whole party)'
        : entry.character_ids?.length === 1
          ? ''
          : entry.character_ids?.length
            ? ` (${entry.character_ids.length} characters)`
            : ' (whole party)';
      lines.push(`Random tier ${tier}${typePart} loot ×${count}${who}`);
    }
  }

  const tempEffects = payload.temp_effects as { effect_template_id?: number; whole_party?: boolean }[] | undefined;
  if (tempEffects?.length) {
    for (const entry of tempEffects) {
      lines.push(`Party effect applied${entry.whole_party ? ' (whole party)' : ''}`);
    }
  }

  const hpReduction = payload.hp_reduction as { amount?: number; whole_party?: boolean }[] | undefined;
  if (hpReduction?.length) {
    for (const entry of hpReduction) {
      if (typeof entry.amount === 'number' && entry.amount !== 0) {
        lines.push(`${entry.amount > 0 ? '+' : ''}${entry.amount} HP${entry.whole_party ? ' (whole party)' : ''}`);
      }
    }
  }

  const walletReduction = payload.wallet_reduction as { amount?: number; whole_party?: boolean }[] | undefined;
  if (walletReduction?.length) {
    for (const entry of walletReduction) {
      if (typeof entry.amount === 'number' && entry.amount > 0) {
        lines.push(`−${entry.amount} copper${entry.whole_party ? ' (whole party)' : ''}`);
      }
    }
  }

  return lines;
}

export function EventOutcomeRewardBuilder({
  mode,
  value,
  onChange,
  effects,
}: {
  mode: 'rewards' | 'punishments';
  value?: Record<string, unknown> | null;
  onChange: (value: Record<string, unknown> | undefined) => void;
  effects: EffectTemplate[];
}) {
  const detectType = (): OutcomeRewardType => {
    if (!value) return 'none';
    if (mode === 'rewards') {
      if (value.xp) return 'xp';
      if (value.wallet) return 'currency';
      if (value.random_tier) return 'random';
      if (value.temp_effects) return 'effect';
    } else {
      if (value.hp_reduction) return 'hp';
      if (value.wallet_reduction) return 'currency_loss';
    }
    return 'none';
  };

  const [enabled, setEnabled] = useState(detectType() !== 'none');
  const [rewardType, setRewardType] = useState<OutcomeRewardType>(detectType() === 'none' ? (mode === 'rewards' ? 'xp' : 'hp') : detectType());
  const [xpAmount, setXpAmount] = useState(100);
  const [currencyAmount, setCurrencyAmount] = useState(100);
  const [tier, setTier] = useState(1);
  const [randomCount, setRandomCount] = useState(1);
  const [randomItemType, setRandomItemType] = useState<ItemTypeFilter>('all');
  const [effectTemplateId, setEffectTemplateId] = useState(effects[0]?.id || 0);
  const [hpChange, setHpChange] = useState(-5);

  useEffect(() => {
    if (effects[0]) setEffectTemplateId(effects[0].id);
  }, [effects]);

  useEffect(() => {
    if (!enabled) {
      onChange(undefined);
      return;
    }
    if (mode === 'rewards') {
      if (rewardType === 'xp' && xpAmount > 0) {
        onChange({ xp: [{ amount: xpAmount, whole_party: true }] });
        return;
      }
      if (rewardType === 'currency' && currencyAmount > 0) {
        onChange({ wallet: [{ amount: currencyAmount, whole_party: true }] });
        return;
      }
      if (rewardType === 'random') {
        const entry: Record<string, unknown> = { tier, count: randomCount, whole_party: true };
        if (randomItemType !== 'all') entry.item_type = randomItemType;
        onChange({ random_tier: [entry] });
        return;
      }
      if (rewardType === 'effect' && effectTemplateId) {
        onChange({ temp_effects: [{ effect_template_id: effectTemplateId, whole_party: true }] });
        return;
      }
    } else {
      if (rewardType === 'hp' && hpChange !== 0) {
        onChange({ hp_reduction: [{ amount: hpChange, whole_party: true }] });
        return;
      }
      if (rewardType === 'currency_loss' && currencyAmount > 0) {
        onChange({ wallet_reduction: [{ amount: currencyAmount, whole_party: true }] });
        return;
      }
    }
    onChange(undefined);
  }, [
    enabled,
    mode,
    rewardType,
    xpAmount,
    currencyAmount,
    tier,
    randomCount,
    randomItemType,
    effectTemplateId,
    hpChange,
  ]);

  const rewardOptions: OutcomeRewardType[] = mode === 'rewards'
    ? ['xp', 'currency', 'random', 'effect']
    : ['hp', 'currency_loss'];

  return (
    <div className="space-y-2 rounded border border-dungeon-700 p-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {mode === 'rewards' ? 'Apply victory rewards' : 'Apply defeat punishments'}
      </label>
      {enabled && (
        <>
          <select
            className="input"
            value={rewardType}
            onChange={(e) => setRewardType(e.target.value as OutcomeRewardType)}
          >
            {rewardOptions.map((t) => (
              <option key={t} value={t}>
                {t === 'xp' && 'Grant XP (whole party)'}
                {t === 'currency' && 'Grant copper (whole party)'}
                {t === 'random' && 'Random tier loot (whole party)'}
                {t === 'effect' && 'Apply effect (whole party)'}
                {t === 'hp' && 'HP change (whole party)'}
                {t === 'currency_loss' && 'Reduce copper (whole party)'}
              </option>
            ))}
          </select>
          {rewardType === 'xp' && (
            <div>
              <label className="label">XP per character</label>
              <input className="input" type="number" min={1} value={xpAmount} onChange={(e) => setXpAmount(+e.target.value)} />
            </div>
          )}
          {(rewardType === 'currency' || rewardType === 'currency_loss') && (
            <div>
              <label className="label">Copper per character</label>
              <input className="input" type="number" min={1} value={currencyAmount} onChange={(e) => setCurrencyAmount(+e.target.value)} />
            </div>
          )}
          {rewardType === 'random' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Tier</label>
                  <input className="input" type="number" min={1} max={5} value={tier} onChange={(e) => setTier(+e.target.value)} />
                </div>
                <div>
                  <label className="label">Count each</label>
                  <input className="input" type="number" min={1} max={5} value={randomCount} onChange={(e) => setRandomCount(+e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Item type</label>
                <select className="input" value={randomItemType} onChange={(e) => setRandomItemType(e.target.value as ItemTypeFilter)}>
                  {ITEM_TYPE_FILTER_OPTIONS.map(({ id, label }) => (
                    <option key={id} value={id}>{label}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          {rewardType === 'effect' && (
            <select className="input" value={effectTemplateId} onChange={(e) => setEffectTemplateId(+e.target.value)}>
              {effects.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          {rewardType === 'hp' && (
            <div>
              <label className="label">HP change (negative = damage)</label>
              <input className="input" type="number" value={hpChange} onChange={(e) => setHpChange(+e.target.value)} />
            </div>
          )}
          {value && formatOutcomeSummary(value).length > 0 && (
            <p className="text-xs text-stone-500">{formatOutcomeSummary(value).join(' · ')}</p>
          )}
        </>
      )}
    </div>
  );
}
