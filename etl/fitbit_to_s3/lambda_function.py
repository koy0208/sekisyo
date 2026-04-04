import os
import base64
import json
from datetime import datetime, timedelta
import botocore.exceptions
from io import BytesIO

import requests
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import boto3
import pytz

# 定数設定
FITBIT_API_BASE = "https://api.fitbit.com"
HEART_RATE_THRESHOLD = 90  # bpm 以上を高強度とする
SECRET_NAME = "prod/dashboard/fitbit"

# 環境変数から各種パラメータを取得
s3_client = boto3.client("s3")


def update_fitbit_secrets(new_refresh_token):
    """
    Secrets Manager のシークレットに格納している FITBIT_REFRESH_TOKEN を新しい値で上書き
    """
    region_name = os.environ.get("AWS_REGION", "ap-northeast-1")
    client = boto3.client("secretsmanager", region_name=region_name)

    # 既存のシークレット全体を取得
    secrets_dict = get_fitbit_secrets()
    # リフレッシュトークンのみ更新
    secrets_dict["FITBIT_REFRESH_TOKEN"] = new_refresh_token

    # JSON に直して update_secret で上書き
    updated_secret = json.dumps(secrets_dict)

    client.update_secret(
        SecretId=SECRET_NAME,
        SecretString=updated_secret
    )

def refresh_fitbit_access_token():
    """
    Fitbit APIのOAuth2トークンをリフレッシュする。
    成功時には新しい access_token と refresh_token を返す。
    """
    # 最新のシークレットを取得
    secrets = get_fitbit_secrets()

    client_id = secrets["FITBIT_CLIENT_ID"]
    client_secret = secrets["FITBIT_CLIENT_SECRET"]
    refresh_token = secrets["FITBIT_REFRESH_TOKEN"]

    auth_str = f"{client_id}:{client_secret}"
    b64_auth_str = base64.b64encode(auth_str.encode()).decode()

    url = f"{FITBIT_API_BASE}/oauth2/token"
    headers = {
        "Authorization": f"Basic {b64_auth_str}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token
    }

    response = requests.post(url, headers=headers, data=data)
    if response.status_code == 200:
        tokens = response.json()
        new_access_token = tokens["access_token"]
        new_refresh_token = tokens["refresh_token"]
        
        # Secrets Manager へ新しい refresh_token を上書き保存
        update_fitbit_secrets(new_refresh_token)

        # 必要に応じて access_token も保存するならここで処理する
        # (例: DynamoDB や Secrets Manager に上書きなど)
        return new_access_token, new_refresh_token
    else:
        raise Exception(f"トークン更新失敗: {response.text}")


def get_fitbit_secrets():
    """
    AWS Secrets Manager から Fitbit 用のクライアントID, シークレットなどを取得する関数
    """
    # Lambda 実行環境のリージョンや、任意のリージョン名を指定
    region_name = os.environ.get("AWS_REGION", "ap-northeast-1")

    # Secrets Manager クライアントを作成
    client = boto3.client("secretsmanager", region_name=region_name)

    # 事前に Lambda 環境変数や設定でシークレット名を指定
    secret_name = SECRET_NAME

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
    except Exception as e:
        print(f"Failed to retrieve secret {secret_name}: {e}")
        raise e
    
    # シークレットの取り出し
    secret_string = get_secret_value_response["SecretString"]
    secret_dict = json.loads(secret_string)  # JSON 形式の場合

    return secret_dict
    

def fetch_fitbit_data(endpoint, access_token):
    """
    Fitbit APIの指定エンドポイントからデータを取得する
    """
    url = f"{FITBIT_API_BASE}{endpoint}"
    headers = {"Authorization": f"Bearer {access_token}"}
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"APIリクエスト失敗 ({endpoint}): {response.text}")


