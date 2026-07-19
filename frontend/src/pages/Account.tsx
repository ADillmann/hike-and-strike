import { Layout } from '../components/Layout';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { SUPPORTED_LOCALES, type LocaleCode } from '../i18n';

export default function AccountPage() {
  const { user } = useAuth();
  const { language, setLanguage, t } = useLocale();

  return (
    <Layout title={t('account.title')}>
      <div className="card mx-auto max-w-lg space-y-4">
        <h2 className="text-xl font-semibold text-dungeon-300">{t('account.heading')}</h2>
        <div>
          <p className="text-sm text-stone-400">
            <span className="text-stone-500">{t('account.role')}: </span>
            {user?.role === 'master' ? t('account.role_master') : t('account.role_player')}
            {user?.username ? ` · ${user.username}` : ''}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="account-language">{t('account.language')}</label>
          <select
            id="account-language"
            className="input"
            value={language}
            onChange={(e) => setLanguage(e.target.value as LocaleCode)}
          >
            {SUPPORTED_LOCALES.map((loc) => (
              <option key={loc.code} value={loc.code}>{loc.label}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-stone-500">{t('account.language_help')}</p>
        </div>
      </div>
    </Layout>
  );
}
