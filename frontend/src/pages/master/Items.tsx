import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

interface Item {
  id: number;
  name: string;
  item_type: string;
  tier: number;
  description: string;
  stats: Record<string, unknown>;
  is_system: boolean;
}

const defaultForm = { name: '', item_type: 'weapon', tier: 1, description: '', damage: 3, armor_bonus: 0, passive: false };

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [editing, setEditing] = useState<Item | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => api.get<Item[]>('/items').then(setItems);

  useEffect(() => { load(); }, []);

  const buildStats = (f: typeof defaultForm) => {
    const stats: Record<string, unknown> = {};
    if (f.item_type === 'weapon') stats.damage = f.damage;
    if (f.item_type === 'armor') stats.armor_bonus = f.armor_bonus;
    if (f.passive) stats.passive = true;
    return stats;
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/items', { name: form.name, item_type: form.item_type, tier: form.tier, description: form.description, stats: buildStats(form) });
    setForm(defaultForm);
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.patch(`/items/${editing.id}`, {
      name: editing.name,
      item_type: editing.item_type,
      tier: editing.tier,
      description: editing.description,
      stats: editing.stats,
    });
    setEditing(null);
    load();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/items/${deleteId}`);
    setDeleteId(null);
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.passive} onChange={(e) => setForm({ ...form, passive: e.target.checked })} />
            Passive (applies stats from bag without equipping)
          </label>
          <textarea className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <button className="btn-primary" type="submit">Add Item</button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Item Pool</h2>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded border border-dungeon-600 p-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-stone-500">T{item.tier} {item.item_type}</span>
                </div>
                {item.is_system && <span className="text-xs text-dungeon-400">(base)</span>}
                {Boolean(item.stats.passive) && <span className="ml-1 text-xs text-dungeon-400">(passive)</span>}
                <p className="text-stone-400">{item.description}</p>
                {!item.is_system && (
                  <div className="mt-1 flex gap-1">
                    <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setEditing({ ...item })}>Edit</button>
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(item.id)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full space-y-3">
            <h3 className="font-semibold">Edit Item</h3>
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <textarea className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <input className="input" type="number" min={1} max={5} value={editing.tier} onChange={(e) => setEditing({ ...editing, tier: +e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!editing.stats.passive}
                onChange={(e) => setEditing({ ...editing, stats: { ...editing.stats, passive: e.target.checked } })}
              />
              Passive (bag stats apply without equipping)
            </label>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Item"
          message="Delete this custom item?"
          onConfirm={doDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </Layout>
  );
}
