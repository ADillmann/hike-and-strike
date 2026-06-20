import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { AlertDialog } from '../../components/AlertDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SOLVER_MODALS } from '../../components/secrets/solverRegistry';
import { EQUIP_SLOTS, slotLabel } from '../../game/equipment';
import { Layout } from '../../components/Layout';
import type { Character } from '../../api/client';

type InvItem = Character['inventory'][number];

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

function formatStats(stats: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (stats.passive) lines.push('Passive — works from bag');
  if (stats.two_handed) lines.push('Two-handed — needs both hands');
  if (typeof stats.damage === 'number') lines.push(`Damage ${stats.damage}`);
  if (typeof stats.armor_bonus === 'number') lines.push(`Armor +${stats.armor_bonus}`);
  if (typeof stats.heal === 'number' && stats.heal > 0) lines.push(`Heals ${stats.heal} HP when used`);
  for (const key of ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'] as const) {
    const val = stats[key];
    if (typeof val === 'number' && val !== 0) lines.push(`${key} ${val > 0 ? '+' : ''}${val}`);
  }
  if (stats.finesse) lines.push('Finesse weapon');
  return lines;
}

function passiveHint(item: InvItem): string {
  const type = (item.item_type || '').toLowerCase();
  if (type === 'secret') return 'Mysterious item — examine or solve';
  if (type === 'key') return 'Quest item — keep in bag';
  if (type === 'spell') return 'Spell scroll — keep in bag';
  return 'Passive effect while in bag';
}

function equipSlotLabel(item: InvItem, slot: string): string {
  if (item.stats.two_handed && (slot === 'left_hand' || slot === 'right_hand')) {
    return 'Equip (two-handed)';
  }
  return `Equip ${slotLabel(slot)}`;
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
  const [giveOpen, setGiveOpen] = useState(false);
  const [targetId, setTargetId] = useState(() => party.find((p) => !p.is_self)?.character_id || 0);
  const statLines = formatStats(item.stats);
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
            {showQuantity(item) && <span className="text-stone-400"> ×{item.quantity}</span>}
          </div>
          <div className="text-xs text-stone-500">
            {item.item_type} · Tier {item.tier}
            {item.equipped_slot && (
              <>
                {' · '}
                {item.stats.two_handed && item.equipped_slot.includes('hand')
                  ? 'Both hands (two-handed)'
                  : slotLabel(item.equipped_slot)}
              </>
            )}
          </div>
        </div>
        {inBag && action === 'passive' && (
          <span className="rounded bg-dungeon-700 px-2 py-0.5 text-xs text-dungeon-300">Bag item</span>
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
          <button type="button" className="btn-secondary text-xs" onClick={() => onUnequip(item.id)}>Unequip</button>
        )}

        {inBag && action === 'use' && onUse && (
          <button type="button" className="btn-primary text-xs" onClick={() => onUse(item.id)}>Use</button>
        )}

        {inBag && action === 'secret' && !revealed && onExamine && (
          <button type="button" className="btn-primary text-xs" onClick={() => onExamine(item)}>Examine</button>
        )}

        {inBag && action === 'secret' && revealed && onSolve && (
          <button type="button" className="btn-secondary text-xs" onClick={() => onSolve(item)}>Solve</button>
        )}

        {inBag && action === 'equip' && onEquip && equipOptions.map((slot) => (
          <button
            key={slot}
            type="button"
            className="btn-secondary text-xs"
            onClick={() => onEquip(item.id, slot)}
          >
            {equipSlotLabel(item, slot)}
          </button>
        ))}

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
                  {party.filter((p) => !p.is_self).map((p) => (
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

function EquipmentPanel({
  inventory,
  onUnequip,
}: {
  inventory: InvItem[];
  onUnequip: (id: number) => void;
}) {
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
            <div className="text-xs uppercase text-stone-500">{slotLabel(slot)}</div>
            {item ? (
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-medium text-dungeon-200">{item.name}</span>
                {!(item.stats.two_handed && slot === 'right_hand') && (
                  <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => onUnequip(item.id)}>
                    Unequip
                  </button>
                )}
                {item.stats.two_handed && slot === 'right_hand' && (
                  <span className="text-xs text-stone-500">↔ two-handed</span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-stone-600 italic">Empty</p>
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
      setError(err instanceof Error ? err.message : 'Could not examine item');
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
      setError(err instanceof Error ? err.message : 'Could not solve secret');
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
    const slot = item.equipped_slot ? ` from ${slotLabel(item.equipped_slot)}` : '';
    return `${item.name}${qty}${slot}`;
  };

  if (!character) return <Layout title="Inventory">Loading...</Layout>;

  const equipped = character.inventory.filter((i) => i.equipped_slot);
  const bag = character.inventory.filter((i) => !i.equipped_slot);
  const hasParty = party.some((p) => !p.is_self);

  return (
    <Layout title="Inventory">
      {error && <p className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-red-400">{error}</p>}

      {partyLoaded && !hasParty && (
        <p className="mb-4 rounded border border-dungeon-700 bg-dungeon-900/50 p-3 text-sm text-stone-400">
          To give items to others, your character must be in a group with at least one other player (ask the Master on the Groups page).
        </p>
      )}
      {hasParty && (
        <p className="mb-4 text-sm text-stone-500">Group: {party.filter((p) => !p.is_self).map((p) => p.name).join(', ') || 'just you'}</p>
      )}

      <section className="card mb-4">
        <h2 className="mb-3 font-semibold text-dungeon-300">Equipment</h2>
        <EquipmentPanel inventory={character.inventory} onUnequip={unequip} />
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
          title="Discard item?"
          message={`Throw away ${trashLabel(trashItem)}? This cannot be undone.`}
          confirmLabel="Discard"
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

      {solveRewardSummary !== null && (
        <AlertDialog
          title="Secret solved!"
          onClose={() => setSolveRewardSummary(null)}
        >
          {solveRewardSummary.length > 0 ? (
            <ul className="list-inside list-disc space-y-1 text-sm text-stone-300">
              {solveRewardSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">Nothing else was found inside.</p>
          )}
        </AlertDialog>
      )}
    </Layout>
  );
}
