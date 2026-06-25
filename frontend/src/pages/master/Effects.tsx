import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

interface EffectTemplate {
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
  is_system: boolean;
}

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];

type EffectForm = {
  name: string;
  description: string;
  label: string;
  is_buff: boolean;
  stat_modifiers: Record<string, number>;
  damage_dealt_mod: number;
  heal_mod: number;
  allsight: 0 | 1 | 2;
  active_in_battle: boolean;
  cleared_on_rest: boolean;
  cleared_on_event: boolean;
};

const defaultForm = (): EffectForm => ({
  name: '',
  description: '',
  label: '',
  is_buff: true,
  stat_modifiers: {},
  damage_dealt_mod: 0,
  heal_mod: 0,
  allsight: 0,
  active_in_battle: false,
  cleared_on_rest: true,
  cleared_on_event: false,
});

function formFromEffect(effect: EffectTemplate): EffectForm {
  const battle = effect.battle_modifiers || {};
  const allsightVal = battle.allsight;
  const allsight: 0 | 1 | 2 = allsightVal === 2 ? 2 : allsightVal === 1 ? 1 : 0;
  return {
    name: effect.name,
    description: effect.description,
    label: effect.label || effect.name,
    is_buff: effect.is_buff,
    stat_modifiers: { ...effect.stat_modifiers },
    damage_dealt_mod: typeof battle.damage_dealt_mod === 'number' ? battle.damage_dealt_mod : 0,
    heal_mod: typeof battle.heal_mod === 'number' ? battle.heal_mod : 0,
    allsight,
    active_in_battle: effect.active_in_battle,
    cleared_on_rest: effect.cleared_on_rest,
    cleared_on_event: effect.cleared_on_event,
  };
}

function buildPayload(form: EffectForm) {
  const stat_modifiers: Record<string, number> = {};
  for (const [k, v] of Object.entries(form.stat_modifiers)) {
    if (v !== 0) stat_modifiers[k] = v;
  }
  const battle_modifiers: Record<string, number> = {};
  if (form.active_in_battle) {
    if (form.damage_dealt_mod !== 0) battle_modifiers.damage_dealt_mod = form.damage_dealt_mod;
    if (form.heal_mod !== 0) battle_modifiers.heal_mod = form.heal_mod;
    if (form.allsight > 0) battle_modifiers.allsight = form.allsight;
  }
  return {
    name: form.name,
    description: form.description,
    label: form.label || form.name,
    is_buff: form.is_buff,
    stat_modifiers,
    battle_modifiers,
    active_in_battle: form.active_in_battle,
    cleared_on_rest: form.cleared_on_rest,
    cleared_on_event: form.cleared_on_event,
  };
}

function effectSummary(effect: EffectTemplate): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(effect.stat_modifiers || {})) {
    if (v) parts.push(`${v > 0 ? '+' : ''}${v} ${k.slice(0, 3)}`);
  }
  if (effect.active_in_battle) {
    const b = effect.battle_modifiers || {};
    if (b.damage_dealt_mod) parts.push(`${b.damage_dealt_mod > 0 ? '+' : ''}${b.damage_dealt_mod} dmg dealt`);
    if (b.heal_mod) parts.push(`${b.heal_mod > 0 ? '+' : ''}${b.heal_mod} heal`);
    if (b.allsight === 2) parts.push('Allsight II');
    else if (b.allsight === 1) parts.push('Allsight I');
  }
  return parts.join(', ') || 'No modifiers';
}

