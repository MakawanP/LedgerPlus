import React, { useMemo, useState } from 'react';
import { Calendar, TrendingDown, TrendingUp } from 'lucide-react';
import { SubscriptionItem, Transaction } from '../types/finance';
import { DashboardSummaryMetrics, formatCurrency } from '../utils/financeMetrics';

interface ProjectedCashFlowChartProps {
  transactions: Transaction[];
  subscriptions: SubscriptionItem[];
  summaryMetrics: DashboardSummaryMetrics;
}

type ForecastScenario = 'baseline' | 'conservative' | 'elevated';

interface DailyProjectionPoint {
  day: number;
  dateStr: string;
  isProjected: boolean;
  cumulativeIncome: number;
  cumulativeFixedSpend: number;
  cumulativeDiscretionarySpend: number;
  cumulativeTotalSpend: number;
  netCashFlowBalance: number;
  octoberReferenceSpend: number;
  scheduledEvents: string[];
}

export const ProjectedCashFlowChart: React.FC<ProjectedCashFlowChartProps> = ({
  transactions,
  subscriptions,
  summaryMetrics,
}) => {
  const [scenario, setScenario] = useState<ForecastScenario>('baseline');
  const [excludeUnusedSubs, setExcludeUnusedSubs] = useState<boolean>(false);
  const [hoveredDay, setHoveredDay] = useState<number>(30);
  const [chartMetricMode, setChartMetricMode] = useState<'net_balance' | 'cumulative_spend'>(
    'net_balance'
  );

  const forecastData = useMemo(() => {
    const novTxs = transactions.filter((t) => t.monthKey === '2026-11');
    const currentDay = 17;
    const totalDaysInNov = 30;

    // Calculate historical daily discretionary spending rate (excluding rent & recurring bills/subs)
    const novDiscretionaryPurchases = novTxs.filter(
      (t) => t.transactionType === 'purchase' && !t.isRecurring && t.category !== 'Rent & Housing'
    );
    const novDiscretionaryTotal = novDiscretionaryPurchases.reduce((s, t) => s + t.amount, 0);
    const novDailyDiscretionaryAvg = novDiscretionaryTotal / currentDay;

    // Blend with October non-recurring daily average for historical stability
    const octDiscretionaryAvg =
      (summaryMetrics.previousMonthTotalSpending - 2450 - 563.36) / 31;
    const historicalDailyDiscretionaryRate =
      novDailyDiscretionaryAvg * 0.65 + Math.max(25, octDiscretionaryAvg) * 0.35;

    const scenarioMultiplier =
      scenario === 'conservative' ? 0.78 : scenario === 'elevated' ? 1.25 : 1.0;

    const effectiveDailyDiscretionary = historicalDailyDiscretionaryRate * scenarioMultiplier;

    // Identify upcoming recurring bills/subscriptions or pro-rated recurring obligations for Nov 18-30
    // Also factor in savings if user toggles "Cancel Unused Subscriptions"
    const unusedMonthlySavings = excludeUnusedSubs
      ? subscriptions
          .filter((s) => s.status === 'Unused / Review')
          .reduce((acc, s) => acc + s.amount, 0)
      : 0;

    // Scheduled late-month recurring items (e.g., cloud infrastructure / wireless / gym add-on or upcoming cycle)
    const upcomingScheduledRecurring: Record<number, { label: string; amount: number }> = {
      20: { label: 'AT&T Wireless & Cloud Backup Autopay', amount: 88.0 },
      24: { label: 'NYTimes + Substack Monthly Digest', amount: 24.0 },
      28: { label: 'Cleaners & Household Recurring Service', amount: 110.0 },
    };

    const points: DailyProjectionPoint[] = [];
    let runningIncome = 0;
    let runningFixedSpend = 0;
    let runningDiscretionarySpend = 0;

    const octDailyTotalRate = summaryMetrics.previousMonthTotalSpending / 30;

    for (let day = 1; day <= totalDaysInNov; day++) {
      const dateStr = `2026-11-${String(day).padStart(2, '0')}`;
      const isProjected = day > currentDay;
      const events: string[] = [];

      if (!isProjected) {
        const dayTxs = novTxs.filter((t) => t.date === dateStr);
        dayTxs.forEach((tx) => {
          if (tx.transactionType === 'income') {
            runningIncome += tx.amount;
            events.push(`+${formatCurrency(tx.amount)} ${tx.merchant}`);
          } else if (tx.transactionType === 'purchase') {
            if (tx.isRecurring || tx.category === 'Rent & Housing') {
              runningFixedSpend += tx.amount;
              events.push(`Fixed: ${tx.merchant} (${formatCurrency(tx.amount)})`);
            } else {
              runningDiscretionarySpend += tx.amount;
              events.push(`${tx.merchant} (${formatCurrency(tx.amount)})`);
            }
          } else if (tx.transactionType === 'refund') {
            runningDiscretionarySpend = Math.max(0, runningDiscretionarySpend - tx.amount);
            events.push(`Refund: ${tx.merchant} (-${formatCurrency(tx.amount)})`);
          }
        });

        // If user toggled "Exclude Unused Subscriptions", credit back the unused subs charged earlier in Nov
        if (day === currentDay && excludeUnusedSubs && unusedMonthlySavings > 0) {
          runningFixedSpend = Math.max(0, runningFixedSpend - unusedMonthlySavings);
          events.push(`Simulated Savings: Unused Subscriptions (-${formatCurrency(unusedMonthlySavings)})`);
        }
      } else {
        // Projected days (Nov 18 - Nov 30)
        runningDiscretionarySpend += effectiveDailyDiscretionary;
        const scheduled = upcomingScheduledRecurring[day];
        if (scheduled) {
          runningFixedSpend += scheduled.amount;
          events.push(`Scheduled Recurring: ${scheduled.label} (${formatCurrency(scheduled.amount)})`);
        }
      }

      const cumulativeTotalSpend = runningFixedSpend + runningDiscretionarySpend;
      const netCashFlowBalance = runningIncome - cumulativeTotalSpend;

      // October reference curve (rent on day 1 + steady daily spend)
      const octoberReferenceSpend =
        day === 1
          ? 2450
          : 2450 + ((summaryMetrics.previousMonthTotalSpending - 2450) / 29) * (day - 1);

      points.push({
        day,
        dateStr,
        isProjected,
        cumulativeIncome: runningIncome,
        cumulativeFixedSpend: runningFixedSpend,
        cumulativeDiscretionarySpend: runningDiscretionarySpend,
        cumulativeTotalSpend,
        netCashFlowBalance,
        octoberReferenceSpend,
        scheduledEvents: events,
      });
    }

    const nov17Point = points[currentDay - 1];
    const nov30Point = points[totalDaysInNov - 1];
    const projectedRemainingSpend =
      nov30Point.cumulativeTotalSpend - nov17Point.cumulativeTotalSpend;

    return {
      points,
      nov17Point,
      nov30Point,
      projectedRemainingSpend,
      effectiveDailyDiscretionary,
      unusedMonthlySavings,
    };
  }, [transactions, subscriptions, summaryMetrics, scenario, excludeUnusedSubs]);

  const activePoint =
    forecastData.points.find((p) => p.day === hoveredDay) ||
    forecastData.points[forecastData.points.length - 1];

  // SVG Coordinate Geometry
  const svgWidth = 860;
  const svgHeight = 250;
  const padLeft = 64;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 32;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const { minVal, maxVal } = useMemo(() => {
    if (chartMetricMode === 'net_balance') {
      const vals = forecastData.points.map((p) => p.netCashFlowBalance);
      const min = Math.min(0, ...vals);
      const max = Math.max(4500, ...vals);
      return { minVal: min - 200, maxVal: max + 300 };
    } else {
      const vals = forecastData.points.flatMap((p) => [
        p.cumulativeTotalSpend,
        p.octoberReferenceSpend,
      ]);
      return { minVal: 0, maxVal: Math.max(6500, ...vals) + 400 };
    }
  }, [forecastData.points, chartMetricMode]);

  const getX = (day: number) => padLeft + ((day - 1) / 29) * plotWidth;
  const getY = (val: number) => {
    const ratio = (val - minVal) / Math.max(1, maxVal - minVal);
    return padTop + plotHeight - ratio * plotHeight;
  };

  const actualPoints = forecastData.points.filter((p) => !p.isProjected);
  const projectedPoints = forecastData.points.filter((p) => p.day >= 17);

  const getMetricValue = (p: DailyProjectionPoint) =>
    chartMetricMode === 'net_balance' ? p.netCashFlowBalance : p.cumulativeTotalSpend;

  const actualPathD = actualPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(p.day).toFixed(1)} ${getY(getMetricValue(p)).toFixed(1)}`)
    .join(' ');

  const projectedPathD = projectedPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(p.day).toFixed(1)} ${getY(getMetricValue(p)).toFixed(1)}`)
    .join(' ');

  const octoberRefPathD =
    chartMetricMode === 'cumulative_spend'
      ? forecastData.points
          .map(
            (p, i) =>
              `${i === 0 ? 'M' : 'L'} ${getX(p.day).toFixed(1)} ${getY(p.octoberReferenceSpend).toFixed(1)}`
          )
          .join(' ')
      : '';

  const baselineZeroY = getY(0);
  const actualAreaD = `${actualPathD} L ${getX(17).toFixed(1)} ${
    chartMetricMode === 'net_balance' ? baselineZeroY.toFixed(1) : (padTop + plotHeight).toFixed(1)
  } L ${getX(1).toFixed(1)} ${
    chartMetricMode === 'net_balance' ? baselineZeroY.toFixed(1) : (padTop + plotHeight).toFixed(1)
  } Z`;

  const yTicks = useMemo(() => {
    const step = (maxVal - minVal) / 4;
    return [0, 1, 2, 3, 4].map((i) => minVal + step * i);
  }, [minVal, maxVal]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header & Scenario Controls */}
      <div className="p-5 sm:px-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Projected Monthly Cash Flow & End-of-Month Balance Forecast
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Combines actual Nov 1–17 ledger records with historical discretionary velocity ({formatCurrency(forecastData.effectiveDailyDiscretionary)}/day) and fixed recurring obligations
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Toggle */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setChartMetricMode('net_balance')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMetricMode === 'net_balance'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Net Cash Flow Balance
            </button>
            <button
              type="button"
              onClick={() => setChartMetricMode('cumulative_spend')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                chartMetricMode === 'cumulative_spend'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Cumulative Spend vs. Oct
            </button>
          </div>

          {/* Trend Scenario Selector */}
          <select
            aria-label="Select projection trend scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ForecastScenario)}
            className="px-3 py-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-slate-900"
          >
            <option value="baseline">Trend: Historical Baseline (1.0x)</option>
            <option value="conservative">Trend: Conservative Spend (-22%)</option>
            <option value="elevated">Trend: Holiday High Pace (+25%)</option>
          </select>

          {/* Toggle Unused Subscriptions Exclusion */}
          <button
            type="button"
            onClick={() => setExcludeUnusedSubs((prev) => !prev)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              excludeUnusedSubs
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {excludeUnusedSubs
              ? 'Simulating Unused Subs Canceled (+$108.99)'
              : 'Simulate Canceling Unused Subs'}
          </button>
        </div>
      </div>

      {/* 4-Column Forecast KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/40">
        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500">Current Net Balance (Nov 17 Actual)</div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(forecastData.nov17Point.netCashFlowBalance, true)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500">
            Income {formatCurrency(forecastData.nov17Point.cumulativeIncome)} − Spend{' '}
            {formatCurrency(forecastData.nov17Point.cumulativeTotalSpend)}
          </div>
        </div>

        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500">Projected Remaining Spend (Nov 18–30)</div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-amber-700">
            {formatCurrency(forecastData.projectedRemainingSpend)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500">
            $222.00 fixed bills + {formatCurrency(forecastData.projectedRemainingSpend - 222)}{' '}
            trend spend
          </div>
        </div>

        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500">Forecasted End-of-Month Spend (Nov 30)</div>
          <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(forecastData.nov30Point.cumulativeTotalSpend)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500">
            Fixed: {formatCurrency(forecastData.nov30Point.cumulativeFixedSpend)} · Discretionary:{' '}
            {formatCurrency(forecastData.nov30Point.cumulativeDiscretionarySpend)}
          </div>
        </div>

        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500">Forecasted End-of-Month Net Balance</div>
          <div
            className={`mt-1 text-lg font-semibold font-mono tabular-nums flex items-center gap-1.5 ${
              forecastData.nov30Point.netCashFlowBalance >= 0
                ? 'text-emerald-700'
                : 'text-rose-700'
            }`}
          >
            {forecastData.nov30Point.netCashFlowBalance >= 0 ? (
              <TrendingUp className="w-4 h-4 shrink-0" />
            ) : (
              <TrendingDown className="w-4 h-4 shrink-0" />
            )}
            <span>{formatCurrency(forecastData.nov30Point.netCashFlowBalance, true)}</span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500">
            Projected savings rate:{' '}
            {(
              (forecastData.nov30Point.netCashFlowBalance /
                Math.max(1, forecastData.nov30Point.cumulativeIncome)) *
              100
            ).toFixed(1)}
            % of income
          </div>
        </div>
      </div>

      {/* SVG Forecast Chart + Interactive Day Inspector */}
      <div className="p-5 sm:px-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-slate-900 inline-block" />
              <span>Actual Ledger (Nov 1 – Nov 17)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-b-2 border-dashed border-emerald-600 inline-block" />
              <span>Projected Trajectory (Nov 18 – Nov 30)</span>
            </span>
            {chartMetricMode === 'cumulative_spend' && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                <span>October Historical Spend Curve</span>
              </span>
            )}
          </div>

          <div className="text-xs font-mono text-slate-500">
            Hover or click any day on chart to inspect daily breakdown
          </div>
        </div>

        {/* Responsive Vector Chart */}
        <div className="w-full overflow-x-auto">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto min-w-[640px] select-none"
            role="img"
            aria-label="Projected Monthly Cash Flow Chart for November 2026"
          >
            {/* Horizontal Grid Lines & Y-Axis Labels */}
            {yTicks.map((tickVal, idx) => {
              const y = getY(tickVal);
              return (
                <g key={idx}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={svgWidth - padRight}
                    y2={y}
                    stroke="#e2e8f0"
                    strokeDasharray={tickVal === 0 ? undefined : '3 3'}
                    strokeWidth={tickVal === 0 ? 1.25 : 1}
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono"
                  >
                    {formatCurrency(tickVal).replace('.00', '')}
                  </text>
                </g>
              );
            })}

            {/* Shaded Forecast Zone Background (Days 17 to 30) */}
            <rect
              x={getX(17)}
              y={padTop}
              width={getX(30) - getX(17)}
              height={plotHeight}
              fill="#f8fafc"
            />
            <line
              x1={getX(17)}
              y1={padTop}
              x2={getX(17)}
              y2={padTop + plotHeight}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <text
              x={getX(17) + 6}
              y={padTop + 12}
              className="fill-slate-500 text-[10px] font-mono"
            >
              Today (Nov 17) → Forecast Window
            </text>

            {/* Area under Actual Curve */}
            <path d={actualAreaD} fill="rgba(15, 23, 42, 0.05)" />

            {/* Optional October Reference Line in Cumulative Spend Mode */}
            {chartMetricMode === 'cumulative_spend' && octoberRefPathD && (
              <path
                d={octoberRefPathD}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="2 3"
              />
            )}

            {/* Actual Trajectory Line (Days 1-17) */}
            <path
              d={actualPathD}
              fill="none"
              stroke="#0f172a"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Projected Trajectory Line (Days 17-30) */}
            <path
              d={projectedPathD}
              fill="none"
              stroke="#059669"
              strokeWidth={2.25}
              strokeDasharray="5 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Active Hovered Day Vertical Guide */}
            <line
              x1={getX(activePoint.day)}
              y1={padTop}
              x2={getX(activePoint.day)}
              y2={padTop + plotHeight}
              stroke="#0f172a"
              strokeOpacity={0.25}
              strokeWidth={1}
            />

            {/* Data Points & Interactive Hit Targets */}
            {forecastData.points.map((pt) => {
              const cx = getX(pt.day);
              const cy = getY(getMetricValue(pt));
              const isSelected = pt.day === activePoint.day;
              const showXLabel =
                pt.day === 1 ||
                pt.day === 5 ||
                pt.day === 10 ||
                pt.day === 15 ||
                pt.day === 17 ||
                pt.day === 22 ||
                pt.day === 26 ||
                pt.day === 30;

              return (
                <g
                  key={pt.day}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredDay(pt.day)}
                  onClick={() => setHoveredDay(pt.day)}
                >
                  {/* Transparent Wide Hit Column */}
                  <rect
                    x={cx - plotWidth / 60}
                    y={padTop}
                    width={plotWidth / 30}
                    height={plotHeight}
                    fill="transparent"
                  />

                  {/* Point Marker */}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 5 : pt.day === 17 || pt.day === 30 ? 3.5 : 2}
                    className={
                      pt.isProjected
                        ? 'fill-emerald-600 stroke-white'
                        : 'fill-slate-900 stroke-white'
                    }
                    strokeWidth={1.5}
                  />

                  {/* X-Axis Date Labels */}
                  {showXLabel && (
                    <text
                      x={cx}
                      y={svgHeight - 8}
                      textAnchor="middle"
                      className={`text-[10px] font-mono ${
                        pt.day === 17 ? 'fill-slate-900 font-semibold' : 'fill-slate-400'
                      }`}
                    >
                      Nov {pt.day}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Day Breakdown Inspector Bar */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Calendar className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="font-mono font-semibold text-slate-900">
              {activePoint.dateStr}
            </span>
            <span className="text-slate-500">
              · {activePoint.isProjected ? 'Projected Forecast' : 'Actual Recorded Ledger'}
            </span>
            {activePoint.scheduledEvents.length > 0 && (
              <span className="text-slate-700 font-medium">
                · {activePoint.scheduledEvents.slice(0, 2).join(', ')}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
            <span className="text-slate-600">
              Cum. Income:{' '}
              <strong className="text-emerald-700">
                {formatCurrency(activePoint.cumulativeIncome)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="text-slate-600">
              Fixed Bills:{' '}
              <strong className="text-slate-900">
                {formatCurrency(activePoint.cumulativeFixedSpend)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="text-slate-600">
              Discretionary:{' '}
              <strong className="text-slate-900">
                {formatCurrency(activePoint.cumulativeDiscretionarySpend)}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <span className="text-slate-600">
              Net Balance:{' '}
              <strong
                className={
                  activePoint.netCashFlowBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }
              >
                {formatCurrency(activePoint.netCashFlowBalance, true)}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
