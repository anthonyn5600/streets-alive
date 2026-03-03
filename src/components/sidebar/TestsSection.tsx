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
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent/50 transition-colors rounded-md">
        <FlaskConical className="size-4 text-muted-foreground" />
        <span className="flex-1 text-left">Runtime Tests</span>
        {testResults.length > 0 && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-normal ${
            failCount > 0 ? 'bg-red-100 text-red-700' : 'bg-muted text-muted-foreground'
          }`}>
            {badgeCount}
          </span>
        )}
        <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <div className="px-3 pb-3">
          {testResults.length === 0 ? (
            <p className="text-xs text-muted-foreground">Waiting for results...</p>
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
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
