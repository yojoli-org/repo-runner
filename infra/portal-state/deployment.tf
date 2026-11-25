variable "deployment_status" {
  description = "Exact customer CloudFormation stack and source version used to verify deployment and discover its webhook."
  type        = object({ stack = string, sourceVersion = string })
  default     = null

  validation {
    condition = var.deployment_status == null ? true : (
      can(regex("^rr-[a-z0-9-]{1,80}$", var.deployment_status.stack)) &&
      length(var.deployment_status.sourceVersion) <= 1024 &&
      can(regex("^[A-Za-z0-9._/+=-]+$", var.deployment_status.sourceVersion))
    )
    error_message = "Provide the customer deployment stack and its exact S3 source version."
  }
}

locals {
  deployment_routes = var.deployment_status == null ? {} : {
    "GET /api/onboarding/deployment/status" = "GET/api/onboarding/deployment/status"
  }
  deployment_access = var.deployment_status == null ? [] : [
    { Effect = "Allow", Action = "cloudformation:DescribeStacks",
    Resource = "arn:aws:cloudformation:${var.portal_aws_region}:${var.portal_aws_account_id}:stack/${var.deployment_status.stack}/*" },
    { Effect = "Allow", Action = "codebuild:BatchGetBuilds",
    Resource = "arn:aws:codebuild:${var.portal_aws_region}:${var.portal_aws_account_id}:project/${var.deployment_status.stack}" },
    { Effect = "Allow", Action = "logs:GetLogEvents",
    Resource = "arn:aws:logs:${var.portal_aws_region}:${var.portal_aws_account_id}:log-group:/repo-runner/bootstrap/${var.deployment_status.stack}:log-stream:proof/*" },
  ]
}
