import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface Campaign {
  id: number;
  name: string;
  status: string;
}

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    api.get<Campaign[]>('/campaigns').then(setCampaigns).catch(() => {});
  }, []);

  const active = campaigns.filter((c) => c.status === 'active' || c.status === 'paused');

  return (
    <Layout title="Organizer Dashboard">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="mb-3 text-lg font-semibold text-dungeon-300">Active Campaigns</h2>
          {active.length === 0 ? (
            <p className="text-stone-400">No active campaigns. Create one and start it.</p>
          ) : (
            <ul className="space-y-2">
              {active.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded border border-dungeon-600 p-3">
                  <span>{c.name} <span className="text-stone-500">({c.status})</span></span>
                  <Link className="btn-primary text-sm" to={`/organizer/campaigns/${c.id}/control`}>Control</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="mb-3 text-lg font-semibold text-dungeon-300">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-primary" to="/organizer/users">Create User</Link>
            <Link className="btn-secondary" to="/organizer/groups">Manage Groups</Link>
            <Link className="btn-secondary" to="/organizer/events">Edit Events</Link>
            <Link className="btn-secondary" to="/organizer/campaigns">Campaigns</Link>
          </div>
        </section>
      </div>
    </Layout>
  );
}
