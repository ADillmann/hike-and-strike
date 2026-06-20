import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface CurrencySettings {
  tier1_name: string;
  tier2_name: string;
  tier3_name: string;
  copper_per_silver: number;
  silver_per_gold: number;
}

export default function CurrencyPage() {
  const [settings, setSettings] = useState<CurrencySettings | null>(null);
  const [previewCopper, setPreviewCopper] = useState(1234);
  const [previewDisplay, setPreviewDisplay] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.get<CurrencySettings>('/currency/settings').then(setSettings);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!settings) return;
    api.get<{ display: string }>(`/currency/preview?copper=${previewCopper}`)
      .then((r) => setPreviewDisplay(r.display))
      .catch(() => setPreviewDisplay(''));
  }, [previewCopper, settings]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setError('');
    setSaved(false);
    try {
      await api.patch('/currency/settings', settings);
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  if (!settings) return <Layout title="Currency">Loading...</Layout>;

  return (
    <Layout title="Currency Settings">
      {error && <p className="mb-4 rounded border border-red-800 bg-red-950/50 p-3 text-red-400">{error}</p>}
      {saved && <p className="mb-4 rounded border border-green-800 bg-green-950/50 p-3 text-green-400">Saved.</p>}

      <form onSubmit={save} className="card max-w-lg space-y-4">
        <p className="text-sm text-stone-400">
          All prices and player wallets are stored internally as copper. Changing tier names or exchange rates
          only affects display — player balances keep the same purchasing power.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Tier 1 name</label>
            <input className="input" value={settings.tier1_name} onChange={(e) => setSettings({ ...settings, tier1_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Tier 2 name</label>
            <input className="input" value={settings.tier2_name} onChange={(e) => setSettings({ ...settings, tier2_name: e.target.value })} />
          </div>
          <div>
            <label className="label">Tier 3 name</label>
            <input className="input" value={settings.tier3_name} onChange={(e) => setSettings({ ...settings, tier3_name: e.target.value })} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Copper per {settings.tier2_name}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={settings.copper_per_silver}
              onChange={(e) => setSettings({ ...settings, copper_per_silver: +e.target.value })}
            />
          </div>
          <div>
            <label className="label">{settings.tier2_name} per {settings.tier3_name}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={settings.silver_per_gold}
              onChange={(e) => setSettings({ ...settings, silver_per_gold: +e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label">Preview (copper amount)</label>
          <input className="input" type="number" min={0} value={previewCopper} onChange={(e) => setPreviewCopper(+e.target.value)} />
          <p className="mt-2 text-sm text-dungeon-300">
            {previewCopper} copper displays as: <strong>{previewDisplay || '…'}</strong>
          </p>
        </div>

        <button className="btn-primary" type="submit">Save Settings</button>
      </form>
    </Layout>
  );
}
