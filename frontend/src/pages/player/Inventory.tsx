import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';
import type { Character } from '../../api/client';

type InvItem = Character['inventory'][number];

interface PartyMember {
  character_id: number;
  name: string;
}

type ItemAction = 'equip' | 'use' | 'passive' | 'none';

function getItemAction(item: InvItem): ItemAction {
  if (item.equipped_slot) return 'none';
  const type = (item.item_type || '').toLowerCase();
  if (type === 'consumable') return 'use';
  if (type === 'key' || type === 'spell') return 'passive';
  if (item.bag_only || item.stats.passive) return 'passive';
  if (type === 'weapon' || type === 'armor') return 'equip';
  if (type === 'accessory') {
    if (item.stats.damage || item.stats.armor_bonus) return 'equip';
    return 'passive';
  }
  if (item.equippable === true) return 'equip';
  return 'passive';
}

function showQuantity(item: InvItem): boolean {
  return (item.item_type || '').toLowerCase() === 'consumable' && item.quantity > 1;
}

function formatStats(stats: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (stats.passive) lines.push('Passive — works from bag');
  if (typeof stats.damage === 'number') lines.push(`Damage ${stats.damage}`);
  if (typeof stats.armor_bonus === 'number') lines.push(`Armor +${stats.armor_bonus}`);
  if (typeof stats.heal === 'number') lines.push(`Heals ${stats.heal} HP when used`);
  for (const key of ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'] as const) {
    const val = stats[key];
    if (typeof val === 'number' && val !== 0) lines.push(`${key} ${val > 0 ? '+' : ''}${val}`);
  }
  if (stats.finesse) lines.push('Finesse weapon');
  return lines;
}

function equipLabel(item: InvItem): string {
  const type = (item.item_type || '').toLowerCase();
  if (type === 'weapon') return 'Equip weapon';
  if (type === 'armor') return 'Equip armor';
  return 'Equip';
}

function equipSlot(item: InvItem): string {
  const type = (item.item_type || '').toLowerCase();
  if (type === 'weapon') return 'weapon';
  if (type === 'armor') return 'armor';
  return 'accessory';
}

function passiveHint(item: InvItem): string {
  const type = (item.item_type || '').toLowerCase();
  if (type === 'key') return 'Quest item — keep in bag';
  if (type === 'spell') return 'Spell scroll — keep in bag';
  if (type === 'consumable') return '';
  return 'Passive effect while in bag';
}

