import { ChartGraphic } from './chart-motion';
import { overviewChartRatio, type OverviewProjection } from './contracts';
import styles from './overview.module.css';

type Point = { date: string; value: string | null };
function maximum(points: Point[]) {
  return points.reduce(
    (max, point) =>
      point.value !== null && BigInt(point.value) > BigInt(max)
        ? point.value
        : max,
    '0',
  );
}

/** Nulls split paths. Drawing ratios never replace the exact table values. */
export function stockPaths(points: Point[]) {
  const max = maximum(points);
  const paths: string[] = [];
  let path = '';
  points.forEach((point, index) => {
    if (point.value === null) {
      if (path) paths.push(path);
      path = '';
      return;
    }
    const x = 8 + (index * 284) / Math.max(1, points.length - 1);
    const y = 72 - overviewChartRatio(point.value, max) * 64;
    path += `${path ? ' L' : 'M'}${x},${y}`;
  });
  if (path) paths.push(path);
  return paths;
}

export function StockChart({
  trend,
  today,
}: {
  trend: OverviewProjection['stockTrends'][number];
  today: string;
}) {
  return (
    <>
      <ChartGraphic identity={JSON.stringify(trend.points)}>
        <svg viewBox="0 0 300 80" className={styles.chart} aria-hidden="true">
          {stockPaths(trend.points).map((path, index) => (
            <path
              key={index}
              d={path}
              pathLength="1"
              data-chart-mark="line"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          ))}
          {trend.points.map(
            (point, index) =>
              point.value !== null && (
                <circle
                  key={point.date}
                  cx={8 + (index * 284) / 13}
                  cy={
                    72 -
                    overviewChartRatio(point.value, maximum(trend.points)) * 64
                  }
                  r="2.5"
                  fill="currentColor"
                />
              ),
          )}
        </svg>
      </ChartGraphic>
      <details className={styles.disclosure}>
        <summary>View daily stock table for {trend.name}</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption>{trend.name} · available in storage</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Available units</th>
                <th scope="col">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {trend.points.map((point) => (
                <tr key={point.date}>
                  <th scope="row">
                    {point.date}
                    {point.date === today ? ' · today so far' : ''}
                  </th>
                  <td>{point.value ?? 'Not available'}</td>
                  <td>
                    {point.state === 'recorded'
                      ? 'Recorded'
                      : point.state === 'not_yet_recorded'
                        ? 'Not yet recorded'
                        : 'History unavailable'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

export function ActivityChart({
  activity,
  today,
}: {
  activity: OverviewProjection['activity'];
  today: string;
}) {
  const max = maximum(activity.points);
  return (
    <>
      <ChartGraphic identity={JSON.stringify(activity.points)}>
        <svg viewBox="0 0 300 80" className={styles.chart} aria-hidden="true">
          {activity.points.map(
            (point, index) =>
              point.value !== null && (
                <rect
                  key={point.date}
                  x={(index * 300) / 14 + 3}
                  y={76 - overviewChartRatio(point.value, max) * 68}
                  data-chart-mark="bar"
                  width="15"
                  height={overviewChartRatio(point.value, max) * 68}
                  fill="currentColor"
                />
              ),
          )}
        </svg>
      </ChartGraphic>
      <details className={styles.disclosure}>
        <summary>View daily activity table</summary>
        <div className={styles.tableScroll}>
          <table>
            <caption>
              Recorded inventory events · each event counted once
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Events</th>
              </tr>
            </thead>
            <tbody>
              {activity.points.map((point) => (
                <tr key={point.date}>
                  <th scope="row">
                    {point.date}
                    {point.date === today ? ' · today so far' : ''}
                  </th>
                  <td>{point.value ?? 'Not available'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
