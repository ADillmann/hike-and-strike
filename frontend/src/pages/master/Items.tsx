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
  secret_template_id?: number | null;
  base_price: number;
  is_system: boolean;
}

interface SecretOption {
  id: number;
  name: string;
}

const ITEM_TYPES = ['weapon', 'shield', 'head', 'armor', 'gloves', 'legs', 'shoes', 'ring', 'necklace', 'spell', 'consumable', 'key', 'secret'];

const STAT_FIELDS = [
  { key: 'strength', label: 'Strength' },
  { key: 'dexterity', label: 'Dexterity' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'durability', label: 'Durability' },
  { key: 'charisma', label: 'Charisma' },
  { key: 'initiative', label: 'Initiative' },
] as const;

type ItemForm = {
  name: string;
  item_type: string;
  tier: number;
  description: string;
  strength: number;
  dexterity: number;
  intelligence: number;
  durability: number;
  charisma: number;
  initiative: number;
  armor_bonus: number;
  damage: number;
  heal: number;
  two_handed: boolean;
  weapon_class: 'melee' | 'range';
  weapon_range: number;
  passive: boolean;
  secret_template_id: number;
  base_price: number;
};

const defaultForm = (): ItemForm => ({
  name: '',
  item_type: 'weapon',
  tier: 1,
  description: '',
  strength: 0,
  dexterity: 0,
  intelligence: 0,
  durability: 0,
  charisma: 0,
  initiative: 0,
  armor_bonus: 0,
  damage: 0,
  heal: 0,
  two_handed: false,
  weapon_class: 'melee',
  weapon_range: 4,
  passive: false,
  secret_template_id: 0,
  base_price: 0,
});

function numStat(stats: Record<string, unknown>, key: string): number {
  const val = stats[key];
  return typeof val === 'number' ? val : 0;
}

function formFromItem(item: Item): ItemForm {
  const s = item.stats || {};
  return {
    name: item.name,
    item_type: item.item_type,
    tier: item.tier,
    description: item.description,
    strength: numStat(s, 'strength'),
    dexterity: numStat(s, 'dexterity'),
    intelligence: numStat(s, 'intelligence'),
    durability: numStat(s, 'durability'),
    charisma: numStat(s, 'charisma'),
    initiative: numStat(s, 'initiative'),
    armor_bonus: numStat(s, 'armor_bonus'),
    damage: numStat(s, 'damage'),
    heal: numStat(s, 'heal'),
    two_handed: Boolean(s.two_handed),
    weapon_class: s.weapon_class === 'range' ? 'range' : 'melee',
    weapon_range: numStat(s, 'range') || 4,
    passive: Boolean(s.passive),
    secret_template_id: item.secret_template_id ?? 0,
    base_price: item.base_price ?? 0,
  };
}

function buildStats(form: ItemForm): Record<string, unknown> {
  if (form.item_type === 'consumable') {
    const stats: Record<string, unknown> = {};
    if (form.heal > 0) stats.heal = form.heal;
    return stats;
  }

  const stats: Record<string, unknown> = {};
  for (const { key } of STAT_FIELDS) {
    const val = form[key];
    if (val !== 0) stats[key] = val;
  }
  if (form.armor_bonus !== 0) stats.armor_bonus = form.armor_bonus;
  if (form.damage !== 0) stats.damage = form.damage;
  if (form.item_type === 'weapon') {
    stats.weapon_class = form.weapon_class;
    if (form.weapon_class === 'range') {
      stats.two_handed = true;
      if (form.weapon_range > 0) stats.range = form.weapon_range;
    } else if (form.two_handed) {
      stats.two_handed = true;
    }
  } else if (form.two_handed) {
    stats.two_handed = true;
  }
  if (form.passive) stats.passive = true;
  return stats;
}

function formatItemStats(itemType: string, stats: Record<string, unknown>): string[] {
  if (itemType === 'consumable') {
    if (typeof stats.heal === 'number' && stats.heal > 0) {
      return [`Heals ${stats.heal} HP`];
    }
    return [];
  }

  const lines: string[] = [];
  for (const { key, label } of STAT_FIELDS) {
    const val = stats[key];
    if (typeof val === 'number' && val !== 0) lines.push(`${label} ${val > 0 ? '+' : ''}${val}`);
  }
  if (typeof stats.armor_bonus === 'number' && stats.armor_bonus !== 0) {
    lines.push(`Armor +${stats.armor_bonus}`);
  }
  if (typeof stats.damage === 'number' && stats.damage !== 0) {
    lines.push(`Damage ${stats.damage}`);
  }
  if (itemType === 'weapon') {
    const wc = stats.weapon_class === 'range' ? 'Ranged' : 'Melee';
    lines.push(`${wc} weapon`);
    if (stats.weapon_class === 'range' && typeof stats.range === 'number') {
      lines.push(`Range ${stats.range}`);
    }
  }
  if (typeof stats.heal === 'number' && stats.heal !== 0) {
    lines.push(`Heal ${stats.heal}`);
  }
  return lines;
}

function consumableFormFields(form: ItemForm): ItemForm {
  return {
    ...form,
    strength: 0,
    dexterity: 0,
    intelligence: 0,
    durability: 0,
    charisma: 0,
    initiative: 0,
    armor_bonus: 0,
    damage: 0,
    two_handed: false,
    weapon_class: 'melee',
    weapon_range: 4,
    passive: false,
  };
}

