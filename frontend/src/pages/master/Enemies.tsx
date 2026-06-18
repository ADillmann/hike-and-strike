import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

interface Enemy {
  id: number;
  name: string;
  stats: Record<string, number>;
  description: string;
  is_system: boolean;
}

interface Preset {
  id: string;
  name: string;
  enemies: { template_name: string; count: number; power_scale: number }[];
}

const STAT_FIELDS = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative', 'damage', 'armor_bonus'];

export default function EnemiesPage() {
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState({ name: '', description: '', stats: Object.fromEntries(STAT_FIELDS.map((s) => [s, s === 'damage' ? 3 : 8])) });
  const [editing, setEditing] = useState<Enemy | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    api.get<Enemy[]>('/enemies').then(setEnemies);
    api.get<Preset[]>('/enemies/presets').then(setPresets);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/enemies', { name: form.name, description: form.description, stats: form.stats });
    setForm({ name: '', description: '', stats: Object.fromEntries(STAT_FIELDS.map((s) => [s, s === 'damage' ? 3 : 8])) });
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.patch(`/enemies/${editing.id}`, { name: editing.name, description: editing.description, stats: editing.stats });
    setEditing(null);
    load();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/enemies/${deleteId}`);
    setDeleteId(null);
    load();
  };

  return (
    <Layout title="Enemy Pool">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Custom Enemy</h2>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <textarea className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            {STAT_FIELDS.map((s) => (
              <div key={s}>
                <label className="label capitalize">{s.replace('_', ' ')}</label>
                <input className="input" type="number" value={form.stats[s] || 0} onChange={(e) => setForm({ ...form, stats: { ...form.stats, [s]: +e.target.value } })} />
              </div>
            ))}
          </div>
          <button className="btn-primary" type="submit">Add Enemy</button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Enemy Pool</h2>
          <div className="max-h-[40vh] space-y-2 overflow-y-auto">
            {enemies.map((enemy) => (
              <div key={enemy.id} className="rounded border border-dungeon-600 p-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium">{enemy.name}</span>
                  {enemy.is_system && <span className="text-xs text-dungeon-400">(base)</span>}
                </div>
                <p className="text-stone-400">{enemy.description}</p>
                {!enemy.is_system && (
                  <div className="mt-1 flex gap-1">
                    <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setEditing(enemy)}>Edit</button>
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(enemy.id)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-4 font-semibold text-dungeon-300">Battle Presets</h3>
          {presets.map((p) => (
            <div key={p.id} className="mb-2 rounded border border-dungeon-700 p-2 text-sm">
              <span className="font-medium">{p.name}</span>
              <p className="text-stone-500">{p.enemies.map((e) => `${e.count}× ${e.template_name}`).join(', ')}</p>
            </div>
          ))}
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full max-h-[80vh] overflow-y-auto space-y-3">
            <h3 className="font-semibold">Edit Enemy</h3>
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <textarea className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete Enemy" message="Delete this custom enemy?" onConfirm={doDelete} onCancel={() => setDeleteId(null)} />
      )}
    </Layout>
  );
}
