"""データ連携の手動トリガー用オーケストレータ。

ダッシュボードの「今すぐ更新」ボタンから非同期 invoke され、
gdrive → (タイムライン変換の完了待ち) → mart_builder を順に実行する。
fitbit は毎日の自動実行で十分なため手動トリガーの対象外
(週次同期でラグが出る gdrive 系だけを流す)。
スケジュール実行(時刻ずらし)の代替ではなく補完で、途中で失敗しても
続行し、次回のスケジュール実行で回復する方針はスケジュール側と同じ。

依存は boto3 のみ(Lambda ランタイム同梱)。Docker 不要の zip デプロイ。
"""

import json
import os
import time
from datetime import datetime, timezone

import boto3
from botocore.config import Config

BUCKET = os.environ.get("DATA_BUCKET", "fitbit-dashboard")
TIMELINE_JSON_PREFIX = "data/gdrive/timeline/"
TIMELINE_PARQUET_PREFIX = "data/timeline/visits/"
# タイムライン JSON → Parquet 変換(S3 トリガーの別 Lambda)の完了待ち上限。
# 超えたらマートはタイムラインだけ 1 世代古いまま生成し、次回実行で追いつく
TIMELINE_WAIT_MAX_SEC = 300

ETL_FUNCTIONS = ["gdrive-to-s3-lambda"]
MART_FUNCTION = "mart-builder-lambda"

# ETL は数分かかり得るため read timeout を Lambda 最大に合わせる。
# リトライは無効化する(タイムアウト時に ETL を二重起動しないため)
lambda_client = boto3.client(
    "lambda",
    config=Config(connect_timeout=10, read_timeout=910, retries={"max_attempts": 0}),
)
s3 = boto3.client("s3")


def invoke_sync(function_name):
    try:
        res = lambda_client.invoke(FunctionName=function_name, InvocationType="RequestResponse")
        if res.get("FunctionError"):
            payload = res["Payload"].read().decode("utf-8", errors="replace")[:300]
            return f"error: {payload}"
        return "ok"
    except Exception as e:  # 失敗しても後続は実行する
        return f"error: {e}"


def latest_mtime(prefix):
    newest = None
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            if newest is None or obj["LastModified"] > newest:
                newest = obj["LastModified"]
    return newest


def wait_for_timeline_conversion(started_at):
    """gdrive が新しいタイムライン JSON を置いた場合のみ、Parquet 変換の完了を待つ"""
    json_mtime = latest_mtime(TIMELINE_JSON_PREFIX)
    if json_mtime is None or json_mtime < started_at:
        return "skipped (no new timeline json)"
    deadline = time.time() + TIMELINE_WAIT_MAX_SEC
    while time.time() < deadline:
        parquet_mtime = latest_mtime(TIMELINE_PARQUET_PREFIX)
        if parquet_mtime is not None and parquet_mtime >= json_mtime:
            return "ok"
        time.sleep(15)
    return "timeout (marts will catch up on next scheduled run)"


def handler(event, context):
    started_at = datetime.now(timezone.utc)
    results = {}
    for name in ETL_FUNCTIONS:
        results[name] = invoke_sync(name)
    results["timeline-to-parquet-lambda"] = wait_for_timeline_conversion(started_at)
    results[MART_FUNCTION] = invoke_sync(MART_FUNCTION)

    print(f"sync finished: {json.dumps(results, ensure_ascii=False)}")
    return {"statusCode": 200, "body": json.dumps(results, ensure_ascii=False)}
