import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout, StatEditor } from '../../components/Layout';
import type { Character, UserInfo } from '../../api/client';

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [editStats, setEditStats] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    api.get<UserInfo[]>('/users').then(setUsers);
    api.get<Character[]>('/characters').then(setCharacters);
  };

  useEffect(() => { load(); }, []);

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', { username, password });
      setUsername('');
      setPassword('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  const openEditor = (c: Character) => {
    setSelectedChar(c);
    setEditStats({ ...c.stats, current_hp: c.current_hp, max_hp: c.max_hp });
    setReason('');
  };

  const saveStats = async () => {
    if (!selectedChar) return;
    const changes: Record<string, number> = {};
    for (const [k, v] of Object.entries(editStats)) {
      const old = k === 'current_hp' || k === 'max_hp' ? (selectedChar as unknown as Record<string, number>)[k] : selectedChar.stats[k];
      if (v !== old) changes[k] = v;
    }
    if (Object.keys(changes).length === 0) return;
    await api.patch(`/characters/${selectedChar.id}/stats`, { changes, reason });
    load();
    setSelectedChar(null);
  };

  return (
    <Layout title="Users & Characters">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Create Player</h2>
          {error && <p className="mb-2 text-red-400">{error}</p>}
          <form onSubmit={createUser} className="space-y-3">
            <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn-primary" type="submit">Create User</button>
          </form>
          <ul className="mt-4 space-y-1 text-sm">
            {users.map((u) => (
              <li key={u.id} className="text-stone-400">{u.username} {u.has_character ? '✓ character' : '(no character)'}</li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Edit Character Stats</h2>
          <div className="space-y-2">
            {characters.map((c) => (
              <button key={c.id} className="w-full rounded border border-dungeon-600 p-2 text-left hover:bg-dungeon-700" onClick={() => openEditor(c)}>
                {c.name} ({c.username}) — HP {c.current_hp}/{c.max_hp}
              </button>
            ))}
          </div>
          {selectedChar && (
            <div className="mt-4 space-y-3 border-t border-dungeon-600 pt-4">
              <h3 className="font-medium">{selectedChar.name}</h3>
              <StatEditor stats={editStats} onChange={(s, v) => setEditStats({ ...editStats, [s]: Math.max(1, v) })} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Current HP</label>
                  <input className="input" type="number" value={editStats.current_hp} onChange={(e) => setEditStats({ ...editStats, current_hp: +e.target.value })} />
                </div>
                <div>
                  <label className="label">Max HP</label>
                  <input className="input" type="number" value={editStats.max_hp} onChange={(e) => setEditStats({ ...editStats, max_hp: +e.target.value })} />
                </div>
              </div>
              <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <button className="btn-primary" onClick={saveStats}>Save Permanent Changes</button>
                <button className="btn-secondary" onClick={() => setSelectedChar(null)}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
