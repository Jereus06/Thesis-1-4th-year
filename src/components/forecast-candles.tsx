import { chartColors } from "@/lib/chart-theme";

type AxisMap = Record<string, { scale: (value: number) => number }>;
type CandlePoint = {
  date: string;
  timestamp: number;
  actual: number | null;
  predicted: number | null;
  intervalBounds: [number, number] | null;
};

/** Sales candles compare actual and forecast quantities; no financial OHLC values are inferred. */
export function ForecastCandles({
  points,
  xAxisMap,
  yAxisMap,
  color = chartColors.ensemble,
}: {
  points: CandlePoint[];
  xAxisMap?: AxisMap;
  yAxisMap?: AxisMap;
  color?: string;
}) {
  const xScale = Object.values(xAxisMap ?? {})[0]?.scale;
  const yScale = Object.values(yAxisMap ?? {})[0]?.scale;
  if (!xScale || !yScale) return null;
  const positions = [...new Set(points.map((point) => xScale(point.timestamp)))].sort(
    (a, b) => a - b,
  );
  const spacing = positions.slice(1).map((position, index) => position - positions[index]);
  const width = Math.max(1, Math.min(10, (spacing.length ? Math.min(...spacing) : 20) * 0.55));

  return (
    <g className="forecast-candles" pointerEvents="none">
      {points.map((point) => {
        const actual = Number.isFinite(point.actual) ? point.actual : null;
        const predicted = Number.isFinite(point.predicted) ? point.predicted : null;
        if (actual === null && predicted === null) return null;
        const x = xScale(point.timestamp);
        const actualY = actual === null ? null : yScale(actual);
        const predictedY = predicted === null ? null : yScale(predicted);
        const bounds = point.intervalBounds;
        const hasRange = predicted !== null && bounds !== null;
        return (
          <g
            key={point.date}
            className="forecast-candle"
            data-date={point.date}
            data-actual={actual ?? undefined}
            data-predicted={predicted ?? undefined}
            data-low={hasRange ? bounds[0] : undefined}
            data-high={hasRange ? bounds[1] : undefined}
          >
            {hasRange && (
              <line
                className="forecast-candle-wick"
                x1={x}
                x2={x}
                y1={yScale(bounds[1])}
                y2={yScale(bounds[0])}
                stroke={chartColors.xgb}
                strokeOpacity={0.7}
                strokeWidth={1}
              />
            )}
            {actualY !== null && predictedY !== null && (
              <rect
                className="forecast-candle-body"
                x={x - width / 2}
                y={Math.min(actualY, predictedY)}
                width={width}
                height={Math.abs(actualY - predictedY)}
                fill={color}
                fillOpacity={0.2}
                stroke={color}
                strokeWidth={0.8}
              />
            )}
            {actualY !== null && (
              <line
                className="forecast-candle-actual"
                x1={x - width / 2}
                x2={x + width / 2}
                y1={actualY}
                y2={actualY}
                stroke={chartColors.actual}
                strokeWidth={1.8}
              />
            )}
            {predictedY !== null && (
              <line
                className="forecast-candle-predicted"
                x1={x - width / 2}
                x2={x + width / 2}
                y1={predictedY}
                y2={predictedY}
                stroke={color}
                strokeWidth={1.8}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}
