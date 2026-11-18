import React from 'react';
import {
  BarChart3,
  LayoutDashboard,
  PiggyBank,
  ReceiptText,
  Split,
} from 'lucide-react';

export type NavTabId = 'overview' | 'transactions' | 'reports' | 'goals' | 'splits';

interface MobileBottomNavProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  uncertainCount: number;
  unpaidSplitsCount?: number;
}

const MOBILE_TABS: Array<{
  id: NavTabId;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'transactions', label: 'Tx & Subs', Icon: ReceiptText },
  { id: 'reports', label: 'Reports', Icon: BarChart3 },
  { id: 'goals', label: 'Goals', Icon: PiggyBank },
  { id: 'splits', label: 'Splits', Icon: Split },
];

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  uncertainCount,
  unpaidSplitsCount = 0,
}) => {
  return (
    <nav
      aria-label="Mobile Navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
    >
      <div className="grid grid-cols-5 items-center h-14 px-1">
        {MOBILE_TABS.map(({ id, label, Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              className={`min-h-[44px] flex flex-col items-center justify-center relative transition-colors ${
                isActive
                  ? 'text-slate-900 dark:text-white font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className="w-4 h-4" />
                {id === 'transactions' && uncertainCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 text-[9px] font-mono font-bold text-amber-700 dark:text-amber-300">
                    {uncertainCount}
                  </span>
                )}
                {id === 'splits' && unpaidSplitsCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 text-[9px] font-mono font-bold text-amber-700 dark:text-amber-300">
                    {unpaidSplitsCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] tracking-tight mt-0.5 whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
