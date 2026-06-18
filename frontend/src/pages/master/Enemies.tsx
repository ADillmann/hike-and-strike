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

interface PresetEntry {
  template_name: string;
  count: number;
  power_scale: number;
}

interface Preset {
  id: string;
  name: string;
  enemies: PresetEntry[];
  is_system: boolean;
}

const STAT_FIELDS = [
  { key: 'strength', label: 'Strength', default: 8 },
  { key: 'dexterity', label: 'Dexterity', default: 8 },
  { key: 'intelligence', label: 'Intelligence', default: 8 },
  { key: 'durability', label: 'Durability', default: 8 },
  { key: 'charisma', label: 'Charisma', default: 8 },
  { key: 'initiative', label: 'Initiative', default: 8 },
  { key: 'damage', label: 'Damage', default: 3 },
  { key: 'armor_bonus', label: 'Armor bonus', default: 0 },
] as const;

type StatKey = (typeof STAT_FIELDS)[number]['key'];

type EnemyForm = {
  name: string;
  description: string;
  stats: Record<StatKey, number>;
};

type PresetForm = {
  name: string;
  enemies: PresetEntry[];
};

const defaultEnemyStats = (): Record<StatKey, number> =>
  Object.fromEntries(STAT_FIELDS.map((s) => [s.key, s.default])) as Record<StatKey, number>;

const defaultEnemyForm = (): EnemyForm => ({
  name: '',
  description: '',
  stats: defaultEnemyStats(),
});

const defaultPresetEntry = (enemyNames: string[]): PresetEntry => ({
  template_name: enemyNames[0] || '',
  count: 1,
  power_scale: 1,
});

const defaultPresetForm = (enemyNames: string[]): PresetForm => ({
  name: '',
  enemies: [defaultPresetEntry(enemyNames)],
});

function enemyFormFromEnemy(enemy: Enemy): EnemyForm {
  const stats = defaultEnemyStats();
  for (const { key } of STAT_FIELDS) {
    stats[key] = enemy.stats[key] ?? stats[key];
  }
  return { name: enemy.name, description: enemy.description, stats };
}

function presetFormFromPreset(preset: Preset): PresetForm {
  return {
    name: preset.name,
    enemies: preset.enemies.length > 0
      ? preset.enemies.map((e) => ({ ...e }))
      : [{ template_name: '', count: 1, power_scale: 1 }],
  };
}

function formatEnemyStats(stats: Record<string, number>): string {
  return STAT_FIELDS
    .map(({ key, label }) => {
      const val = stats[key];
      if (val === undefined) return null;
      return `${label} ${val}`;
    })
    .filter(Boolean)
    .join(' · ');
}