function ItemCard({
  item,
  party,
  hasParty,
  onEquip,
  onUnequip,
  onUse,
  onGive,
  onTrash,
}: {
  item: InvItem;
  party: PartyMember[];
  hasParty: boolean;
  onEquip?: (id: number, slot: string) => void;
  onUnequip?: (id: number) => void;
  onUse?: (id: number) => void;
  onGive?: (item: InvItem, targetId: number) => void;
  onTrash?: (item: InvItem) => void;
}) {
  const [giveOpen, setGiveOpen] = useState(false);
  const [targetId, setTargetId] = useState(party[0]?.character_id || 0);
  const statLines = formatStats(item.stats);
  const inBag = !item.equipped_slot;
  const action = getItemAction(item);

  useEffect(() => {
    if (party[0]) setTargetId(party[0].character_id);
  }, [party]);

  return (
    <div className="mb-3 rounded border border-dungeon-600 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-dungeon-200">
            {item.name}
            {showQuantity(item) && <span className="text-stone-400"> ×{item.quantity}</span>}
          </div>
          <div className="text-xs text-stone-500">
            {item.item_type} · Tier {item.tier}
            {item.equipped_slot && ` · ${item.equipped_slot}`}
          </div>
        </div>
        {inBag && action === 'passive' && (
          <span className="rounded bg-dungeon-700 px-2 py-0.5 text-xs text-dungeon-300">Bag item</span>
        )}
      </div>

      {item.description && (
        <p className="mt-2 text-stone-400">{item.description}</p>
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
          <button type="button" className="btn-secondary text-xs" onClick={() => onUnequip(item.id)}>Unequip</button>
        )}

        {inBag && action === 'use' && onUse && (
          <button type="button" className="btn-primary text-xs" onClick={() => onUse(item.id)}>Use</button>
        )}

        {inBag && action === 'equip' && onEquip && (
          <button type="button" className="btn-secondary text-xs" onClick={() => onEquip(item.id, equipSlot(item))}>
            {equipLabel(item)}
          </button>
        )}

        {inBag && action === 'passive' && passiveHint(item) && (
          <span className="text-xs text-stone-500 italic">{passiveHint(item)}</span>
        )}

        {inBag && onGive && (
          <>
            {!giveOpen ? (
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={!hasParty}
                title={hasParty ? 'Give to a group member' : 'You must be in a group with other players'}
                onClick={() => hasParty && setGiveOpen(true)}
              >
                Give to…
              </button>
            ) : (
              <div className="flex w-full flex-wrap items-center gap-1">
                <select className="input flex-1 py-1 text-xs" value={targetId} onChange={(e) => setTargetId(+e.target.value)}>
                  {party.map((p) => (
                    <option key={p.character_id} value={p.character_id}>{p.name}</option>
                  ))}
                </select>
                <button type="button" className="btn-primary text-xs" onClick={() => { onGive(item, targetId); setGiveOpen(false); }}>Give</button>
                <button type="button" className="btn-secondary text-xs" onClick={() => setGiveOpen(false)}>Cancel</button>
              </div>
            )}
          </>
        )}

        {onTrash && (
          <button type="button" className="btn-danger text-xs" onClick={() => onTrash(item)}>Trash</button>
        )}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [party, setParty] = useState<PartyMember[]>([]);
  const [partyLoaded, setPartyLoaded] = useState(false);
  const [error, setError] = useState('');
  const [trashItem, setTrashItem] = useState<InvItem | null>(null);
  const navigate = useNavigate();

  const load = () => {
    api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));
    api.get<PartyMember[]>('/characters/me/party')
      .then((members) => { setParty(members); setPartyLoaded(true); })
      .catch(() => { setParty([]); setPartyLoaded(true); });
  };

  useEffect(() => { load(); }, [navigate]);

  const equip = async (inventoryItemId: number, slot: string) => {
    setError('');
    try {
      await api.post('/characters/me/equip', { inventory_item_id: inventoryItemId, slot });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not equip');
    }
  };

  const unequip = async (inventoryItemId: number) => {
    await api.post('/characters/me/equip', { inventory_item_id: inventoryItemId, slot: null });
    load();
  };

  const useItem = async (inventoryItemId: number) => {
    setError('');
    try {
      await api.post('/characters/me/use-item', { inventory_item_id: inventoryItemId });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use item');
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
      setError(err instanceof Error ? err.message : 'Could not give item');
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
      setError(err instanceof Error ? err.message : 'Could not discard item');
    }
  };

  const trashLabel = (item: InvItem) => {
    const qty = showQuantity(item) ? ` (×${item.quantity})` : '';
    const slot = item.equipped_slot ? ` from ${item.equipped_slot}` : '';
    return `${item.name}${qty}${slot}`;
  };

  if (!character) return <Layout title="Inventory">Loading...</Layout>;

  const equipped = character.inventory.filter((i) => i.equipped_slot);
  const bag = character.inventory.filter((i) => !i.equipped_slot);
  const hasParty = party.length > 0;

  return (
    <Layout title="Inventory">
      {error && <p className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-red-400">{error}</p>}

      {partyLoaded && !hasParty && (
        <p className="mb-4 rounded border border-dungeon-700 bg-dungeon-900/50 p-3 text-sm text-stone-400">
          To give items to others, your character must be in a group with at least one other player (ask the Master to add you on the Groups page).
        </p>
      )}
      {hasParty && (
        <p className="mb-4 text-sm text-stone-500">
          Group: {party.map((p) => p.name).join(', ')}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Equipped</h2>
          {equipped.length === 0 ? (
            <p className="text-stone-400">Nothing equipped</p>
          ) : (
            equipped.map((i) => (
              <ItemCard key={i.id} item={i} party={party} hasParty={hasParty} onUnequip={unequip} onGive={giveItem} onTrash={setTrashItem} />
            ))
          )}
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Bag</h2>
          {bag.length === 0 ? (
            <p className="text-stone-400">Empty</p>
          ) : (
            bag.map((i) => (
              <ItemCard
                key={i.id}
                item={i}
                party={party}
                hasParty={hasParty}
                onEquip={equip}
                onUse={useItem}
                onGive={giveItem}
                onTrash={setTrashItem}
              />
            ))
          )}
        </section>
      </div>

      {trashItem && (
        <ConfirmDialog
          title="Discard item?"
          message={`Throw away ${trashLabel(trashItem)}? This cannot be undone.`}
          confirmLabel="Discard"
          onConfirm={discardItem}
          onCancel={() => setTrashItem(null)}
        />
      )}
    </Layout>
  );
}
