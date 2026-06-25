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

interface EffectOption {
  id: number;
  name: string;
  label: string;
  active_in_battle: boolean;
}

const EFFECT_TYPES = [
  { id: 'none', label: 'None (passive / out of battle)' },
  { id: 'heal', label: 'Heal (restore ally HP)' },
  { id: 'melee', label: 'Melee (close combat damage)' },
  { id: 'range', label: 'Range (ranged damage)' },
  { id: 'support', label: 'Support (buff allies)' },
];

const STAT_OPTIONS = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
const RANGE_STAT_OPTIONS = ['dexterity', 'intelligence'];
const SPLASH_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: '1 cell' },
  { value: 2, label: '2 cells' },
];

type SupportMode = 'shield' | 'stat_boost' | 'damage_boost' | 'apply_effect';
type TargetScope = 'single' | 'party';

type SkillForm = {
  name: string;
  description: string;
  max_uses_per_rest: number;
  effect_type: string;
  heal_base: number;
  bonus_damage: number;
  range_stat: string;
  skill_range: number;
  splash_radius: number;
  support_mode: SupportMode;
  target_scope: TargetScope;
  shield_amount: number;
  stat: string;
  stat_bonus: number;
  damage_boost_amount: number;
  effect_template_id: number;
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
  skill_range: 4,
  splash_radius: 0,
  support_mode: 'shield',
  target_scope: 'single',
  shield_amount: 8,
  stat: 'charisma',
  stat_bonus: 2,
  damage_boost_amount: 2,
  effect_template_id: 0,
  selectable_at_creation: true,
});

function numParam(params: Record<string, string | number>, key: string, fallback: number): number {
  const val = params[key];
  return typeof val === 'number' ? val : fallback;
}

