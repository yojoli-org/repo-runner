mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/fixture" }
  }
  mock_resource "aws_apigatewayv2_api" {
    defaults = { execution_arn = "arn:aws:execute-api:us-east-2:111111111111:fixture" }
  }
}

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

run "customer_endpoint_writes_only_local_installation_parameters" {
  command = apply

  variables {
    table_name = "example-customer-attempts"
    sandbox = {
      issuer   = "https://id.example.test"
      audience = "portal"
      scope    = "registration/start"
      tenantId = "example"
      subject  = "example-user"
      customer = {
        prefix = "example-customer"
        app = {
          organization = "example-org"
          appName      = "Example Repo Runner"
          homepage     = "https://portal.example.test"
          redirectUrl  = "https://portal.example.test/"
          webhookUrl   = "https://fixture.execute-api.us-east-2.amazonaws.com/webhook"
        }
      }
    }
  }

  assert {
    condition = aws_lambda_function.portal_api.handler == "onboarding/customer-registration-lambda.handler" && alltrue([
      for route in aws_apigatewayv2_route.portal : route.authorization_type == "JWT" &&
      contains(route.authorization_scopes, "registration/start")
    ])
    error_message = "The customer handler must be protected by the JWT authorizer on both routes."
  }

  assert {
    condition = !contains(flatten([
      for permission in jsondecode(nonsensitive(aws_iam_role_policy.portal_api.policy)).Statement : permission.Action
    ]), "sts:AssumeRole")
    error_message = "The customer role must not be able to assume another role."
  }

  assert {
    condition = one([
      for permission in jsondecode(nonsensitive(aws_iam_role_policy.portal_api.policy)).Statement : sort(permission.Resource)
      if permission.Action == "ssm:PutParameter"
      ]) == sort([
      for name in ["app-id", "app-key-base64", "webhook-secret"] :
      "arn:aws:ssm:us-east-2:111111111111:parameter/repo-runner/example-customer/${name}"
    ])
    error_message = "Parameter writes must target exactly the three local customer paths."
  }
}

run "smoke_routes_require_authorized_customer_configuration" {
  command = plan

  variables {
    table_name            = "example-smoke-attempts"
    smoke_artifact_bucket = "example-private-bucket"
    smoke_repository      = "example-org/example"
    sandbox = {
      issuer   = "https://id.example.test"
      audience = "portal"
      scope    = "registration/start"
      tenantId = "example"
      subject  = "example-user"
      customer = {
        prefix = "example-smoke"
        app = {
          organization       = "example-org"
          appName            = "Example Repo Runner"
          homepage           = "https://portal.example.test"
          redirectUrl        = "https://portal.example.test/"
          webhookUrl         = "https://fixture.execute-api.us-east-2.amazonaws.com/webhook"
          allowSmokeDispatch = true
        }
      }
    }
  }

  assert {
    condition = length(aws_apigatewayv2_route.portal) == 4 && alltrue([
      for route in aws_apigatewayv2_route.portal :
      route.authorization_type == "JWT" && contains(route.authorization_scopes, "registration/start")
    ])
    error_message = "Smoke routes must use the same JWT scope as GitHub registration."
  }

  assert {
    condition     = aws_codebuild_project.smoke[0].name == "example-smoke-verify"
    error_message = "Smoke verification must have its own project."
  }
}

run "deployment_status_uses_the_customer_jwt_scope" {
  command = plan

  variables {
    table_name = "example-customer-attempts"
    deployment_status = {
      stack         = "rr-example"
      sourceVersion = "fixture-version"
    }
    sandbox = {
      issuer   = "https://id.example.test"
      audience = "portal"
      scope    = "registration/start"
      tenantId = "example"
      subject  = "example-user"
      customer = {
        prefix = "example-customer"
        app = {
          organization = "example-org"
          appName      = "Example Repo Runner"
          homepage     = "https://portal.example.test"
          redirectUrl  = "https://portal.example.test/"
        }
      }
    }
  }

  assert {
    condition = length(aws_apigatewayv2_route.portal) == 3 && alltrue([
      for route in aws_apigatewayv2_route.portal :
      route.authorization_type == "JWT" && contains(route.authorization_scopes, "registration/start")
    ])
    error_message = "Deployment tracking must add one JWT-protected route without a static webhook."
  }
}
