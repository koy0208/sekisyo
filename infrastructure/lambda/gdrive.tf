#######################################
# Google Drive → S3 転送 Lambda
#######################################

# ECR リポジトリ
resource "aws_ecr_repository" "gdrive_lambda_repo" {
  name = "gdrive-to-s3-lambda"
}

# Secrets Manager (サービスアカウントキー格納用)
data "aws_secretsmanager_secret" "gdrive_secret" {
  name = "prod/dashboard/gdrive"
}

#######################################
# IAM ロール
#######################################
data "aws_iam_policy_document" "gdrive_lambda_trust_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "gdrive_lambda_execution_role" {
  name               = "gdrive-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.gdrive_lambda_trust_policy.json
}

data "aws_iam_policy_document" "gdrive_lambda_policy" {
  # CloudWatch Logs
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # Secrets Manager (Google Drive サービスアカウントキー)
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.aws_secretsmanager_secret.gdrive_secret.arn]
  }

  # S3 アップロード
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["arn:aws:s3:::fitbit-dashboard/*"]
  }
}

resource "aws_iam_policy" "gdrive_lambda_policy" {
  name        = "gdrive-lambda-policy"
  path        = "/"
  description = "Policy for Google Drive to S3 Lambda"
  policy      = data.aws_iam_policy_document.gdrive_lambda_policy.json
}

resource "aws_iam_role_policy_attachment" "gdrive_lambda_attach_policy" {
  role       = aws_iam_role.gdrive_lambda_execution_role.name
  policy_arn = aws_iam_policy.gdrive_lambda_policy.arn
}

#######################################
# Lambda 関数
#######################################
resource "aws_lambda_function" "gdrive_to_s3" {
  function_name = "gdrive-to-s3-lambda"
  role          = aws_iam_role.gdrive_lambda_execution_role.arn
  package_type  = "Image"

  image_uri = "${aws_ecr_repository.gdrive_lambda_repo.repository_url}:latest"

  environment {
    variables = {
      # フォーマット: "folder_id:s3_prefix,folder_id:s3_prefix,..."
      GDRIVE_FOLDER_IDS = "1tzfP5kWWsOBRwSMIt_OVYft9TmPnWOBw:data/household_budget/"
    }
  }

  memory_size = 512
  timeout     = 300
}

#######################################
# EventBridge: 週次スケジュール (毎週月曜 JST 04:00 = UTC 19:00 日曜)
#######################################
resource "aws_cloudwatch_event_rule" "gdrive_weekly_schedule" {
  name                = "gdrive-to-s3-weekly-schedule"
  description         = "Triggers Google Drive to S3 Lambda weekly (Mon 4AM JST)"
  schedule_expression = "cron(0 19 ? * SUN *)"
}

resource "aws_cloudwatch_event_target" "gdrive_weekly_target" {
  rule = aws_cloudwatch_event_rule.gdrive_weekly_schedule.name
  arn  = aws_lambda_function.gdrive_to_s3.arn
}

resource "aws_lambda_permission" "allow_eventbridge_gdrive" {
  statement_id  = "AllowEventBridgeToInvokeGDriveLambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.gdrive_to_s3.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.gdrive_weekly_schedule.arn
}
