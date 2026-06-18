import { useEffect, useState } from 'react';
import { api, Character } from '../../api/client';
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
              <h3 className="font-medium">{g.name}</h3>
              <p className="text-sm text-stone-400">{g.members.map((m) => m.name).join(', ') || 'No members'}</p>
            </div>
          ))}
        </section>
      </div>
    </Layout>
  );
}
