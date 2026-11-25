variable "smoke_artifact_bucket" {
  description = "Private, versioned customer bucket for the reviewed smoke worker bundle. Leave null to disable portal smoke dispatch."
  type        = string
  default     = null

  validation {
    condition = var.smoke_artifact_bucket == null ? true : (
      can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.smoke_artifact_bucket)) &&
      try(var.sandbox.customer.app.allowSmokeDispatch, false)
    )
    error_message = "Use a private versioned bucket and explicitly enable smoke dispatch for the customer App."
  }
}

variable "smoke_repository" {
  description = "Exact private repository approved for the automated smoke job."
  type        = string
  default     = null

  validation {
    condition = var.smoke_artifact_bucket == null ? true : (
      can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$", var.smoke_repository)) &&
      try(split("/", var.smoke_repository)[0] == var.sandbox.customer.app.organization, false)
    )
    error_message = "Provide the approved private repository within the App organization."
  }
}

locals {
  smoke_enabled = var.smoke_artifact_bucket != null
  smoke_project = local.smoke_enabled ? nonsensitive("${var.sandbox.customer.prefix}-verify") : ""
  smoke_arn     = "arn:aws:codebuild:${var.portal_aws_region}:${var.portal_aws_account_id}:project/${local.smoke_project}"
  smoke_routes = local.smoke_enabled ? {
    "POST /api/onboarding/smoke/start" = "POST/api/onboarding/smoke/start"
    "GET /api/onboarding/smoke/status" = "GET/api/onboarding/smoke/status"
  } : {}
  smoke_access = local.smoke_enabled ? [
    { Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = aws_dynamodb_table.registration_attempts.arn },
    { Effect = "Allow", Action = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"], Resource = local.smoke_arn },
  ] : []
}

resource "aws_s3_object" "smoke_bundle" {
  count                  = local.smoke_enabled ? 1 : 0
  bucket                 = var.smoke_artifact_bucket
  key                    = "browser-bootstrap/smoke/${local.smoke_project}-${filesha256(var.lambda_zip)}.zip"
  source                 = var.lambda_zip
  source_hash            = filesha256(var.lambda_zip)
  server_side_encryption = "AES256"
}

resource "aws_cloudwatch_log_group" "smoke" {
  count             = local.smoke_enabled ? 1 : 0
  name              = "/repo-runner/smoke/${local.smoke_project}"
  retention_in_days = 7
}

resource "aws_iam_role" "smoke" {
  count = local.smoke_enabled ? 1 : 0
  name  = local.smoke_project
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Action = "sts:AssumeRole", Principal = { Service = "codebuild.amazonaws.com" },
    Condition = { StringEquals = { "aws:SourceAccount" = var.portal_aws_account_id, "aws:SourceArn" = local.smoke_arn } }
  }] })
}

resource "aws_iam_role_policy" "smoke" {
  count = local.smoke_enabled ? 1 : 0
  role  = aws_iam_role.smoke[0].name
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = "s3:GetBucketLocation", Resource = "arn:aws:s3:::${var.smoke_artifact_bucket}" },
    { Effect = "Allow", Action = "s3:GetObject", Resource = aws_s3_object.smoke_bundle[0].arn },
    { Effect = "Allow", Action = "s3:GetObjectVersion", Resource = aws_s3_object.smoke_bundle[0].arn,
    Condition = { StringEquals = { "s3:VersionId" = aws_s3_object.smoke_bundle[0].version_id } } },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.smoke[0].arn}:*" },
    { Effect = "Allow", Action = "ssm:GetParameters", Resource = [local.customer_parameter_arns[0], local.customer_parameter_arns[2]] },
    { Effect = "Allow", Action = "kms:Decrypt", Resource = "arn:aws:kms:${var.portal_aws_region}:${var.portal_aws_account_id}:key/*",
      Condition = { StringEquals = {
        "kms:ViaService"                      = "ssm.${var.portal_aws_region}.amazonaws.com"
        "kms:ResourceAliases"                 = "alias/aws/ssm"
        "kms:EncryptionContext:PARAMETER_ARN" = local.customer_parameter_arns[0]
    } } },
    { Effect = "Allow", Action = ["ec2:DescribeInstances", "ec2:DescribeVolumes", "lambda:ListEventSourceMappings"], Resource = "*",
    Condition = { StringEquals = { "aws:RequestedRegion" = var.portal_aws_region } } },
  ] })
}

resource "aws_codebuild_project" "smoke" {
  count                  = local.smoke_enabled ? 1 : 0
  name                   = local.smoke_project
  service_role           = aws_iam_role.smoke[0].arn
  source_version         = aws_s3_object.smoke_bundle[0].version_id
  build_timeout          = 25
  queued_timeout         = 5
  concurrent_build_limit = 1

  artifacts {
    type = "NO_ARTIFACTS"
  }

  source {
    type     = "S3"
    location = "${var.smoke_artifact_bucket}/${aws_s3_object.smoke_bundle[0].key}"
    buildspec = yamlencode({
      version = 0.2
      phases = {
        install = { "runtime-versions" = { nodejs = 22 } }
        build   = { commands = ["node onboarding/customer-smoke.mjs"] }
      }
    })
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = false

    dynamic "environment_variable" {
      for_each = {
        EXPECTED_ACCOUNT_ID = var.portal_aws_account_id
        PILOT_PREFIX        = var.sandbox.customer.prefix
        PILOT_REPOSITORY    = var.smoke_repository
      }
      content {
        name  = environment_variable.key
        value = environment_variable.value
      }
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.smoke[0].name
    }
  }

  lifecycle {
    precondition {
      condition     = try(length(aws_s3_object.smoke_bundle[0].version_id) > 0 && aws_s3_object.smoke_bundle[0].version_id != "null", false)
      error_message = "The smoke bundle must be pinned to a real S3 object version."
    }
  }

  depends_on = [aws_iam_role_policy.smoke]
}
