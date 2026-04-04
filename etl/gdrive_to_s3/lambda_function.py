import os
import json
from io import BytesIO

import boto3
import botocore.exceptions
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SECRET_NAME = "prod/dashboard/gdrive"
S3_BUCKET = "fitbit-dashboard"
S3_PREFIX = "data/gdrive/"

s3_client = boto3.client("s3")

# Google Drive export MIME type mapping
# スプレッドシート等のGoogle形式ファイルを変換してダウンロード
EXPORT_MIME_TYPES = {
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.document": "text/plain",
}


def get_gdrive_secrets():
    """Secrets ManagerからGoogle Drive用のサービスアカウント認証情報を取得"""
    region_name = os.environ.get("AWS_REGION", "ap-northeast-1")
    client = boto3.client("secretsmanager", region_name=region_name)
    response = client.get_secret_value(SecretId=SECRET_NAME)
    return json.loads(response["SecretString"])


def build_drive_service():
    """Google Drive APIクライアントを構築"""
    secrets = get_gdrive_secrets()
    # サービスアカウントのJSON鍵が格納されている想定
    sa_info = secrets["SERVICE_ACCOUNT_KEY"]
    if isinstance(sa_info, str):
        sa_info = json.loads(sa_info)

    credentials = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=credentials)


def download_file(service, file_id, mime_type):
    """Google Driveからファイルをダウンロードしバイトストリームを返す"""
    buffer = BytesIO()

    if mime_type in EXPORT_MIME_TYPES:
        # Google形式のファイル（スプレッドシート等）はエクスポート
        export_mime = EXPORT_MIME_TYPES[mime_type]
        request = service.files().export_media(
            fileId=file_id, mimeType=export_mime
        )
    else:
        # 通常のファイル（CSV, Excel等）はそのままダウンロード
        request = service.files().get_media(fileId=file_id)

    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    buffer.seek(0)
    return buffer


def determine_s3_key(file_name, mime_type):
    """ファイル名とMIMEタイプからS3キーを決定"""
    if mime_type in EXPORT_MIME_TYPES:
        # Google Spreadsheet → CSV として保存
        base_name = os.path.splitext(file_name)[0]
        return f"{S3_PREFIX}{base_name}.csv"
    return f"{S3_PREFIX}{file_name}"


def upload_to_s3(buffer, s3_key):
    """バイトストリームをS3にアップロード"""
    s3_client.upload_fileobj(buffer, S3_BUCKET, s3_key)
    print(f"Uploaded to s3://{S3_BUCKET}/{s3_key}")


def handler(event, context):
    """
    Lambda関数のエントリポイント。
    EventBridgeから週次で呼び出される。

    環境変数 GDRIVE_FILE_IDS に転送対象のファイルIDをカンマ区切りで指定。
    例: "1abc123,2def456,3ghi789"
    """
    file_ids_str = os.environ.get("GDRIVE_FILE_IDS", "")
    if not file_ids_str:
        return {
            "statusCode": 400,
            "body": json.dumps({"message": "GDRIVE_FILE_IDS が設定されていません"}),
        }

    file_ids = [fid.strip() for fid in file_ids_str.split(",") if fid.strip()]
    service = build_drive_service()

    results = []
    for file_id in file_ids:
        # ファイルのメタデータを取得
        file_meta = service.files().get(
            fileId=file_id, fields="id,name,mimeType"
        ).execute()

        file_name = file_meta["name"]
        mime_type = file_meta["mimeType"]
        print(f"Processing: {file_name} (type: {mime_type})")

        # ダウンロード
        buffer = download_file(service, file_id, mime_type)

        # S3にアップロード
        s3_key = determine_s3_key(file_name, mime_type)
        upload_to_s3(buffer, s3_key)

        results.append({"file": file_name, "s3_key": s3_key})

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "message": "Google DriveからS3への転送が完了しました",
                "files": results,
            }
        ),
    }
