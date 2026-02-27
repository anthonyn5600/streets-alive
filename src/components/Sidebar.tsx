import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import type { MapEngine } from '@/map/engine';

interface SidebarProps {
  engine: MapEngine | null;
}

export function Sidebar({ engine }: SidebarProps) {
  return (
    <div className="w-full">
      <Card className="bg-white/90 backdrop-blur-sm shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Layers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="buildings" className="text-sm">Buildings</Label>
            <Switch
              id="buildings"
              defaultChecked
              onCheckedChange={v => engine?.setLayerVisibility('buildings', v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="roads" className="text-sm">Roads</Label>
            <Switch
              id="roads"
              defaultChecked
              onCheckedChange={v => engine?.setLayerVisibility('roads', v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="labels" className="text-sm">Road Labels</Label>
            <Switch
              id="labels"
              defaultChecked
              onCheckedChange={v => engine?.setLayerVisibility('labels', v)}
            />
          </div>

          <div className="pt-2 border-t space-y-3">
            <div>
              <Label className="text-sm text-muted-foreground">Building Height</Label>
              <Slider
                defaultValue={[1]}
                min={0.1}
                max={3}
                step={0.1}
                onValueChange={([v]) => engine?.setHeightMultiplier(v)}
                className="mt-1"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
