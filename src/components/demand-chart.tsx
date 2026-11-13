import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColors } from "@/lib/chart-theme";
import { ForecastCandles } from "@/components/forecast-candles";
import { formatShort } from "@/lib/dates";
import { chartIntervalBounds } from "@/lib/forecast-interval";
import { predictionKey } from "@/lib/forecast/chart";
import { modelLabel } from "@/lib/forecast/constants";
import type { ForecastMethod, ForecastPoint } from "@/lib/types";

export type ForecastChartType = "line" | "area" | "candlestick" | "step";

export function DemandChart({
  points,
  intervalLabel = "Prediction interval",
  scale = 1,
  showModels = true,
  method = "ensemble",
  chartType = "line",
}: {
  points: ForecastPoint[];
  intervalLabel?: string;
  scale?: number;
  showModels?: boolean;
  method?: ForecastMethod;
  chartType?: ForecastChartType;
}) {
  if (!points.length) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl bg-surface-2 text-sm text-muted">
        No forecast series for this product yet.
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
    timestamp: Date.parse(`${p.date}T00:00:00Z`),
    predicted: Number.isFinite(p[predictionKey(method)]) ? p[predictionKey(method)] * scale : null,
    intervalBounds: chartIntervalBounds({
      ...p,
      p10: p.p10 * scale,
      p90: p.p90 * scale,
    }),
  }));
  const hasIntervals = data.some((point) => point.intervalBounds !== null);
  const timestamps = [...new Set(data.map((point) => point.timestamp))].sort((a, b) => a - b);
  const steps = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]);
  const halfStep = (steps.length ? Math.min(...steps) : 86_400_000) / 2;
  const series: {
    key: "predicted" | "actual" | "ensemble" | "xgb" | "ma";
    name: string;
    color: string;
    width: number;
    dash?: string;
  }[] = [
    ...(!showModels
      ? [
          {
            key: "predicted" as const,
            name: `Predicted (${modelLabel(method === "rule" ? "ma" : method)})`,
            color: chartColors.ensemble,
            width: 2.25,
          },
        ]
      : []),
    { key: "actual", name: "Actual", color: chartColors.actual, width: 2 },
    ...(showModels
      ? [
          { key: "ensemble" as const, name: "Ensemble", color: chartColors.ensemble, width: 2.25 },
          { key: "xgb" as const, name: "XGBoost", color: chartColors.xgb, width: 1.5 },
          {
            key: "ma" as const,
            name: "Moving Average",
            color: chartColors.ma,
            width: 1.5,
            dash: "5 4",
          },
        ]
      : []),
  ];

  return (
    <div className="min-w-0 w-full">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={
                chartType === "candlestick" || timestamps.length === 1
                  ? [timestamps[0] - halfStep, timestamps[timestamps.length - 1] + halfStep]
                  : ["dataMin", "dataMax"]
              }
              ticks={
                chartType === "candlestick" || timestamps.length === 1 ? timestamps : undefined
              }
              tickFormatter={(value: number) =>
                formatShort(new Date(value).toISOString().slice(0, 10))
              }
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
              labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 10)}
              contentStyle={{
                background: chartColors.surface,
                border: `1px solid ${chartColors.grid}`,
                borderRadius: 12,
                fontSize: 13,
              }}
            />
            {hasIntervals && (
              <Area
                type="linear"
                dataKey="intervalBounds"
                name={intervalLabel}
                stroke="none"
                fill={chartColors.band}
                fillOpacity={chartType === "candlestick" ? 0 : 1}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {series.map((item) =>
              chartType === "area" ? (
                <Area
                  key={item.key}
                  type="linear"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  fill={item.color}
                  fillOpacity={0.12}
                  strokeWidth={item.width}
                  strokeDasharray={item.dash}
                  dot={
                    data.filter((point) => Number.isFinite(point[item.key])).length === 1
                      ? { r: 3 }
                      : false
                  }
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={item.key}
                  type={chartType === "step" ? "stepAfter" : "linear"}
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  strokeWidth={item.width}
                  strokeDasharray={item.dash}
                  strokeOpacity={
                    chartType === "candlestick" &&
                    (item.key === "actual" ||
                      item.key === "predicted" ||
                      item.key === predictionKey(method))
                      ? 0
                      : 1
                  }
                  dot={
                    chartType !== "candlestick" &&
                    data.filter((point) => Number.isFinite(point[item.key])).length === 1
                      ? { r: 3 }
                      : false
                  }
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ),
            )}
            {chartType === "candlestick" && (
              <Customized
                component={
                  <ForecastCandles
                    points={data}
                    color={
                      showModels
                        ? series.find((item) => item.key === predictionKey(method))?.color
                        : chartColors.ensemble
                    }
                  />
                }
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul
        aria-label="Forecast chart legend"
        className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-muted"
      >
        {[
          ...(hasIntervals
            ? [{ key: "interval", name: intervalLabel, color: "#6D8B7E", dash: undefined }]
            : []),
          ...series.filter((item) => item.key === "actual"),
          ...series.filter((item) => item.key !== "actual"),
        ].map((item) => (
          <li key={item.key} className="flex min-w-0 items-center gap-1.5">
            <svg aria-hidden="true" width="18" height="12" viewBox="0 0 18 12" className="shrink-0">
              <line
                x1="1"
                y1="6"
                x2="17"
                y2="6"
                stroke={item.color}
                strokeWidth="1.5"
                strokeDasharray={item.dash}
              />
              <circle cx="9" cy="6" r="2" stroke={item.color} fill={chartColors.surface} />
            </svg>
            <span className="[overflow-wrap:anywhere]">{item.name}</span>
          </li>
        ))}
      </ul>
      {chartType === "candlestick" && (
        <p className="mt-3 text-xs text-muted">
          Candle bodies compare actual sales with the chosen forecast. Whiskers show the saved
          estimated range when available. Future dates show forecast markers until actual sales are
          available.
        </p>
      )}
    </div>
  );
}
