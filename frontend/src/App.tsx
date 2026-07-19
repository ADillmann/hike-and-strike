import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { useLocale } from './context/LocaleContext';
import LoginPage from './pages/Login';
import AccountPage from './pages/Account';
import DashboardPage from './pages/master/Dashboard';
import UsersPage from './pages/master/Users';
import GroupsPage from './pages/master/Groups';
import EventsPage from './pages/master/Events';
import ItemsPage from './pages/master/Items';
import CampaignsPage from './pages/master/Campaigns';
import CampaignControlPage from './pages/master/CampaignControl';
import CharacterCreatePage, { CharacterSheetPage } from './pages/player/Character';
import InventoryPage from './pages/player/Inventory';
import SkillsPage from './pages/player/Skills';
import CampaignPage from './pages/player/Campaign';
import BattlePage from './pages/Battle';
import EnemiesPage from './pages/master/Enemies';
import SkillsPageMaster from './pages/master/Skills';
import ClassesPage from './pages/master/Classes';
import EffectsPageMaster from './pages/master/Effects';
import SecretsPageMaster from './pages/master/Secrets';
import CurrencyPage from './pages/master/Currency';

function Protected({ children, role }: { children: React.ReactNode; role?: 'master' | 'player' }) {
  const { user, loading } = useAuth();
  const { t } = useLocale();
  if (loading) return <div className="flex min-h-screen items-center justify-center">{t('common.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === 'master' ? '/organizer' : '/character'} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/account" element={<Protected><AccountPage /></Protected>} />
      <Route path="/organizer" element={<Protected role="master"><DashboardPage /></Protected>} />
      <Route path="/organizer/users" element={<Protected role="master"><UsersPage /></Protected>} />
      <Route path="/organizer/groups" element={<Protected role="master"><GroupsPage /></Protected>} />
      <Route path="/organizer/events" element={<Protected role="master"><EventsPage /></Protected>} />
      <Route path="/organizer/items" element={<Protected role="master"><ItemsPage /></Protected>} />
      <Route path="/organizer/enemies" element={<Protected role="master"><EnemiesPage /></Protected>} />
      <Route path="/organizer/skills" element={<Protected role="master"><SkillsPageMaster /></Protected>} />
      <Route path="/organizer/classes" element={<Protected role="master"><ClassesPage /></Protected>} />
      <Route path="/organizer/effects" element={<Protected role="master"><EffectsPageMaster /></Protected>} />
      <Route path="/organizer/secrets" element={<Protected role="master"><SecretsPageMaster /></Protected>} />
      <Route path="/organizer/currency" element={<Protected role="master"><CurrencyPage /></Protected>} />
      <Route path="/organizer/campaigns" element={<Protected role="master"><CampaignsPage /></Protected>} />
      <Route path="/organizer/campaigns/:id/control" element={<Protected role="master"><CampaignControlPage /></Protected>} />
      <Route path="/character/create" element={<Protected role="player"><CharacterCreatePage /></Protected>} />
      <Route path="/character" element={<Protected role="player"><CharacterSheetPage /></Protected>} />
      <Route path="/inventory" element={<Protected role="player"><InventoryPage /></Protected>} />
      <Route path="/skills" element={<Protected role="player"><SkillsPage /></Protected>} />
      <Route path="/campaign" element={<Protected role="player"><CampaignPage /></Protected>} />
      <Route path="/battle/:id" element={<Protected><BattlePage /></Protected>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
