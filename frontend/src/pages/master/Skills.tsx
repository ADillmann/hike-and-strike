import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

interface SkillTemplate {
  id: number;
  name: string;
  description: string;
  max_uses_per_rest: number;
  effect_type: string;
  effect_params: Record<string, string | number>;
  selectable_at_creation: boolean;
  is_system: boolean;
}

const EFFECT_TYPES = [
  { id: 'none', label: 'None (passive / out of battle)' },
  { id: 'heal', label: 'Heal (restore ally HP)' },
  { id: 'melee', label: 'Melee (close combat damage)' },
  { id: 'range', label: 'Range (ranged damage)' },
  { id: 'support', label: 'Support (shield or stat boost)' },
];

const STAT_OPTIONS = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
const RANGE_STAT_OPTIONS = ['dexterity', 'intelligence'];

type SkillForm = {
  name: string;
  description: string;
  max_uses_per_rest: number;
  effect_type: string;
  heal_base: number;
  bonus_damage: number;
  range_stat: string;
  support_mode: 'shield' | 'stat_boost';
  shield_amount: number;
  stat: string;
  stat_bonus: number;
  selectable_at_creation: boolean;
};

const defaultForm = (): SkillForm => ({
  name: '',
  description: '',
  max_uses_per_rest: 2,
  effect_type: 'none',
  heal_base: 5,
  bonus_damage: 3,
  range_stat: 'dexterity',
  support_mode: 'shield',
  shield_amount: 8,
  stat: 'charisma',
  stat_bonus: 2,
  selectable_at_creation: true,
});

function formFromSkill(skill: SkillTemplate): SkillForm {
  const params = skill.effect_params || {};
  return {
    name: skill.name,
    description: skill.description,
    max_uses_per_rest: skill.max_uses_per_rest,
    effect_type: normalizeEffect(skill.effect_type),
    heal_base: typeof params.heal_base === 'number' ? params.heal_base : 5,
    bonus_damage: typeof params.bonus_damage === 'number' ? params.bonus_damage : 3,
    range_stat: typeof params.range_stat === 'string' ? params.range_stat : 'dexterity',
    support_mode: params.support_mode === 'stat_boost' ? 'stat_boost' : 'shield',
    shield_amount: typeof params.shield_amount === 'number' ? params.shield_amount : 8,
    stat: typeof params.stat === 'string' ? params.stat : 'charisma',
    stat_bonus: typeof params.stat_bonus === 'number' ? params.stat_bonus : 2,
    selectable_at_creation: skill.selectable_at_creation,
  };
}

function normalizeEffect(type: string): string {
  if (type === 'power_strike') return 'melee';
  if (type === 'arcane_bolt') return 'range';
  return type;
}

function buildPayload(form: SkillForm) {
  const effect_params: Record<string, string | number> = {};
  if (form.effect_type === 'heal') effect_params.heal_base = form.heal_base;
  if (form.effect_type === 'melee') effect_params.bonus_damage = form.bonus_damage;
  if (form.effect_type === 'range') {
    effect_params.bonus_damage = form.bonus_damage;
    effect_params.range_stat = form.range_stat;
  }
  if (form.effect_type === 'support') {
    effect_params.support_mode = form.support_mode;
    if (form.support_mode === 'shield') effect_params.shield_amount = form.shield_amount;
    else {
      effect_params.stat = form.stat;
      effect_params.stat_bonus = form.stat_bonus;
    }
  }
  return {
    name: form.name,
    description: form.description,
    max_uses_per_rest: form.max_uses_per_rest,
    effect_type: form.effect_type,
    effect_params,
    selectable_at_creation: form.selectable_at_creation,
  };
}

function effectLabel(skill: SkillTemplate): string {
  const type = normalizeEffect(skill.effect_type);
  const base = EFFECT_TYPES.find((e) => e.id === type)?.label || type;
  const p = skill.effect_params || {};
  if (type === 'support') {
    if (p.support_mode === 'stat_boost') return `${base}: +${p.stat_bonus} ${p.stat}`;
    if (p.support_mode === 'shield') return `${base}: ${p.shield_amount} shield HP`;
  }
  if (type === 'range' && p.range_stat) return `${base} (${p.range_stat})`;
  return base;
}

