terraform {
  required_version = ">= 1.10, < 2.0"

  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.33"
    }
  }
}

variable "portal_aws_account_id" {
  description = "Repo Runner's AWS account ID for this portal environment."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.portal_aws_account_id))
    error_message = "Provide the 12-digit Repo Runner AWS account ID."
  }
}

variable "portal_aws_region" {
  description = "AWS region approved for this portal environment."
  type        = string
}

variable "table_name" {
  description = "Registration attempt table name, unique to the portal environment."
  type        = string
}

provider "aws" {
  region              = var.portal_aws_region
  allowed_account_ids = [var.portal_aws_account_id]
}

resource "aws_dynamodb_table" "registration_attempts" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = { Project = "Repo Runner", Component = "portal-onboarding" }
}

output "registration_attempt_table_name" {
  description = "Table name for the portal registration adapter."
  value       = aws_dynamodb_table.registration_attempts.name
}

output "registration_attempt_table_arn" {
  description = "Resource ARN for scoping the portal runtime IAM policy."
  value       = aws_dynamodb_table.registration_attempts.arn
}
