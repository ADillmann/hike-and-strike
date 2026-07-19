import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { useCampaignSocket } from '../hooks/useCampaignSocket';
import { useAuth } from './AuthContext';

export type LayoutTheme = 'default' | 'fantasy' | 'cyberpunk' | 'knight';

const ALLOWED: ReadonlySet<string> = new Set(['default', 'fantasy', 'cyberpunk', 'knight']);

function normalizeTheme(value: unknown): LayoutTheme {
  if (typeof value === 'string' && ALLOWED.has(value)) return value as LayoutTheme;
  return 'default';
}

interface LayoutThemeContextType {
  layoutTheme: LayoutTheme;
  setLayoutTheme: (theme: LayoutTheme) => void;
  refresh: () => Promise<void>;
}

const LayoutThemeContext = createContext<LayoutThemeContextType | null>(null);

export function LayoutThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [layoutTheme, setLayoutThemeState] = useState<LayoutTheme>('default');
  const [campaignId, setCampaignId] = useState<number | null>(null);

  const setLayoutTheme = useCallback((theme: LayoutTheme) => {
    setLayoutThemeState(normalizeTheme(theme));
  }, []);

  const refresh = useCallback(async () => {
    if (!user || user.role !== 'player') {
      setLayoutThemeState('default');
      setCampaignId(null);
      return;
    }
    try {
      const data = await api.get<{ active?: boolean; campaign_id?: number; layout_theme?: string }>(
        '/player/campaign/active',
      );
      if (data.active) {
        setLayoutThemeState(normalizeTheme(data.layout_theme));
        setCampaignId(data.campaign_id ?? null);
      } else {
        setLayoutThemeState('default');
        setCampaignId(null);
      }
    } catch {
      setLayoutThemeState('default');
      setCampaignId(null);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useCampaignSocket(campaignId, (msg) => {
    if (msg.type === 'campaign_state' && msg.data && typeof msg.data === 'object') {
      const d = msg.data as { layout_theme?: string };
      setLayoutThemeState(normalizeTheme(d.layout_theme));
    }
  });

  return (
    <LayoutThemeContext.Provider value={{ layoutTheme, setLayoutTheme, refresh }}>
      {children}
    </LayoutThemeContext.Provider>
  );
}

export function useLayoutTheme() {
  const ctx = useContext(LayoutThemeContext);
  if (!ctx) throw new Error('useLayoutTheme must be used within LayoutThemeProvider');
  return ctx;
}