def process_sleep_data(sleep_data):
    """
    sleep APIのレスポンスをPandas DataFrameに変換する
    """
    sleep_records = sleep_data.get("sleep", {})
    sleep_records[0].get("minutesAsleep", 0)
    total_sleep_minutes = [record.get("minutesAsleep", 0) for record in sleep_records]
    total_sleep_hour = [sm / 60 for sm in total_sleep_minutes]
    date = [record.get("dateOfSleep") for record in sleep_records]
    start_time = [record.get("startTime") for record in sleep_records]
    end_time = [record.get("endTime") for record in sleep_records]
    df = pd.DataFrame(
        {
            "total_sleep_hour": total_sleep_hour,
            "start_time": start_time,
            "end_time": end_time,
            "date": date,
        }
    )
    return df


def process_steps_data(steps_data):
    """
    steps APIのレスポンスをDataFrameに変換する
    """
    steps_records = steps_data.get("activities-steps", {})
    steps_value = [record.get("value", 0) for record in steps_records]
    date = [record.get("dateTime") for record in steps_records]
    df = pd.DataFrame({"steps": steps_value, "date": date})
    return df

def process_activity_data(data):
    """
    activity APIのレスポンスをDataFrameに変換する
    """
    activity_records = data.get("activities-active-zone-minutes", {})
    active_zone_minutes = [records["value"]["activeZoneMinutes"] for records in activity_records]
    date = [records["dateTime"] for records in activity_records]
    df = pd.DataFrame(
        {
            "active_zone_minutes": active_zone_minutes,
            "date": date,
        }
    )
    return df

def process_low_intensity_data(heart_data):
    """
    5分ごとの心拍数データから、閾値（例: 150bpm）以上の時間を集計する。
    """
    intraday = heart_data.get("activities-heart-intraday", {})
    dataset = intraday.get("dataset", {})
    date = heart_data["activities-heart"][0].get("dateTime", "")
    df = pd.DataFrame(dataset)
    if not df.empty:
        # "value"カラムに心拍数が入っていると仮定
        df["low_intensity"] = df["value"] >= HEART_RATE_THRESHOLD
        # 高強度の分数を合計
        total_low_intensity_minutes = int(df["low_intensity"].sum())
        # 集計結果をDataFrameとして作成
        agg_df = pd.DataFrame(
            [
                {
                    "low_intensity_minutes": total_low_intensity_minutes,
                    "date": date
                }
            ]
        )
        return agg_df
    else:
        return pd.DataFrame(columns=["date", "low_intensity_minutes"])


def merge_and_upload_to_s3(new_df, bucket, key):
    """
    S3上に既存のファイルがあればダウンロードし、新しいデータとマージしてからアップロードする関数。
    """
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        existing_bytes = response['Body'].read()
        existing_df = pd.read_parquet(BytesIO(existing_bytes))
        # 既存データと新規データを連結し、重複（例えば日付やIDなど）を除去
        merged_df = pd.concat([existing_df, new_df]).drop_duplicates()
        print(f"{key} の既存データと新規データをマージしました。")
    except botocore.exceptions.ClientError as e:
        error_code = e.response['Error']['Code']
        # ファイルが存在しない場合は新規データをそのまま使用
        if error_code == 'NoSuchKey':
            merged_df = new_df
            print(f"{key} は存在しなかったため、新規データをアップロードします。")
        else:
            raise e

    buffer = df_to_parquet_bytes(merged_df)
    s3_client.upload_fileobj(buffer, bucket, key)

def df_to_parquet_bytes(df):
    """
    DataFrameをParquet形式のバイトストリームに変換
    """
    table = pa.Table.from_pandas(df)
    out_buffer = BytesIO()
    pq.write_table(table, out_buffer)
    out_buffer.seek(0)
    return out_buffer

