import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

interface SecretTemplate {
  id: number;
  name: string;
  description: string;
  solver_type: string;
  solver_config: Record<string, unknown>;
  examine_stat: string;
  examine_mode: string;
  examine_dc: number;
  revealed_description: string;
  fail_message_examine: string;
  fail_message_solve: string;
  rewards: {
    xp?: number;
    items?: { item_template_id: number }[];
    temp_effects?: { effect_template_id: number }[];
  };
  consume_on_solve: boolean;
  is_system: boolean;
}

interface ItemOption {
  id: number;
  name: string;
}

interface EffectOption {
  id: number;
  name: string;
}

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
const SOLVER_TYPES = [
  { id: 'codeword', label: 'Codeword' },
  { id: 'number_lock', label: 'Number lock (5 digits)' },
];
const EXAMINE_MODES = [
  { id: 'd20_plus_stat', label: 'd20 + stat vs DC' },
  { id: 'stat_vs_dc', label: 'Stat vs DC (no roll)' },
];

type SecretForm = {
  name: string;
  description: string;
  solver_type: string;
  codeword_answer: string;
  codeword_case_sensitive: boolean;
  lock_code: string;
  lock_length: number;
  examine_stat: string;
  examine_mode: string;
  examine_dc: number;
  revealed_description: string;
  fail_message_examine: string;
  fail_message_solve: string;
  reward_xp: number;
  reward_item_id: number;
  reward_effect_id: number;
  consume_on_solve: boolean;
};

const defaultForm = (): SecretForm => ({
  name: '',
  description: '',
  solver_type: 'codeword',
  codeword_answer: '',
  codeword_case_sensitive: false,
  lock_code: '',
  lock_length: 5,
  examine_stat: 'intelligence',
  examine_mode: 'd20_plus_stat',
  examine_dc: 10,
  revealed_description: '',
  fail_message_examine: 'Nothing happens...',
  fail_message_solve: "That doesn't work.",
  reward_xp: 0,
  reward_item_id: 0,
  reward_effect_id: 0,
  consume_on_solve: true,
});

function formFromSecret(secret: SecretTemplate): SecretForm {
  const cfg = secret.solver_config || {};
  const rewards = secret.rewards || {};
  return {
    name: secret.name,
    description: secret.description,
    solver_type: secret.solver_type,
    codeword_answer: typeof cfg.answer === 'string' ? cfg.answer : '',
    codeword_case_sensitive: Boolean(cfg.case_sensitive),
    lock_code: typeof cfg.code === 'string' ? cfg.code : '',
    lock_length: typeof cfg.length === 'number' ? cfg.length : 5,
    examine_stat: secret.examine_stat,
    examine_mode: secret.examine_mode,
    examine_dc: secret.examine_dc,
    revealed_description: secret.revealed_description,
    fail_message_examine: secret.fail_message_examine,
    fail_message_solve: secret.fail_message_solve,
    reward_xp: typeof rewards.xp === 'number' ? rewards.xp : 0,
    reward_item_id: rewards.items?.[0]?.item_template_id ?? 0,
    reward_effect_id: rewards.temp_effects?.[0]?.effect_template_id ?? 0,
    consume_on_solve: secret.consume_on_solve,
  };
}

function buildPayload(form: SecretForm) {
  const solver_config =
    form.solver_type === 'number_lock'
      ? { code: form.lock_code, length: form.lock_length }
      : { answer: form.codeword_answer, case_sensitive: form.codeword_case_sensitive };

  const rewards: SecretTemplate['rewards'] = {};
  if (form.reward_xp > 0) rewards.xp = form.reward_xp;
  if (form.reward_item_id) rewards.items = [{ item_template_id: form.reward_item_id }];
  if (form.reward_effect_id) rewards.temp_effects = [{ effect_template_id: form.reward_effect_id }];

  return {
    name: form.name,
    description: form.description,
    solver_type: form.solver_type,
    solver_config,
    examine_stat: form.examine_stat,
    examine_mode: form.examine_mode,
    examine_dc: form.examine_dc,
    revealed_description: form.revealed_description,
    fail_message_examine: form.fail_message_examine,
    fail_message_solve: form.fail_message_solve,
    rewards,
    consume_on_solve: form.consume_on_solve,
  };
}

function secretSummary(secret: SecretTemplate): string {
  const solver = SOLVER_TYPES.find((s) => s.id === secret.solver_type)?.label || secret.solver_type;
  const mode = secret.examine_mode === 'stat_vs_dc' ? 'stat' : 'd20+stat';
  return `${solver} · ${secret.examine_stat.slice(0, 3)} ${mode} DC ${secret.examine_dc}`;
}

