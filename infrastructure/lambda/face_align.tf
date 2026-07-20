#######################################
# 顔写真整列 Lambda
#   data/photos/*.jpg を顔検出 → 両目基準で整列した 512×512 JPEG を
#   data/photos_aligned/ に出力する。フロントエンドの顔タイムラプス用。
#   gdrive 同期で写真が S3 に置かれたタイミング(S3 PutObject)で起動。
#   初回全件処理は {"mode": "backfill"} の手動 invoke で行う。
#######################################

# ECR リポジトリ
resource "aws_ecr_repository" "face_align_lambda_repo" {
  name = "face-align-lambda"
}

#######################################
# IAM ロール
#######################################
data "aws_iam_policy_document" "face_align_lambda_trust_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "face_align_lambda_execution_role" {
  name               = "face-align-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.face_align_lambda_trust_policy.json
}

data "aws_iam_policy_document" "face_align_lambda_policy" {
  # CloudWatch Logs
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # S3: 元写真の読込は入力プレフィックス、出力は整列済みプレフィックスのみ
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.data_bucket}/data/photos/*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.data_bucket}/data/photos_aligned/*"]
  }

  # backfill 時の未処理チェック用一覧取得
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.data_bucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["data/photos/*", "data/photos_aligned/*"]
    }
  }
}

resource "aws_iam_policy" "face_align_lambda_policy" {
  name        = "face-align-lambda-policy"
  path        = "/"
  description = "Policy for face photo alignment Lambda"
  policy      = data.aws_iam_policy_document.face_align_lambda_policy.json
}

resource "aws_iam_role_policy_attachment" "face_align_lambda_attach_policy" {
  role       = aws_iam_role.face_align_lambda_execution_role.name
  policy_arn = aws_iam_policy.face_align_lambda_policy.arn
}

#######################################
# Lambda 関数
#######################################
resource "aws_lambda_function" "face_align" {
  function_name = "face-align-lambda"
  role          = aws_iam_role.face_align_lambda_execution_role.arn
  package_type  = "Image"

  image_uri = "${aws_ecr_repository.face_align_lambda_repo.repository_url}:latest"

  # Mac(Apple Silicon)でネイティブビルドするため arm64(Graviton)。
  # イメージも --platform linux/arm64 でビルドすること。
  architectures = ["arm64"]

  environment {
    variables = {
      PHOTOS_INPUT_PREFIX  = "data/photos/"
      PHOTOS_OUTPUT_PREFIX = "data/photos_aligned/"
    }
  }

  # mediapipe の顔検出をメモリ上で行うため余裕を持たせる。
  # timeout は backfill (全件 ≒ 100枚超 × 数秒) を1回の invoke で終えられる値
  memory_size = 2048
  timeout     = 900
}

#######################################
# S3 PutObject トリガー
#   通知設定本体は timeline.tf の aws_s3_bucket_notification に統合
#   (バケットにつき1リソースのため)。ここでは invoke 権限のみ定義する。
#######################################
resource "aws_lambda_permission" "allow_s3_invoke_face_align" {
  statement_id  = "AllowS3InvokeFaceAlignLambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.face_align.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = "arn:aws:s3:::${local.data_bucket}"
}