def handler(event, context):
    """
    Lambda関数のエントリポイント
    Amazon EventBridgeのスケジュール（毎日UTC 00:00）で実行される前提。
    ここでは、対象日を「前日」としてデータ取得する例。
    """
    # Fitbit APIのアクセストークンを更新（必要に応じてキャッシュ等を利用してください）
    access_token, new_refresh_token = refresh_fitbit_access_token()
    # ※新しいrefresh tokenは必要に応じて永続化する

    # 対象日をJST前日とする
    target_date = (datetime.now(pytz.timezone('Asia/Tokyo')) - timedelta(days=1)).strftime("%Y-%m-%d")
    
    # 1. 睡眠データ取得
    sleep_endpoint = f"/1.2/user/-/sleep/date/{target_date}/{target_date}.json"
    sleep_data = fetch_fitbit_data(sleep_endpoint, access_token)
    sleep_df = process_sleep_data(sleep_data)
    sleep_key = f"data/sleep/sleep.parquet"
    merge_and_upload_to_s3(sleep_df, bucket="fitbit-dashboard", key=sleep_key)

    # 2. 歩数データ取得
    steps_endpoint = (
        f"/1/user/-/activities/steps/date/{target_date}/{target_date}.json"
    )
    steps_data = fetch_fitbit_data(steps_endpoint, access_token)
    steps_df = process_steps_data(steps_data)
    steps_key = f"data/steps/steps.parquet"
    merge_and_upload_to_s3(steps_df, bucket="fitbit-dashboard", key=steps_key)

    # アクティブな時間
    activity_endpoint = (
         f"/1/user/-/activities/active-zone-minutes/date/{target_date}/{target_date}.json"
    )
    activity_endpoint = f"/1/user/-/activities/active-zone-minutes/date/{target_date}/{target_date}.json"
    activity_data = fetch_fitbit_data(activity_endpoint, access_token)
    activity_df = process_activity_data(activity_data)
    activity_key = f"data/activity/activity.parquet"
    merge_and_upload_to_s3(
        activity_df, bucket="fitbit-dashboard", key=activity_key
    )

    # 3. 低強度運動データ（心拍）取得
    heart_endpoint = (
        f"/1/user/-/activities/heart/date/{target_date}/{target_date}/5min.json"
    )
    heart_data = fetch_fitbit_data(heart_endpoint, access_token)
    low_intensity_df = process_low_intensity_data(heart_data)
    heart_key = f"data/low_intensity/low_intensity.parquet"
    merge_and_upload_to_s3(low_intensity_df, bucket="fitbit-dashboard", key=heart_key)
    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": "Fitbitデータの取得・変換・S3アップロードが成功しました",
                "date": target_date,
            }
        ),
    }

# back-fill
# target_date = (datetime.now(pytz.timezone('Asia/Tokyo')) - timedelta(days=180)).strftime("%Y-%m-%d")
# start_date = (datetime.now(pytz.timezone('Asia/Tokyo')) - timedelta(days=270)).strftime("%Y-%m-%d")

# sleep_endpoint = f"/1.2/user/-/sleep/date/{start_date}/{target_date}.json"
# sleep_data = fetch_fitbit_data(sleep_endpoint, access_token)
# sleep_df = process_sleep_data(sleep_data)
# sleep_key = f"data/sleep/sleep.parquet"
# merge_and_upload_to_s3(sleep_df, bucket="fitbit-dashboard", key=sleep_key)

# steps_endpoint = f"/1/user/-/activities/steps/date/{start_date}/{target_date}.json"
# steps_data = fetch_fitbit_data(steps_endpoint, access_token)
# steps_df = process_steps_data(steps_data)
# steps_key = f"data/steps/steps.parquet"
# merge_and_upload_to_s3(steps_df, bucket="fitbit-dashboard", key=steps_key)

# activity_endpoint = f"/1/user/-/activities/active-zone-minutes/date/{start_date}/{target_date}.json"
# activity_data = fetch_fitbit_data(activity_endpoint, access_token)
# activity_df = process_activity_data(activity_data)
# activity_key = f"data/activity/activity.parquet"
# merge_and_upload_to_s3(
#     activity_df, bucket="fitbit-dashboard", key=activity_key
# )

# # 3. 低強度運動データ（心拍）取得
# tmp_df = []
# for i in range(138, 250):
#     target_date = (datetime.now(pytz.timezone('Asia/Tokyo')) - timedelta(days=i)).strftime("%Y-%m-%d")
#     print(f"{i} Processing day: {target_date}")
#     heart_endpoint = (
#         f"/1/user/-/activities/heart/date/{target_date}/{target_date}/5min.json"
#     )
#     heart_data = fetch_fitbit_data(heart_endpoint, access_token)
#     low_intensity_df = process_low_intensity_data(heart_data)
#     tmp_df.append(low_intensity_df)
# low_intensity_df = pd.concat(tmp_df)