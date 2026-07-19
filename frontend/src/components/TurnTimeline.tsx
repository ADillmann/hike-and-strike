import { useLocale } from '../context/LocaleContext';

export interface TimelineActor {
  id: string;
  name: string;
  type: 'player' | 'enemy';
  initiative_value: number;
}

interface TurnTimelineProps {
  actors: TimelineActor[];
  activeActorId: string | null;
}

export function TurnTimeline({ actors, activeActorId }: TurnTimelineProps) {
  const { t } = useLocale();

  if (actors.length === 0) return null;

  return (
    <section className="card mb-4 overflow-x-auto">
      <h2 className="mb-3 font-semibold text-dungeon-300">{t('battle.timeline')}</h2>
      <div className="relative min-w-[min(100%,28rem)] px-2 pb-1 pt-2">
        <div className="absolute left-4 right-4 top-[1.65rem] h-0.5 bg-dungeon-600" aria-hidden />
        <ol className="relative flex items-start justify-between gap-3">
          {actors.map((actor) => {
            const isActive = actor.id === activeActorId;
            const isPlayer = actor.type === 'player';
            const markerColor = isPlayer
              ? isActive
                ? 'border-green-300 bg-green-500 ring-2 ring-green-300/80'
                : 'border-green-500 bg-green-700'
              : isActive
                ? 'border-red-300 bg-red-500 ring-2 ring-red-300/80'
                : 'border-red-500 bg-red-800';
            const labelColor = isPlayer
              ? isActive
                ? 'text-green-200 font-semibold'
                : 'text-green-300'
              : isActive
                ? 'text-red-200 font-semibold'
                : 'text-red-300';
            return (
              <li key={actor.id} className="flex min-w-0 flex-1 flex-col items-center text-center">
                <span
                  className={`relative z-10 mb-2 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${markerColor}`}
                  aria-current={isActive ? 'true' : undefined}
                />
                <span className={`max-w-[6.5rem] truncate text-xs ${labelColor}`} title={actor.name}>
                  {actor.name}
                </span>
                <span className="text-[10px] text-stone-500">{actor.initiative_value.toFixed(2)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
