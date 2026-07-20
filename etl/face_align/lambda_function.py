import json
import os
import re
from datetime import datetime, timezone
from io import BytesIO
from urllib.parse import unquote_plus

import boto3
import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision
from PIL import Image, ImageOps

S3_BUCKET = "fitbit-dashboard"
INPUT_PREFIX = os.environ.get("PHOTOS_INPUT_PREFIX", "data/photos/")
OUTPUT_PREFIX = os.environ.get("PHOTOS_OUTPUT_PREFIX", "data/photos_aligned/")

# フロントエンド用インデックス。表示パスは marts/*.json だけを読む設計
# (docs/redesign/02-data-layer.md) のため、一覧もマートとして出力する。
# 型は frontend/src/lib/mart-types.ts の FacePhotosMart と手動同期
INDEX_KEY = os.environ.get("PHOTOS_INDEX_KEY", "marts/face_photos.json")
FILE_NAME_PATTERN = re.compile(r"^(\d{4})(\d{2})(\d{2})_\d+\.jpe?g$", re.IGNORECASE)

# BlazeFace (short-range) モデル。リポジトリに同梱し Docker イメージへコピーする
MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "blaze_face_short_range.tflite"
)

# 出力キャンバスと目の目標位置。
# 全写真で両目をこの座標に固定することで、連続再生時に顔の位置・傾き・
# 大きさが揃い、変化だけが見えるタイムラプスになる。
# 本人の右目は(鏡像でない写真では)画像の左側に写る。
OUTPUT_SIZE = 512
RIGHT_EYE_TARGET = (0.35 * OUTPUT_SIZE, 0.40 * OUTPUT_SIZE)
LEFT_EYE_TARGET = (0.65 * OUTPUT_SIZE, 0.40 * OUTPUT_SIZE)
JPEG_QUALITY = 80

s3_client = boto3.client("s3")


_detector = None


def get_detector():
    """FaceDetector を warm start 間で使い回す"""
    global _detector
    if _detector is None:
        _detector = vision.FaceDetector.create_from_options(
            vision.FaceDetectorOptions(
                base_options=BaseOptions(model_asset_path=MODEL_PATH),
                min_detection_confidence=0.5,
            )
        )
    return _detector


def detect_eyes(image_rgb):
    """顔検出して両目の座標 (右目xy, 左目xy) を返す。検出できなければ None。

    複数顔が写っている場合はバウンディングボックスが最大のものを採用する。
    keypoints は BlazeFace の定義順で 0=右目, 1=左目。
    """
    h, w = image_rgb.shape[:2]
    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(image_rgb)
    )
    result = get_detector().detect(mp_image)
    if not result.detections:
        return None

    detection = max(
        result.detections,
        key=lambda d: d.bounding_box.width * d.bounding_box.height,
    )
    right, left = detection.keypoints[0], detection.keypoints[1]
    return (right.x * w, right.y * h), (left.x * w, left.y * h)


