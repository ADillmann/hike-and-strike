import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';

interface AppliedPack {
  name?: string;
  version?: string;
  layout_theme?: string | null;
  source?: { repo?: string; branch?: string };
}

const CONFIRM = 'REPLACE';

export default function SettingsPacksPage() {
  const [applied, setApplied] = useState<AppliedPack | null>(null);
  const [exportName, setExportName] = useState('local');
  const [exportVersion, setExportVersion] = useState('1.0.0');
  const [exportTheme, setExportTheme] = useState('');
  const [exportDir, setExportDir] = useState('');
  const [importDir, setImportDir] = useState('');
  const [importConfirm, setImportConfirm] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('fantasy');
  const [token, setToken] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [githubConfirm, setGithubConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadStatus = () => {
    api.get<{ applied: AppliedPack | null }>('/organizer/settings-pack/status')
      .then((r) => setApplied(r.applied))
      .catch(() => setApplied(null));
  };

  useEffect(() => { loadStatus(); }, []);

  const exportToPath = async () => {
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
        pack: { name?: string };
      }>('/organizer/settings-pack/export', {
        directory: exportDir,
        name: exportName,
        version: exportVersion,
        layout_theme: exportTheme || null,
      });
      setMessage(
        `Wrote ${res.files.length} files to ${res.directory} (pack "${res.pack?.name || exportName}").`,
      );
      if (!importDir) setImportDir(res.directory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const importFromPath = async () => {
    if (!importDir.trim()) {
      setError('Enter a server directory path for import.');
      return;
    }
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; applied: AppliedPack; directory: string }>(
        '/organizer/settings-pack/import-path',
        { directory: importDir, confirm: importConfirm },
      );
      setApplied(res.applied);
      setMessage(
        `Imported pack "${res.applied?.name || ''}" from ${res.directory}. Players, groups, and campaigns were cleared.`,
      );
      setImportConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const importGithub = async () => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; applied: AppliedPack }>('/organizer/settings-pack/import-github', {
        repo,
        branch,
        token: token || null,
        path_prefix: pathPrefix,
        confirm: githubConfirm,
      });
      setApplied(res.applied);
      setMessage(`Loaded "${res.applied?.name || ''}" from ${repo}@${branch}. Players, groups, and campaigns were cleared.`);
      setGithubConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="Settings Packs">
      {error && <p className="mb-3 text-red-400">{error}</p>}
      {message && <p className="mb-3 text-green-400">{message}</p>}

      <section className="card mb-4">
        <h2 className="mb-2 font-semibold text-dungeon-300">Active pack</h2>
        {applied?.name ? (
          <p className="text-sm text-stone-300">
            {applied.name} v{applied.version || '?'}
            {applied.layout_theme ? ` · theme hint: ${applied.layout_theme}` : ''}
            {applied.source?.repo ? ` · from ${applied.source.repo}@${applied.source.branch}` : ''}
          </p>
        ) : (
          <p className="text-sm text-stone-500">No custom pack marker — default seed content may apply on restart.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Export to directory</h2>
          <p className="text-sm text-stone-400">
            Writes the same multi-file layout as the GitHub settings repo
            (pack.json, classes.json, skills.json, …) onto the <em>server</em> filesystem —
            e.g. a local clone you can commit and push. Events stay in the app.
          </p>
          <div>
            <label className="label">Server directory</label>
            <input
              className="input font-mono text-sm"
              placeholder="/home/bee/playground/hike-and-strike-settings"
              value={exportDir}
              onChange={(e) => setExportDir(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Pack name</label>
            <input className="input" value={exportName} onChange={(e) => setExportName(e.target.value)} />
          </div>
          <div>
            <label className="label">Version</label>
            <input className="input" value={exportVersion} onChange={(e) => setExportVersion(e.target.value)} />
          </div>
          <div>
            <label className="label">Layout theme hint (optional)</label>
            <select className="input" value={exportTheme} onChange={(e) => setExportTheme(e.target.value)}>
              <option value="">None</option>
              <option value="fantasy">Fantasy</option>
              <option value="cyberpunk">Cyberpunk</option>
              <option value="knight">Knight</option>
            </select>
          </div>
          <button type="button" className="btn-primary" disabled={busy} onClick={exportToPath}>
            Write pack files
          </button>
        </section>

        <section className="card space-y-3">
          <h2 className="font-semibold text-dungeon-300">Import from directory (destructive)</h2>
          <p className="text-sm text-amber-300">
            Loads pack.json and related files from a server path. Replaces settings content and clears
            players, groups, and campaigns. Master accounts are kept. Type {CONFIRM} to confirm.
          </p>
          <div>
            <label className="label">Server directory</label>
            <input
              className="input font-mono text-sm"
              placeholder="/home/bee/playground/hike-and-strike-settings"
              value={importDir}
              onChange={(e) => setImportDir(e.target.value)}
            />
          </div>
          <input
            className="input"
            placeholder={CONFIRM}
            value={importConfirm}
            onChange={(e) => setImportConfirm(e.target.value)}
          />
          <button type="button" className="btn-danger" disabled={busy || !importDir} onClick={importFromPath}>
            Import and replace
          </button>
        </section>

        <section className="card space-y-3 lg:col-span-2">
          <h2 className="font-semibold text-dungeon-300">Load from remote repository (destructive)</h2>
          <p className="text-sm text-stone-400">
            Fetches pack.json and related files from a branch on GitHub, GitLab, or Gitea/Forgejo/Codeberg-style hosts.
            Same wipe rules as directory import.
          </p>
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
              <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} list="settings-branches" />
              <datalist id="settings-branches">
                <option value="fantasy" />
                <option value="cyberpunk" />
                <option value="knight" />
                <option value="main" />
              </datalist>
            </div>
            <div>
              <label className="label">Path prefix (optional)</label>
              <input className="input" placeholder="leave empty if pack files are at repo root" value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Token (optional, private repos)</label>
              <input className="input" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </div>
          </div>
          <input
            className="input max-w-xs"
            placeholder={CONFIRM}
            value={githubConfirm}
            onChange={(e) => setGithubConfirm(e.target.value)}
          />
          <button type="button" className="btn-danger" disabled={busy || !repo || !branch} onClick={importGithub}>
            Load from repository and replace
          </button>
        </section>
      </div>
    </Layout>
  );
}
