import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface CampaignListItem {
  id: number;
  name: string;
  status: string;
}

const CONFIRM = 'REPLACE';

export default function CampaignPacksPage() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [campaignId, setCampaignId] = useState<number | ''>('');
  const [exportMode, setExportMode] = useState<'full' | 'blank'>('full');
  const [exportDir, setExportDir] = useState('');
  const [importDir, setImportDir] = useState('');
  const [reloadMode, setReloadMode] = useState<'full' | 'blank'>('full');
  const [resumeAsActive, setResumeAsActive] = useState(true);
  const [importConfirm, setImportConfirm] = useState('');
  const [settingsDir, setSettingsDir] = useState('');
  const [repo, setRepo] = useState('https://github.com/ADillmann/hike-and-strike-settings');
  const [branch, setBranch] = useState('knight');
  const [token, setToken] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [settingsSource, setSettingsSource] = useState<'path' | 'github'>('path');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<CampaignListItem[]>('/campaigns')
      .then((rows) => {
        setCampaigns(rows);
        if (rows.length && campaignId === '') setCampaignId(rows[0].id);
      })
      .catch(() => setCampaigns([]));
  }, []);

  const exportPack = async () => {
    if (!campaignId) {
      setError('Select a campaign to export.');
      return;
    }
    if (!exportDir.trim()) {
      setError('Enter a server directory path for export.');
      return;
    }
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await api.post<{
        ok: boolean;
        directory: string;
        files: string[];
        campaign: { name?: string; export_mode?: string };
      }>('/organizer/campaign-pack/export', {
        campaign_id: campaignId,
        directory: exportDir,
        mode: exportMode,
      });
      setMessage(
        `Wrote ${res.files.length} files to ${res.directory} (campaign "${res.campaign?.name || ''}", mode ${res.campaign?.export_mode}).`,
      );
      if (!importDir) setImportDir(res.directory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const importPack = async () => {
    if (!importDir.trim()) {
      setError('Enter a campaign pack directory.');
      return;
    }
    if (settingsSource === 'path' && !settingsDir.trim()) {
      setError('Enter a settings pack directory, or switch to GitHub.');
      return;
    }
    if (settingsSource === 'github' && (!repo.trim() || !branch.trim())) {
      setError('Enter settings repository URL and branch.');
      return;
    }
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const settings =
        settingsSource === 'path'
          ? { directory: settingsDir }
          : { repo, branch, token: token || null, path_prefix: pathPrefix };
      const res = await api.post<{
        ok: boolean;
        imported: { name?: string; reload_mode?: string; campaign_id?: number; status?: string };
      }>('/organizer/campaign-pack/import', {
        directory: importDir,
        reload_mode: reloadMode,
        resume_as_active: reloadMode === 'full' ? resumeAsActive : true,
        confirm: importConfirm,
        settings,
      });
      setMessage(
        `Imported "${res.imported?.name || ''}" as ${res.imported?.reload_mode} `
        + `(campaign #${res.imported?.campaign_id}, status ${res.imported?.status || '?'}). `
        + 'Players/groups/campaigns were replaced.',
      );
      setImportConfirm('');
      const rows = await api.get<CampaignListItem[]>('/campaigns');
      setCampaigns(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="Campaign Packs">
      {error && <p className="mb-3 text-red-400">{error}</p>}
      {message && <p className="mb-3 text-green-400">{message}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Export to directory</h2>
          <p className="text-sm text-stone-400">
            Writes events, users/groups, characters, and a settings delta (full mode only) onto the server filesystem.
            Never writes into the settings GitHub repo.
          </p>
          <div>
            <label className="label">Campaign</label>
            <select
              className="input"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">Select…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Export mode</label>
            <select className="input" value={exportMode} onChange={(e) => setExportMode(e.target.value as 'full' | 'blank')}>
              <option value="full">Full (current character state + settings delta)</option>
              <option value="blank">Blank (start-state characters, empty delta)</option>
            </select>
          </div>
          <div>
            <label className="label">Server directory</label>
            <input
              className="input font-mono text-sm"
              placeholder="/home/bee/playground/hike-and-strike-campaign"
              value={exportDir}
              onChange={(e) => setExportDir(e.target.value)}
            />
          </div>
          <button type="button" className="btn-primary" disabled={busy} onClick={exportPack}>
            Write campaign pack
          </button>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Import / reload (destructive)</h2>
          <p className="text-sm text-amber-300">
            Loads settings base first, optionally applies the campaign settings delta, then restores the world.
            Clears players, groups, and campaigns. Masters are kept. Type {CONFIRM} to confirm.
          </p>
          <div>
            <label className="label">Campaign pack directory</label>
            <input
              className="input font-mono text-sm"
              placeholder="/home/bee/playground/hike-and-strike-campaign"
              value={importDir}
              onChange={(e) => setImportDir(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Reload mode</label>
            <label className="mt-1 flex items-center gap-2 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={reloadMode === 'full'}
                onChange={(e) => setReloadMode(e.target.checked ? 'full' : 'blank')}
              />
              Full reload (apply settings delta + full character state)
            </label>
            <p className="mt-1 text-xs text-stone-500">
              Unchecked = blank reload (skip delta, start-state characters, campaign restarted at first event).
            </p>
            {reloadMode === 'full' && (
              <label className="mt-2 flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={resumeAsActive}
                  onChange={(e) => setResumeAsActive(e.target.checked)}
                />
                Resume as active (so you can continue even if the export was completed/paused)
              </label>
            )}
          </div>
          <div>
            <label className="label">Settings base source</label>
            <select
              className="input"
              value={settingsSource}
              onChange={(e) => setSettingsSource(e.target.value as 'path' | 'github')}
            >
              <option value="path">Local settings directory</option>
              <option value="github">Remote repository URL</option>
            </select>
          </div>
          {settingsSource === 'path' ? (
            <div>
              <label className="label">Settings directory</label>
              <input
                className="input font-mono text-sm"
                placeholder="/home/bee/playground/hike-and-strike-setting"
                value={settingsDir}
                onChange={(e) => setSettingsDir(e.target.value)}
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Repository URL</label>
                <input
                  className="input font-mono text-sm"
                  placeholder="https://github.com/ADillmann/hike-and-strike-settings"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Branch</label>
                <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} />
              </div>
              <div>
                <label className="label">Path prefix (optional)</label>
                <input className="input" value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Token (optional)</label>
                <input
                  className="input"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          )}
          <input
            className="input"
            placeholder={CONFIRM}
            value={importConfirm}
            onChange={(e) => setImportConfirm(e.target.value)}
          />
          <button type="button" className="btn-danger" disabled={busy || !importDir} onClick={importPack}>
            Import and replace
          </button>
        </section>
      </div>
    </Layout>
  );
}
