import os
import json
import time
from io import BytesIO
from datetime import datetime, timezone

import boto3
import botocore.exceptions
import requests
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# 設定
SECRET_NAME = "prod/dashboard/gdrive"  # Places API キーは Drive 用シークレットに同居
S3_BUCKET = "fitbit-dashboard"
INPUT_PREFIX = os.environ.get("TIMELINE_INPUT_PREFIX", "data/gdrive/timeline/")
OUTPUT_PREFIX = os.environ.get("TIMELINE_OUTPUT_PREFIX", "data/timeline/")

VISITS_KEY = f"{OUTPUT_PREFIX}visits/visits.parquet"
ACTIVITIES_KEY = f"{OUTPUT_PREFIX}activities/activities.parquet"
PLACE_CACHE_KEY = f"{OUTPUT_PREFIX}place_cache/place_cache.parquet"

PLACES_API_URL = "https://places.googleapis.com/v1/places/{place_id}"
# すべて Pro ティア内のフィールド（追加課金なし）
PLACES_FIELD_MASK = (
    "displayName,formattedAddress,types,location,addressComponents,"
    "primaryTypeDisplayName,googleMapsUri"
)
TZ = "Asia/Tokyo"

# place_cache のスキーマ。addressComponents(都道府県/市区町村)・カテゴリ・マップURL対応。
# 旧スキーマ(prefecture 列なし)を読んだ場合は、解決済みの場所のみ再取得して補完する
# (resolve_place_ids 内で列の有無を見て移行)。
PLACE_CACHE_COLUMNS = [
    "place_id", "place_name", "place_address", "place_types", "place_category",
    "prefecture", "municipality", "google_maps_uri", "lat", "lng", "resolved_at",
]

s3_client = boto3.client("s3")


# ---------------------------------------------------------------------------
# Secrets / Places API key
# ---------------------------------------------------------------------------
def get_places_api_key():
    """Secrets Manager から Google Maps (Places) API キーを取得。未設定なら None。"""
    region = os.environ.get("AWS_REGION", "ap-northeast-1")
    client = boto3.client("secretsmanager", region_name=region)
    secret = json.loads(client.get_secret_value(SecretId=SECRET_NAME)["SecretString"])
    return secret.get("GOOGLE_MAPS_API_KEY")


# ---------------------------------------------------------------------------
# S3 入出力
# ---------------------------------------------------------------------------
def list_timeline_json_keys():
    """INPUT_PREFIX 配下の *.json キーを全件返す。"""
    keys = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=INPUT_PREFIX):
        for obj in page.get("Contents", []):
            if obj["Key"].lower().endswith(".json"):
                keys.append(obj["Key"])
    return keys


def load_json_from_s3(key):
    body = s3_client.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()
    return json.loads(body)


def read_parquet_from_s3(key):
    """S3 上の Parquet を DataFrame で返す。無ければ None。"""
    try:
        body = s3_client.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()
        return pd.read_parquet(BytesIO(body))
    except botocore.exceptions.ClientError as e:
        if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
            return None
        raise


def write_parquet_to_s3(df, key):
    buffer = BytesIO()
    # Athena(Trino系)は Parquet のナノ秒 timestamp を読めないため ms に丸める
    pq.write_table(
        pa.Table.from_pandas(df, preserve_index=False),
        buffer,
        coerce_timestamps="ms",
        allow_truncated_timestamps=True,
    )
    buffer.seek(0)
    s3_client.upload_fileobj(buffer, S3_BUCKET, key)
    print(f"Uploaded {len(df)} rows to s3://{S3_BUCKET}/{key}")


# ---------------------------------------------------------------------------
# パース
# ---------------------------------------------------------------------------
def parse_lat_lng(latlng_str):
    """'35.176°, 136.974°' -> (35.176, 136.974)。失敗時 (None, None)。"""
    if not latlng_str:
        return (None, None)
    try:
        parts = latlng_str.replace("°", "").split(",")
        return (float(parts[0].strip()), float(parts[1].strip()))
    except (ValueError, IndexError):
        return (None, None)


