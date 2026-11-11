import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColors } from "@/lib/chart-theme";
import { formatShort } from "@/lib/dates";
import { chartIntervalBounds } from "@/lib/forecast-interval";
import type { ForecastPoint } from "@/lib/types";

export function DemandChart({
  points,
  intervalLabel = "Prediction interval",
  scale = 1,
  showModels = true,
}: {
  points: ForecastPoint[];
  intervalLabel?: string;
  scale?: number;
  showModels?: boolean;
}) {
  if (!points.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl bg-surface-2 text-sm text-muted">
        No holdout series for this product yet.
      </div>
    );
  }

  const data = points.map((p) => ({
    ...p,
    actual: Number.isFinite(p.actual) ? (p.actual ?? 0) * scale : null,
    ma: Number.isFinite(p.ma) ? p.ma * scale : null,
    xgb: Number.isFinite(p.xgb) ? p.xgb * scale : null,
    ensemble: Number.isFinite(p.ensemble) ? p.ensemble * scale : null,
    p10: p.p10 * scale,
    p90: p.p90 * scale,
    label: formatShort(p.date),
    intervalBounds: chartIntervalBounds({
      ...p,
      p10: p.p10 * scale,
      p90: p.p90 * scale,
    }),
  }));
  const hasIntervals = data.some((point) => point.intervalBounds !== null);

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: chartColors.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: chartColors.grid }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: chartColors.muted, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: chartColors.surface,
              border: `1px solid ${chartColors.grid}`,
              borderRadius: 12,
              fontSize: 13,
            }}
          />
          <Legend />
          {hasIntervals && (
            <Area
              type="monotone"
              dataKey="intervalBounds"
              name={intervalLabel}
              stroke="none"
              fill={chartColors.band}
              fillOpacity={1}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke={chartColors.actual}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />
          {showModels && (
            <>
              <Line type="monotone" dataKey="ensemble" name="Ensemble" stroke={chartColors.ensemble} strokeWidth={2.25} dot={false} />
              <Line type="monotone" dataKey="xgb" name="XGBoost" stroke={chartColors.xgb} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="ma" name="Moving Average" stroke={chartColors.ma} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
