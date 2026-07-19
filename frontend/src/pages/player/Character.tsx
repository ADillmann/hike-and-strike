import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ClassTemplate } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImageUpload } from '../../components/ImageUpload';
import { Layout, StatBadge } from '../../components/Layout';
import { useLocale } from '../../context/LocaleContext';
import type { Character } from '../../api/client';
import { formatBattleMods, formatStatMods } from '../../utils/effects';
import {
  allowedSlotsForEffect,
  canAddResolved,
  needsSlotChoice,
  normalizeEffectType,
  resolveSlot,
  slotCapacity,
  slotUsageFromKinds,
  type SlotKind,
} from '../../utils/skillSlots';

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
const DEFAULT_STATS = Object.fromEntries(STAT_NAMES.map((s) => [s, 8]));
const MAX_STARTER_SKILLS = 2;
const STAT_CAP_CREATE = 15;

interface StarterSkill {
  id: number;
  name: string;
  max_uses_per_rest: number;
  description: string;
  effect_type: string;
}

type StarterPick = { skillId: number; slotKind: SlotKind };

export default function CharacterCreatePage() {
  const [classes, setClasses] = useState<ClassTemplate[]>([]);
  const [bonusPool, setBonusPool] = useState(27);
  const [starterSkills, setStarterSkills] = useState<StarterSkill[]>([]);
  const [name, setName] = useState('');
  const [classId, setClassId] = useState<number | null>(null);
  const [baseStats, setBaseStats] = useState<Record<string, number>>(DEFAULT_STATS);
  const [stats, setStats] = useState<Record<string, number>>(DEFAULT_STATS);
  const [picks, setPicks] = useState<StarterPick[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { t } = useLocale();

  useEffect(() => {
    Promise.all([
      api.get<ClassTemplate[]>('/player/classes'),
      api.get<{ creation_bonus_points: number }>('/player/creation-settings'),
      api.get<StarterSkill[]>('/player/starter-skills'),
    ]).then(([cls, settings, skills]) => {
      setClasses(cls);
      setBonusPool(settings.creation_bonus_points);
      setStarterSkills(skills);
      if (cls[0]) {
        setClassId(cls[0].id);
        const bases = { ...DEFAULT_STATS, ...cls[0].base_stats };
        setBaseStats(bases);
        setStats(bases);
      }
    });
  }, []);

  const selectedClass = classes.find((c) => c.id === classId) || null;

  const pointCost = (v: number) => (v <= 13 ? v - 8 : v - 8 + (v - 13));
  const bonusSpent = STAT_NAMES.reduce(
    (sum, s) => sum + (pointCost(stats[s] || 8) - pointCost(baseStats[s] || 8)),
    0,
  );

  const selectedKinds = useMemo(() => picks.map((p) => p.slotKind), [picks]);
  const slotLine = useMemo(() => {
    const capacity = slotCapacity(stats);
    const used = slotUsageFromKinds(selectedKinds);
    return `${t('slots.melee')} ${used.melee}/${capacity.melee} · ${t('slots.range')} ${used.range}/${capacity.range} · ${t('slots.support')} ${used.support}/${capacity.support}`;
  }, [stats, selectedKinds, t]);

  const onClassChange = (id: number) => {
    setClassId(id);
    const cls = classes.find((c) => c.id === id);
    if (!cls) return;
    const bases = { ...DEFAULT_STATS, ...cls.base_stats };
    setBaseStats(bases);
    setStats(bases);
    setPicks([]);
  };

  const adjust = (stat: string, delta: number) => {
    const floor = baseStats[stat] || 8;
    const next = Math.min(STAT_CAP_CREATE, Math.max(floor, (stats[stat] || 8) + delta));
    const candidate = { ...stats, [stat]: next };
    const spent = STAT_NAMES.reduce(
      (sum, s) => sum + (pointCost(candidate[s] || 8) - pointCost(baseStats[s] || 8)),
      0,
    );
    if (spent > bonusPool) return;
    setStats(candidate);
    setPicks((prev) => {
      const kept: StarterPick[] = [];
      for (const pick of prev) {
        if (canAddResolved(candidate, kept.map((p) => p.slotKind), pick.slotKind)) {
          kept.push(pick);
        }
      }
      return kept;
    });
  };

  /** Fixed-type skills only (melee/range/support). Heal/none use setFlexibleSlot. */
  const toggleFixedSkill = (skill: StarterSkill) => {
    const already = picks.some((p) => p.skillId === skill.id);
    if (already) {
      setPicks((prev) => prev.filter((p) => p.skillId !== skill.id));
      return;
    }
    if (needsSlotChoice(skill.effect_type)) {
      setError(t('character.err_use_slot_buttons', { name: skill.name }));
      return;
    }
    if (picks.length >= MAX_STARTER_SKILLS) return;
    let slot: SlotKind | null = null;
    try {
      slot = resolveSlot(skill.effect_type, null);
    } catch {
      slot = null;
    }
    const otherKinds = picks.map((p) => p.slotKind);
    if (!slot || !canAddResolved(stats, otherKinds, slot)) {
      setError(t('character.err_no_free_slot'));
      return;
    }
    setError('');
    setPicks((prev) => [...prev, { skillId: skill.id, slotKind: slot }]);
  };

  /** Heal / passive: choosing a slot is what selects the skill. */
  const setFlexibleSlot = (skill: StarterSkill, slot: SlotKind) => {
    const without = picks.filter((p) => p.skillId !== skill.id);
    if (!canAddResolved(stats, without.map((p) => p.slotKind), slot)) {
      setError(t('character.err_no_free_named_slot', { slot: t(`slots.${slot}`) }));
      return;
    }
    const already = picks.some((p) => p.skillId === skill.id);
    if (!already && without.length >= MAX_STARTER_SKILLS) {
      setError(t('character.err_clear_one_first', { n: MAX_STARTER_SKILLS }));
      return;
    }
    setError('');
    setPicks([...without, { skillId: skill.id, slotKind: slot }]);
  };

  const clearPick = (skillId: number) => {
    setPicks((prev) => prev.filter((p) => p.skillId !== skillId));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!classId) { setError(t('character.err_pick_class')); return; }
    if (bonusSpent > bonusPool) { setError(t('character.err_too_many_bonus')); return; }
    if (picks.length !== MAX_STARTER_SKILLS) {
      setError(t('character.err_pick_starter', { n: MAX_STARTER_SKILLS }));
      return;
    }
    for (const pick of picks) {
      if (pick.slotKind !== 'melee' && pick.slotKind !== 'range' && pick.slotKind !== 'support') {
        const skill = starterSkills.find((s) => s.id === pick.skillId);
        setError(t('character.err_choose_slot', { name: skill?.name ?? '' }));
        return;
      }
    }
    const starter_skills = picks.map((p) => ({
      skill_template_id: p.skillId,
      slot_kind: p.slotKind as string,
    }));
    try {
      await api.post('/characters', {
        name,
        class_template_id: classId,
        stats,
        starter_skills,
      });
      navigate('/character');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.failed'));
    }
  };

  return (
    <Layout title={t('character.create_title')}>
      <form onSubmit={submit} className="card mx-auto max-w-lg space-y-4">
        <h2 className="text-xl font-semibold text-dungeon-300">{t('character.forge_heading')}</h2>
        {error && <p className="text-red-400">{error}</p>}
        <div>
          <label className="label">{t('character.name')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">{t('character.class')}</label>
          <select
            className="input"
            value={classId ?? ''}
            onChange={(e) => onClassChange(Number(e.target.value))}
            required
          >
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {selectedClass?.description && (
            <p className="mt-1 text-sm text-stone-400">{selectedClass.description}</p>
          )}
        </div>
        <div>
          <div className="mb-2 flex justify-between">
            <span className="label mb-0">{t('character.attributes')}</span>
            <span className="text-sm text-stone-400">{t('character.bonus', { spent: bonusSpent, pool: bonusPool })}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STAT_NAMES.map((s) => (
              <div key={s} className="flex items-center gap-2 rounded border border-dungeon-600 p-2">
                <span className="flex-1 text-sm">{t(`stats.${s}`)}</span>
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => adjust(s, -1)}>-</button>
                <span>{stats[s]}</span>
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => adjust(s, 1)}>+</button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-500">{t('character.class_floors', { cap: STAT_CAP_CREATE })}</p>
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <span className="label mb-0">{t('character.skill_slots')}</span>
            <span className="text-sm text-stone-400">{slotLine}</span>
          </div>
          <p className="text-xs text-stone-500">
            {t('character.slots_help')}
          </p>
        </div>
        <div>
          <div className="mb-2 flex justify-between">
            <span className="label mb-0">{t('character.starter_skills')}</span>
            <span className="text-sm text-stone-400">{picks.length}/{MAX_STARTER_SKILLS}</span>
          </div>
          <div className="space-y-2">
            {starterSkills.map((s) => {
              const selected = picks.some((p) => p.skillId === s.id);
              const flexible = needsSlotChoice(s.effect_type);
              const chosenSlot = picks.find((p) => p.skillId === s.id)?.slotKind ?? null;
              const otherKinds = picks.filter((p) => p.skillId !== s.id).map((p) => p.slotKind);
              let fixedSlot: SlotKind | null = null;
              if (!flexible) {
                try {
                  fixedSlot = resolveSlot(s.effect_type, null);
                } catch {
                  fixedSlot = null;
                }
              }
              const flexibleSlots = flexible ? allowedSlotsForEffect(s.effect_type) : [];
              const anySlotFree = flexible
                ? flexibleSlots.some((slot) => canAddResolved(stats, otherKinds, slot))
                : fixedSlot != null && canAddResolved(stats, otherKinds, fixedSlot);
              const atCap = !selected && picks.length >= MAX_STARTER_SKILLS;
              const rowDisabled = atCap || (!selected && !anySlotFree);
              return (
                <div
                  key={s.id}
                  className={`rounded border p-3 ${
                    selected ? 'border-dungeon-400 bg-dungeon-800/40' : 'border-dungeon-600'
                  } ${rowDisabled ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!flexible && (
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selected}
                        onChange={() => toggleFixedSkill(s)}
                        disabled={rowDisabled && !selected}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-xs text-stone-500">
                          {normalizeEffectType(s.effect_type)} · {t('character.uses_per_rest', { n: s.max_uses_per_rest })}
                        </span>
                      </div>
                      {s.description && <p className="mt-0.5 text-xs text-stone-500">{s.description}</p>}
                      {!flexible && fixedSlot && (
                        <p className="mt-1 text-xs text-dungeon-300">{t('character.uses_slot', { slot: t(`slots.${fixedSlot}`) })}</p>
                      )}
                      {flexible && (
                        <div className="mt-3 rounded border border-dashed border-dungeon-500 bg-dungeon-900/50 p-2">
                          <p className="mb-2 text-xs font-medium text-dungeon-200">
                            {selected && chosenSlot
                              ? t('character.selected_in_slot', { slot: t(`slots.${chosenSlot}`) })
                              : t('character.choose_range_support')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {flexibleSlots.map((slot) => {
                              const slotFits = canAddResolved(stats, otherKinds, slot);
                              const canSelect = slotFits && (!atCap || selected);
                              return (
                                <button
                                  key={slot}
                                  type="button"
                                  className={`btn-secondary ${
                                    chosenSlot === slot ? 'ring-2 ring-dungeon-300' : ''
                                  }`}
                                  disabled={!canSelect}
                                  onClick={() => setFlexibleSlot(s, slot)}
                                >
                                  {t(`slots.${slot}`)}
                                </button>
                              );
                            })}
                            {selected && (
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => clearPick(s.id)}
                              >
                                {t('common.clear')}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {!anySlotFree && !selected && (
                        <p className="mt-1 text-xs text-red-400">{t('character.no_free_slot_stats')}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <button className="btn-primary w-full" type="submit">{t('character.create_button')}</button>
      </form>
    </Layout>
  );
}

export function CharacterSheetPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [pendingStat, setPendingStat] = useState<{ stat: string; cost: number } | null>(null);
  const navigate = useNavigate();
  const { t } = useLocale();

  const load = () => {
    api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));
  };

  useEffect(() => { load(); }, [navigate]);

  const uploadPortrait = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    await api.post('/characters/me/portrait', fd);
    load();
  };

  const allocateStat = async () => {
    if (!pendingStat) return;
    await api.post('/characters/me/allocate-stat', { stat: pendingStat.stat });
    setPendingStat(null);
    load();
  };

  if (!character) return <Layout title={t('character.title')}>{t('common.loading')}</Layout>;

  const eff = character.effective_stats || character.stats;
  const base = character.stats;
  const freePoints = character.stat_points_free ?? 0;
  const raiseCosts = character.stat_raise_costs ?? {};

  return (
    <Layout title={t('character.sheet_title')}>
      <div className="card">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            {character.portrait_path && (
              <img src={character.portrait_path} alt={character.name} className="mb-2 h-24 w-24 rounded object-cover" />
            )}
            <ImageUpload label={t('character.portrait')} onUpload={uploadPortrait} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-dungeon-300">{character.name}</h2>
            <p className="text-stone-400">{t('character.class_label', { name: character.race })}</p>
            <p className="mt-1">
              {t('character.level_xp', {
                level: character.level ?? 1,
                xp: character.xp ?? 0,
                next: character.xp_to_next_level ?? 100,
              })}
            </p>
            <p className="text-sm text-dungeon-300">{t('character.free_stat_points', { n: freePoints })}</p>
            <p className="mt-1">{t('character.hp', { current: character.current_hp, max: character.max_hp })}</p>
            <p>{t('character.attack_bonus', { value: character.attack_bonus ?? '—' })}</p>
          </div>
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-sm text-stone-400">{t('character.base_stats')}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {STAT_NAMES.map((s) => {
              const current = base[s] || 8;
              const cost = raiseCosts[s] ?? 0;
              const canRaise = cost > 0 && freePoints >= cost;
              return (
                <div key={s} className="flex items-center gap-2 rounded border border-dungeon-600 p-2">
                  <div className="flex-1">
                    <StatBadge label={t(`stats.${s}`)} value={eff[s] || current} />
                    <p className="text-center text-xs text-stone-500">
                      {t('character.base_value', { current })}
                      {(eff[s] || current) !== current && ` ${t('character.eff_value', { value: eff[s] })}`}
                    </p>
                  </div>
                  {canRaise && (
                    <button
                      type="button"
                      className="btn-secondary px-2 py-0.5 text-xs"
                      onClick={() => setPendingStat({ stat: s, cost })}
                    >
                      {t('character.raise_cost', { cost })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {character.skills.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm text-stone-400">{t('character.skills_heading')}</h3>
            <div className="space-y-1">
              {character.skills.map((s) => (
                <div key={s.id} className="rounded border border-dungeon-700 px-2 py-1 text-sm">
                  {s.name} — {t('skills.uses', { remaining: s.uses_remaining, max: s.max_uses_per_rest })}
                </div>
              ))}
            </div>
          </div>
        )}
        {(character.temporary_effects.length > 0 || (character.item_effects?.length ?? 0) > 0) && (
          <div className="mt-4">
            <h3 className="text-sm text-stone-400">{t('character.effects_heading')}</h3>
            <div className="mt-1 space-y-1">
              {character.temporary_effects.map((e) => {
                const statLine = formatStatMods(e.stat_modifiers);
                const battleLine = formatBattleMods(e.active_in_battle, e.battle_modifiers);
                return (
                  <div key={e.id} className="rounded bg-red-900/50 px-2 py-1 text-xs">
                    <span className="font-medium">{e.label}</span>
                    {statLine && <span className="ml-2 text-stone-400">{statLine}</span>}
                    {battleLine && <span className="ml-2 text-dungeon-300">{battleLine}</span>}
                  </div>
                );
              })}
              {(character.item_effects ?? []).map((e) => {
                const statLine = formatStatMods(e.stat_modifiers);
                const battleLine = formatBattleMods(e.active_in_battle, e.battle_modifiers);
                return (
                  <div key={`item-${e.source_item}-${e.label}`} className="rounded bg-dungeon-800 px-2 py-1 text-xs">
                    <span className="font-medium">{e.label}</span>
                    <span className="ml-2 text-stone-500">{t('character.from_item', { name: e.source_item })}</span>
                    {statLine && <span className="ml-2 text-stone-400">{statLine}</span>}
                    {battleLine && <span className="ml-2 text-dungeon-300">{battleLine}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {pendingStat && (
        <ConfirmDialog
          title={t('character.confirm_spend_title')}
          message={t('character.confirm_spend_message', {
            cost: pendingStat.cost,
            stat: t(`stats.${pendingStat.stat}_full`),
          })}
          confirmLabel={t('character.allocate')}
          onConfirm={allocateStat}
          onCancel={() => setPendingStat(null)}
        />
      )}
    </Layout>
  );
}
