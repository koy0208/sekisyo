"""マートビルダー Lambda (docs/redesign/02-data-layer.md)。

S3 の生データ (Parquet/CSV) を DuckDB で集計し、表示用の JSON マートを
marts/ に出力する。フロントの表示パスから Athena を外すための唯一の集計層で、
従来 frontend/src/app/actions/*.ts に散在していた SQL をここに一元化する。

S3 の読み込みは httpfs 拡張の S3 直読みではなく boto3 で /tmp に落として
ローカル読みする (データ全体で数 MB。Lambda 内での拡張ロードの不確実性を避ける)。
"""

import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
import duckdb

BUCKET = os.environ.get("DATA_BUCKET", "fitbit-dashboard")
MART_PREFIX = os.environ.get("MART_PREFIX", "marts/")
LOCAL_DIR = "/tmp/src"
JST = timezone(timedelta(hours=9))

# ソース名 → (S3 プレフィックス, 拡張子)
SOURCES = {
    "steps": ("data/steps/", ".parquet"),
    "sleep": ("data/sleep/", ".parquet"),
    "activity": ("data/activity/", ".parquet"),
    "low_intensity": ("data/low_intensity/", ".parquet"),
    "household_budget": ("data/household_budget/", ".csv"),
    "visits": ("data/timeline/visits/", ".parquet"),
    "activities": ("data/timeline/activities/", ".parquet"),
}

# 家計簿 CSV のヘッダ行は日本語のため、Glue テーブル定義と同じ位置対応で命名する
BUDGET_COLUMNS = [
    "calculation_target", "date", "description", "amount",
    "financial_institution", "major_category", "sub_category", "memo",
    "transfer", "id",
]

# 自宅・親エリア・低確度を除外した「外出先の滞在」共通条件。
# 旧 timeline-actions.ts の VISIT_FILTER をここに一元化 (日別ビューは自宅も含める)
VISIT_FILTER = """
    hierarchy_level = 0
    AND probability >= 0.5
    AND semantic_type NOT IN ('HOME', 'INFERRED_HOME')
    AND place_name IS NOT NULL
"""

s3 = boto3.client("s3")


def download_sources():
    shutil.rmtree(LOCAL_DIR, ignore_errors=True)
    paginator = s3.get_paginator("list_objects_v2")
    for name, (prefix, suffix) in SOURCES.items():
        os.makedirs(f"{LOCAL_DIR}/{name}", exist_ok=True)
        count = 0
        for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if not key.endswith(suffix):
                    continue
                dest = f"{LOCAL_DIR}/{name}/{os.path.basename(key)}"
                s3.download_file(BUCKET, key, dest)
                count += 1
        if count == 0:
            raise RuntimeError(f"no source files under s3://{BUCKET}/{prefix}")


