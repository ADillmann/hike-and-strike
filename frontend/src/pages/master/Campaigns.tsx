import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface Group { id: number; name: string }
interface EventTemplate { id: number; name: string; event_type: string }
interface Campaign {
  id: number;
  name: string;
  group_id: number;
  status: string;
  nodes: { id: number; sort_order: number; event_template_id: number; event_name: string; label: string | null }[];
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [events, setEvents] = useState<EventTemplate[]>([]);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(0);
  const [nodeEvents, setNodeEvents] = useState<number[]>([]);

  const load = () => {
    api.get<Campaign[]>('/campaigns').then(setCampaigns);
    api.get<Group[]>('/groups').then((g) => { setGroups(g); if (g[0]) setGroupId(g[0].id); });
    api.get<EventTemplate[]>('/events').then(setEvents);
  };

  useEffect(() => { load(); }, []);

  const addNode = () => setNodeEvents([...nodeEvents, events[0]?.id || 0]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const nodes = nodeEvents.map((event_template_id, i) => ({ event_template_id, sort_order: i }));
    await api.post('/campaigns', { name, group_id: groupId, nodes });
    setName('');
    setNodeEvents([]);
    load();
  };

  const start = async (id: number) => {
    await api.post(`/campaigns/${id}/start`);
    load();
  };

  return (
    <Layout title="Campaigns">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">New Campaign</h2>
          <input className="input" placeholder="Campaign name" value={name} onChange={(e) => setName(e.target.value)} required />
          <select className="input" value={groupId} onChange={(e) => setGroupId(+e.target.value)}>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div>
            <div className="mb-2 flex justify-between">
              <span className="label mb-0">Event sequence</span>
              <button type="button" className="btn-secondary text-sm" onClick={addNode}>+ Event</button>
            </div>
            {nodeEvents.map((evId, i) => (
              <select key={i} className="input mb-1" value={evId} onChange={(e) => {
                const next = [...nodeEvents];
                next[i] = +e.target.value;
                setNodeEvents(next);
              }}>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} ({ev.event_type})</option>)}
              </select>
            ))}
          </div>
          <button className="btn-primary" type="submit">Create Campaign</button>
        </form>
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Campaigns</h2>
          {campaigns.map((c) => (
            <div key={c.id} className="mb-3 rounded border border-dungeon-600 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{c.name} <span className="text-stone-500">({c.status})</span></span>
                <div className="flex gap-2">
                  {c.status === 'draft' && <button className="btn-primary text-sm" onClick={() => start(c.id)}>Start</button>}
                  {(c.status === 'active' || c.status === 'paused') && (
                    <Link className="btn-primary text-sm" to={`/organizer/campaigns/${c.id}/control`}>Control</Link>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-stone-500">{c.nodes.map((n) => n.event_name).join(' → ')}</p>
            </div>
          ))}
        </section>
      </div>
    </Layout>
  );
}
