provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "ap-northeast-1"
}

variable "project_name" {
  default = "sekisyo"
}

variable "data_bucket_arn" {
  description = "Sekisyoデータが格納されているS3バケットのARN"
  default     = "arn:aws:s3:::fitbit-dashboard" 
}

# Athena クエリ結果保存用バケット
resource "aws_s3_bucket" "athena_results" {
  bucket = "${var.project_name}-athena-results"
}

# Athena ワークグループ
resource "aws_athena_workgroup" "main" {
  name = "${var.project_name}-workgroup"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.bucket}/"
    }
  }
}

# アプリ専用 IAM ユーザー
resource "aws_iam_user" "app_user" {
  name = "${var.project_name}-app-user"
}

resource "aws_iam_access_key" "app_user_key" {
  user = aws_iam_user.app_user.name
}

# アプリ用 IAM ポリシー
resource "aws_iam_user_policy" "app_policy" {
  name = "${var.project_name}-policy"
  user = aws_iam_user.app_user.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution"
        ]
        Effect   = "Allow"
        Resource = [aws_athena_workgroup.main.arn]
      },
      {
        Action = [
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:ListMultipartUploadParts",
          "s3:AbortMultipartUpload",
          "s3:PutObject"
        ]
        Effect   = "Allow"
        Resource = [
          aws_s3_bucket.athena_results.arn,
          "${aws_s3_bucket.athena_results.arn}/*"
        ]
      },
      {
        Action = [
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Effect   = "Allow"
        Resource = [
          var.data_bucket_arn,
          "${var.data_bucket_arn}/*"
        ]
      },
      {
        Action = [
          "glue:GetTable",
          "glue:GetDatabase",
          "glue:GetPartitions"
        ]
        Effect   = "Allow"
        Resource = ["*"]
      }
    ]
  })
}

# Glue データベース
resource "aws_glue_catalog_database" "main" {
  name = var.project_name
}

# 家計簿テーブル (Google Drive CSV)
resource "aws_glue_catalog_table" "household_budget" {
  database_name = aws_glue_catalog_database.main.name
  name          = "household_budget"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"  = "csv"
    "skip.header.line.count" = "1"
  }

  storage_descriptor {
    location      = "s3://fitbit-dashboard/data/household_budget/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.serde2.OpenCSVSerde"
      parameters = {
        "separatorChar" = ","
      }
    }

    columns {
      name = "calculation_target"
      type = "int"
    }
    columns {
      name = "date"
      type = "string"
    }
    columns {
      name = "description"
      type = "string"
    }
    columns {
      name = "amount"
      type = "int"
    }
    columns {
      name = "financial_institution"
      type = "string"
    }
    columns {
      name = "major_category"
      type = "string"
    }
    columns {
      name = "sub_category"
      type = "string"
    }
    columns {
      name = "memo"
      type = "string"
    }
    columns {
      name = "transfer"
      type = "int"
    }
    columns {
      name = "id"
      type = "string"
    }
  }
}

output "athena_workgroup_name" {
  value = aws_athena_workgroup.main.name
}

output "athena_output_s3_path" {
  value = "s3://${aws_s3_bucket.athena_results.bucket}/"
}

output "aws_access_key_id" {
  value = aws_iam_access_key.app_user_key.id
}

output "aws_secret_access_key" {
  value     = aws_iam_access_key.app_user_key.secret
  sensitive = true
}