def create_views(con):
    for name in ["steps", "sleep", "activity", "low_intensity", "visits", "activities"]:
        con.execute(
            f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{LOCAL_DIR}/{name}/*.parquet')"
        )
    # 正規化はここで一度だけ行う: 日付 Y/m/d → ISO、金額キャスト、カテゴリ NULL → 不明。
    # フィルタ (集計対象・振替除外) も全マート共通なのでビューに含める
    cols = ", ".join(f"'{c}': 'VARCHAR'" for c in BUDGET_COLUMNS)
    con.execute(f"""
        CREATE VIEW budget AS
        SELECT
            strftime(strptime(date, '%Y/%m/%d'), '%Y-%m-%d') AS date,
            strftime(strptime(date, '%Y/%m/%d'), '%Y-%m') AS month,
            CAST(amount AS INTEGER) AS amount,
            COALESCE(NULLIF(major_category, ''), '不明') AS major_category,
            COALESCE(NULLIF(sub_category, ''), '不明') AS sub_category
        FROM read_csv('{LOCAL_DIR}/household_budget/*.csv',
                      header = true, columns = {{{cols}}})
        WHERE CAST(calculation_target AS INTEGER) = 1
          AND CAST(transfer AS INTEGER) = 0
    """)


def rows(con, sql):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    return str(value)  # date / datetime など


def put_json(key, obj):
    s3.put_object(
        Bucket=BUCKET,
        Key=f"{MART_PREFIX}{key}",
        Body=json.dumps(obj, ensure_ascii=False, default=json_default).encode("utf-8"),
        ContentType="application/json",
    )


# --- fitbit (activity) マート -------------------------------------------------

def build_activity_base(con):
    """日次の全指標を 1 行に統合したベーステーブル (activity マートと daily.json が共用)"""
    con.execute("""
        CREATE TABLE activity_base AS
        WITH steps_d AS (
            SELECT date, SUM(TRY_CAST(steps AS DOUBLE)) AS steps FROM steps GROUP BY date
        ),
        sleep_d AS (
            SELECT date, SUM(total_sleep_hour) AS sleep_hours FROM sleep GROUP BY date
        ),
        -- 最長セッションを主睡眠として就寝・起床時刻を取る (旧 getSleep と同じ)
        sleep_main AS (
            SELECT date,
                   strftime(CAST(start_time AS TIMESTAMP), '%H:%M') AS sleep_start,
                   strftime(CAST(end_time AS TIMESTAMP), '%H:%M') AS sleep_end
            FROM (
                SELECT date, start_time, end_time,
                       ROW_NUMBER() OVER (PARTITION BY date ORDER BY total_sleep_hour DESC) AS rn
                FROM sleep
            )
            WHERE rn = 1
        ),
        act_d AS (
            SELECT date, SUM(active_zone_minutes) AS active_zone_min FROM activity GROUP BY date
        ),
        low_d AS (
            SELECT date, SUM(low_intensity_minutes) AS low_intensity_min
            FROM low_intensity GROUP BY date
        )
        SELECT date, steps, sleep_hours, sleep_start, sleep_end,
               active_zone_min, low_intensity_min
        FROM steps_d
        FULL JOIN sleep_d USING (date)
        FULL JOIN act_d USING (date)
        FULL JOIN low_d USING (date)
        LEFT JOIN sleep_main USING (date)
        ORDER BY date
    """)


def build_activity_marts(con):
    daily = rows(con, """
        SELECT date,
               steps,
               ROUND(AVG(steps) OVER w, 2) AS steps_ma,
               sleep_hours,
               ROUND(AVG(sleep_hours) OVER w, 2) AS sleep_hours_ma,
               sleep_start, sleep_end,
               active_zone_min,
               ROUND(AVG(active_zone_min) OVER w, 2) AS active_zone_ma,
               low_intensity_min,
               ROUND(AVG(low_intensity_min) OVER w, 2) AS low_intensity_ma
        FROM activity_base
        WINDOW w AS (ORDER BY date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW)
        ORDER BY date
    """)
    put_json("activity_daily.json", daily)

    monthly = rows(con, """
        SELECT substr(date, 1, 7) AS month,
               ROUND(AVG(steps), 2) AS steps,
               ROUND(AVG(sleep_hours), 2) AS sleep_hours,
               ROUND(AVG(active_zone_min), 2) AS active_zone_min,
               ROUND(AVG(low_intensity_min), 2) AS low_intensity_min
        FROM activity_base
        GROUP BY 1
        ORDER BY 1
    """)
    put_json("activity_monthly.json", monthly)


# --- budget マート ------------------------------------------------------------

def build_budget_marts(con):
    # 月次: 合計・取引数 + カテゴリ内訳 (収入は sub_category 単位)
    summary = rows(con, """
        SELECT month,
               SUM(CASE WHEN major_category <> '収入' THEN amount END) AS expense_total,
               SUM(CASE WHEN major_category = '収入' THEN amount END) AS income_total,
               COUNT(CASE WHEN major_category <> '収入' THEN 1 END) AS transaction_count
        FROM budget
        GROUP BY month
        ORDER BY month
    """)
    breakdown = rows(con, """
        SELECT month,
               CASE WHEN major_category = '収入' THEN 'income' ELSE 'expense' END AS kind,
               CASE WHEN major_category = '収入' THEN sub_category ELSE major_category END AS category,
               SUM(amount) AS amount
        FROM budget
        GROUP BY 1, 2, 3
        ORDER BY month, amount DESC
    """)
    by_month = {}
    for r in summary:
        by_month[r["month"]] = {
            "month": r["month"],
            "expense_total": r["expense_total"] or 0,
            "income_total": r["income_total"] or 0,
            "transaction_count": r["transaction_count"],
            "expense_by_category": {},
            "income_by_category": {},
        }
    for r in breakdown:
        key = "income_by_category" if r["kind"] == "income" else "expense_by_category"
        by_month[r["month"]][key][r["category"]] = r["amount"]
    put_json("budget_monthly.json", list(by_month.values()))

    # 日次: 日 × カテゴリの素データ。累積・週次トレンドはフロントで導出する
    daily = rows(con, """
        SELECT date,
               CASE WHEN major_category = '収入' THEN 'income' ELSE 'expense' END AS kind,
               CASE WHEN major_category = '収入' THEN sub_category ELSE major_category END AS category,
               SUM(amount) AS amount
        FROM budget
        GROUP BY 1, 2, 3
        ORDER BY date
    """)
    put_json("budget_daily.json", daily)


# --- timeline マート ----------------------------------------------------------

def build_timeline_marts(con, executor):
    ranking = rows(con, f"""
        SELECT substr(date, 1, 7) AS mon,
               place_id,
               max(place_name) AS place_name,
               max(google_maps_uri) AS uri,
               max(lat) AS lat,
               max(lng) AS lng,
               count(*) AS visits,
               round(sum(duration_min) / 60.0, 1) AS hours
        FROM visits
        WHERE {VISIT_FILTER}
        GROUP BY substr(date, 1, 7), place_id
        ORDER BY mon
    """)
    put_json("timeline_ranking.json", ranking)

    # 場所ドリルダウン用の訪問明細 (place_id での絞り込みはフロントで行う)
    place_visits = rows(con, f"""
        SELECT place_id,
               date,
               strftime(start_time, '%a') AS dow,
               strftime(start_time, '%H:%M') AS in_t,
               strftime(end_time, '%H:%M') AS out_t,
               duration_min AS dur
        FROM visits
        WHERE {VISIT_FILTER}
        ORDER BY start_time
    """)
    put_json("timeline_place_visits.json", place_visits)

    # 日別ビュー: 滞在 + 移動を時系列統合し 1 日 1 ファイル。自宅も含める
    history = rows(con, """
        SELECT kind, date, in_t, out_t, dur, label, type_code,
               place_id, uri, lat, lng, end_lat, end_lng, dist_m
        FROM (
            SELECT 'visit' AS kind, date,
                   strftime(start_time, '%H:%M') AS in_t,
                   strftime(end_time, '%H:%M') AS out_t,
                   duration_min AS dur,
                   place_name AS label,
                   semantic_type AS type_code,
                   place_id,
                   google_maps_uri AS uri,
                   lat, lng,
                   CAST(NULL AS DOUBLE) AS end_lat,
                   CAST(NULL AS DOUBLE) AS end_lng,
                   CAST(NULL AS DOUBLE) AS dist_m,
                   start_time
            FROM visits
            WHERE hierarchy_level = 0
            UNION ALL
            SELECT 'move' AS kind, date,
                   strftime(start_time, '%H:%M') AS in_t,
                   strftime(end_time, '%H:%M') AS out_t,
                   duration_min AS dur,
                   CAST(NULL AS VARCHAR) AS label,
                   activity_type AS type_code,
                   CAST(NULL AS VARCHAR) AS place_id,
                   CAST(NULL AS VARCHAR) AS uri,
                   start_lat AS lat,
                   start_lng AS lng,
                   end_lat, end_lng,
                   distance_m AS dist_m,
                   start_time
            FROM activities
        )
        ORDER BY start_time
    """)
    by_date = {}
    for r in history:
        by_date.setdefault(r["date"], []).append(r)
    # 1500 日分程度の PutObject を直列で行うと数十秒かかるため並列化する
    futures = [
        executor.submit(put_json, f"timeline_days/{date}.json", items)
        for date, items in by_date.items()
    ]
    for f in futures:
        f.result()
    return len(by_date)


# --- daily.json (横断機能の基盤) ----------------------------------------------

def build_daily_mart(con):
    base = rows(con, f"""
        WITH spend AS (
            SELECT date, SUM(amount) AS spending_total
            FROM budget WHERE major_category <> '収入' GROUP BY date
        ),
        tl AS (
            SELECT date,
                   COUNT(*) AS visit_count,
                   ROUND(SUM(duration_min) / 60.0, 1) AS out_hours
            FROM visits
            WHERE {VISIT_FILTER}
            GROUP BY date
        )
        SELECT date, steps, sleep_hours, sleep_start, sleep_end,
               active_zone_min, low_intensity_min,
               spending_total, visit_count, out_hours
        FROM activity_base
        FULL JOIN spend USING (date)
        FULL JOIN tl USING (date)
        ORDER BY date
    """)
    spend_cat = rows(con, """
        SELECT date, major_category AS category, SUM(amount) AS amount
        FROM budget WHERE major_category <> '収入' GROUP BY 1, 2
    """)
    top_places = rows(con, f"""
        SELECT date, place_id, max(place_name) AS name, SUM(duration_min) AS min
        FROM visits
        WHERE {VISIT_FILTER}
        GROUP BY date, place_id
        QUALIFY ROW_NUMBER() OVER (PARTITION BY date ORDER BY SUM(duration_min) DESC) <= 3
        ORDER BY date, min DESC
    """)
    by_date = {r["date"]: r for r in base}
    for r in spend_cat:
        row = by_date.get(r["date"])
        if row is not None:
            row.setdefault("spending_by_category", {})[r["category"]] = r["amount"]
    for r in top_places:
        row = by_date.get(r["date"])
        if row is not None:
            row.setdefault("top_places", []).append(
                {"place_id": r["place_id"], "name": r["name"], "min": r["min"]}
            )
    put_json("daily.json", base)


# --- meta.json (鮮度情報。最後に書くことで更新完了マーカーを兼ねる) ---------------

def build_meta_mart(con):
    fitbit_last = con.execute(
        "SELECT max(date) FROM activity_base WHERE steps IS NOT NULL"
    ).fetchone()[0]
    budget_last = con.execute("SELECT max(date) FROM budget").fetchone()[0]
    tl_first, tl_last = con.execute(
        "SELECT min(date), max(date) FROM visits WHERE hierarchy_level = 0"
    ).fetchone()
    meta = {
        "generated_at": datetime.now(JST).isoformat(timespec="seconds"),
        "sources": {
            "fitbit": {"last_date": fitbit_last},
            "budget": {"last_date": budget_last},
            "timeline": {"first_date": tl_first, "last_date": tl_last},
        },
    }
    put_json("meta.json", meta)
    return meta


def handler(event, context):
    download_sources()
    con = duckdb.connect()
    create_views(con)
    build_activity_base(con)

    build_activity_marts(con)
    build_budget_marts(con)
    with ThreadPoolExecutor(max_workers=16) as executor:
        day_files = build_timeline_marts(con, executor)
    build_daily_mart(con)
    meta = build_meta_mart(con)

    print(f"marts generated: timeline_days={day_files}, meta={json.dumps(meta, ensure_ascii=False)}")
    return {"statusCode": 200, "body": json.dumps({"timeline_days": day_files, **meta})}
