import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [setupMode, setSetupMode] = useState(false);
  const { login, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ setup_needed: boolean }>('/auth/setup-needed').then((r) => setSetupMode(r.setup_needed)).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (setupMode) {
        const res = await api.post<{ access_token: string; role: string }>('/auth/setup', { username, password });
        setToken(res.access_token);
        await refresh();
        navigate('/organizer');
        return;
      }
      const me = await login(username, password);
      if (me.role === 'master') navigate('/organizer');
      else if (!me.has_character) navigate('/character/create');
      else navigate('/character');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-md space-y-4">
        <h1 className="text-center text-3xl font-bold text-dungeon-300">Hike&amp;strike</h1>
        <p className="text-center text-sm text-stone-400">
          {setupMode ? 'Create your Master account' : 'Enter the dungeon'}
        </p>
        {error && <p className="text-center text-red-400">{error}</p>}
        <div>
          <label className="label">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn-primary w-full" type="submit">
          {setupMode ? 'Create Master' : 'Login'}
        </button>
      </form>
    </div>
  );
}
