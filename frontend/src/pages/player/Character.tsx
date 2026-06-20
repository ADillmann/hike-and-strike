import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ImageUpload } from '../../components/ImageUpload';
import { Layout, StatBadge } from '../../components/Layout';
import type { Character } from '../../api/client';
import { formatBattleMods, formatStatMods } from '../../utils/effects';

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
const DEFAULT_STATS = Object.fromEntries(STAT_NAMES.map((s) => [s, 8]));
const MAX_SKILLS = 3;

interface StarterSkill {
  id: number;
  name: string;
  max_uses_per_rest: number;
  description: string;
}

export default function CharacterCreatePage() {
  const [races, setRaces] = useState<string[]>([]);
  const [starterSkills, setStarterSkills] = useState<StarterSkill[]>([]);
  const [name, setName] = useState('');
  const [race, setRace] = useState('Human');
  const [stats, setStats] = useState<Record<string, number>>(DEFAULT_STATS);
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<string[]>('/player/races').then((r) => { setRaces(r); setRace(r[0] || 'Human'); });
    api.get<StarterSkill[]>('/player/starter-skills').then(setStarterSkills);
  }, []);

  const pointCost = (v: number) => (v <= 13 ? v - 8 : v - 8 + (v - 13));
  const totalPoints = STAT_NAMES.reduce((sum, s) => sum + pointCost(stats[s] || 8), 0);

  const adjust = (stat: string, delta: number) => {
    const next = Math.min(15, Math.max(8, (stats[stat] || 8) + delta));
    setStats({ ...stats, [stat]: next });
  };

  const toggleSkill = (skillId: number) => {
    setSelectedSkillIds((prev) => {
      if (prev.includes(skillId)) return prev.filter((s) => s !== skillId);
      if (prev.length >= MAX_SKILLS) return prev;
      return [...prev, skillId];
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (totalPoints > 27) { setError('Too many points spent'); return; }
    if (selectedSkillIds.length < 1) { setError('Pick at least 1 skill'); return; }
    try {
      await api.post('/characters', { name, race, stats, skill_template_ids: selectedSkillIds });
      navigate('/character');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <Layout title="Create Character">
      <form onSubmit={submit} className="card mx-auto max-w-lg space-y-4">
        <h2 className="text-xl font-semibold text-dungeon-300">Forge Your Hero</h2>
        {error && <p className="text-red-400">{error}</p>}
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Race</label>
          <select className="input" value={race} onChange={(e) => setRace(e.target.value)}>
            {races.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <div className="mb-2 flex justify-between">
            <span className="label mb-0">Attributes</span>
            <span className="text-sm text-stone-400">Points: {totalPoints}/27</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STAT_NAMES.map((s) => (
              <div key={s} className="flex items-center gap-2 rounded border border-dungeon-600 p-2">
                <span className="flex-1 text-sm capitalize">{s.slice(0, 3)}</span>
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => adjust(s, -1)}>-</button>
                <span>{stats[s]}</span>
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => adjust(s, 1)}>+</button>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex justify-between">
            <span className="label mb-0">Skills</span>
            <span className="text-sm text-stone-400">{selectedSkillIds.length}/{MAX_SKILLS}</span>
          </div>
          <div className="space-y-1">
            {starterSkills.map((s) => (
              <label key={s.id} className="flex items-start gap-2 rounded border border-dungeon-600 p-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selectedSkillIds.includes(s.id)}
                  onChange={() => toggleSkill(s.id)}
                  disabled={!selectedSkillIds.includes(s.id) && selectedSkillIds.length >= MAX_SKILLS}
                />
                <div>
                  <span>{s.name}</span>
                  <span className="ml-1 text-xs text-stone-500">({s.max_uses_per_rest}/rest)</span>
                  {s.description && <p className="text-xs text-stone-500">{s.description}</p>}
                </div>
              </label>
            ))}
          </div>
        </div>
        <button className="btn-primary w-full" type="submit">Create Character</button>
      </form>
    </Layout>
  );
}

export function CharacterSheetPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const [pendingStat, setPendingStat] = useState<{ stat: string; cost: number } | null>(null);
  const navigate = useNavigate();

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

  if (!character) return <Layout title="Character">Loading...</Layout>;

  const eff = character.effective_stats || character.stats;
  const base = character.stats;
  const freePoints = character.stat_points_free ?? 0;
  const raiseCosts = character.stat_raise_costs ?? {};

  return (
    <Layout title="Character Sheet">
      <div className="card">
        <div className="flex flex-wrap items-start gap-4">
          <div>
            {character.portrait_path && (
              <img src={character.portrait_path} alt={character.name} className="mb-2 h-24 w-24 rounded object-cover" />
            )}
            <ImageUpload label="Portrait" onUpload={uploadPortrait} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-dungeon-300">{character.name}</h2>
            <p className="text-stone-400">{character.race}</p>
            <p className="mt-1">
              Level {character.level ?? 1} — XP {character.xp ?? 0} / {character.xp_to_next_level ?? 100}
            </p>
            <p className="text-sm text-dungeon-300">Free stat points: {freePoints}</p>
            <p className="mt-1">HP: {character.current_hp} / {character.max_hp}</p>
            <p>Attack bonus: {character.attack_bonus ?? '—'}</p>
          </div>
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-sm text-stone-400">Base stats (cap 20)</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {STAT_NAMES.map((s) => {
              const current = base[s] || 8;
              const cost = raiseCosts[s] ?? 0;
              const canRaise = cost > 0 && freePoints >= cost;
              return (
                <div key={s} className="flex items-center gap-2 rounded border border-dungeon-600 p-2">
                  <div className="flex-1">
                    <StatBadge label={s.slice(0, 3)} value={eff[s] || current} />
                    <p className="text-center text-xs text-stone-500">
                      base {current}/20
                      {(eff[s] || current) !== current && ` (eff ${eff[s]})`}
                    </p>
                  </div>
                  {canRaise && (
                    <button
                      type="button"
                      className="btn-secondary px-2 py-0.5 text-xs"
                      onClick={() => setPendingStat({ stat: s, cost })}
                    >
                      + ({cost} pt{cost !== 1 ? 's' : ''})
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {character.skills.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm text-stone-400">Skills</h3>
            <div className="space-y-1">
              {character.skills.map((s) => (
                <div key={s.id} className="rounded border border-dungeon-700 px-2 py-1 text-sm">
                  {s.name} — {s.uses_remaining}/{s.max_uses_per_rest} uses
                </div>
              ))}
            </div>
          </div>
        )}
        {character.temporary_effects.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm text-stone-400">Active effects</h3>
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
            </div>
          </div>
        )}
      </div>

      {pendingStat && (
        <ConfirmDialog
          title="Allocate Stat Point"
          message={`Spend ${pendingStat.cost} free point${pendingStat.cost !== 1 ? 's' : ''} to raise ${pendingStat.stat} by 1? This cannot be undone by you.`}
          confirmLabel="Allocate"
          onConfirm={allocateStat}
          onCancel={() => setPendingStat(null)}
        />
      )}
    </Layout>
  );
}