function SkillFormFields({ form, onChange }: { form: SkillForm; onChange: (next: SkillForm) => void }) {
  const set = <K extends keyof SkillForm>(key: K, value: SkillForm[K]) => onChange({ ...form, [key]: value });

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
        <label className="label">Uses per rest</label>
        <input className="input" type="number" min={1} value={form.max_uses_per_rest} onChange={(e) => set('max_uses_per_rest', +e.target.value)} />
      </div>
      <div>
        <label className="label">Battle effect</label>
        <select className="input" value={form.effect_type} onChange={(e) => set('effect_type', e.target.value)}>
          {EFFECT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {form.effect_type === 'heal' && (
        <div>
          <label className="label">Base heal amount</label>
          <input className="input" type="number" min={1} value={form.heal_base} onChange={(e) => set('heal_base', +e.target.value)} />
          <p className="mt-1 text-xs text-stone-500">Final heal adds intelligence ÷ 2.</p>
        </div>
      )}
      {form.effect_type === 'melee' && (
        <div>
          <label className="label">Bonus damage</label>
          <input className="input" type="number" min={0} value={form.bonus_damage} onChange={(e) => set('bonus_damage', +e.target.value)} />
          <p className="mt-1 text-xs text-stone-500">Uses attack bonus + d8 + bonus.</p>
        </div>
      )}
      {form.effect_type === 'range' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label">Bonus damage</label>
            <input className="input" type="number" min={0} value={form.bonus_damage} onChange={(e) => set('bonus_damage', +e.target.value)} />
          </div>
          <div>
            <label className="label">Ranged stat</label>
            <select className="input" value={form.range_stat} onChange={(e) => set('range_stat', e.target.value)}>
              {RANGE_STAT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <p className="sm:col-span-2 text-xs text-stone-500">Damage uses ranged stat ÷ 2 + d6 + bonus.</p>
        </div>
      )}
      {form.effect_type === 'support' && (
        <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
          <legend className="px-1 text-sm font-medium text-dungeon-300">Support type</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={form.support_mode === 'shield'} onChange={() => set('support_mode', 'shield')} />
            Shield (extra HP until battle ends)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={form.support_mode === 'stat_boost'} onChange={() => set('support_mode', 'stat_boost')} />
            Stat boost (lasts until battle ends)
          </label>
          {form.support_mode === 'shield' ? (
            <div>
              <label className="label">Shield amount</label>
              <input className="input" type="number" min={1} value={form.shield_amount} onChange={(e) => set('shield_amount', +e.target.value)} />
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label">Stat</label>
                <select className="input" value={form.stat} onChange={(e) => set('stat', e.target.value)}>
                  {STAT_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Bonus</label>
                <input className="input" type="number" value={form.stat_bonus} onChange={(e) => set('stat_bonus', +e.target.value)} />
              </div>
            </div>
          )}
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.selectable_at_creation} onChange={(e) => set('selectable_at_creation', e.target.checked)} />
        Available when creating a new character
      </label>
    </div>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillTemplate[]>([]);
  const [form, setForm] = useState<SkillForm>(defaultForm);
  const [editing, setEditing] = useState<{ id: number; is_system: boolean; form: SkillForm } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => api.get<SkillTemplate[]>('/skills').then(setSkills);
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/skills', buildPayload(form));
    setForm(defaultForm());
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.patch(`/skills/${editing.id}`, buildPayload(editing.form));
    setEditing(null);
    load();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/skills/${deleteId}`);
    setDeleteId(null);
    load();
  };

  return (
    <Layout title="Skill Pool">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Custom Skill</h2>
          <SkillFormFields form={form} onChange={setForm} />
          <button className="btn-primary" type="submit">Add Skill</button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Skill Pool</h2>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {skills.map((skill) => (
              <div key={skill.id} className="rounded border border-dungeon-600 p-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{skill.name}</span>
                  <span className="shrink-0 text-stone-500">{skill.max_uses_per_rest}/rest</span>
                </div>
                <div className="text-xs text-dungeon-400">
                  {skill.is_system && <span>(base)</span>}
                  {!skill.selectable_at_creation && <span className="ml-1">(not in creation pool)</span>}
                </div>
                {skill.description && <p className="text-stone-400">{skill.description}</p>}
                <p className="text-xs text-stone-500">{effectLabel(skill)}</p>
                <div className="mt-1 flex gap-1">
                  <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setEditing({ id: skill.id, is_system: skill.is_system, form: formFromSkill(skill) })}>
                    Edit
                  </button>
                  {!skill.is_system && (
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(skill.id)}>Delete</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto">
            <h3 className="font-semibold">
              Edit Skill
              {editing.is_system && <span className="ml-2 text-sm font-normal text-dungeon-400">(base skill)</span>}
            </h3>
            <SkillFormFields form={editing.form} onChange={(next) => setEditing({ ...editing, form: next })} />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete Skill" message="Delete this custom skill?" onConfirm={doDelete} onCancel={() => setDeleteId(null)} />
      )}
    </Layout>
  );
}
