import { useState, useMemo, memo } from 'react';
import { FlaskConical, ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { RuntimeTestResult, TestStatus } from '@/map/types';

interface TestsSectionProps {
  testResults: RuntimeTestResult[];
  showTests: boolean;
  onToggleTests: () => void;
}

const STATUS_DOT: Record<TestStatus, string> = {
  pass: 'bg-teal',
  fail: 'bg-rose',
  warn: 'bg-amber',
  skip: 'bg-text-dim',
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

export const TestsSection = memo(function TestsSection({ testResults, showTests, onToggleTests }: TestsSectionProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const failCount = useMemo(() => testResults.filter(r => r.status === 'fail').length, [testResults]);
  const badgeCount = failCount > 0 ? failCount : testResults.length;

  const groups = useMemo(() => groupByCategory(testResults), [testResults]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <Collapsible open={showTests} onOpenChange={onToggleTests}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-sm font-display font-medium text-text-mid hover:text-text-bright hover:bg-panel-hover transition-colors rounded-md">
        <FlaskConical className="size-4 text-teal/70 group-hover:text-teal transition-colors" />
        <span className="flex-1 text-left tracking-wide">Runtime Tests</span>
        {testResults.length > 0 && (
          <span className={`data-readout px-1.5 py-0.5 rounded font-medium ${
            failCount > 0 ? 'bg-rose-dim text-rose border border-rose/20' : 'bg-teal-dim text-teal border border-teal/15'
          }`}>
            {badgeCount}
          </span>
        )}
        <ChevronDown className="size-4 text-text-dim transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="px-3 pb-3">
          {testResults.length === 0 ? (
            <p className="data-readout text-text-dim">Waiting for results...</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-2">
              {Array.from(groups.entries()).map(([category, tests]) => {
                const catCollapsed = collapsedCategories.has(category);
                const catFails = tests.filter(t => t.status === 'fail').length;
                const catWarns = tests.filter(t => t.status === 'warn').length;
                return (
                  <div key={category}>
                    <button
                      onClick={() => toggleCategory(category)}
                      className="w-full flex items-center gap-1.5 text-[11px] font-display font-medium text-text-mid hover:text-text-bright transition-colors"
                    >
                      {catCollapsed ? (
                        <ChevronRight className="size-3 text-text-dim" />
                      ) : (
                        <ChevronDown className="size-3 text-text-dim" />
                      )}
                      <span>{category}</span>
                      {catFails > 0 && <span className="data-readout px-1 bg-rose-dim text-rose rounded border border-rose/20">{catFails} fail</span>}
                      {catWarns > 0 && <span className="data-readout px-1 bg-amber-dim text-amber rounded border border-amber/20">{catWarns} warn</span>}
                    </button>
                    {!catCollapsed && (
                      <div className="ml-3 mt-0.5 space-y-0.5">
                        {tests.map(test => (
                          <div key={test.id} className="flex items-center gap-1.5 data-readout">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[test.status]}`} />
                            <span className="flex-1 text-text-mid">{test.name}</span>
                            <span className="text-text-dim">{test.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
