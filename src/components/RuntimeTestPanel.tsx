import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RuntimeTestResult, TestStatus } from '@/map/types';

interface RuntimeTestPanelProps {
  results: RuntimeTestResult[];
  visible: boolean;
}

const STATUS_DOT: Record<TestStatus, string> = {
  pass: 'bg-green-500',
  fail: 'bg-red-500',
  warn: 'bg-yellow-500',
  skip: 'bg-gray-400',
};

function groupByCategory(results: RuntimeTestResult[]): Map<string, RuntimeTestResult[]> {
  const groups = new Map<string, RuntimeTestResult[]>();
  for (const r of results) {
    let group = groups.get(r.category);
    if (!group) { group = []; groups.set(r.category, group); }
    group.push(r);
  }
  return groups;
}

export function RuntimeTestPanel({ results, visible }: RuntimeTestPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  if (results.length === 0 || !visible) return null;

  const passCount = results.filter(r => r.status === 'pass').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const skipCount = results.filter(r => r.status === 'skip').length;

  const groups = groupByCategory(results);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const parts: string[] = [];
  if (passCount > 0) parts.push(`${passCount} pass`);
  if (warnCount > 0) parts.push(`${warnCount} warn`);
  if (failCount > 0) parts.push(`${failCount} fail`);
  if (skipCount > 0) parts.push(`${skipCount} skip`);

  return (
    <div className="absolute bottom-14 right-4 z-10 w-72">
      <Card className="bg-white/90 backdrop-blur-sm shadow-lg">
        <CardHeader className="pb-2 cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span>Tests: {parts.join(' | ')}</span>
            {collapsed ? (
              <ChevronRight className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </CardTitle>
        </CardHeader>
        {!collapsed && (
          <CardContent className="pt-0 pb-2">
            <div className="max-h-64 overflow-y-auto space-y-2">
              {Array.from(groups.entries()).map(([category, tests]) => {
                const catCollapsed = collapsedCategories.has(category);
                const catFails = tests.filter(t => t.status === 'fail').length;
                const catWarns = tests.filter(t => t.status === 'warn').length;
                return (
                  <div key={category}>
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center gap-1.5 text-[11px] font-medium text-gray-700 hover:text-gray-900"
                    >
                      {catCollapsed ? (
                        <ChevronRight className="size-3 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-3 text-muted-foreground" />
                      )}
                      <span>{category}</span>
                      {catFails > 0 && <span className="text-[9px] px-1 bg-red-100 text-red-700 rounded">{catFails} fail</span>}
                      {catWarns > 0 && <span className="text-[9px] px-1 bg-yellow-100 text-yellow-700 rounded">{catWarns} warn</span>}
                    </button>
                    {!catCollapsed && (
                      <div className="ml-3 mt-0.5 space-y-0.5">
                        {tests.map(test => (
                          <div key={test.id} className="flex items-center gap-1.5 text-[10px]">
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[test.status]}`} />
                            <span className="flex-1 text-gray-600">{test.name}</span>
                            <span className="text-muted-foreground">{test.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