function EnemyFormFields({
  form,
  onChange,
}: {
  form: EnemyForm;
  onChange: (next: EnemyForm) => void;
}) {
  const setStat = (key: StatKey, value: number) => {
    onChange({ ...form, stats: { ...form.stats, [key]: value } });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} required />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" value={form.description} onChange={(e) => onChange({ ...form, description: e.target.value })} />
      </div>
      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Stats</legend>
        <div className="grid grid-cols-2 gap-2">
          {STAT_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input
                className="input"
                type="number"
                value={form.stats[key]}
                onChange={(e) => setStat(key, +e.target.value)}
              />
            </div>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function PresetFormFields({
  form,
  enemyNames,
  onChange,
}: {
  form: PresetForm;
  enemyNames: string[];
  onChange: (next: PresetForm) => void;
}) {
  const updateEntry = (index: number, patch: Partial<PresetEntry>) => {
    const enemies = form.enemies.map((entry, i) => (i === index ? { ...entry, ...patch } : entry));
    onChange({ ...form, enemies });
  };

  const addEntry = () => {
    onChange({ ...form, enemies: [...form.enemies, defaultPresetEntry(enemyNames)] });
  };

  const removeEntry = (index: number) => {
    if (form.enemies.length <= 1) return;
    onChange({ ...form, enemies: form.enemies.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Preset name</label>
        <input className="input" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} required />
      </div>
      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Enemies in battle</legend>
        {form.enemies.map((entry, index) => (
          <div key={index} className="grid gap-2 rounded border border-dungeon-800 p-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <div>
              <label className="label">Enemy template</label>
              <select
                className="input"
                value={entry.template_name}
                onChange={(e) => updateEntry(index, { template_name: e.target.value })}
              >
                {enemyNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Count</label>
              <input
                className="input"
                type="number"
                min={1}
                value={entry.count}
                onChange={(e) => updateEntry(index, { count: +e.target.value })}
              />
            </div>
            <div>
              <label className="label">Power scale</label>
              <input
                className="input"
                type="number"
                min={0.1}
                step={0.1}
                value={entry.power_scale}
                onChange={(e) => updateEntry(index, { power_scale: +e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-danger px-2 py-1 text-xs"
                disabled={form.enemies.length <= 1}
                onClick={() => removeEntry(index)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-secondary text-xs" onClick={addEntry}>Add enemy row</button>
      </fieldset>
    </div>
  );
}

export default function EnemiesPage() {
  const [enemies, setEnemies] = useState<Enemy[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [enemyForm, setEnemyForm] = useState<EnemyForm>(defaultEnemyForm);
  const [presetForm, setPresetForm] = useState<PresetForm>(defaultPresetForm([]));
  const [editingEnemy, setEditingEnemy] = useState<{ id: number; is_system: boolean; form: EnemyForm } | null>(null);
  const [editingPreset, setEditingPreset] = useState<{ id: string; is_system: boolean; form: PresetForm } | null>(null);
  const [deleteEnemyId, setDeleteEnemyId] = useState<number | null>(null);
  const [deletePresetId, setDeletePresetId] = useState<string | null>(null);

  const enemyNames = enemies.map((e) => e.name);

  const load = () => {
    api.get<Enemy[]>('/enemies').then((rows) => {
      setEnemies(rows);
      setPresetForm((prev) => (
        prev.enemies.some((e) => e.template_name)
          ? prev
          : defaultPresetForm(rows.map((r) => r.name))
      ));
    });
    api.get<Preset[]>('/enemies/presets').then(setPresets);
  };

  useEffect(() => { load(); }, []);

  const createEnemy = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/enemies', {
      name: enemyForm.name,
      description: enemyForm.description,
      stats: enemyForm.stats,
    });
    setEnemyForm(defaultEnemyForm());
    load();
  };

  const createPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/enemies/presets', {
      name: presetForm.name,
      enemies: presetForm.enemies,
    });
    setPresetForm(defaultPresetForm(enemyNames));
    load();
  };

  const saveEnemyEdit = async () => {
    if (!editingEnemy) return;
    await api.patch(`/enemies/${editingEnemy.id}`, {
      name: editingEnemy.form.name,
      description: editingEnemy.form.description,
      stats: editingEnemy.form.stats,
    });
    setEditingEnemy(null);
    load();
  };

  const savePresetEdit = async () => {
    if (!editingPreset) return;
    await api.patch(`/enemies/presets/${editingPreset.id}`, {
      name: editingPreset.form.name,
      enemies: editingPreset.form.enemies,
    });
    setEditingPreset(null);
    load();
  };

  const doDeleteEnemy = async () => {
    if (!deleteEnemyId) return;
    await api.delete(`/enemies/${deleteEnemyId}`);
    setDeleteEnemyId(null);
    load();
  };

  const doDeletePreset = async () => {
    if (!deletePresetId) return;
    await api.delete(`/enemies/presets/${deletePresetId}`);
    setDeletePresetId(null);
    load();
  };

  return (
    <Layout title="Enemy Pool">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <form onSubmit={createEnemy} className="card space-y-3">
            <h2 className="font-semibold text-dungeon-300">Custom Enemy</h2>
            <EnemyFormFields form={enemyForm} onChange={setEnemyForm} />
            <button className="btn-primary" type="submit">Add Enemy</button>
          </form>

          <form onSubmit={createPreset} className="card space-y-3">
            <h2 className="font-semibold text-dungeon-300">Custom Battle Preset</h2>
            <PresetFormFields form={presetForm} enemyNames={enemyNames} onChange={setPresetForm} />
            <button className="btn-primary" type="submit" disabled={enemyNames.length === 0}>
              Add Preset
            </button>
          </form>
        </div>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Enemy Pool</h2>
          <div className="max-h-[40vh] space-y-2 overflow-y-auto">
            {enemies.map((enemy) => (
              <div key={enemy.id} className="rounded border border-dungeon-600 p-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{enemy.name}</span>
                  {enemy.is_system && <span className="text-xs text-dungeon-400">(base)</span>}
                </div>
                {enemy.description && <p className="text-stone-400">{enemy.description}</p>}
                <p className="text-xs text-stone-500">{formatEnemyStats(enemy.stats)}</p>
                <div className="mt-1 flex gap-1">
                  <button
                    className="btn-secondary px-2 py-0.5 text-xs"
                    onClick={() => setEditingEnemy({ id: enemy.id, is_system: enemy.is_system, form: enemyFormFromEnemy(enemy) })}
                  >
                    Edit
                  </button>
                  {!enemy.is_system && (
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteEnemyId(enemy.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-4 font-semibold text-dungeon-300">Battle Presets</h3>
          <div className="space-y-2">
            {presets.map((p) => (
              <div key={p.id} className="rounded border border-dungeon-700 p-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.is_system && <span className="text-xs text-dungeon-400">(base)</span>}
                </div>
                <p className="text-stone-500">{p.enemies.map((e) => `${e.count}× ${e.template_name}`).join(', ')}</p>
                <div className="mt-1 flex gap-1">
                  <button
                    className="btn-secondary px-2 py-0.5 text-xs"
                    onClick={() => setEditingPreset({ id: p.id, is_system: p.is_system, form: presetFormFromPreset(p) })}
                  >
                    Edit
                  </button>
                  {!p.is_system && (
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeletePresetId(p.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {editingEnemy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto">
            <h3 className="font-semibold">
              Edit Enemy
              {editingEnemy.is_system && <span className="ml-2 text-sm font-normal text-dungeon-400">(base enemy)</span>}
            </h3>
            <EnemyFormFields
              form={editingEnemy.form}
              onChange={(form) => setEditingEnemy({ ...editingEnemy, form })}
            />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEnemyEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditingEnemy(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editingPreset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto">
            <h3 className="font-semibold">
              Edit Battle Preset
              {editingPreset.is_system && <span className="ml-2 text-sm font-normal text-dungeon-400">(base preset)</span>}
            </h3>
            <PresetFormFields
              form={editingPreset.form}
              enemyNames={enemyNames}
              onChange={(form) => setEditingPreset({ ...editingPreset, form })}
            />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={savePresetEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditingPreset(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteEnemyId && (
        <ConfirmDialog title="Delete Enemy" message="Delete this custom enemy?" onConfirm={doDeleteEnemy} onCancel={() => setDeleteEnemyId(null)} />
      )}

      {deletePresetId && (
        <ConfirmDialog title="Delete Preset" message="Delete this custom battle preset?" onConfirm={doDeletePreset} onCancel={() => setDeletePresetId(null)} />
      )}
    </Layout>
  );
}
