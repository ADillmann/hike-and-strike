import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';
import type { LayoutTheme } from '../../context/LayoutThemeContext';
import { useLocale } from '../../context/LocaleContext';

interface Group { id: number; name: string }
interface EventTemplate { id: number; name: string; event_type: string }
interface Campaign {
  id: number;
  name: string;
  group_id: number;
  status: string;
  layout_theme?: LayoutTheme;
  nodes: { id: number; sort_order: number; event_template_id: number; event_name: string; label: string | null; event_type?: string }[];
}

export default function CampaignsPage() {
  const { t } = useLocale();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [events, setEvents] = useState<EventTemplate[]>([]);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(0);
  const [layoutTheme, setLayoutTheme] = useState<LayoutTheme>('default');
  const [nodeEvents, setNodeEvents] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNodes, setEditNodes] = useState<number[]>([]);

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
    await api.post('/campaigns', { name, group_id: groupId, nodes, layout_theme: layoutTheme });
    setName('');
    setNodeEvents([]);
    setLayoutTheme('default');
    load();
  };

  const updateTheme = async (id: number, theme: LayoutTheme) => {
    await api.patch(`/campaigns/${id}/layout-theme`, { layout_theme: theme });
    load();
  };

  const start = async (id: number) => {
    await api.post(`/campaigns/${id}/start`);
    load();
  };

  const pause = async (id: number) => {
    await api.post(`/campaigns/${id}/pause`);
    load();
  };

  const complete = async (id: number) => {
    await api.post(`/campaigns/${id}/complete`);
    load();
  };

  const openEdit = (c: Campaign) => {
    setEditingId(c.id);
    setEditNodes(c.nodes.sort((a, b) => a.sort_order - b.sort_order).map((n) => n.event_template_id));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const nodes = editNodes.map((event_template_id, i) => ({ event_template_id, sort_order: i }));
    await api.put(`/campaigns/${editingId}/nodes`, nodes);
    setEditingId(null);
    load();
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400';
      case 'paused': return 'text-yellow-400';
      case 'completed': return 'text-stone-500';
      default: return 'text-dungeon-300';
    }
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
            <label className="label" htmlFor="new-layout-theme">{t('layout.label')}</label>
            <select
              id="new-layout-theme"
              className="input"
              value={layoutTheme}
              onChange={(e) => setLayoutTheme(e.target.value as LayoutTheme)}
            >
              <option value="default">{t('layout.default')}</option>
              <option value="fantasy">{t('layout.fantasy')}</option>
              <option value="cyberpunk">{t('layout.cyberpunk')}</option>
              <option value="knight">{t('layout.knight')}</option>
            </select>
            <p className="mt-1 text-xs text-stone-500">{t('layout.help')}</p>
          </div>
          <div>
            <div className="mb-2 flex justify-between">
              <span className="label mb-0">Event sequence</span>
              <button type="button" className="btn-secondary text-sm" onClick={addNode}>+ Event</button>
            </div>
            {nodeEvents.map((evId, i) => (
              <div key={i} className="mb-1 flex gap-1">
                <select className="input flex-1" value={evId} onChange={(e) => {
                  const next = [...nodeEvents];
                  next[i] = +e.target.value;
                  setNodeEvents(next);
                }}>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} ({ev.event_type})</option>)}
                </select>
                <button type="button" className="btn-secondary px-2" onClick={() => setNodeEvents(nodeEvents.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          <button className="btn-primary" type="submit">Create Campaign</button>
        </form>

        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Campaigns</h2>
          {campaigns.map((c) => (
            <div key={c.id} className="mb-3 rounded border border-dungeon-600 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {c.name} <span className={`text-sm capitalize ${statusColor(c.status)}`}>({c.status})</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  {c.status === 'draft' && (
                    <>
                      <button className="btn-secondary text-sm" onClick={() => openEdit(c)}>Edit Sequence</button>
                      <button className="btn-primary text-sm" onClick={() => start(c.id)}>Start</button>
                    </>
                  )}
                  {c.status === 'active' && (
                    <>
                      <Link className="btn-primary text-sm" to={`/organizer/campaigns/${c.id}/control`}>Control</Link>
                      <button className="btn-secondary text-sm" onClick={() => pause(c.id)}>Pause</button>
                      <button className="btn-danger text-sm" onClick={() => complete(c.id)}>Complete</button>
                    </>
                  )}
                  {c.status === 'paused' && (
                    <>
                      <Link className="btn-primary text-sm" to={`/organizer/campaigns/${c.id}/control`}>Control</Link>
                      <button className="btn-secondary text-sm" onClick={() => start(c.id)}>Resume</button>
                      <button className="btn-danger text-sm" onClick={() => complete(c.id)}>Complete</button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2 max-w-xs">
                <label className="label" htmlFor={`theme-${c.id}`}>{t('layout.label')}</label>
                <select
                  id={`theme-${c.id}`}
                  className="input"
                  value={c.layout_theme || 'default'}
                  onChange={(e) => updateTheme(c.id, e.target.value as LayoutTheme)}
                  disabled={c.status === 'completed'}
                >
                  <option value="default">{t('layout.default')}</option>
                  <option value="fantasy">{t('layout.fantasy')}</option>
                  <option value="cyberpunk">{t('layout.cyberpunk')}</option>
                  <option value="knight">{t('layout.knight')}</option>
                </select>
              </div>
              <p className="mt-1 text-xs text-stone-500">{c.nodes.map((n) => n.event_name).join(' → ')}</p>
            </div>
          ))}
        </section>
      </div>

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <h3 className="mb-3 font-semibold text-dungeon-300">Edit Event Sequence</h3>
            {editNodes.map((evId, i) => (
              <div key={i} className="mb-1 flex gap-1">
                <span className="flex w-6 items-center text-stone-500">{i + 1}.</span>
                <select className="input flex-1" value={evId} onChange={(e) => {
                  const next = [...editNodes];
                  next[i] = +e.target.value;
                  setEditNodes(next);
                }}>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
                <button type="button" className="btn-secondary px-2" onClick={() => setEditNodes(editNodes.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" className="btn-secondary mb-3 text-sm" onClick={() => setEditNodes([...editNodes, events[0]?.id || 0])}>+ Add Event</button>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit}>Save</button>
              <button className="btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
