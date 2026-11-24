variable "portal_origin" {
  description = "HTTPS browser origin, with no trailing slash or path."
  type        = string

  validation {
    condition     = can(regex("^https://[A-Za-z0-9.-]+(:[0-9]+)?$", var.portal_origin))
    error_message = "Provide an HTTPS origin without a path or trailing slash."
  }
}

variable "lambda_zip" {
  description = "Absolute local path to the reviewed portal Lambda package."
  type        = string
}

variable "sandbox" {
  description = "Server-approved OIDC identity and customer installation for this sandbox."
  sensitive   = true
  type = object({
    issuer   = string
    audience = string
    scope    = string
    subject  = string
    tenantId = string
    installation = object({
      config      = object({ organization = string, appName = string, homepage = string, redirectUrl = string })
      destination = object({ accountId = string, region = string, path = string, roleArn = string, externalId = string })
    })
  })

  validation {
    condition     = startswith(var.sandbox.issuer, "https://") && alltrue([for value in [var.sandbox.scope, var.sandbox.audience, var.sandbox.subject, var.sandbox.tenantId] : trimspace(value) != ""])
    error_message = "Provide an HTTPS issuer and an explicit audience, access-token scope, subject, and tenant."
  }
}

locals {
  portal_function_name = "${var.table_name}-api"
  portal_routes = {
    "POST /api/onboarding/github/start"   = "POST/api/onboarding/github/start"
    "GET /api/onboarding/github/callback" = "GET/api/onboarding/github/callback"
  }
}

resource "aws_cloudwatch_log_group" "portal_api" {
  name              = "/aws/lambda/${local.portal_function_name}"
  retention_in_days = 7
}

resource "aws_iam_role" "portal_api" {
  name = local.portal_function_name
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" }
  }] })
}

resource "aws_iam_role_policy" "portal_api" {
  role = aws_iam_role.portal_api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["dynamodb:PutItem", "dynamodb:UpdateItem"], Resource = aws_dynamodb_table.registration_attempts.arn },
    { Effect = "Allow", Action = "sts:AssumeRole", Resource = var.sandbox.installation.destination.roleArn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.portal_api.arn}:*" },
  ] })
}

resource "aws_lambda_function" "portal_api" {
  function_name    = local.portal_function_name
  role             = aws_iam_role.portal_api.arn
  handler          = "onboarding/portal-lambda.handler"
  runtime          = "nodejs22.x"
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  timeout          = 25
  memory_size      = 256

  environment {
    variables = {
      PORTAL_ORIGIN                = var.portal_origin
      PORTAL_AWS_ACCOUNT_ID        = var.portal_aws_account_id
      REGISTRATION_ATTEMPT_TABLE   = aws_dynamodb_table.registration_attempts.name
      PORTAL_SANDBOX_CONFIGURATION = jsonencode(var.sandbox)
    }
  }

  depends_on = [aws_iam_role_policy.portal_api]
}

resource "aws_apigatewayv2_api" "portal" {
  name          = local.portal_function_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.portal_origin]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
  }
}

resource "aws_apigatewayv2_authorizer" "portal" {
  api_id           = aws_apigatewayv2_api.portal.id
  authorizer_type  = "JWT"
  name             = "portal-sign-in"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = var.sandbox.issuer
    audience = [var.sandbox.audience]
  }
}

resource "aws_apigatewayv2_integration" "portal" {
  api_id                 = aws_apigatewayv2_api.portal.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.portal_api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "portal" {
  for_each = local.portal_routes

  api_id               = aws_apigatewayv2_api.portal.id
  route_key            = each.key
  target               = "integrations/${aws_apigatewayv2_integration.portal.id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.portal.id
  authorization_scopes = [var.sandbox.scope]
}

resource "aws_apigatewayv2_stage" "portal" {
  api_id      = aws_apigatewayv2_api.portal.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "gateway" {
  for_each = local.portal_routes

  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.portal_api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.portal.execution_arn}/${aws_apigatewayv2_stage.portal.name}/${each.value}"
}

output "portal_api_url" {
  description = "Base URL for the protected registration API."
  value       = aws_apigatewayv2_api.portal.api_endpoint
}

output "portal_runtime_role_arn" {
  description = "Role the approved customer-side trust policy must reference."
  value       = aws_iam_role.portal_api.arn
}