function formFromSkill(skill: SkillTemplate): SkillForm {
  const params = skill.effect_params || {};
  const mode = params.support_mode;
  let support_mode: SupportMode = 'shield';
  if (mode === 'stat_boost') support_mode = 'stat_boost';
  else if (mode === 'damage_boost') support_mode = 'damage_boost';
  else if (mode === 'apply_effect') support_mode = 'apply_effect';
  return {
    name: skill.name,
    description: skill.description,
    max_uses_per_rest: skill.max_uses_per_rest,
    effect_type: normalizeEffect(skill.effect_type),
    heal_base: numParam(params, 'heal_base', 5),
    bonus_damage: numParam(params, 'bonus_damage', 3),
    range_stat: typeof params.range_stat === 'string' ? params.range_stat : 'dexterity',
    skill_range: numParam(params, 'range', 4),
    splash_radius: numParam(params, 'splash_radius', 0),
    support_mode,
    target_scope: params.target_scope === 'party' ? 'party' : 'single',
    shield_amount: numParam(params, 'shield_amount', 8),
    stat: typeof params.stat === 'string' ? params.stat : 'charisma',
    stat_bonus: numParam(params, 'stat_bonus', 2),
    damage_boost_amount: numParam(params, 'damage_boost_amount', 2),
    effect_template_id: numParam(params, 'effect_template_id', 0),
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
  if (form.effect_type === 'heal') {
    effect_params.heal_base = form.heal_base;
    effect_params.range = form.skill_range;
    if (form.splash_radius > 0) effect_params.splash_radius = form.splash_radius;
  }
  if (form.effect_type === 'melee') {
    effect_params.bonus_damage = form.bonus_damage;
    if (form.splash_radius > 0) effect_params.splash_radius = form.splash_radius;
  }
  if (form.effect_type === 'range') {
    effect_params.bonus_damage = form.bonus_damage;
    effect_params.range_stat = form.range_stat;
    effect_params.range = form.skill_range;
    if (form.splash_radius > 0) effect_params.splash_radius = form.splash_radius;
  }
  if (form.effect_type === 'support') {
    effect_params.support_mode = form.support_mode;
    effect_params.target_scope = form.target_scope;
    if (form.support_mode === 'shield') effect_params.shield_amount = form.shield_amount;
    else if (form.support_mode === 'stat_boost') {
      effect_params.stat = form.stat;
      effect_params.stat_bonus = form.stat_bonus;
    } else if (form.support_mode === 'damage_boost') {
      effect_params.damage_boost_amount = form.damage_boost_amount;
    } else if (form.support_mode === 'apply_effect' && form.effect_template_id) {
      effect_params.effect_template_id = form.effect_template_id;
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

function effectLabel(skill: SkillTemplate, effects: EffectOption[]): string {
  const type = normalizeEffect(skill.effect_type);
  const base = EFFECT_TYPES.find((e) => e.id === type)?.label || type;
  const p = skill.effect_params || {};
  if (type === 'support') {
    const scope = p.target_scope === 'party' ? 'party' : 'single ally';
    if (p.support_mode === 'stat_boost') return `${base} (${scope}): +${p.stat_bonus} ${p.stat}`;
    if (p.support_mode === 'shield') return `${base} (${scope}): ${p.shield_amount} shield HP`;
    if (p.support_mode === 'damage_boost') return `${base} (${scope}): +${p.damage_boost_amount} damage`;
    if (p.support_mode === 'apply_effect') {
      const eff = effects.find((e) => e.id === p.effect_template_id);
      return `${base} (${scope}): ${eff?.label || eff?.name || 'effect'}`;
    }
  }
  if (type === 'range' && p.range_stat) {
    const splash = p.splash_radius ? `, splash ${p.splash_radius}` : '';
    return `${base} (${p.range_stat}, range ${p.range ?? 4}${splash})`;
  }
  if (type === 'heal') {
    const splash = p.splash_radius ? `, splash ${p.splash_radius}` : '';
    return `${base} (range ${p.range ?? 4}${splash})`;
  }
  if (type === 'melee' && p.splash_radius) return `${base} (splash ${p.splash_radius})`;
  return base;
}

function SplashSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="label">Splash radius</label>
      <select className="input" value={value} onChange={(e) => onChange(+e.target.value)}>
        {SPLASH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <p className="mt-1 text-xs text-stone-500">50% effect on targets within radius around primary target.</p>
    </div>
  );
}

function SkillFormFields({
  form,
  onChange,
  battleEffects,
}: {
  form: SkillForm;
  onChange: (next: SkillForm) => void;
  battleEffects: EffectOption[];
}) {
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
        <>
          <div>
            <label className="label">Base heal amount</label>
            <input className="input" type="number" min={1} value={form.heal_base} onChange={(e) => set('heal_base', +e.target.value)} />
            <p className="mt-1 text-xs text-stone-500">Final heal adds intelligence ÷ 2.</p>
          </div>
          <div>
            <label className="label">Range (cells)</label>
            <input className="input" type="number" min={1} max={9} value={form.skill_range} onChange={(e) => set('skill_range', +e.target.value)} />
          </div>
          <SplashSelect value={form.splash_radius} onChange={(v) => set('splash_radius', v)} />
        </>
      )}
      {form.effect_type === 'melee' && (
        <>
          <div>
            <label className="label">Bonus damage</label>
            <input className="input" type="number" min={0} value={form.bonus_damage} onChange={(e) => set('bonus_damage', +e.target.value)} />
            <p className="mt-1 text-xs text-stone-500">Uses attack bonus + d6 + bonus on primary hit.</p>
          </div>
          <SplashSelect value={form.splash_radius} onChange={(v) => set('splash_radius', v)} />
        </>
      )}
      {form.effect_type === 'range' && (
        <>
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
          </div>
          <div>
            <label className="label">Range (cells)</label>
            <input className="input" type="number" min={1} max={9} value={form.skill_range} onChange={(e) => set('skill_range', +e.target.value)} />
          </div>
          <SplashSelect value={form.splash_radius} onChange={(v) => set('splash_radius', v)} />
          <p className="text-xs text-stone-500">Damage uses ranged stat ÷ 2 + d6 + bonus.</p>
        </>
      )}
      {form.effect_type === 'support' && (
        <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
          <legend className="px-1 text-sm font-medium text-dungeon-300">Support</legend>
          <div>
            <label className="label">Target</label>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.target_scope === 'single'} onChange={() => set('target_scope', 'single')} />
                Single ally
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={form.target_scope === 'party'} onChange={() => set('target_scope', 'party')} />
                Whole party
              </label>
            </div>
          </div>
          <div>
            <label className="label">Support type</label>
            <select className="input" value={form.support_mode} onChange={(e) => set('support_mode', e.target.value as SupportMode)}>
              <option value="shield">Shield (extra HP until battle ends)</option>
              <option value="stat_boost">Stat boost (until battle ends)</option>
              <option value="damage_boost">Damage boost (until battle ends)</option>
              <option value="apply_effect">Apply battle effect</option>
            </select>
          </div>
          {form.support_mode === 'shield' && (
            <div>
              <label className="label">Shield amount</label>
              <input className="input" type="number" min={1} value={form.shield_amount} onChange={(e) => set('shield_amount', +e.target.value)} />
            </div>
          )}
          {form.support_mode === 'stat_boost' && (
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
          {form.support_mode === 'damage_boost' && (
            <div>
              <label className="label">Damage boost amount</label>
              <input className="input" type="number" min={1} value={form.damage_boost_amount} onChange={(e) => set('damage_boost_amount', +e.target.value)} />
              <p className="mt-1 text-xs text-stone-500">Added to damage dealt modifier for this battle.</p>
            </div>
          )}
          {form.support_mode === 'apply_effect' && (
            <div>
              <label className="label">Battle effect template</label>
              <select
                className="input"
                value={form.effect_template_id}
                onChange={(e) => set('effect_template_id', +e.target.value)}
                required
              >
                <option value={0}>Select effect...</option>
                {battleEffects.map((e) => (
                  <option key={e.id} value={e.id}>{e.label || e.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-stone-500">Only effects marked active in battle are listed.</p>
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
  const [battleEffects, setBattleEffects] = useState<EffectOption[]>([]);
  const [form, setForm] = useState<SkillForm>(defaultForm);
  const [editing, setEditing] = useState<{ id: number; is_system: boolean; form: SkillForm } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    api.get<SkillTemplate[]>('/skills').then(setSkills);
    api.get<EffectOption[]>('/effects').then((items) => {
      setBattleEffects(items.filter((e) => e.active_in_battle));
    });
  };

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
          <SkillFormFields form={form} onChange={setForm} battleEffects={battleEffects} />
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
                <p className="text-xs text-stone-500">{effectLabel(skill, battleEffects)}</p>
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
            <SkillFormFields form={editing.form} onChange={(next) => setEditing({ ...editing, form: next })} battleEffects={battleEffects} />
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
