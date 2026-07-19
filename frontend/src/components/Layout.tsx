import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLayoutTheme, type LayoutTheme } from '../context/LayoutThemeContext';
import { useLocale } from '../context/LocaleContext';
import {
  CrossedSwords,
  CyberCorner,
  CyberHex,
  FrameCorner,
  KnightCorner,
  KnightShield,
} from './layoutOrnaments';

const THEMED_LAYOUTS: ReadonlySet<LayoutTheme> = new Set(['fantasy', 'cyberpunk', 'knight']);

export function Layout({ children, title }: { children: React.ReactNode; title?: string }) {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const { layoutTheme } = useLayoutTheme();
  const isMaster = user?.role === 'master';
  const themedPlayer = !isMaster && THEMED_LAYOUTS.has(layoutTheme);
  const fantasyPlayer = themedPlayer && layoutTheme === 'fantasy';
  const cyberPlayer = themedPlayer && layoutTheme === 'cyberpunk';
  const knightPlayer = themedPlayer && layoutTheme === 'knight';

  const accentClass = cyberPlayer
    ? 'text-cyan-400'
    : knightPlayer
      ? 'text-slate-300'
      : 'text-dungeon-400';
  const brandClass = cyberPlayer
    ? 'text-cyan-300'
    : knightPlayer
      ? 'text-slate-200'
      : 'text-dungeon-300';

  const brandAndNav = (
    <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {fantasyPlayer && <CrossedSwords className={`shrink-0 ${accentClass}`} />}
        {cyberPlayer && <CyberHex className={`shrink-0 ${accentClass}`} />}
        {knightPlayer && <KnightShield className={`shrink-0 ${accentClass}`} />}
        <div>
          <Link to={isMaster ? '/organizer' : '/character'} className={`text-xl font-bold ${brandClass}`}>
            Hike&amp;strike
          </Link>
          {title && <p className="text-sm text-stone-400">{title}</p>}
        </div>
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
        {fantasyPlayer && <CrossedSwords className={`ml-1 shrink-0 ${accentClass}`} />}
        {cyberPlayer && <CyberHex className={`ml-1 shrink-0 ${accentClass}`} />}
        {knightPlayer && <KnightShield className={`ml-1 shrink-0 ${accentClass}`} />}
      </nav>
    </div>
  );

  const headerClass = fantasyPlayer
    ? 'layout-header-fantasy relative mx-3 mt-3 mb-1 px-4 py-3 sm:mx-4'
    : cyberPlayer
      ? 'layout-header-cyberpunk relative mx-3 mt-3 mb-1 px-4 py-3 sm:mx-4'
      : knightPlayer
        ? 'layout-header-knight relative mx-3 mt-3 mb-1 px-4 py-3 sm:mx-4'
        : 'border-b border-dungeon-700 bg-dungeon-800 px-4 py-3';

  return (
    <div className="min-h-screen" data-layout={themedPlayer ? layoutTheme : 'default'}>
      <header className={headerClass}>
        {fantasyPlayer && (
          <>
            <FrameCorner className="pointer-events-none absolute left-1 top-1 text-dungeon-400" />
            <FrameCorner className="pointer-events-none absolute right-1 top-1 text-dungeon-400" flipX />
            <FrameCorner className="pointer-events-none absolute bottom-1 left-1 text-dungeon-400" flipY />
            <FrameCorner className="pointer-events-none absolute bottom-1 right-1 text-dungeon-400" flipX flipY />
          </>
        )}
        {cyberPlayer && (
          <>
            <CyberCorner className="pointer-events-none absolute left-2 top-2 text-cyan-400" />
            <CyberCorner className="pointer-events-none absolute right-2 top-2 text-cyan-400" flipX />
            <CyberCorner className="pointer-events-none absolute bottom-2 left-2 text-cyan-400" flipY />
            <CyberCorner className="pointer-events-none absolute bottom-2 right-2 text-cyan-400" flipX flipY />
          </>
        )}
        {knightPlayer && (
          <>
            <KnightCorner className="pointer-events-none absolute left-1 top-1 text-slate-300" />
            <KnightCorner className="pointer-events-none absolute right-1 top-1 text-slate-300" flipX />
            <KnightCorner className="pointer-events-none absolute bottom-1 left-1 text-slate-300" flipY />
            <KnightCorner className="pointer-events-none absolute bottom-1 right-1 text-slate-300" flipX flipY />
          </>
        )}
        {brandAndNav}
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