def parse_segments(segments, source_file):
    """semanticSegments を visits / activities の行リストに展開する。"""
    visits, activities = [], []
    for seg in segments:
        start, end = seg.get("startTime"), seg.get("endTime")
        if "visit" in seg:
            visit = seg["visit"]
            tc = visit.get("topCandidate", {})
            lat, lng = parse_lat_lng(tc.get("placeLocation", {}).get("latLng"))
            visits.append({
                "start_time": start,
                "end_time": end,
                "hierarchy_level": visit.get("hierarchyLevel"),
                "place_id": tc.get("placeId"),
                "semantic_type": tc.get("semanticType"),
                "lat": lat,
                "lng": lng,
                "probability": float(tc.get("probability", 0) or 0),
                "source_file": source_file,
            })
        elif "activity" in seg:
            act = seg["activity"]
            tc = act.get("topCandidate", {})
            s_lat, s_lng = parse_lat_lng(act.get("start", {}).get("latLng"))
            e_lat, e_lng = parse_lat_lng(act.get("end", {}).get("latLng"))
            activities.append({
                "start_time": start,
                "end_time": end,
                "activity_type": tc.get("type"),
                "distance_m": float(act.get("distanceMeters", 0) or 0),
                "start_lat": s_lat,
                "start_lng": s_lng,
                "end_lat": e_lat,
                "end_lng": e_lng,
                "probability": float(tc.get("probability", 0) or 0),
                "source_file": source_file,
            })
        # timelinePath（生GPS）は今回スコープ外
    return visits, activities


def finalize_frame(df, dedup_keys):
    """時刻整形・滞在時間算出・重複排除（高probability採用）を行う。"""
    if df.empty:
        return df
    df["start_time"] = pd.to_datetime(df["start_time"], utc=True).dt.tz_convert(TZ)
    df["end_time"] = pd.to_datetime(df["end_time"], utc=True).dt.tz_convert(TZ)
    df["duration_min"] = (
        (df["end_time"] - df["start_time"]).dt.total_seconds() / 60
    ).round().astype("Int64")
    df["date"] = df["start_time"].dt.date.astype(str)
    # 同一キーは probability が高い行を採用
    df = (
        df.sort_values("probability", ascending=False)
        .drop_duplicates(subset=dedup_keys)
        .sort_values("start_time")
        .reset_index(drop=True)
    )
    # tz 付き timestamp は Athena 互換のため tz を落として JST naive に
    df["start_time"] = df["start_time"].dt.tz_localize(None)
    df["end_time"] = df["end_time"].dt.tz_localize(None)
    return df


# ---------------------------------------------------------------------------
# Places API による place_id 解決（キャッシュ付き）
# ---------------------------------------------------------------------------
def extract_admin_areas(address_components):
    """addressComponents から都道府県・市区町村を取り出す。

    日本の住所では:
      administrative_area_level_1 → 都道府県 (例: 愛知県)
      locality                    → 市/町/村 (例: 名古屋市, 稲沢市) や東京23区
      sublocality_level_1         → 政令市の区 (例: 千種区)
    市区町村は locality + sublocality_level_1 を連結する (例: 名古屋市千種区)。
    """
    by_type = {}
    for comp in address_components or []:
        text = comp.get("longText") or comp.get("shortText")
        for t in comp.get("types", []):
            by_type.setdefault(t, text)
    prefecture = by_type.get("administrative_area_level_1")
    locality = by_type.get("locality")
    ward = by_type.get("sublocality_level_1")
    municipality = "".join(part for part in (locality, ward) if part) or None
    return prefecture, municipality


def fetch_place_details(place_id, api_key):
    """Places API (New) で 1 件の場所詳細を取得。失敗時 None。"""
    try:
        resp = requests.get(
            PLACES_API_URL.format(place_id=place_id),
            headers={"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": PLACES_FIELD_MASK},
            # 都道府県/市区町村を日本語の構造化データで得る
            params={"languageCode": "ja", "regionCode": "JP"},
            timeout=10,
        )
        if resp.status_code != 200:
            # ログ肥大を防ぐため1行に圧縮（古いデータは無効 placeId の 404 が一定数出る）
            msg = " ".join(resp.text.split())[:120]
            print(f"Places API {resp.status_code} for {place_id}: {msg}")
            return None
        d = resp.json()
        loc = d.get("location", {})
        prefecture, municipality = extract_admin_areas(d.get("addressComponents"))
        return {
            "place_id": place_id,
            "place_name": (d.get("displayName") or {}).get("text"),
            "place_address": d.get("formattedAddress"),
            "place_types": ",".join(d.get("types", []) or []),
            "place_category": (d.get("primaryTypeDisplayName") or {}).get("text"),
            "prefecture": prefecture,
            "municipality": municipality,
            "google_maps_uri": d.get("googleMapsUri"),
            "lat": loc.get("latitude"),
            "lng": loc.get("longitude"),
            "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None),
        }
    except requests.RequestException as e:
        print(f"Places API error for {place_id}: {e}")
        return None


# 解決に失敗した place_id も「負キャッシュ」として記録し、毎回の再試行を防ぐ
CHECKPOINT_EVERY = 100


