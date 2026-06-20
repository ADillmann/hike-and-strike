import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Character } from '../../api/client';

interface ShopCatalogItem {
  id: number;
  name: string;
  tier: number;
  item_type: string;
  description: string;
  buy_price: number;
  buy_price_display: string;
}

interface ShopSellItem {
  inventory_item_id: number;
  name: string;
  tier: number;
  quantity: number;
  sell_price: number;
  sell_price_display: string;
}

interface ShopCatalog {
  wallet_copper: number;
  wallet_display: string;
  items: ShopCatalogItem[];
}

interface ShopSellables {
  wallet_copper: number;
  wallet_display: string;
  items: ShopSellItem[];
}

export function ShopModal({
  onClose,
  onUpdated,
}: {
  onClose: () => void;
  onUpdated: (character: Character) => void;
}) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [catalog, setCatalog] = useState<ShopCatalog | null>(null);
  const [sellables, setSellables] = useState<ShopSellables | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadBuy = useCallback(() => {
    api.get<ShopCatalog>('/player/campaign/shop/catalog').then(setCatalog).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not load shop');
    });
  }, []);

  const loadSell = useCallback(() => {
    api.get<ShopSellables>('/player/campaign/shop/sellables').then(setSellables).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not load sell list');
    });
  }, []);

  useEffect(() => {
    loadBuy();
    loadSell();
  }, [loadBuy, loadSell]);

  const walletDisplay = tab === 'buy' ? catalog?.wallet_display : sellables?.wallet_display;
  const walletCopper = tab === 'buy' ? catalog?.wallet_copper : sellables?.wallet_copper;

  const buy = async (itemTemplateId: number) => {
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ character: Character }>('/player/campaign/shop/buy', { item_template_id: itemTemplateId });
      onUpdated(res.character);
      loadBuy();
      loadSell();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      setBusy(false);
    }
  };

  const sell = async (inventoryItemId: number) => {
    setError('');
    setBusy(true);
    try {
      const res = await api.post<{ character: Character }>('/player/campaign/shop/sell', { inventory_item_id: inventoryItemId });
      onUpdated(res.character);
      loadBuy();
      loadSell();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sale failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card flex max-h-[85vh] w-full max-w-lg flex-col">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-dungeon-300">Shop</h3>
            <p className="text-sm text-stone-400">
              Wallet: {walletDisplay ?? '…'}
              {walletCopper != null && <span className="ml-1 text-xs text-stone-500">({walletCopper} copper)</span>}
            </p>
          </div>
          <button type="button" className="btn-secondary px-2 py-1 text-sm" onClick={onClose}>Close</button>
        </div>

        {error && <p className="mb-2 rounded border border-red-800 bg-red-950/50 p-2 text-sm text-red-400">{error}</p>}

        <div className="mb-2 flex gap-1">
          <button
            type="button"
            className={`px-3 py-1 text-sm rounded ${tab === 'buy' ? 'bg-dungeon-600 text-dungeon-200' : 'bg-dungeon-800 text-stone-400'}`}
            onClick={() => setTab('buy')}
          >
            Buy
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-sm rounded ${tab === 'sell' ? 'bg-dungeon-600 text-dungeon-200' : 'bg-dungeon-800 text-stone-400'}`}
            onClick={() => setTab('sell')}
          >
            Sell
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {tab === 'buy' && (
            catalog?.items.length ? catalog.items.map((item) => {
              const canAfford = (catalog.wallet_copper ?? 0) >= item.buy_price;
              return (
                <div key={item.id} className="rounded border border-dungeon-600 p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-dungeon-300">{item.buy_price_display}</span>
                  </div>
                  <p className="text-xs text-stone-500">T{item.tier} · {item.item_type}</p>
                  {item.description && <p className="mt-1 text-stone-400">{item.description}</p>}
                  <button
                    type="button"
                    className="btn-primary mt-2 text-xs"
                    disabled={busy || !canAfford}
                    onClick={() => buy(item.id)}
                  >
                    {canAfford ? 'Buy' : 'Not enough funds'}
                  </button>
                </div>
              );
            }) : <p className="text-stone-500">Nothing for sale here.</p>
          )}

          {tab === 'sell' && (
            sellables?.items.length ? sellables.items.map((item) => (
              <div key={item.inventory_item_id} className="rounded border border-dungeon-600 p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">
                    {item.name}
                    {item.quantity > 1 && <span className="text-stone-400"> ×{item.quantity}</span>}
                  </span>
                  <span className="text-dungeon-300">{item.sell_price_display}</span>
                </div>
                <p className="text-xs text-stone-500">T{item.tier} · sells at 50% base price</p>
                <button
                  type="button"
                  className="btn-secondary mt-2 text-xs"
                  disabled={busy}
                  onClick={() => sell(item.inventory_item_id)}
                >
                  Sell
                </button>
              </div>
            )) : <p className="text-stone-500">No sellable items in your bag.</p>
          )}
        </div>
      </div>
    </div>
  );
}
