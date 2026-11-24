mock_provider "aws" {}

variables {
  portal_aws_account_id = "111111111111"
  portal_aws_region     = "us-east-2"
  portal_origin         = "https://portal.example.test"
  table_name            = "example-portal-attempts"
  lambda_zip            = "main.tf" # Inert fixture for the mocked file hash.
  sandbox = {
    issuer   = "https://id.example.test"
    audience = "portal"
    scope    = "registration/start"
    tenantId = "example"
    subject  = "example-user"
    installation = {
      config = {
        organization = "example-org"
        appName      = "Example Repo Runner"
        homepage     = "https://portal.example.test"
        redirectUrl  = "https://portal.example.test/github/return"
      }
      destination = {
        accountId  = "222222222222"
        region     = "us-east-2"
        path       = "/repo-runner/example"
        roleArn    = "arn:aws:iam::222222222222:role/example"
        externalId = "synthetic-external-id"
      }
    }
  }
}

run "protect_both_registration_routes" {
  command = plan

  assert {
    condition = length(aws_apigatewayv2_route.portal) == 2 && alltrue([
      for route in aws_apigatewayv2_route.portal : route.authorization_type == "JWT"
      && contains(route.authorization_scopes, "registration/start")
    ])
    error_message = "Both routes must require a JWT and the intended OAuth scope."
  }
}
