#######################################
# Google Maps タイムライン JSON → Parquet 変換 Lambda
#   data/gdrive/timeline/*.json を展開・重複排除・placeId 解決し
#   data/timeline/{visits,activities,place_cache}/ に Parquet 出力する。
#   gdrive 同期で JSON が S3 に置かれたタイミング(S3 PutObject)で起動。
#######################################

locals {
  data_bucket = "fitbit-dashboard"
}

# ECR リポジトリ
resource "aws_ecr_repository" "timeline_lambda_repo" {
  name = "timeline-to-parquet-lambda"
}

#######################################
# IAM ロール
#######################################
data "aws_iam_policy_document" "timeline_lambda_trust_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "timeline_lambda_execution_role" {
  name               = "timeline-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.timeline_lambda_trust_policy.json
}

data "aws_iam_policy_document" "timeline_lambda_policy" {
  # CloudWatch Logs
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # Secrets Manager (Places API キーは gdrive シークレットに同居)
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.aws_secretsmanager_secret.gdrive_secret.arn]
  }

  # S3 (入力 JSON の読込 + Parquet 出力)
  statement {
    effect  = "Allow"
    actions = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
    resources = [
      "arn:aws:s3:::${local.data_bucket}",
      "arn:aws:s3:::${local.data_bucket}/*",
    ]
  }
}

resource "aws_iam_policy" "timeline_lambda_policy" {
  name        = "timeline-lambda-policy"
  path        = "/"
  description = "Policy for Google Maps timeline to Parquet Lambda"
  policy      = data.aws_iam_policy_document.timeline_lambda_policy.json
}

resource "aws_iam_role_policy_attachment" "timeline_lambda_attach_policy" {
  role       = aws_iam_role.timeline_lambda_execution_role.name
  policy_arn = aws_iam_policy.timeline_lambda_policy.arn
}

#######################################
# Lambda 関数
#######################################
resource "aws_lambda_function" "timeline_to_parquet" {
  function_name = "timeline-to-parquet-lambda"
  role          = aws_iam_role.timeline_lambda_execution_role.arn
  package_type  = "Image"

  image_uri = "${aws_ecr_repository.timeline_lambda_repo.repository_url}:latest"

  # Mac(Apple Silicon)でネイティブビルドするため arm64(Graviton)。
  # イメージも --platform linux/arm64 でビルドすること。
  architectures = ["arm64"]

  environment {
    variables = {
      TIMELINE_INPUT_PREFIX  = "data/gdrive/timeline/"
      TIMELINE_OUTPUT_PREFIX = "data/timeline/"
    }
  }

  # 全期間の semanticSegments をメモリ展開し、初回は大量の placeId 解決を行うため
  # メモリ・タイムアウトに余裕を持たせる
  memory_size = 2048
  timeout     = 900

  # 複数JSONの同時アップロードや非同期リトライによる並行起動を防ぐ。
  # place_cache / visits / activities の read-modify-write 競合と二重課金を回避する。
  reserved_concurrent_executions = 1
}

#######################################
# S3 PutObject トリガー
#   注意: aws_s3_bucket_notification はバケットの通知設定を「上書き」する。
#   fitbit-dashboard に他の通知が無いことを確認済み。将来追加する場合は
#   このリソースに統合すること。
#######################################
resource "aws_lambda_permission" "allow_s3_invoke_timeline" {
  statement_id  = "AllowS3InvokeTimelineLambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.timeline_to_parquet.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = "arn:aws:s3:::${local.data_bucket}"
}

resource "aws_s3_bucket_notification" "timeline_json_uploaded" {
  bucket = local.data_bucket

  lambda_function {
    lambda_function_arn = aws_lambda_function.timeline_to_parquet.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "data/gdrive/timeline/"
    filter_suffix       = ".json"
  }

  depends_on = [aws_lambda_permission.allow_s3_invoke_timeline]
}