function EffectFormFields({ form, onChange }: { form: EffectForm; onChange: (next: EffectForm) => void }) {
  const set = <K extends keyof EffectForm>(key: K, value: EffectForm[K]) => onChange({ ...form, [key]: value });
  const setStat = (stat: string, value: number) => {
    const next = { ...form.stat_modifiers };
    if (value === 0) delete next[stat];
    else next[stat] = value;
    set('stat_modifiers', next);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div>
        <label className="label">Display label</label>
        <input className="input" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Shown on character sheet" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_buff} onChange={(e) => set('is_buff', e.target.checked)} />
        Buff (uncheck for debuff)
      </label>
      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Stat modifiers (optional)</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STAT_NAMES.map((s) => (
            <div key={s}>
              <label className="label capitalize">{s.slice(0, 3)}</label>
              <input
                className="input"
                type="number"
                value={form.stat_modifiers[s] ?? 0}
                onChange={(e) => setStat(s, +e.target.value)}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Battle modifiers</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active_in_battle} onChange={(e) => set('active_in_battle', e.target.checked)} />
          Active in battle
        </label>
        {form.active_in_battle && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Damage dealt mod</label>
              <input className="input" type="number" value={form.damage_dealt_mod} onChange={(e) => set('damage_dealt_mod', +e.target.value)} />
              <p className="mt-1 text-xs text-stone-500">Flat bonus/penalty on outgoing damage.</p>
            </div>
            <div>
              <label className="label">Heal mod</label>
              <input className="input" type="number" value={form.heal_mod} onChange={(e) => set('heal_mod', +e.target.value)} />
              <p className="mt-1 text-xs text-stone-500">Flat bonus/penalty on heal skills.</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Allsight</label>
              <select
                className="input"
                value={form.allsight}
                onChange={(e) => set('allsight', Number(e.target.value) as 0 | 1 | 2)}
              >
                <option value={0}>None</option>
                <option value={1}>Allsight I (non-boss enemy HP)</option>
                <option value={2}>Allsight II (all enemy HP)</option>
              </select>
              <p className="mt-1 text-xs text-stone-500">Party-wide while any member has this effect in battle.</p>
            </div>
          </div>
        )}
      </fieldset>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.cleared_on_rest} onChange={(e) => set('cleared_on_rest', e.target.checked)} />
          Cleared on rest
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.cleared_on_event} onChange={(e) => set('cleared_on_event', e.target.checked)} />
          Cleared on event advance
        </label>
      </div>
    </div>
  );
}

export default function EffectsPage() {
  const [effects, setEffects] = useState<EffectTemplate[]>([]);
  const [form, setForm] = useState<EffectForm>(defaultForm());
  const [editing, setEditing] = useState<EffectTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => api.get<EffectTemplate[]>('/effects').then(setEffects);

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/effects', buildPayload(form));
    setForm(defaultForm());
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.patch(`/effects/${editing.id}`, buildPayload(form));
    setEditing(null);
    setForm(defaultForm());
    load();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/effects/${deleteId}`);
    setDeleteId(null);
    load();
  };

  const openEdit = (effect: EffectTemplate) => {
    setEditing(effect);
    setForm(formFromEffect(effect));
  };

  return (
    <Layout title="Effect Templates">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Create Effect Template</h2>
          <form onSubmit={create}>
            <EffectFormFields form={form} onChange={setForm} />
            <button className="btn-primary mt-3" type="submit">Create Effect</button>
          </form>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Templates</h2>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {effects.map((effect) => (
              <div key={effect.id} className="rounded border border-dungeon-700 p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium">{effect.name}</span>
                    <span className={`ml-2 text-xs ${effect.is_buff ? 'text-green-400' : 'text-red-400'}`}>
                      {effect.is_buff ? 'buff' : 'debuff'}
                    </span>
                    {effect.is_system && <span className="ml-1 text-xs text-stone-500">(base)</span>}
                    <p className="text-xs text-stone-500">{effectSummary(effect)}</p>
                    {effect.description && <p className="mt-1 text-stone-400">{effect.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => openEdit(effect)}>Edit</button>
                    {!effect.is_system && (
                      <button type="button" className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(effect.id)}>Delete</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <h3 className="mb-3 font-semibold">
              Edit {editing.name}
              {editing.is_system && <span className="ml-2 text-sm font-normal text-dungeon-400">(base effect)</span>}
            </h3>
            <EffectFormFields form={form} onChange={setForm} />
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => { setEditing(null); setForm(defaultForm()); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete Effect" message="Delete this custom effect template?" onConfirm={doDelete} onCancel={() => setDeleteId(null)} />
      )}
    </Layout>
  );
}
