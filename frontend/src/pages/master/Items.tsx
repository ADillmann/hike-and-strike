import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface Item {
  id: number;
  name: string;
  item_type: string;
  tier: number;
  description: string;
  is_system: boolean;
}

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ name: '', item_type: 'weapon', tier: 1, description: '', damage: 3, armor_bonus: 0 });

  const load = () => api.get<Item[]>('/items').then(setItems);

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const stats: Record<string, number> = {};
    if (form.item_type === 'weapon') stats.damage = form.damage;
    if (form.item_type === 'armor') stats.armor_bonus = form.armor_bonus;
    await api.post('/items', { name: form.name, item_type: form.item_type, tier: form.tier, description: form.description, stats });
    setForm({ name: '', item_type: 'weapon', tier: 1, description: '', damage: 3, armor_bonus: 0 });
    load();
  };

  return (
    <Layout title="Item Pool">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Custom Item</h2>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select className="input" value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })}>
            {['weapon', 'armor', 'spell', 'consumable', 'key'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="input" type="number" min={1} max={5} placeholder="Tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: +e.target.value })} />
          {form.item_type === 'weapon' && <input className="input" type="number" placeholder="Damage" value={form.damage} onChange={(e) => setForm({ ...form, damage: +e.target.value })} />}
          {form.item_type === 'armor' && <input className="input" type="number" placeholder="Armor bonus" value={form.armor_bonus} onChange={(e) => setForm({ ...form, armor_bonus: +e.target.value })} />}
          <textarea className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="btn-primary" type="submit">Add Item</button>
        </form>
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Item Pool</h2>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded border border-dungeon-600 p-2 text-sm">
                <span className="font-medium">{item.name}</span>
                <span className="ml-2 text-stone-500">T{item.tier} {item.item_type}</span>
                {item.is_system && <span className="ml-1 text-xs text-dungeon-400">(base)</span>}
                <p className="text-stone-400">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
