import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout, StatEditor } from '../../components/Layout';
import type { Character, UserInfo } from '../../api/client';

interface StatLog {
  id: number;
  stat_name: string;
  old_value: number;
  new_value: number;
  reason: string | null;
  timestamp: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [editStats, setEditStats] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [historyCharId, setHistoryCharId] = useState<number | null>(null);
  const [statHistory, setStatHistory] = useState<StatLog[]>([]);

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

  const doResetPassword = async () => {
    if (!resetUserId || !resetPassword) return;
    await api.patch(`/users/${resetUserId}`, { password: resetPassword });
    setResetUserId(null);
    setResetPassword('');
  };

  const doDeleteUser = async () => {
    if (!deleteUserId) return;
    await api.delete(`/users/${deleteUserId}`);
    setDeleteUserId(null);
    load();
  };

  const openHistory = async (charId: number) => {
    setHistoryCharId(charId);
    const logs = await api.get<StatLog[]>(`/characters/${charId}/stat-history`);
    setStatHistory(logs);
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
          <ul className="mt-4 space-y-2 text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-dungeon-700 p-2">
                <span className="text-stone-400">{u.username} {u.has_character ? '✓ character' : '(no character)'}</span>
                <div className="flex gap-1">
                  <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setResetUserId(u.id)}>Reset PW</button>
                  <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteUserId(u.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Edit Character Stats</h2>
          <div className="space-y-2">
            {characters.map((c) => (
              <div key={c.id} className="flex gap-2">
                <button className="flex-1 rounded border border-dungeon-600 p-2 text-left hover:bg-dungeon-700" onClick={() => openEditor(c)}>
                  {c.name} ({c.username}) — HP {c.current_hp}/{c.max_hp}
                </button>
                <button className="btn-secondary px-2 text-xs" onClick={() => openHistory(c.id)}>History</button>
              </div>
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

      {resetUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-sm w-full space-y-3">
            <h3 className="font-semibold">Reset Password</h3>
            <input className="input" type="password" placeholder="New password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary" onClick={doResetPassword}>Save</button>
              <button className="btn-secondary" onClick={() => setResetUserId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteUserId && (
        <ConfirmDialog
          title="Delete User"
          message="This will permanently delete the user and their character. Continue?"
          onConfirm={doDeleteUser}
          onCancel={() => setDeleteUserId(null)}
        />
      )}

      {historyCharId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full max-h-[60vh] overflow-y-auto">
            <h3 className="mb-3 font-semibold">Stat Change History</h3>
            {statHistory.length === 0 && <p className="text-stone-500 text-sm">No changes recorded.</p>}
            {statHistory.map((log) => (
              <div key={log.id} className="mb-2 border-b border-dungeon-700 pb-2 text-sm">
                <span className="text-dungeon-400">{log.stat_name}</span>: {log.old_value} → {log.new_value}
                {log.reason && <span className="text-stone-500"> ({log.reason})</span>}
                <div className="text-xs text-stone-600">{new Date(log.timestamp).toLocaleString()}</div>
              </div>
            ))}
            <button className="btn-secondary mt-2" onClick={() => setHistoryCharId(null)}>Close</button>
          </div>
        </div>
      )}
    </Layout>
  );
}
