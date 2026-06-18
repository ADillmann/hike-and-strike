import { useEffect, useRef, useState } from 'react';
import { getToken } from '../api/client';

export function useCampaignSocket(campaignId: number | null, onMessage: (msg: { type: string; data: unknown }) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!campaignId) return;
    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws/campaigns/${campaignId}?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        onMessageRef.current(msg);
      } catch {
        /* ignore */
      }
    };
    return () => ws.close();
  }, [campaignId]);

  return { connected };
}