def resolve_place_ids(place_ids, api_key):
    """既存キャッシュを読み、未解決 place_id のみ API 解決して追記・保存。

    大量解決中にタイムアウトしても進捗を失わないよう、CHECKPOINT_EVERY 件ごとに
    place_cache を保存する。非200で解決できなかった place_id も resolved_at 付きの
    負キャッシュ行として残し、次回以降の無限再試行・二重課金を防ぐ。
    """
    cache = read_parquet_from_s3(PLACE_CACHE_KEY)
    if cache is None:
        cache = pd.DataFrame(columns=PLACE_CACHE_COLUMNS)

    # 旧スキーマ(prefecture 列なし)の移行: 解決済みの場所だけ再取得して
    # 都道府県/市区町村を補完する。404 等の負キャッシュ(place_name が空)は
    # 再試行しても無駄なのでそのまま skip する。
    needs_migration = "prefecture" not in cache.columns
    for col in PLACE_CACHE_COLUMNS:
        if col not in cache.columns:
            cache[col] = None

    if needs_migration:
        known = set(cache.loc[cache["place_name"].isna(), "place_id"].dropna())
        print("place_cache を v2 スキーマへ移行: 解決済みの場所を再取得します")
    else:
        known = set(cache["place_id"].dropna().tolist())
    targets = [p for p in place_ids if p and p not in known]
    print(f"place_id total={len(place_ids)} cached_skip={len(known)} to_resolve={len(targets)}")

    if not api_key:
        print("GOOGLE_MAPS_API_KEY 未設定のため place_id 解決をスキップ")
        return cache

    new_rows = []

    def flush():
        nonlocal cache, new_rows
        if not new_rows:
            return
        cache = pd.concat([cache, pd.DataFrame(new_rows)], ignore_index=True)
        cache = cache.drop_duplicates(subset=["place_id"], keep="last")
        write_parquet_to_s3(cache, PLACE_CACHE_KEY)
        new_rows = []

    for i, pid in enumerate(targets, 1):
        row = fetch_place_details(pid, api_key)
        if row is None:
            # 解決失敗も負キャッシュ（name/address は None）として記録
            row = {
                "place_id": pid, "place_name": None, "place_address": None,
                "place_types": None, "place_category": None,
                "prefecture": None, "municipality": None, "google_maps_uri": None,
                "lat": None, "lng": None,
                "resolved_at": datetime.now(timezone.utc).replace(tzinfo=None),
            }
        new_rows.append(row)
        if i % CHECKPOINT_EVERY == 0:
            print(f"  resolved {i}/{len(targets)} (checkpoint)")
            flush()
        time.sleep(0.05)  # レート抑制

    flush()
    return cache


def attach_place_names(visits, cache):
    """visits に place_cache の名前・住所・都道府県・市区町村を join。"""
    if visits.empty:
        return visits
    cols = ["place_id", "place_name", "place_address", "place_category",
            "prefecture", "municipality", "google_maps_uri"]
    lookup = cache[cols].drop_duplicates("place_id")
    return visits.merge(lookup, on="place_id", how="left")


# ---------------------------------------------------------------------------
# ハンドラ
# ---------------------------------------------------------------------------
def handler(event, context):
    keys = list_timeline_json_keys()
    print(f"timeline json files: {keys}")
    if not keys:
        return {"statusCode": 404,
                "body": json.dumps({"message": f"{INPUT_PREFIX} に JSON がありません"})}

    all_visits, all_activities = [], []
    for key in keys:
        data = load_json_from_s3(key)
        v, a = parse_segments(data.get("semanticSegments", []), os.path.basename(key))
        all_visits.extend(v)
        all_activities.extend(a)

    visits = finalize_frame(pd.DataFrame(all_visits),
                            dedup_keys=["start_time", "end_time", "hierarchy_level"])
    activities = finalize_frame(pd.DataFrame(all_activities),
                                dedup_keys=["start_time", "end_time", "activity_type"])
    print(f"visits={len(visits)} activities={len(activities)}")

    # place_id 解決
    api_key = get_places_api_key()
    place_ids = visits["place_id"].dropna().unique().tolist() if not visits.empty else []
    cache = resolve_place_ids(place_ids, api_key)
    visits = attach_place_names(visits, cache)

    # 出力（source_file は内部用なので最終列から除外）
    visits_out = visits.drop(columns=["source_file"], errors="ignore")
    activities_out = activities.drop(columns=["source_file"], errors="ignore")
    write_parquet_to_s3(visits_out, VISITS_KEY)
    write_parquet_to_s3(activities_out, ACTIVITIES_KEY)

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": "タイムラインの変換が完了しました",
            "visits": len(visits_out),
            "activities": len(activities_out),
            "place_ids_in_cache": len(cache),
            "source_files": keys,
        }),
    }
