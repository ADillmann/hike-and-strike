import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { Layout } from '../../components/Layout';
import type { Character } from '../../api/client';

export default function SkillsPage() {
  const [character, setCharacter] = useState<Character | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Character>('/characters/me').then(setCharacter).catch(() => navigate('/character/create'));
  }, [navigate]);

  if (!character) return <Layout title="Skills">Loading...</Layout>;

  return (
    <Layout title="Skills">
      <div className="card space-y-3">
        {character.skills.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded border border-dungeon-600 p-3">
            <span className="font-medium">{s.name}</span>
            <span className="text-dungeon-300">{s.uses_remaining} / {s.max_uses_per_rest} uses</span>
          </div>
        ))}
        <p className="text-sm text-stone-500">Uses refill after rest at bonfire or house events.</p>
      </div>
    </Layout>
  );
}
