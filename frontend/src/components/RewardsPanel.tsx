import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface RewardsPayload {
  rewards?: Record<string, unknown>;
  punishments?: Record<string, unknown>;
}

interface PartyMember {
  id: number;
  name: string;
}

interface Item {
  id: number;
  name: string;
  tier: number;
}

interface InvItem {
  id: number;
  name: string;
  character_id?: number;
}

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];

export function RewardsPanel({
  campaignId,
  party,
  items,
  onApplied,
  compact,
}: {
  campaignId: number;
  party: PartyMember[];
  items: Item[];
  onApplied?: () => void;
  compact?: boolean;
}) {
  const [tab, setTab] = useState<'item' | 'random' | 'buff' | 'debuff' | 'hp' | 'remove'>('item');
  const [rewardCharId, setRewardCharId] = useState(0);
  const [rewardItemId, setRewardItemId] = useState(0);
  const [wholeParty, setWholeParty] = useState(false);
  const [randomTier, setRandomTier] = useState(1);
  const [randomCount, setRandomCount] = useState(1);
  const [buffLabel, setBuffLabel] = useState('');
  const [buffStat, setBuffStat] = useState('strength');
  const [buffValue, setBuffValue] = useState(1);
  const [buffCharId, setBuffCharId] = useState(0);
  const [hpCharId, setHpCharId] = useState(0);
  const [hpHalf, setHpHalf] = useState(true);
  const [hpAmount, setHpAmount] = useState(5);
  const [removeCharId, setRemoveCharId] = useState(0);
  const [removeInvId, setRemoveInvId] = useState(0);
  const [charInventory, setCharInventory] = useState<InvItem[]>([]);

  useEffect(() => {
    if (party[0]) {
      setRewardCharId(party[0].id);
      setBuffCharId(party[0].id);
      setHpCharId(party[0].id);
      setRemoveCharId(party[0].id);
    }
    if (items[0]) setRewardItemId(items[0].id);
  }, [party, items]);

  useEffect(() => {
    if (!removeCharId) return;
    api.get<{ id: number; name: string; inventory: { id: number; name: string }[] }>(`/characters/${removeCharId}`)
      .then((c) => setCharInventory(c.inventory.map((i) => ({ id: i.id, name: i.name, character_id: removeCharId }))))
      .catch(() => setCharInventory([]));
  }, [removeCharId]);

  const apply = async (payload: RewardsPayload) => {
    await api.post(`/campaigns/${campaignId}/rewards`, payload);
    onApplied?.();
  };

  const grantItem = () => {
    const targets = wholeParty ? party.map((p) => p.id) : [rewardCharId];
    apply({
      rewards: {
        items: targets.map((character_id) => ({ character_id, item_template_id: rewardItemId })),
      },
    });
  };

  const grantRandom = () => {
    apply({
      rewards: {
        random_tier: [{ tier: randomTier, count: randomCount, character_ids: party.map((p) => p.id) }],
      },
    });
  };

  const grantBuff = () => {
    apply({
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

  const grantDebuff = () => {
    apply({
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

  const punishHp = () => {
    apply({
      punishments: {
        hp_reduction: [{
          character_id: hpCharId,
          ...(hpHalf ? { half: true } : { amount: hpAmount }),
        }],
      },
    });
  };

  const removeItem = () => {
    if (!removeInvId) return;
    apply({ punishments: { remove_items: [{ inventory_item_id: removeInvId }] } });
  };

  const tabs = [
    { id: 'item' as const, label: 'Item' },
    { id: 'random' as const, label: 'Random' },
    { id: 'buff' as const, label: 'Buff' },
    { id: 'debuff' as const, label: 'Debuff' },
    { id: 'hp' as const, label: 'HP' },
    { id: 'remove' as const, label: 'Remove' },
  ];

  return (
    <div className={compact ? '' : 'card'}>
      {!compact && <h2 className="mb-2 font-semibold text-dungeon-300">Rewards & Punishments</h2>}
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
          <button className="btn-secondary w-full" onClick={grantItem}>Grant Item</button>
        </div>
      )}

      {tab === 'random' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Tier</label>
              <input className="input" type="number" min={1} max={5} value={randomTier} onChange={(e) => setRandomTier(+e.target.value)} />
            </div>
            <div>
              <label className="label">Count each</label>
              <input className="input" type="number" min={1} max={5} value={randomCount} onChange={(e) => setRandomCount(+e.target.value)} />
            </div>
          </div>
          <button className="btn-secondary w-full" onClick={grantRandom}>Grant Random Loot</button>
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
          <button className={tab === 'buff' ? 'btn-secondary w-full' : 'btn-danger w-full'} onClick={tab === 'buff' ? grantBuff : grantDebuff}>
            Apply {tab === 'buff' ? 'Buff' : 'Debuff'}
          </button>
        </div>
      )}

      {tab === 'hp' && (
        <div className="space-y-2">
          <select className="input" value={hpCharId} onChange={(e) => setHpCharId(+e.target.value)}>
            {party.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hpHalf} onChange={(e) => setHpHalf(e.target.checked)} />
            Half HP
          </label>
          {!hpHalf && (
            <input className="input" type="number" min={1} value={hpAmount} onChange={(e) => setHpAmount(+e.target.value)} placeholder="Damage amount" />
          )}
          <button className="btn-danger w-full" onClick={punishHp}>Apply HP Punishment</button>
        </div>
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
          <button className="btn-danger w-full" onClick={removeItem} disabled={!removeInvId}>Remove Item</button>
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
