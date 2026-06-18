import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout, StatBadge } from '../../components/Layout';
import type { Character } from '../../api/client';

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
const DEFAULT_STATS = Object.fromEntries(STAT_NAMES.map((s) => [s, 8]));

export default function CharacterCreatePage() {
  const [races, setRaces] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [race, setRace] = useState('Human');
  const [stats, setStats] = useState<Record<string, number>>(DEFAULT_STATS);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<string[]>('/player/races').then((r) => { setRaces(r); setRace(r[0] || 'Human'); });
  }, []);

  const pointCost = (v: number) => (v <= 13 ? v - 8 : v - 8 + (v - 13));
  const totalPoints = STAT_NAMES.reduce((sum, s) => sum + pointCost(stats[s] || 8), 0);

  const adjust = (stat: string, delta: number) => {
    const next = Math.min(15, Math.max(8, (stats[stat] || 8) + delta));
    setStats({ ...stats, [stat]: next });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (totalPoints > 27) { setError('Too many points spent'); return; }
    try {
      await api.post('/characters', { name, race, stats });
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
        <button className="btn-primary w-full" type="submit">Create Character</button>
      </form>
    </Layout>
  );
}

export function CharacterSheetPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));
  }, [navigate]);

  if (!character) return <Layout title="Character">Loading...</Layout>;

  const eff = character.effective_stats || character.stats;

  return (
    <Layout title="Character Sheet">
      <div className="card">
        <div className="flex flex-wrap items-start gap-4">
          {character.portrait_path && (
            <img src={character.portrait_path} alt={character.name} className="h-24 w-24 rounded object-cover" />
          )}
          <div>
            <h2 className="text-2xl font-bold text-dungeon-300">{character.name}</h2>
            <p className="text-stone-400">{character.race}</p>
            <p className="mt-1">HP: {character.current_hp} / {character.max_hp}</p>
            <p>Attack bonus: {character.attack_bonus ?? '—'}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {STAT_NAMES.map((s) => (
            <StatBadge key={s} label={s.slice(0, 3)} value={eff[s] || character.stats[s] || 8} />
          ))}
        </div>
        {character.temporary_effects.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm text-stone-400">Active effects</h3>
            {character.temporary_effects.map((e) => (
              <span key={e.id} className="mr-2 rounded bg-red-900/50 px-2 py-1 text-xs">{e.label}</span>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
