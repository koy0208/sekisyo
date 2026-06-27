provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "ap-northeast-1"
}

variable "project_name" {
  default = "sekisyo"
}

variable "data_bucket_name" {
  description = "Sekisyo の生データ（Fitbit/位置情報/家計簿）が格納されている S3 バケット名"
  default     = "fitbit-dashboard"
}

# 生データバケット（既存・import で Terraform 管理下に取り込む）
resource "aws_s3_bucket" "data_bucket" {
  bucket = var.data_bucket_name
}

import {
  to = aws_s3_bucket.data_bucket
  id = var.data_bucket_name
}

# 公開を全面ブロック（最も機密度の高い生データのため最優先）
resource "aws_s3_bucket_public_access_block" "data_bucket" {
  bucket                  = aws_s3_bucket.data_bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# デフォルト暗号化（SSE-S3）
resource "aws_s3_bucket_server_side_encryption_configuration" "data_bucket" {
  bucket = aws_s3_bucket.data_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# 注意: 生データは唯一の正本のため、results バケットのような expiration
# ライフサイクル（自動削除）は意図的に付与しない。

# Athena クエリ結果保存用バケット
resource "aws_s3_bucket" "athena_results" {
  bucket = "${var.project_name}-athena-results"
}

# 公開を全面ブロック（機密データのクエリ結果が入るため必須）
resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket                  = aws_s3_bucket.athena_results.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# デフォルト暗号化（SSE-S3）
resource "aws_s3_bucket_server_side_encryption_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# クエリ結果（＝機密データのコピー）は 30 日で自動削除し、無期限の蓄積を防ぐ
resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    id     = "expire-query-results"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Athena ワークグループ
resource "aws_athena_workgroup" "main" {
  name = "${var.project_name}-workgroup"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.bucket}/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
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
        Effect = "Allow"
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
        Effect = "Allow"
        Resource = [
          aws_s3_bucket.data_bucket.arn,
          "${aws_s3_bucket.data_bucket.arn}/*"
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
    "classification"         = "csv"
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

# タイムライン: 滞在テーブル (Parquet, 単一ファイル上書き運用)
# 件数は10年分でも約1.4万行と小規模なためパーティションは設けない。
# 滞在時間の二重計上を避ける場合は WHERE hierarchy_level = 0 で絞る。
resource "aws_glue_catalog_table" "timeline_visits" {
  database_name = aws_glue_catalog_database.main.name
  name          = "visits"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    "classification" = "parquet"
  }

  storage_descriptor {
    location      = "s3://fitbit-dashboard/data/timeline/visits/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    columns {
      name = "start_time"
      type = "timestamp"
    }
    columns {
      name = "end_time"
      type = "timestamp"
    }
    columns {
      name = "hierarchy_level"
      type = "int"
    }
    columns {
      name = "place_id"
      type = "string"
    }
    columns {
      name = "semantic_type"
      type = "string"
    }
    columns {
      name = "lat"
      type = "double"
    }
    columns {
      name = "lng"
      type = "double"
    }
    columns {
      name = "probability"
      type = "double"
    }
    columns {
      name = "duration_min"
      type = "bigint"
    }
    columns {
      name = "date"
      type = "string"
    }
    columns {
      name = "place_name"
      type = "string"
    }
    columns {
      name = "place_address"
      type = "string"
    }
    columns {
      name = "place_category"
      type = "string"
    }
    columns {
      name = "prefecture"
      type = "string"
    }
    columns {
      name = "municipality"
      type = "string"
    }
    columns {
      name = "google_maps_uri"
      type = "string"
    }
  }
}

# タイムライン: 移動テーブル (Parquet, 単一ファイル上書き運用)
resource "aws_glue_catalog_table" "timeline_activities" {
  database_name = aws_glue_catalog_database.main.name
  name          = "activities"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    "classification" = "parquet"
  }

  storage_descriptor {
    location      = "s3://fitbit-dashboard/data/timeline/activities/"
    input_format  = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat"

    ser_de_info {
      serialization_library = "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe"
    }

    columns {
      name = "start_time"
      type = "timestamp"
    }
    columns {
      name = "end_time"
      type = "timestamp"
    }
    columns {
      name = "activity_type"
      type = "string"
    }
    columns {
      name = "distance_m"
      type = "double"
    }
    columns {
      name = "start_lat"
      type = "double"
    }
    columns {
      name = "start_lng"
      type = "double"
    }
    columns {
      name = "end_lat"
      type = "double"
    }
    columns {
      name = "end_lng"
      type = "double"
    }
    columns {
      name = "probability"
      type = "double"
    }
    columns {
      name = "duration_min"
      type = "bigint"
    }
    columns {
      name = "date"
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
