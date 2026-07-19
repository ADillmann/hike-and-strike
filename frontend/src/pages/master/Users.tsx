import { useEffect, useState } from 'react';
import { api, REWARDS_BLOCKED_DURING_BATTLE, type Character, type UserInfo } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout, StatEditor } from '../../components/Layout';
import {
  allowedSlotsForEffect,
  canAddResolved,
  needsSlotChoice,
  type SlotKind,
} from '../../utils/skillSlots';

interface StatLog {
  id: number;
  stat_name: string;
  old_value: number;
  new_value: number;
  reason: string | null;
  timestamp: string;
}

interface SkillTemplateOption {
  id: number;
  name: string;
  max_uses_per_rest: number;
  effect_type?: string;
}

const STAT_NAMES = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [skillTemplates, setSkillTemplates] = useState<SkillTemplateOption[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [editStats, setEditStats] = useState<Record<string, number>>({});
  const [addSkillId, setAddSkillId] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deleteUserId, setDeleteUserId] = useState<number | null>(null);
  const [historyCharId, setHistoryCharId] = useState<number | null>(null);
  const [statHistory, setStatHistory] = useState<StatLog[]>([]);
  const [pendingAddSkill, setPendingAddSkill] = useState<{
    templateId: number;
    name: string;
    effectType: string;
    slotKind: SlotKind | null;
  } | null>(null);
  const [pendingRemoveSkill, setPendingRemoveSkill] = useState<{ skillId: number; name: string } | null>(null);
  const [grantXpAmount, setGrantXpAmount] = useState(100);
  const [pendingGrantXp, setPendingGrantXp] = useState(false);
  const [pendingReleaseStat, setPendingReleaseStat] = useState<string | null>(null);

  const load = () => {
    api.get<UserInfo[]>('/users').then(setUsers);
    api.get<Character[]>('/characters').then(setCharacters);
    api.get<SkillTemplateOption[]>('/skills').then((rows) => {
      setSkillTemplates(rows);
      if (rows[0]) setAddSkillId(rows[0].id);
    });
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

  const openEditor = async (c: Character) => {
    const fresh = await api.get<Character>(`/characters/${c.id}`);
    setSelectedChar(fresh);
    setEditStats({ ...fresh.stats, current_hp: fresh.current_hp, max_hp: fresh.max_hp });
    setReason('');
  };

  const grantXp = async () => {
    if (!selectedChar || grantXpAmount <= 0) return;
    setError('');
    try {
      const updated = await api.post<Character>(`/characters/${selectedChar.id}/grant-xp`, { amount: grantXpAmount });
      setSelectedChar(updated);
      setEditStats({ ...updated.stats, current_hp: updated.current_hp, max_hp: updated.max_hp });
      setPendingGrantXp(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant XP');
      setPendingGrantXp(false);
    }
  };

  const releaseStat = async () => {
    if (!selectedChar || !pendingReleaseStat) return;
    const updated = await api.post<Character>(`/characters/${selectedChar.id}/release-stat`, { stat: pendingReleaseStat });
    setSelectedChar(updated);
    setEditStats({ ...updated.stats, current_hp: updated.current_hp, max_hp: updated.max_hp });
    setPendingReleaseStat(null);
    load();
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

  const assignSkill = async () => {
    if (!selectedChar || !pendingAddSkill) return;
    if (needsSlotChoice(pendingAddSkill.effectType) && !pendingAddSkill.slotKind) {
      setError('Choose a skill slot');
      return;
    }
    try {
      const updated = await api.post<Character>(`/characters/${selectedChar.id}/skills`, {
        skill_template_id: pendingAddSkill.templateId,
        ...(pendingAddSkill.slotKind ? { slot_kind: pendingAddSkill.slotKind } : {}),
      });
      setSelectedChar(updated);
      setPendingAddSkill(null);
      setError('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign skill');
    }
  };

  const removeSkill = async () => {
    if (!selectedChar || !pendingRemoveSkill) return;
    const updated = await api.delete<Character>(
      `/characters/${selectedChar.id}/skills/${pendingRemoveSkill.skillId}`,
    );
    setSelectedChar(updated);
    setPendingRemoveSkill(null);
    load();
  };

  const requestAddSkill = () => {
    if (!selectedChar || !addSkillId) return;
    const template = skillTemplates.find((t) => t.id === addSkillId);
    if (!template) return;
    setPendingAddSkill({
      templateId: template.id,
      name: template.name,
      effectType: template.effect_type || 'none',
      slotKind: null,
    });
  };

  const requestRemoveSkill = (skillId: number, name: string) => {
    setPendingRemoveSkill({ skillId, name });
  };

  const assignedTemplateIds = new Set(
    (selectedChar?.skills || []).map((s) => s.skill_template_id).filter((id): id is number => id != null),
  );
  const availableToAssign = skillTemplates.filter((t) => !assignedTemplateIds.has(t.id));

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
                  {c.name} ({c.username}) — Lv {c.level ?? 1} — HP {c.current_hp}/{c.max_hp}
                </button>
                <button className="btn-secondary px-2 text-xs" onClick={() => openHistory(c.id)}>History</button>
              </div>
            ))}
          </div>
          {selectedChar && (
            <div className="mt-4 space-y-3 border-t border-dungeon-600 pt-4">
              <h3 className="font-medium">{selectedChar.name}</h3>
              <p className="text-sm text-stone-400">
                Level {selectedChar.level ?? 1} — XP {selectedChar.xp ?? 0} / {selectedChar.xp_to_next_level ?? 100}
                {' '}— Free stat points: {selectedChar.stat_points_free ?? 0}
              </p>
              {selectedChar.in_active_battle && (
                <p className="rounded border border-amber-800/60 bg-amber-950/30 p-2 text-sm text-amber-300">
                  {REWARDS_BLOCKED_DURING_BATTLE}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <input
                  className="input w-28"
                  type="number"
                  min={1}
                  value={grantXpAmount}
                  onChange={(e) => setGrantXpAmount(+e.target.value)}
                  disabled={selectedChar.in_active_battle}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPendingGrantXp(true)}
                  disabled={grantXpAmount <= 0 || selectedChar.in_active_battle}
                >
                  Grant XP
                </button>
              </div>
              <StatEditor stats={editStats} onChange={(s, v) => setEditStats({ ...editStats, [s]: Math.max(1, v) })} />
              <div className="space-y-1">
                <p className="text-xs text-stone-500">Release level-allocated stat points back to free pool:</p>
                <div className="flex flex-wrap gap-1">
                  {STAT_NAMES.map((stat) => {
                    const bumps = selectedChar.level_stat_allocations?.[stat] ?? 0;
                    if (bumps <= 0) return null;
                    return (
                      <button
                        key={stat}
                        type="button"
                        className="btn-danger px-2 py-0.5 text-xs"
                        onClick={() => setPendingReleaseStat(stat)}
                      >
                        Release {stat.slice(0, 3)} ({bumps})
                      </button>
                    );
                  })}
                </div>
              </div>
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
              <div className="border-t border-dungeon-600 pt-3">
                <h4 className="mb-2 font-medium text-dungeon-300">Skills</h4>
                {selectedChar.skills.length === 0 && (
                  <p className="mb-2 text-sm text-stone-500">No skills assigned.</p>
                )}
                <div className="space-y-1">
                  {selectedChar.skills.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded border border-dungeon-700 p-2 text-sm">
                      <span>
                        {s.name} ({s.uses_remaining}/{s.max_uses_per_rest})
                        {s.slot_kind && <span className="ml-1 text-xs text-stone-500">· {s.slot_kind}</span>}
                      </span>
                      <button type="button" className="btn-danger px-2 py-0.5 text-xs" onClick={() => requestRemoveSkill(s.id, s.name)}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                {availableToAssign.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select className="input flex-1" value={addSkillId} onChange={(e) => setAddSkillId(+e.target.value)}>
                      {availableToAssign.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-secondary" onClick={requestAddSkill}>Add skill</button>
                  </div>
                )}
              </div>
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

      {pendingAddSkill && selectedChar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-sm w-full space-y-3">
            <h3 className="font-semibold text-dungeon-300">Add Skill</h3>
            <p className="text-sm text-stone-400">
              Add &quot;{pendingAddSkill.name}&quot; to {selectedChar.name}?
            </p>
            {needsSlotChoice(pendingAddSkill.effectType) && (
              <div className="flex flex-wrap gap-2">
                <span className="self-center text-xs text-stone-400">Place in:</span>
                {allowedSlotsForEffect(pendingAddSkill.effectType).map((slot) => {
                  const owned = selectedChar.skills.map((s) => s.slot_kind || 'support');
                  const fits = canAddResolved(selectedChar.stats || {}, owned, slot);
                  return (
                    <button
                      key={slot}
                      type="button"
                      className={`btn-secondary px-2 py-0.5 text-xs capitalize ${
                        pendingAddSkill.slotKind === slot ? 'ring-1 ring-dungeon-300' : ''
                      }`}
                      disabled={!fits}
                      onClick={() => setPendingAddSkill({ ...pendingAddSkill, slotKind: slot })}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={needsSlotChoice(pendingAddSkill.effectType) && !pendingAddSkill.slotKind}
                onClick={assignSkill}
              >
                Add
              </button>
              <button type="button" className="btn-secondary" onClick={() => setPendingAddSkill(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoveSkill && selectedChar && (
        <ConfirmDialog
          title="Remove Skill"
          message={`Remove "${pendingRemoveSkill.name}" from ${selectedChar.name}?`}
          confirmLabel="Remove"
          onConfirm={removeSkill}
          onCancel={() => setPendingRemoveSkill(null)}
        />
      )}

      {pendingGrantXp && selectedChar && (
        <ConfirmDialog
          title="Grant XP"
          message={`Grant ${grantXpAmount} XP to ${selectedChar.name}?`}
          confirmLabel="Grant"
          onConfirm={grantXp}
          onCancel={() => setPendingGrantXp(false)}
        />
      )}

      {pendingReleaseStat && selectedChar && (
        <ConfirmDialog
          title="Release Stat Point"
          message={`Release one level-allocated point from ${selectedChar.name}'s ${pendingReleaseStat}? Points will return to their free pool.`}
          confirmLabel="Release"
          onConfirm={releaseStat}
          onCancel={() => setPendingReleaseStat(null)}
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