def align_face(image_rgb, right_eye, left_eye):
    """両目が目標座標に来るよう相似変換(回転+拡縮+平行移動)して切り出す"""
    dx = left_eye[0] - right_eye[0]
    dy = left_eye[1] - right_eye[1]
    angle = np.degrees(np.arctan2(dy, dx))

    src_dist = np.hypot(dx, dy)
    dst_dist = LEFT_EYE_TARGET[0] - RIGHT_EYE_TARGET[0]
    scale = dst_dist / src_dist

    eyes_center = ((right_eye[0] + left_eye[0]) / 2, (right_eye[1] + left_eye[1]) / 2)
    dst_center = (
        (RIGHT_EYE_TARGET[0] + LEFT_EYE_TARGET[0]) / 2,
        (RIGHT_EYE_TARGET[1] + LEFT_EYE_TARGET[1]) / 2,
    )

    matrix = cv2.getRotationMatrix2D(eyes_center, angle, scale)
    matrix[0, 2] += dst_center[0] - eyes_center[0]
    matrix[1, 2] += dst_center[1] - eyes_center[1]

    return cv2.warpAffine(
        image_rgb,
        matrix,
        (OUTPUT_SIZE, OUTPUT_SIZE),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def center_crop(image_rgb):
    """顔が検出できなかったときのフォールバック: 中央スクエアクロップ"""
    h, w = image_rgb.shape[:2]
    side = min(h, w)
    top = (h - side) // 2
    left = (w - side) // 2
    cropped = image_rgb[top : top + side, left : left + side]
    return cv2.resize(cropped, (OUTPUT_SIZE, OUTPUT_SIZE), interpolation=cv2.INTER_AREA)


def load_image_rgb(body_bytes):
    """JPEG バイト列を EXIF Orientation 適用済みの RGB ndarray にする。

    スマホ写真は回転を EXIF で持つことが多く、無視すると顔検出に失敗する。
    """
    pil_image = Image.open(BytesIO(body_bytes))
    pil_image = ImageOps.exif_transpose(pil_image).convert("RGB")
    return np.asarray(pil_image)


def process_photo(input_key):
    """1枚処理して出力キーと整列成否を返す"""
    file_name = input_key[len(INPUT_PREFIX):]
    output_key = f"{OUTPUT_PREFIX}{file_name}"

    obj = s3_client.get_object(Bucket=S3_BUCKET, Key=input_key)
    image_rgb = load_image_rgb(obj["Body"].read())

    eyes = detect_eyes(image_rgb)
    if eyes is not None:
        aligned = align_face(image_rgb, *eyes)
    else:
        aligned = center_crop(image_rgb)

    ok, encoded = cv2.imencode(
        ".jpg",
        cv2.cvtColor(aligned, cv2.COLOR_RGB2BGR),
        [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY],
    )
    if not ok:
        raise RuntimeError(f"JPEG encode failed: {input_key}")

    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=output_key,
        Body=encoded.tobytes(),
        ContentType="image/jpeg",
        Metadata={"aligned": "true" if eyes is not None else "false"},
    )
    print(f"{'aligned' if eyes is not None else 'fallback'}: {input_key} -> {output_key}")
    return output_key, eyes is not None


def list_keys(prefix):
    """プレフィックス配下の全キーを返す"""
    keys = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []))
    return keys


def is_photo(key):
    return key.lower().endswith((".jpg", ".jpeg"))


def collect_backfill_keys():
    """未処理 (出力側に存在しない) の入力キーを列挙する。冪等な再実行が可能"""
    existing_names = {
        key[len(OUTPUT_PREFIX):] for key in list_keys(OUTPUT_PREFIX)
    }
    return [
        key
        for key in list_keys(INPUT_PREFIX)
        if is_photo(key) and key[len(INPUT_PREFIX):] not in existing_names
    ]


def write_index():
    """出力プレフィックスの全ファイルから marts/face_photos.json を再生成する"""
    photos = []
    for key in sorted(list_keys(OUTPUT_PREFIX)):
        name = key[len(OUTPUT_PREFIX):]
        match = FILE_NAME_PATTERN.match(name)
        if not match:
            continue
        photos.append(
            {
                "file": name,
                "date": f"{match.group(1)}-{match.group(2)}-{match.group(3)}",
            }
        )

    body = json.dumps(
        {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "photos": photos,
        },
        ensure_ascii=False,
    )
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=INDEX_KEY,
        Body=body.encode("utf-8"),
        ContentType="application/json",
    )
    print(f"index written: {INDEX_KEY} ({len(photos)} photos)")
    return len(photos)


def handler(event, context):
    """
    Lambda エントリポイント。2 つの起動モードを持つ。

    1. S3 PutObject イベント (通常運用): イベント中の写真のみ処理。
       gdrive_to_s3 が新しい写真を転送するたびに自動で走る。
    2. {"mode": "backfill"} 手動 invoke (初回・パラメータ変更時):
       data/photos/ 全件のうち出力が無いものだけ処理する。
    """
    if event.get("mode") == "backfill":
        keys = collect_backfill_keys()
        print(f"backfill: {len(keys)} photos to process")
    else:
        keys = [
            unquote_plus(record["s3"]["object"]["key"])
            for record in event.get("Records", [])
        ]
        keys = [key for key in keys if is_photo(key)]

    results = []
    fallback_count = 0
    for key in keys:
        output_key, aligned = process_photo(key)
        results.append(output_key)
        if not aligned:
            fallback_count += 1

    # 0件処理でもインデックスは再生成する (フォーマット変更時の再構築を兼ねる)
    index_count = write_index()

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "processed": len(results),
                "fallback": fallback_count,
                "index_count": index_count,
            }
        ),
    }
