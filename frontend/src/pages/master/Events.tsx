import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface EventTemplate {
  id: number;
  name: string;
  description: string;
  event_type: string;
  is_generic: boolean;
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventTemplate[]>([]);
  const [form, setForm] = useState({ name: '', description: '', event_type: 'story' });

  const load = () => api.get<EventTemplate[]>('/events').then(setEvents);

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/events', form);
    setForm({ name: '', description: '', event_type: 'story' });
    load();
  };

  return (
    <Layout title="Event Templates">
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={create} className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">New Event</h2>
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <textarea className="input min-h-24" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <select className="input" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
            <option value="story">Story</option>
            <option value="puzzle">Puzzle</option>
            <option value="rest">Rest</option>
            <option value="generic">Generic</option>
            <option value="battle_hook">Battle Hook</option>
          </select>
          <button className="btn-primary" type="submit">Save Event</button>
        </form>
        <section className="card">
          <h2 className="mb-3 font-semibold text-dungeon-300">Event Library</h2>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {events.map((ev) => (
              <div key={ev.id} className="rounded border border-dungeon-600 p-3">
                <div className="flex justify-between">
                  <span className="font-medium">{ev.name}</span>
                  <span className="text-xs text-stone-500">{ev.event_type}{ev.is_generic ? ' (generic)' : ''}</span>
                </div>
                <p className="mt-1 text-sm text-stone-400">{ev.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
