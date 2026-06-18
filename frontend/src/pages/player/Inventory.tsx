import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';
import type { Character } from '../../api/client';

export default function InventoryPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const navigate = useNavigate();

  const load = () => api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));

  useEffect(() => { load(); }, [navigate]);

  const equip = async (inventoryItemId: number, slot: string | null) => {
    await api.post('/characters/me/equip', { inventory_item_id: inventoryItemId, slot });
    load();
  };

  if (!character) return <Layout title="Inventory">Loading...</Layout>;

  const equipped = character.inventory.filter((i) => i.equipped_slot);
  const bag = character.inventory.filter((i) => !i.equipped_slot);

  return (
    <Layout title="Inventory">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Equipped</h2>
          {equipped.length === 0 ? <p className="text-stone-400">Nothing equipped</p> : equipped.map((i) => (
            <div key={i.id} className="mb-2 flex justify-between rounded border border-dungeon-600 p-2 text-sm">
              <span>{i.name} ({i.equipped_slot})</span>
              <button className="btn-secondary text-xs" onClick={() => equip(i.id, null)}>Unequip</button>
            </div>
          ))}
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Bag</h2>
          {bag.length === 0 ? <p className="text-stone-400">Empty</p> : bag.map((i) => (
            <div key={i.id} className="mb-2 rounded border border-dungeon-600 p-2 text-sm">
              <div className="font-medium">{i.name} x{i.quantity}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {i.item_type === 'weapon' && <button className="btn-secondary text-xs" onClick={() => equip(i.id, 'weapon')}>Equip weapon</button>}
                {i.item_type === 'armor' && <button className="btn-secondary text-xs" onClick={() => equip(i.id, 'armor')}>Equip armor</button>}
                {i.item_type !== 'weapon' && i.item_type !== 'armor' && <button className="btn-secondary text-xs" onClick={() => equip(i.id, 'accessory')}>Equip</button>}
              </div>
            </div>
          ))}
        </section>
      </div>
    </Layout>
  );
}
