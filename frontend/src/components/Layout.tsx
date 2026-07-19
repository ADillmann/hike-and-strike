import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';

export function Layout({ children, title }: { children: React.ReactNode; title?: string }) {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const isMaster = user?.role === 'master';

  return (
    <div className="min-h-screen">
      <header className="border-b border-dungeon-700 bg-dungeon-800 px-4 py-3">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <div>
            <Link to={isMaster ? '/organizer' : '/character'} className="text-xl font-bold text-dungeon-300">
              Hike&amp;strike
            </Link>
            {title && <p className="text-sm text-stone-400">{title}</p>}
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            {isMaster ? (
              <>
                <Link className="hover:text-dungeon-300" to="/organizer">Dashboard</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/users">Users</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/groups">Groups</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/events">Events</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/items">Items</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/enemies">Enemies</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/skills">Skills</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/classes">Classes</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/effects">Effects</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/secrets">Secrets</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/currency">Currency</Link>
                <Link className="hover:text-dungeon-300" to="/organizer/campaigns">Campaigns</Link>
              </>
            ) : (
              <>
                <Link className="hover:text-dungeon-300" to="/character">{t('nav.character')}</Link>
                <Link className="hover:text-dungeon-300" to="/inventory">{t('nav.inventory')}</Link>
                <Link className="hover:text-dungeon-300" to="/skills">{t('nav.skills')}</Link>
                <Link className="hover:text-dungeon-300" to="/campaign">{t('nav.campaign')}</Link>
              </>
            )}
            <span className="text-stone-500">|</span>
            <Link className="hover:text-dungeon-300" to="/account">{t('common.account')}</Link>
            <span className="text-stone-400">{user?.username}</span>
            <button className="btn-secondary text-sm" onClick={logout}>{t('common.logout')}</button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}

export function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-dungeon-600 bg-dungeon-900 px-3 py-2 text-center">
      <div className="text-xs uppercase text-stone-500">{label}</div>
      <div className="text-lg font-semibold text-dungeon-300">{value}</div>
    </div>
  );
}

export function StatEditor({
  stats,
  onChange,
}: {
  stats: Record<string, number>;
  onChange: (stat: string, value: number) => void;
}) {
  const { t } = useLocale();
  const statNames = ['strength', 'dexterity', 'intelligence', 'durability', 'charisma', 'initiative'];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {statNames.map((s) => (
        <div key={s} className="flex items-center gap-2 rounded border border-dungeon-600 p-2">
          <span className="flex-1 text-sm uppercase">{t(`stats.${s}`)}</span>
          <button className="btn-secondary px-2 py-1 text-sm" onClick={() => onChange(s, (stats[s] || 8) - 1)}>-</button>
          <span className="w-6 text-center">{stats[s] || 8}</span>
          <button className="btn-secondary px-2 py-1 text-sm" onClick={() => onChange(s, (stats[s] || 8) + 1)}>+</button>
        </div>
      ))}
    </div>
  );
}
