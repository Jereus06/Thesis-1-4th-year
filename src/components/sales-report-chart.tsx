import { useId, useMemo, useState, type CSSProperties } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartColors } from "@/lib/chart-theme";
import type { DailySalesProduct, DailySalesRow } from "@/lib/daily-sales";
import { quantity } from "@/lib/format";
import {
  buildSalesRecordShares,
  buildSalesTrend,
  salesPieLayout,
  salesSharePercentage,
  type SalesReportChartType,
} from "@/lib/sales-report-chart";

const colors = [
  chartColors.xgb,
  chartColors.ma,
  "#B47B2E",
  "#426A8C",
  "#926484",
  "#607841",
  "#B05E42",
  "#7BA3AE",
];
const tooltipStyle: CSSProperties = {
  background: chartColors.surface,
  border: `1px solid ${chartColors.grid}`,
  borderRadius: 12,
  fontSize: 13,
  maxWidth: "min(80vw, 24rem)",
  whiteSpace: "normal",
  overflowWrap: "anywhere",
};
const dateLabel = (value: number) =>
  new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

export function SalesReportChart({
  rows,
  products,
  chartType = "bar",
}: {
  rows: DailySalesRow[];
  products: DailySalesProduct[];
  chartType?: SalesReportChartType;
}) {
  const trend = useMemo(() => buildSalesTrend(rows), [rows]);
  const shares = useMemo(() => buildSalesRecordShares(products), [products]);
  const descriptionId = useId();
  const [chartSize, setChartSize] = useState({ width: 300, height: 288 });
  const pieLayout = salesPieLayout(shares, chartSize.width, chartSize.height);
  const pie = chartType === "pie";
  if (pie ? !shares.length : !trend.points.length) {
    return <p className="py-16 text-center text-sm text-muted">No sales match these filters.</p>;
  }

  const legend = pie
    ? shares.map((share) => ({
        key: share.id,
        text: `${share.name}: ${quantity(share.records)} records (${salesSharePercentage(share.percentage)})`,
      }))
    : trend.series.map((series) => ({ key: series.key, text: series.unit || "Unspecified unit" }));

  return (
    <div className="grid min-w-0 gap-3">
      <div
        role="img"
        aria-label={
          pie
            ? "Product share of sales records"
            : `Sales trend — ${chartType[0].toUpperCase()}${chartType.slice(1)}`
        }
        aria-describedby={descriptionId}
        className="h-72 min-w-0 w-full overflow-hidden"
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          onResize={(width, height) =>
            setChartSize((previous) =>
              previous.width === width && previous.height === height ? previous : { width, height },
            )
          }
        >
          {pie ? (
            <PieChart>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, _name, item) => [
                  `${quantity(Number(value))} records (${salesSharePercentage(Number(item.payload.percentage))})`,
                  "Sales records",
                ]}
              />
              <Pie
                data={shares}
                dataKey="records"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={pieLayout.radius}
                labelLine={false}
                label={({ index }: { index?: number }) => {
                  const label = index === undefined ? undefined : pieLayout.labels[index];
                  if (!label) return null;
                  return (
                    <g className="sales-pie-percentage" data-share-index={index}>
                      <polyline
                        points={`${label.startX},${label.startY} ${label.elbowX},${label.elbowY} ${label.x - label.side * 4},${label.y}`}
                        fill="none"
                        stroke={colors[index! % colors.length]}
                        strokeWidth={1}
                      />
                      <text
                        x={label.x}
                        y={label.y}
                        textAnchor={label.side > 0 ? "start" : "end"}
                        dominantBaseline="middle"
                        fill={chartColors.actual}
                        fontSize={12}
                        fontWeight={500}
                      >
                        {label.text}
                      </text>
                    </g>
                  );
                }}
                stroke={chartColors.surface}
                strokeWidth={2}
                isAnimationActive={false}
              >
                {shares.map((share, index) => (
                  <Cell key={share.id} fill={colors[index % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : (
            <ComposedChart
              data={trend.points}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
              barCategoryGap="20%"
            >
              <CartesianGrid stroke={chartColors.grid} vertical={false} />
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={trend.domain}
                ticks={trend.points.length === 1 ? [trend.points[0].timestamp] : undefined}
                tickFormatter={dateLabel}
                tick={{ fill: chartColors.muted, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: chartColors.grid }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: chartColors.muted, fontSize: 12 }}
                tickFormatter={quantity}
                tickLine={false}
                axisLine={false}
                width={52}
                domain={[0, "auto"]}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 10)}
                formatter={(value, name) => [quantity(Number(value)), `Quantity (${name})`]}
              />
              {chartType === "bar" &&
                trend.series.map((series, index) => (
                  <Bar
                    key={series.key}
                    dataKey={`values.${series.key}`}
                    name={series.unit || "Unspecified unit"}
                    fill={colors[index % colors.length]}
                    maxBarSize={64}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  />
                ))}
              {chartType === "line" &&
                trend.series.map((series, index) => (
                  <Line
                    key={series.key}
                    dataKey={`values.${series.key}`}
                    name={series.unit || "Unspecified unit"}
                    type="linear"
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: colors[index % colors.length] }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              {chartType === "area" &&
                trend.series.map((series, index) => (
                  <Area
                    key={series.key}
                    dataKey={`values.${series.key}`}
                    name={series.unit || "Unspecified unit"}
                    type="linear"
                    stroke={colors[index % colors.length]}
                    fill={colors[index % colors.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    dot={{ r: 3, fill: colors[index % colors.length] }}
                    activeDot={{ r: 5 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
      <ul
        aria-label={pie ? "Product share legend" : "Counting units legend"}
        className="flex max-h-28 flex-wrap gap-x-5 gap-y-2 overflow-y-auto text-xs text-muted"
        tabIndex={0}
      >
        {legend.map((item, index) => (
          <li key={item.key} className="flex min-w-0 items-start gap-2">
            <span
              className="mt-0.5 size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: colors[index % colors.length] }}
              aria-hidden="true"
            />
            <span className="[overflow-wrap:anywhere]">{item.text}</span>
          </li>
        ))}
      </ul>
      <p id={descriptionId} className="text-xs text-muted">
        {pie
          ? "Each slice counts sales records. Smaller groups appear as Other products."
          : "Quantities are grouped by counting unit. Gaps indicate missing records."}
      </p>
    </div>
  );
}