function ItemFormFields({
  form,
  onChange,
  secrets,
}: {
  form: ItemForm;
  onChange: (next: ItemForm) => void;
  secrets: SecretOption[];
}) {
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => {
    onChange({ ...form, [key]: value });
  };

  const isConsumable = form.item_type === 'consumable';
  const isSecret = form.item_type === 'secret';

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Name</label>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} required />
      </div>
      <div>
        <label className="label">Type</label>
        <select
          className="input"
          value={form.item_type}
          onChange={(e) => {
            const item_type = e.target.value;
            onChange(item_type === 'consumable' ? consumableFormFields({ ...form, item_type }) : { ...form, item_type });
          }}
        >
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Tier</label>
        <input
          className="input"
          type="number"
          min={1}
          max={5}
          value={form.tier}
          onChange={(e) => set('tier', +e.target.value)}
        />
      </div>
      <div>
        <label className="label">Base price (copper)</label>
        <input
          className="input"
          type="number"
          min={0}
          value={form.base_price}
          onChange={(e) => set('base_price', +e.target.value)}
        />
        <p className="mt-1 text-xs text-stone-500">Shop buy/sell prices use this value in copper.</p>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
      </div>

      {isSecret ? (
        <div>
          <label className="label">Secret template</label>
          <select
            className="input"
            value={form.secret_template_id}
            onChange={(e) => set('secret_template_id', +e.target.value)}
            required
          >
            <option value={0}>Select secret...</option>
            {secrets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-stone-500">Puzzle logic and rewards come from the secret template.</p>
        </div>
      ) : isConsumable ? (
        <div>
          <label className="label">Healing (HP on use)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={form.heal}
            onChange={(e) => set('heal', +e.target.value)}
          />
          <p className="mt-1 text-xs text-stone-500">Leave at 0 for non-healing consumables (e.g. torch, rope).</p>
        </div>
      ) : (
        <>
          <fieldset className="space-y-2 rounded border border-dungeon-700 p-3">
            <legend className="px-1 text-sm font-medium text-dungeon-300">Stat bonuses</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAT_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    className="input"
                    type="number"
                    value={form[key]}
                    onChange={(e) => set(key, +e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="label">Armor bonus</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.armor_bonus}
                  onChange={(e) => set('armor_bonus', +e.target.value)}
                />
              </div>
              <div>
                <label className="label">Damage</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={form.damage}
                  onChange={(e) => set('damage', +e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          {form.item_type === 'weapon' && (
            <>
              <div>
                <label className="label">Weapon class</label>
                <select
                  className="input"
                  value={form.weapon_class}
                  onChange={(e) => {
                    const weapon_class = e.target.value as 'melee' | 'range';
                    onChange({
                      ...form,
                      weapon_class,
                      two_handed: weapon_class === 'range' ? true : form.two_handed,
                    });
                  }}
                >
                  <option value="melee">Melee</option>
                  <option value="range">Ranged (two-handed)</option>
                </select>
              </div>
              {form.weapon_class === 'range' && (
                <div>
                  <label className="label">Range (cells)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={9}
                    value={form.weapon_range}
                    onChange={(e) => set('weapon_range', +e.target.value)}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.weapon_class === 'range' ? true : form.two_handed}
                  disabled={form.weapon_class === 'range'}
                  onChange={(e) => set('two_handed', e.target.checked)}
                />
                Two-handed (needs both hands free)
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.passive} onChange={(e) => set('passive', e.target.checked)} />
            Passive (applies stats from bag without equipping)
          </label>
        </>
      )}
    </div>
  );
}

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [secrets, setSecrets] = useState<SecretOption[]>([]);
  const [form, setForm] = useState<ItemForm>(defaultForm);
  const [editing, setEditing] = useState<{ id: number; is_system: boolean; form: ItemForm } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const load = () => {
    api.get<Item[]>('/items').then(setItems);
    api.get<SecretOption[]>('/secrets').then(setSecrets);
  };

  useEffect(() => { load(); }, []);

  const buildItemPayload = (f: ItemForm) => ({
    name: f.name,
    item_type: f.item_type,
    tier: f.tier,
    description: f.description,
    stats: buildStats(f),
    secret_template_id: f.item_type === 'secret' ? f.secret_template_id || null : null,
    base_price: f.base_price,
  });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/items', buildItemPayload(form));
    setForm(defaultForm());
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.patch(`/items/${editing.id}`, buildItemPayload(editing.form));
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
          <ItemFormFields form={form} onChange={setForm} secrets={secrets} />
          <button className="btn-primary" type="submit">Add Item</button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Item Pool</h2>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {items.map((item) => {
              const statLines = formatItemStats(item.item_type, item.stats);
              return (
                <div key={item.id} className="rounded border border-dungeon-600 p-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="shrink-0 text-stone-500">T{item.tier} {item.item_type}</span>
                  </div>
                  {(item.base_price ?? 0) > 0 && (
                    <p className="text-xs text-dungeon-400">{item.base_price} copper</p>
                  )}
                  <div className="text-xs text-dungeon-400">
                    {item.is_system && <span>(base)</span>}
                    {Boolean(item.stats.passive) && <span className="ml-1">(passive)</span>}
                    {Boolean(item.stats.two_handed) && <span className="ml-1">(two-handed)</span>}
                  </div>
                  {item.description && <p className="text-stone-400">{item.description}</p>}
                  {statLines.length > 0 && (
                    <p className="text-xs text-stone-500">{statLines.join(' · ')}</p>
                  )}
                  <div className="mt-1 flex gap-1">
                    <button
                      className="btn-secondary px-2 py-0.5 text-xs"
                      onClick={() => setEditing({ id: item.id, is_system: item.is_system, form: formFromItem(item) })}
                    >
                      Edit
                    </button>
                    {!item.is_system && (
                      <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteId(item.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto">
            <h3 className="font-semibold">
              Edit Item
              {editing.is_system && <span className="ml-2 text-sm font-normal text-dungeon-400">(base item)</span>}
            </h3>
            <ItemFormFields form={editing.form} onChange={(next) => setEditing({ ...editing, form: next })} secrets={secrets} />
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
