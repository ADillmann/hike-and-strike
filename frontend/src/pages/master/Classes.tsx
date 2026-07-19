import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];

interface ClassTemplate {
  id: number;
  name: string;
  description: string;
  base_stats: Record<string, number>;
  is_system: boolean;
}

type ClassForm = {
  name: string;
  description: string;
  base_stats: Record<string, number>;
};

const defaultStats = (): Record<string, number> =>
  Object.fromEntries(STAT_NAMES.map((s) => [s, 8]));

const defaultForm = (): ClassForm => ({
  name: '',
  description: '',
  base_stats: defaultStats(),
});

function formFromClass(item: ClassTemplate): ClassForm {
  return {
    name: item.name,
    description: item.description || '',
    base_stats: { ...defaultStats(), ...item.base_stats },
  };
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassTemplate[]>([]);
  const [bonusPoints, setBonusPoints] = useState(27);
  const [bonusDraft, setBonusDraft] = useState(27);
  const [form, setForm] = useState<ClassForm>(defaultForm());
  const [editing, setEditing] = useState<ClassTemplate | null>(null);
  const [editForm, setEditForm] = useState<ClassForm>(defaultForm());
  const [pendingDelete, setPendingDelete] = useState<ClassTemplate | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    api.get<ClassTemplate[]>('/classes').then(setClasses).catch(() => setClasses([]));
    api.get<{ creation_bonus_points: number }>('/classes/creation-settings').then((r) => {
      setBonusPoints(r.creation_bonus_points);
      setBonusDraft(r.creation_bonus_points);
    });
  };

  useEffect(() => { load(); }, []);

  const saveBonus = async () => {
    setError('');
    setMessage('');
    try {
      const r = await api.patch<{ creation_bonus_points: number }>('/classes/creation-settings', {
        creation_bonus_points: bonusDraft,
      });
      setBonusPoints(r.creation_bonus_points);
      setBonusDraft(r.creation_bonus_points);
      setMessage('Creation bonus points saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/classes', form);
      setForm(defaultForm());
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create class');
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError('');
    try {
      await api.patch(`/classes/${editing.id}`, editForm);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update class');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setError('');
    try {
      await api.delete(`/classes/${pendingDelete.id}`);
      setPendingDelete(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setPendingDelete(null);
    }
  };

  const StatInputs = ({
    stats,
    onChange,
  }: {
    stats: Record<string, number>;
    onChange: (stat: string, value: number) => void;
  }) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {STAT_NAMES.map((s) => (
        <label key={s} className="text-sm">
          <span className="label capitalize">{s}</span>
          <input
            className="input"
            type="number"
            min={8}
            max={15}
            value={stats[s] ?? 8}
            onChange={(e) => onChange(s, Number(e.target.value))}
          />
        </label>
      ))}
    </div>
  );

  return (
    <Layout title="Classes">
      {error && <p className="mb-3 text-red-400">{error}</p>}
      {message && <p className="mb-3 text-green-400">{message}</p>}

      <section className="card mb-4 space-y-3">
        <h2 className="text-lg font-semibold text-dungeon-300">Creation bonus points</h2>
        <p className="text-sm text-stone-400">
          Shared pool every player spends on top of class base stats during character creation.
          Current: {bonusPoints}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="label">Bonus points</span>
            <input
              className="input w-28"
              type="number"
              min={0}
              value={bonusDraft}
              onChange={(e) => setBonusDraft(Number(e.target.value))}
            />
          </label>
          <button type="button" className="btn-primary" onClick={saveBonus}>Save</button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="text-lg font-semibold text-dungeon-300">Add class</h2>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div>
            <span className="label">Base stats</span>
            <StatInputs
              stats={form.base_stats}
              onChange={(stat, value) =>
                setForm({ ...form, base_stats: { ...form.base_stats, [stat]: value } })
              }
            />
          </div>
          <button className="btn-primary" type="submit">Create</button>
        </form>

        <div className="card space-y-2">
          <h2 className="text-lg font-semibold text-dungeon-300">Class list</h2>
          {classes.length === 0 && <p className="text-stone-500">No classes yet.</p>}
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {classes.map((c) => (
              <div key={c.id} className="rounded border border-dungeon-700 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium">{c.name}</span>
                    {c.is_system && <span className="ml-2 text-xs text-dungeon-400">(base)</span>}
                    {c.description && <p className="text-sm text-stone-400">{c.description}</p>}
                    <p className="mt-1 text-xs text-stone-500">
                      {STAT_NAMES.map((s) => `${s.slice(0, 3)} ${c.base_stats[s] ?? 8}`).join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => { setEditing(c); setEditForm(formFromClass(c)); }}
                    >
                      Edit
                    </button>
                    {!c.is_system && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => setPendingDelete(c)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={saveEdit} className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto">
            <h3 className="text-lg font-semibold text-dungeon-300">
              Edit {editing.name}
              {editing.is_system && <span className="ml-2 text-sm font-normal text-dungeon-400">(base)</span>}
            </h3>
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-[80px]"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />
            </div>
            <div>
              <span className="label">Base stats</span>
              <StatInputs
                stats={editForm.base_stats}
                onChange={(stat, value) =>
                  setEditForm({ ...editForm, base_stats: { ...editForm.base_stats, [stat]: value } })
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save</button>
            </div>
          </form>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete class?"
          message={`Delete ${pendingDelete.name}?`}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Layout>
  );
}
