import { useEffect, useState } from 'react';
import { api, Character } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Layout } from '../../components/Layout';

interface Group {
  id: number;
  name: string;
  members: { character_id: number; name: string; username: string }[];
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [editMembers, setEditMembers] = useState<number[]>([]);
  const [deleteGroupId, setDeleteGroupId] = useState<number | null>(null);

  const load = () => {
    api.get<Group[]>('/groups').then(setGroups);
    api.get<Character[]>('/characters').then(setCharacters);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/groups', { name, character_ids: selected });
    setName('');
    setSelected([]);
    load();
  };

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleEdit = (id: number) => {
    setEditMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openEdit = (g: Group) => {
    setEditingGroup(g);
    setEditMembers(g.members.map((m) => m.character_id));
  };

  const saveEdit = async () => {
    if (!editingGroup) return;
    await api.patch(`/groups/${editingGroup.id}/members`, editMembers);
    setEditingGroup(null);
    load();
  };

  const doDelete = async () => {
    if (!deleteGroupId) return;
    await api.delete(`/groups/${deleteGroupId}`);
    setDeleteGroupId(null);
    load();
  };

  return (
    <Layout title="Groups">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Create Group</h2>
          <input className="input" placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="space-y-1">
            {characters.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                {c.name} ({c.username})
              </label>
            ))}
          </div>
          <button className="btn-primary" type="submit">Create Group</button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Existing Groups</h2>
          {groups.map((g) => (
            <div key={g.id} className="mb-3 rounded border border-dungeon-600 p-3">
              <div className="flex justify-between">
                <h3 className="font-medium">{g.name}</h3>
                <div className="flex gap-1">
                  <button className="btn-secondary px-2 py-0.5 text-xs" onClick={() => openEdit(g)}>Edit</button>
                  <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => setDeleteGroupId(g.id)}>Delete</button>
                </div>
              </div>
              <p className="text-sm text-stone-400">{g.members.map((m) => m.name).join(', ') || 'No members'}</p>
            </div>
          ))}
        </section>
      </div>

      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-md w-full">
            <h3 className="mb-3 font-semibold">Edit {editingGroup.name}</h3>
            <div className="mb-4 space-y-1">
              {characters.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={editMembers.includes(c.id)} onChange={() => toggleEdit(c.id)} />
                  {c.name} ({c.username})
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditingGroup(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {deleteGroupId && (
        <ConfirmDialog
          title="Delete Group"
          message="Delete this group? Campaigns linked to it may be affected."
          onConfirm={doDelete}
          onCancel={() => setDeleteGroupId(null)}
        />
      )}
    </Layout>
  );
}
