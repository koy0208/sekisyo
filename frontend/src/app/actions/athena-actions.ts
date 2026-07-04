'use server'

import { runAthenaQuery } from "@/lib/athena";
import { assertAmount, assertUnit } from "@/lib/query-guards";

function isAllPeriod(unit: string) {
  return unit === 'all'
}

// 非 all の期間指定を検証して SQL の interval 句に埋め込める形にする。
// 'all' はクエリ分岐で処理し、文字列自体は SQL に埋め込まない。
function assertPeriod(amount: number, unit: string) {
  assertAmount(amount)
  assertUnit(unit)
}

export async function getActivity(amount: number = 1, unit: string = 'month') {
  if (isAllPeriod(unit)) {
    const query = `
      SELECT
        substr(date, 1, 7) as date,
        ROUND(AVG(daily_total), 2) as active_zone_minutes,
        null as active_zone_ma
      FROM (
        SELECT date, SUM(active_zone_minutes) as daily_total
        FROM fitbit.activity
        GROUP BY date
      )
      GROUP BY substr(date, 1, 7)
      ORDER BY date ASC
    `;
    return await runAthenaQuery(query);
  }
  assertPeriod(amount, unit)
  const query = `
    SELECT date, val as active_zone_minutes, ma as active_zone_ma
    FROM (
      SELECT
        date,
        val,
        AVG(val) OVER (ORDER BY date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as ma
      FROM (
        SELECT date, SUM(active_zone_minutes) as val
        FROM fitbit.activity
        GROUP BY date
      )
    )
    WHERE date >= cast(current_date - interval '${amount}' ${unit} as varchar)
    ORDER BY date ASC
  `;
  return await runAthenaQuery(query);
}

export async function getLowIntensity(amount: number = 1, unit: string = 'month') {
  if (isAllPeriod(unit)) {
    const query = `
      SELECT
        substr(date, 1, 7) as date,
        ROUND(AVG(daily_total), 2) as low_intensity_minutes,
        null as low_intensity_ma
      FROM (
        SELECT date, SUM(low_intensity_minutes) as daily_total
        FROM fitbit.low_intensity
        GROUP BY date
      )
      GROUP BY substr(date, 1, 7)
      ORDER BY date ASC
    `;
    return await runAthenaQuery(query);
  }
  assertPeriod(amount, unit)
  const query = `
    SELECT date, val as low_intensity_minutes, ma as low_intensity_ma
    FROM (
      SELECT
        date,
        val,
        AVG(val) OVER (ORDER BY date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as ma
      FROM (
        SELECT date, SUM(low_intensity_minutes) as val
        FROM fitbit.low_intensity
        GROUP BY date
      )
    )
    WHERE date >= cast(current_date - interval '${amount}' ${unit} as varchar)
    ORDER BY date ASC
  `;
  return await runAthenaQuery(query);
}

export async function getSleep(amount: number = 1, unit: string = 'month') {
  if (isAllPeriod(unit)) {
    const query = `
      WITH daily_totals AS (
        SELECT date, SUM(total_sleep_hour) as val
        FROM fitbit.sleep
        GROUP BY date
      )
      SELECT
        substr(date, 1, 7) as date,
        ROUND(AVG(val), 2) as total_sleep_hour,
        null as total_sleep_hour_ma,
        null as start_time,
        null as end_time
      FROM daily_totals
      GROUP BY substr(date, 1, 7)
      ORDER BY date ASC
    `;
    return await runAthenaQuery(query);
  }
  assertPeriod(amount, unit)
  const query = `
    WITH daily_totals AS (
      SELECT
        date,
        SUM(total_sleep_hour) as val
      FROM fitbit.sleep
      GROUP BY date
    ),
    main_sleep_session AS (
      SELECT
        date,
        start_time,
        end_time
      FROM (
        SELECT
          date,
          start_time,
          end_time,
          ROW_NUMBER() OVER(PARTITION BY date ORDER BY total_sleep_hour DESC) as rn
        FROM fitbit.sleep
      ) AS ranked_sleep
      WHERE rn = 1
    )
    SELECT
      dt.date,
      dt.val as total_sleep_hour,
      AVG(dt.val) OVER (ORDER BY dt.date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as total_sleep_hour_ma,
      mss.start_time,
      mss.end_time
    FROM daily_totals dt
    LEFT JOIN main_sleep_session mss ON dt.date = mss.date
    WHERE dt.date >= cast(current_date - interval '${amount}' ${unit} as varchar)
    ORDER BY dt.date ASC;
  `;
  return await runAthenaQuery(query);
}

export async function getSteps(amount: number = 1, unit: string = 'month') {
  if (isAllPeriod(unit)) {
    const query = `
      SELECT
        substr(date, 1, 7) as date,
        ROUND(AVG(daily_total), 2) as steps,
        null as steps_ma
      FROM (
        SELECT date, SUM(CAST(steps AS DOUBLE)) as daily_total
        FROM fitbit.steps
        GROUP BY date
      )
      GROUP BY substr(date, 1, 7)
      ORDER BY date ASC
    `;
    return await runAthenaQuery(query);
  }
  assertPeriod(amount, unit)
  const query = `
    SELECT date, val as steps, ma as steps_ma
    FROM (
      SELECT
        date,
        val,
        AVG(val) OVER (ORDER BY date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as ma
      FROM (
        SELECT date, SUM(CAST(steps AS DOUBLE)) as val
        FROM fitbit.steps
        GROUP BY date
      )
    )
    WHERE date >= cast(current_date - interval '${amount}' ${unit} as varchar)
    ORDER BY date ASC
  `;
  return await runAthenaQuery(query);
}

// StatsCard 用: 選択期間と独立に、各指標の最新日の値と日付を 1 クエリで返す。
// (従来は選択期間の配列末尾を「今日の値」として表示しており、期間切替で意味が変わっていた)
export async function getLatestStats() {
  const query = `
    SELECT * FROM (
      SELECT 'steps' AS metric, date, SUM(CAST(steps AS DOUBLE)) AS val
      FROM fitbit.steps GROUP BY date ORDER BY date DESC LIMIT 1
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'sleep' AS metric, date, SUM(total_sleep_hour) AS val
      FROM fitbit.sleep GROUP BY date ORDER BY date DESC LIMIT 1
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'active_zone' AS metric, date, SUM(active_zone_minutes) AS val
      FROM fitbit.activity GROUP BY date ORDER BY date DESC LIMIT 1
    )
    UNION ALL
    SELECT * FROM (
      SELECT 'low_intensity' AS metric, date, SUM(low_intensity_minutes) AS val
      FROM fitbit.low_intensity GROUP BY date ORDER BY date DESC LIMIT 1
    )
  `;
  return await runAthenaQuery(query);
}
