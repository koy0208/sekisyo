'use server'

import { runAthenaQuery } from "@/lib/athena";

export async function getActivity(amount: number = 1, unit: string = 'month') {
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
  const query = `
    SELECT date, val as total_sleep_hour, ma as total_sleep_hour_ma, start_time, end_time
    FROM (
      SELECT 
        date, 
        val,
        AVG(val) OVER (ORDER BY date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as ma,
        start_time,
        end_time
      FROM (
        SELECT 
          date, 
          SUM(total_sleep_hour) as val, 
          MIN(start_time) as start_time, 
          MAX(end_time) as end_time
        FROM fitbit.sleep
        GROUP BY date
      )
    )
    WHERE date >= cast(current_date - interval '${amount}' ${unit} as varchar)
    ORDER BY date ASC
  `;
  return await runAthenaQuery(query);
}

export async function getSteps(amount: number = 1, unit: string = 'month') {
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

export async function getDataUpdateStatus() {
  const query = `
    SELECT MAX(date) as last_updated
    FROM fitbit.steps
  `;
  const result = await runAthenaQuery(query);
  return result[0]?.last_updated;
}
