import os
import json
from io import BytesIO

import boto3
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SECRET_NAME = "prod/dashboard/gdrive"
S3_BUCKET = "fitbit-dashboard"
S3_DEFAULT_PREFIX = "data/gdrive/"

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
    sa_info = secrets["SERVICE_ACCOUNT_KEY"]
    if isinstance(sa_info, str):
        sa_info = json.loads(sa_info)

    credentials = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=credentials)


def list_files_in_folder(service, folder_id):
    """フォルダ内のファイル一覧を取得し、同名ファイルは最新のもののみ返す"""
    query = f"'{folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
    files = []
    page_token = None

    while True:
        response = service.files().list(
            q=query,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime)",
            pageSize=1000,
            pageToken=page_token,
        ).execute()

        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    # 同名ファイルは modifiedTime が最新のもののみ残す
    latest_by_name = {}
    for f in files:
        name = f["name"]
        if name not in latest_by_name or f["modifiedTime"] > latest_by_name[name]["modifiedTime"]:
            latest_by_name[name] = f

    return list(latest_by_name.values())


def download_file(service, file_id, mime_type):
    """Google Driveからファイルをダウンロードしバイトストリームを返す"""
    buffer = BytesIO()

    if mime_type in EXPORT_MIME_TYPES:
        export_mime = EXPORT_MIME_TYPES[mime_type]
        request = service.files().export_media(
            fileId=file_id, mimeType=export_mime
        )
    else:
        request = service.files().get_media(fileId=file_id)

    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    buffer.seek(0)
    return buffer


def determine_s3_key(file_name, mime_type, s3_prefix):
    """ファイル名とMIMEタイプからS3キーを決定"""
    if mime_type in EXPORT_MIME_TYPES:
        base_name = os.path.splitext(file_name)[0]
        return f"{s3_prefix}{base_name}.csv"
    return f"{s3_prefix}{file_name}"


def upload_to_s3(buffer, s3_key):
    """バイトストリームをS3にアップロード"""
    s3_client.upload_fileobj(buffer, S3_BUCKET, s3_key)
    print(f"Uploaded to s3://{S3_BUCKET}/{s3_key}")


def handler(event, context):
    """
    Lambda関数のエントリポイント。
    EventBridgeから週次で呼び出される。

    環境変数 GDRIVE_FOLDER_IDS にフォルダIDとS3プレフィックスを指定。
    フォーマット: "folder_id:s3_prefix,folder_id:s3_prefix,..."
    s3_prefix省略時はデフォルトの data/gdrive/ を使用。
    フォルダ内の同名ファイルは更新日が最新のもののみ転送する。
    """
    folder_ids_str = os.environ.get("GDRIVE_FOLDER_IDS", "")
    if not folder_ids_str:
        return {
            "statusCode": 400,
            "body": json.dumps({"message": "GDRIVE_FOLDER_IDS が設定されていません"}),
        }

    folder_entries = [entry.strip() for entry in folder_ids_str.split(",") if entry.strip()]
    service = build_drive_service()

    results = []
    for entry in folder_entries:
        if ":" in entry:
            folder_id, s3_prefix = entry.split(":", 1)
        else:
            folder_id, s3_prefix = entry, S3_DEFAULT_PREFIX

        # フォルダ内のファイル一覧を取得（同名は最新のみ）
        files = list_files_in_folder(service, folder_id)
        print(f"Folder {folder_id}: {len(files)} files to sync")

        for file_meta in files:
            file_name = file_meta["name"]
            mime_type = file_meta["mimeType"]
            file_id = file_meta["id"]
            print(f"Processing: {file_name} (type: {mime_type}, modified: {file_meta['modifiedTime']})")

            buffer = download_file(service, file_id, mime_type)

            s3_key = determine_s3_key(file_name, mime_type, s3_prefix)
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
