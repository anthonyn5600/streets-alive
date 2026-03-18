import { memo } from 'react';
import type { NeedType, PersonInfo, PersonLocation } from '@/map/types';

export const NEED_LABELS: Record<NeedType, string> = {
  energy: 'E',
  hunger: 'Hu',
  social: 'S',
  fun: 'F',
  health: 'Hp',
};

export const NEED_ORDER: NeedType[] = ['energy', 'hunger', 'social', 'fun', 'health'];

export const ACTIVITY_BADGE_LABELS: Record<string, string> = {
  home: 'At Home',
  work: 'Working',
  mall: 'At Mall',
  social: 'Socializing',
  restaurant: 'Eating',
  supermarket: 'Shopping',
};

export function getLocationBadge(loc: PersonLocation): { label: string; color: string } {
  if (loc.type === 'home') return { label: 'Home', color: 'bg-teal-dim text-teal border border-teal/15' };
  if (loc.type === 'car') return { label: 'In Car', color: 'bg-blue-500/15 text-blue-400 border border-blue-500/20' };
  if (loc.type === 'traveling') return { label: 'Traveling', color: 'bg-purple-500/15 text-purple-400 border border-purple-500/20' };
  const actLabel = loc.activity ? ACTIVITY_BADGE_LABELS[loc.activity] : null;
  return { label: actLabel ?? 'At Building', color: 'bg-amber-dim text-amber border border-amber/15' };
}

export function colorToHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

export function needColor(value: number): string {
  if (value > 60) return '#00d4aa';
  if (value > 30) return '#f5a623';
  return '#ff6b8a';
}

function personEqual(a: PersonInfo, b: PersonInfo): boolean {
  if (a.id !== b.id || a.name !== b.name || a.job !== b.job) return false;
  if (a.location.type !== b.location.type || a.location.activity !== b.location.activity) return false;
  if (Math.round(a.wallet) !== Math.round(b.wallet)) return false;
  for (const key of NEED_ORDER) {
    if (Math.round(a.needs[key]) !== Math.round(b.needs[key])) return false;
  }
  return true;
}

function formatDollars(amount: number): string {
  return '$' + Math.floor(amount).toLocaleString();
}

export const NeedBars = memo(function NeedBars({ needs }: { needs: Record<NeedType, number> }) {
  return (
    <div className="flex gap-0.5">
      {NEED_ORDER.map(needType => (
        <div key={needType} className="flex-1">
          <div className="text-[8px] text-center text-text-dim leading-none mb-0.5 font-mono">
            {NEED_LABELS[needType]}
          </div>
          <div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${needs[needType]}%`,
                backgroundColor: needColor(needs[needType]),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}, (prev, next) => {
  for (const key of NEED_ORDER) {
    if (Math.round(prev.needs[key]) !== Math.round(next.needs[key])) return false;
  }
  return true;
});

export const LocationBadge = memo(function LocationBadge({ location }: { location: PersonLocation }) {
  const badge = getLocationBadge(location);
  return (
    <span className={`text-[9px] px-1 py-0 rounded font-mono ${badge.color}`}>
      {badge.label}
    </span>
  );
}, (prev, next) => prev.location.type === next.location.type && prev.location.activity === next.location.activity);

export const PersonCard = memo(function PersonCard({ person, onClick }: { person: PersonInfo; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div
      onClick={onClick}
      className={`space-y-0.5 ${onClick ? 'cursor-pointer hover:bg-panel-hover rounded px-1 py-0.5 transition-colors' : ''}`}
    >
      <div className="flex items-center gap-1 text-[11px]">
        <span className="font-display font-medium text-text-bright">{person.name}</span>
        <span className="text-[9px] px-1 py-0 bg-white/[0.04] rounded text-text-dim font-mono border border-white/[0.06]">
          {person.job}
        </span>
        <span className="text-[9px] px-1 py-0 bg-teal-dim rounded text-teal font-mono font-medium border border-teal/15">
          {formatDollars(person.wallet)}
        </span>
        <LocationBadge location={person.location} />
      </div>
      <NeedBars needs={person.needs} />
    </div>
  );
}, (prev, next) => personEqual(prev.person, next.person) && !!prev.onClick === !!next.onClick);