function SecretFormFields({
  form,
  onChange,
  items,
  effects,
}: {
  form: SecretForm;
  onChange: (next: SecretForm) => void;
  items: ItemOption[];
  effects: EffectOption[];
}) {
  const set = <K extends keyof SecretForm>(key: K, value: SecretForm[K]) => onChange({ ...form, [key]: value });

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </div>
      <div>
        <label className="label">Master notes</label>
        <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>
      <div>
        <label className="label">Revealed description (after examine)</label>
        <textarea className="input" value={form.revealed_description} onChange={(e) => set('revealed_description', e.target.value)} />
      </div>

      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Examine check</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="label">Stat</label>
            <select className="input" value={form.examine_stat} onChange={(e) => set('examine_stat', e.target.value)}>
              {STAT_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" value={form.examine_mode} onChange={(e) => set('examine_mode', e.target.value)}>
              {EXAMINE_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">DC</label>
            <input className="input" type="number" min={1} value={form.examine_dc} onChange={(e) => set('examine_dc', +e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Fail message (examine)</label>
          <input className="input" value={form.fail_message_examine} onChange={(e) => set('fail_message_examine', e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Solver</legend>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.solver_type} onChange={(e) => set('solver_type', e.target.value)}>
            {SOLVER_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        {form.solver_type === 'codeword' ? (
          <>
            <div>
              <label className="label">Answer</label>
              <input className="input" value={form.codeword_answer} onChange={(e) => set('codeword_answer', e.target.value)} required />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.codeword_case_sensitive} onChange={(e) => set('codeword_case_sensitive', e.target.checked)} />
              Case sensitive
            </label>
          </>
        ) : (
          <div>
            <label className="label">{form.lock_length}-digit code</label>
            <input
              className="input"
              value={form.lock_code}
              onChange={(e) => set('lock_code', e.target.value.replace(/\D/g, '').slice(0, form.lock_length))}
              maxLength={form.lock_length}
              pattern={`\\d{${form.lock_length}}`}
              required
            />
          </div>
        )}
        <div>
          <label className="label">Fail message (solve)</label>
          <input className="input" value={form.fail_message_solve} onChange={(e) => set('fail_message_solve', e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
        <legend className="px-1 text-sm font-medium text-dungeon-300">Rewards on solve</legend>
        <div>
          <label className="label">XP</label>
          <input className="input" type="number" min={0} value={form.reward_xp} onChange={(e) => set('reward_xp', +e.target.value)} />
        </div>
        <div>
          <label className="label">Item (optional)</label>
          <select className="input" value={form.reward_item_id} onChange={(e) => set('reward_item_id', +e.target.value)}>
            <option value={0}>None</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Effect (optional)</label>
          <select className="input" value={form.reward_effect_id} onChange={(e) => set('reward_effect_id', +e.target.value)}>
            <option value={0}>None</option>
            {effects.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.consume_on_solve} onChange={(e) => set('consume_on_solve', e.target.checked)} />
        Remove item from inventory when solved
      </label>
    </div>
  );
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<SecretTemplate[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [effects, setEffects] = useState<EffectOption[]>([]);
  const [form, setForm] = useState<SecretForm>(defaultForm());
  const [editing, setEditing] = useState<SecretTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    api.get<SecretTemplate[]>('/secrets').then(setSecrets);
    api.get<ItemOption[]>('/items').then(setItems);
    api.get<EffectOption[]>('/effects').then(setEffects);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/secrets', buildPayload(form));
    setForm(defaultForm());
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.patch(`/secrets/${editing.id}`, buildPayload(form));
    setEditing(null);
    setForm(defaultForm());
    load();
  };

  const doDelete = async () => {
    if (!deleteId) return;
    await api.delete(`/secrets/${deleteId}`);
    setDeleteId(null);
    load();
  };

  return (
    <Layout title="Secret Templates">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Create Secret</h2>
          <form onSubmit={create}>
            <SecretFormFields form={form} onChange={setForm} items={items} effects={effects} />
            <button className="btn-primary mt-3" type="submit">Create Secret</button>
          </form>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Templates</h2>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {secrets.map((secret) => (
              <div key={secret.id} className="rounded border border-dungeon-700 p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium">{secret.name}</span>
                    {secret.is_system && <span className="ml-1 text-xs text-stone-500">(base)</span>}
                    <p className="text-xs text-stone-500">{secretSummary(secret)}</p>
                    {secret.description && <p className="mt-1 text-stone-400">{secret.description}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => { setEditing(secret); setForm(formFromSecret(secret)); }}>Edit</button>
                    {!secret.is_system && (
                      <button type="button" className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(secret.id)}>Delete</button>
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
            <h3 className="mb-3 font-semibold">Edit {editing.name}</h3>
            <SecretFormFields form={form} onChange={setForm} items={items} effects={effects} />
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => { setEditing(null); setForm(defaultForm()); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <ConfirmDialog title="Delete Secret" message="Delete this custom secret template?" onConfirm={doDelete} onCancel={() => setDeleteId(null)} />
      )}
    </Layout>
  );
}
