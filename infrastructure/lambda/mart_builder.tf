#######################################
# マートビルダー Lambda (docs/redesign/02-data-layer.md)
#   data/** の生データを DuckDB で集計し marts/*.json を出力する。
#   フロント表示用の唯一の集計層。ETL 後の時刻ずらしで日次/週次に起動する
#   (厳密なチェーン実行はしない。失敗しても翌日の実行で回復する)。
#######################################

# ECR リポジトリ
resource "aws_ecr_repository" "mart_builder_repo" {
  name = "mart-builder-lambda"
}

#######################################
# IAM ロール (最小権限: data/** 読み取り + marts/** 書き込みのみ)
#######################################
data "aws_iam_policy_document" "mart_builder_trust_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "mart_builder_execution_role" {
  name               = "mart-builder-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.mart_builder_trust_policy.json
}

data "aws_iam_policy_document" "mart_builder_policy" {
  # CloudWatch Logs
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # 生データの一覧・読み取り (data/ プレフィックスのみ)
  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.data_bucket}"]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["data/*"]
    }
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${local.data_bucket}/data/*"]
  }

  # マートの書き込みは marts/ プレフィックスのみ
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.data_bucket}/marts/*"]
  }
}

resource "aws_iam_policy" "mart_builder_policy" {
  name        = "mart-builder-lambda-policy"
  path        = "/"
  description = "Policy for mart builder Lambda (read data/, write marts/)"
  policy      = data.aws_iam_policy_document.mart_builder_policy.json
}

resource "aws_iam_role_policy_attachment" "mart_builder_attach_policy" {
  role       = aws_iam_role.mart_builder_execution_role.name
  policy_arn = aws_iam_policy.mart_builder_policy.arn
}

#######################################
# Lambda 関数
#######################################
resource "aws_lambda_function" "mart_builder" {
  function_name = "mart-builder-lambda"
  role          = aws_iam_role.mart_builder_execution_role.arn
  package_type  = "Image"

  image_uri = "${aws_ecr_repository.mart_builder_repo.repository_url}:latest"

  # Mac(Apple Silicon)でネイティブビルドするため arm64(Graviton)。
  # イメージも --platform linux/arm64 でビルドすること。
  architectures = ["arm64"]

  environment {
    variables = {
      DATA_BUCKET = local.data_bucket
      MART_PREFIX = "marts/"
    }
  }

  memory_size = 512
  timeout     = 120

  # 日次/週次スケジュールの重なりや非同期リトライでの並行実行を防ぐ
  # (marts/ への書き込み競合を避ける)
  reserved_concurrent_executions = 1
}

#######################################
# EventBridge トリガー (ETL 後の時刻ずらし)
#######################################

# 日次: fitbit ETL (3:00 JST) の後、3:45 JST
resource "aws_cloudwatch_event_rule" "mart_builder_daily" {
  name                = "mart-builder-daily-jst-0345"
  description         = "Build marts daily after fitbit ETL"
  schedule_expression = "cron(45 18 * * ? *)"
}

resource "aws_cloudwatch_event_target" "mart_builder_daily_target" {
  rule = aws_cloudwatch_event_rule.mart_builder_daily.name
  arn  = aws_lambda_function.mart_builder.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke_mart_builder_daily" {
  statement_id  = "AllowEventBridgeInvokeMartBuilderDaily"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mart_builder.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.mart_builder_daily.arn
}

# 週次: gdrive ETL (月曜 4:00 JST) の後、月曜 4:30 JST
resource "aws_cloudwatch_event_rule" "mart_builder_weekly" {
  name                = "mart-builder-weekly-mon-jst-0430"
  description         = "Build marts after weekly gdrive ETL"
  schedule_expression = "cron(30 19 ? * SUN *)"
}

resource "aws_cloudwatch_event_target" "mart_builder_weekly_target" {
  rule = aws_cloudwatch_event_rule.mart_builder_weekly.name
  arn  = aws_lambda_function.mart_builder.arn
}

resource "aws_lambda_permission" "allow_eventbridge_invoke_mart_builder_weekly" {
  statement_id  = "AllowEventBridgeInvokeMartBuilderWeekly"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mart_builder.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.mart_builder_weekly.arn
}
