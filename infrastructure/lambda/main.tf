#######################################
# 1. プロバイダ設定
#######################################
provider "aws" {
  region = "ap-northeast-1"
}

#######################################
# ECR リポジトリ
#######################################
resource "aws_ecr_repository" "lambda_repo" {
  name = "fitbit-lambda"
}

# (任意) ECR のライフサイクルポリシーやイミュータブルタグ設定など追加可

#######################################
# IAM ロール (Lambda 実行ロールとStreamlitの実行ユーザー)
#######################################
data "aws_iam_policy_document" "lambda_trust_policy" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_execution_role" {
  name               = "my-lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust_policy.json
}

data "aws_secretsmanager_secret" "fitbit_secret" {
  name = "prod/dashboard/fitbit"
}

# Secrets Manager への getSecretValue が必要
data "aws_iam_policy_document" "lambda_policy" {
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    effect    = "Allow"
    actions   = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:UpdateSecret"
        ]
    resources = [
      data.aws_secretsmanager_secret.fitbit_secret.arn
    ]
  }

  # S3 へのアクセスが必要ならさらに書く
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["arn:aws:s3:::fitbit-dashboard/*"]
  }
}

resource "aws_iam_policy" "lambda_logging_secrets_policy" {
  name        = "lambda-logging-secrets-policy"
  path        = "/"
  description = "Policy for Lambda logging and secrets manager"
  policy      = data.aws_iam_policy_document.lambda_policy.json
}

resource "aws_iam_role_policy_attachment" "lambda_attach_policy" {
  role       = aws_iam_role.lambda_execution_role.name
  policy_arn = aws_iam_policy.lambda_logging_secrets_policy.arn
}

# Streamlit 用の IAM ユーザーを作成
data "aws_iam_policy_document" "streamlit_athena_policy" {
  statement {
    effect    = "Allow"
    actions   = [
      "athena:StartQueryExecution",
      "athena:GetQueryResults",
      "athena:GetQueryExecution",
      "athena:StopQueryExecution",
      "athena:GetWorkGroup"
    ]
    resources = ["*"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::fitbit-dashboard"]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["arn:aws:s3:::fitbit-dashboard/*"]
  }

  # Glue の アクションを許可するステートメントを追加
  statement {
    effect    = "Allow"
    actions   = ["glue:*"]
    resources = ["*"]
  }

  # バケットの作成とロケーション取得を許可（リソースは CreateBucket の場合 "*" 固定）
  statement {
    effect  = "Allow"
    actions = [
      "s3:CreateBucket",
      "s3:GetBucketLocation"
    ]
    resources = ["*"]
  }
}

# Streamlit 用の IAM ユーザーを作成
resource "aws_iam_user" "streamlit_athena_user" {
  name = "streamlit-athena-user"
}

# 作成した IAM ユーザーにポリシーをアタッチ
resource "aws_iam_user_policy" "streamlit_athena_policy_attachment" {
  name   = "StreamlitAthenaPolicy"
  user   = aws_iam_user.streamlit_athena_user.name
  policy = data.aws_iam_policy_document.streamlit_athena_policy.json
}

#######################################
# 5. Lambda 関数 (Docker イメージ)
#######################################
resource "aws_lambda_function" "get_fitbit_api" {
  function_name  = "fitbit-lambda-docker"
  role           = aws_iam_role.lambda_execution_role.arn
  package_type   = "Image"
  
  # ECR にプッシュしたイメージを指定
  image_uri      = "${aws_ecr_repository.lambda_repo.repository_url}:latest"
  
  # 環境変数の例 (Secrets Manager のシークレット名などを渡す)
  environment {
    variables = {
      FITBIT_SECRET_NAME = "prod/dashboard/fitbit"
    }
  }

  # Lambda のメモリやタイムアウトなど
  memory_size = 512
  timeout     = 900
}


# ---------------------------------------------------------------------
# EventBridge Rule: 毎日 18:00 UTC (= JST 03:00) に起動
# ---------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "scheduled_rule_jst_3am" {
  name                = "fitbit-lambda-schedule-jst-3am"
  description         = "Triggers Lambda at 3 AM JST daily"
  schedule_expression = "cron(0 18 * * ? *)"
  # ↑ cron(minutes hours day-of-month month day-of-week year)
  #    18:00 UTC = JST 03:00
}

# ---------------------------------------------------------------------
# EventBridge Target: 上記 Rule が発火したときに呼び出す Lambda
# ---------------------------------------------------------------------
resource "aws_cloudwatch_event_target" "scheduled_rule_jst_3am_target" {
  rule      = aws_cloudwatch_event_rule.scheduled_rule_jst_3am.name
  arn       = aws_lambda_function.get_fitbit_api.arn
  # 任意で入力 (引数) を設定したい場合は input or input_path / input_transformer を指定
  # input = jsonencode({ example = "Hello" })
}

# ---------------------------------------------------------------------
# Lambda 側の Invoke 権限 (EventBridge から呼び出しを許可する)
# ---------------------------------------------------------------------
resource "aws_lambda_permission" "allow_eventbridge_invoke" {
  statement_id  = "AllowEventBridgeToInvokeLambda"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_fitbit_api.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduled_rule_jst_3am.arn
}