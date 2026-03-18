import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { MapEngine } from '@/map/engine';

const PRESETS: Record<string, [number, number]> = {
  'Downtown LA': [34.0522, -118.2437],
  'Hollywood': [34.0928, -118.3287],
  'Santa Monica': [34.0195, -118.4912],
  'San Francisco': [37.7749, -122.4194],
  'San Diego': [32.7157, -117.1611],
  'Sacramento': [38.5816, -121.4944],
};

interface SearchSectionProps {
  engine: MapEngine | null;
}

export function SearchSection({ engine }: SearchSectionProps) {
  const [value, setValue] = useState('');

  const handleGo = () => {
    for (const [name, coords] of Object.entries(PRESETS)) {
      if (value.toLowerCase().includes(name.toLowerCase())) {
        engine?.flyTo(coords[0], coords[1]);
        return;
      }
    }
    const parts = value.split(',').map(s => s.trim());
    if (parts.length === 2) {
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (!isNaN(lat) && !isNaN(lng)) {
        engine?.flyTo(lat, lng);
      }
    }
  };

  return (
    <div className="px-3 pt-4 pb-2 space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="lat, lng or city"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGo()}
          className="h-8 text-sm bg-white/[0.03] border-white/[0.08] text-text-bright placeholder:text-text-dim font-mono text-xs focus:border-teal/40 focus:ring-teal/20"
        />
        <Button
          size="sm"
          onClick={handleGo}
          className="h-8 px-3 bg-teal/15 text-teal border border-teal/20 hover:bg-teal/25 hover:border-teal/40 transition-all font-display font-medium text-xs"
        >
          Go
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(PRESETS).map(([name, [lat, lng]]) => (
          <button
            key={name}
            onClick={() => engine?.flyTo(lat, lng)}
            className="text-[10px] px-2 py-0.5 bg-white/[0.03] border border-white/[0.06] rounded text-text-mid hover:text-teal hover:bg-teal-dim hover:border-teal/20 transition-all font-display"
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
