#######################################
# データ連携の手動トリガー用オーケストレータ Lambda
#   ダッシュボードの「今すぐ更新」から非同期 invoke され、
#   gdrive → (タイムライン変換待ち) → mart_builder を順に実行する。
#   fitbit は毎日の自動実行で十分なため対象外。
#   スケジュールは持たない(定期実行は各 Lambda の EventBridge が担う)。
#   依存が boto3 のみのため Docker ではなく zip デプロイ。
#######################################

data "archive_file" "sync_runner_zip" {
  type        = "zip"
  source_file = "${path.module}/../../etl/sync_runner/lambda_function.py"
  output_path = "${path.module}/build/sync_runner.zip"
}

#######################################
# IAM ロール
#######################################
data "aws_iam_policy_document" "sync_runner_trust_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sync_runner_execution_role" {
  name               = "sync-runner-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.sync_runner_trust_policy.json
}

data "aws_iam_policy_document" "sync_runner_policy" {
  # CloudWatch Logs
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # パイプラインを構成する Lambda の起動のみ許可
  statement {
    effect  = "Allow"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.gdrive_to_s3.arn,
      aws_lambda_function.mart_builder.arn,
    ]
  }

  # タイムライン変換の完了判定 (data/ 配下の一覧のみ)
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
}

resource "aws_iam_policy" "sync_runner_policy" {
  name        = "sync-runner-lambda-policy"
  path        = "/"
  description = "Policy for manual sync orchestrator Lambda"
  policy      = data.aws_iam_policy_document.sync_runner_policy.json
}

resource "aws_iam_role_policy_attachment" "sync_runner_attach_policy" {
  role       = aws_iam_role.sync_runner_execution_role.name
  policy_arn = aws_iam_policy.sync_runner_policy.arn
}

#######################################
# Lambda 関数
#######################################
resource "aws_lambda_function" "sync_runner" {
  function_name    = "sync-runner-lambda"
  role             = aws_iam_role.sync_runner_execution_role.arn
  runtime          = "python3.12"
  handler          = "lambda_function.handler"
  filename         = data.archive_file.sync_runner_zip.output_path
  source_code_hash = data.archive_file.sync_runner_zip.output_base64sha256

  environment {
    variables = {
      DATA_BUCKET = local.data_bucket
    }
  }

  # ETL の同期待ち + タイムライン変換待ちがあるため上限まで確保
  memory_size = 256
  timeout     = 900

  # ボタン連打や非同期リトライでのパイプライン多重実行を防ぐ
  reserved_concurrent_executions = 1
}
