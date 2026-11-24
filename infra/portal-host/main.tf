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
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.portal_aws_account_id))
    error_message = "Provide the approved 12-digit portal AWS account ID."
  }
}

variable "portal_aws_region" {
  type = string
}

variable "prefix" {
  description = "Unique lowercase sandbox prefix, also used as the Cognito domain prefix."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.prefix))
    error_message = "Use 3–30 lowercase letters, digits, or hyphens, beginning with a letter and ending with a letter or digit."
  }
}

variable "api_origin" {
  description = "Portal API HTTPS origin. Leave unset until the protected API is deployed."
  type        = string
  default     = null
  validation {
    condition     = var.api_origin == null || can(regex("^https://[A-Za-z0-9.-]+$", var.api_origin))
    error_message = "Provide the HTTPS API origin without a path or trailing slash."
  }
}

provider "aws" {
  region              = var.portal_aws_region
  allowed_account_ids = [var.portal_aws_account_id]
}

locals {
  portal_origin  = "https://${aws_cloudfront_distribution.portal.domain_name}"
  cognito_origin = "https://${var.prefix}.auth.${var.portal_aws_region}.amazoncognito.com"
  api_scope      = "repo-runner/register"
}

resource "aws_cognito_user_pool" "portal" {
  name                = var.prefix
  username_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_domain" "portal" {
  domain       = var.prefix
  user_pool_id = aws_cognito_user_pool.portal.id
}

resource "aws_cognito_resource_server" "portal" {
  identifier   = "repo-runner"
  name         = "Repo Runner sandbox API"
  user_pool_id = aws_cognito_user_pool.portal.id
  scope {
    scope_name        = "register"
    scope_description = "Register the approved sandbox GitHub App"
  }
}

resource "aws_cognito_user_pool_client" "portal" {
  name                                 = "portal-browser"
  user_pool_id                         = aws_cognito_user_pool.portal.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", local.api_scope]
  callback_urls                        = ["${local.portal_origin}/"]
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 15
  token_validity_units {
    access_token = "minutes"
  }

  depends_on = [aws_cognito_resource_server.portal]
}

output "portal_sign_in" {
  description = "Values for the portal API authorizer and approved callback configuration."
  value = {
    origin       = local.portal_origin
    callback_url = "${local.portal_origin}/"
    issuer       = "https://cognito-idp.${var.portal_aws_region}.amazonaws.com/${aws_cognito_user_pool.portal.id}"
    audience     = aws_cognito_user_pool_client.portal.id
    scope        = local.api_scope
    user_pool_id = aws_cognito_user_pool.portal.id
  }
}
