mock_provider "aws" {}

variables {
  portal_aws_account_id = "111111111111"
  portal_aws_region     = "us-east-2"
  prefix                = "example-repo-runner"
}

run "publish_config_after_api_is_known" {
  command = plan

  variables {
    api_origin = "https://api.example.test"
  }

  assert {
    condition     = length(aws_s3_object.config) == 1 && aws_s3_object.config[0].cache_control == "no-store"
    error_message = "Publish one browser configuration with caching disabled."
  }
}

run "private_host_and_invite_only_sign_in" {
  command = plan

  assert {
    condition = aws_s3_bucket_public_access_block.portal.block_public_policy && (
      aws_cloudfront_origin_access_control.portal.signing_behavior == "always"
      ) && alltrue([
        for config in aws_cognito_user_pool.portal.admin_create_user_config : config.allow_admin_create_user_only
    ])
    error_message = "The bucket must stay private and user creation must be invite-only."
  }

  assert {
    condition     = !aws_cognito_user_pool_client.portal.generate_secret && contains(aws_cognito_user_pool_client.portal.allowed_oauth_flows, "code") && length(aws_s3_object.config) == 0
    error_message = "Use a public authorization-code client and publish browser config only after setting the API origin."
  }
}

run "use_console_hostname_for_sign_in" {
  command = plan

  variables {
    custom_domain = {
      hostname        = "runner.example.test"
      certificate_arn = "arn:aws:acm:us-east-1:111111111111:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }
  }

  assert {
    condition = contains(aws_cloudfront_distribution.portal.aliases, "runner.example.test") && (
      output.portal_sign_in.origin == "https://runner.example.test" &&
      contains(aws_cognito_user_pool_client.portal.callback_urls, "https://runner.example.test/")
    )
    error_message = "Use the console hostname throughout CloudFront and Cognito."
  }
}

run "reject_other_account_certificate" {
  command = plan

  variables {
    custom_domain = {
      hostname        = "runner.example.test"
      certificate_arn = "arn:aws:acm:us-east-1:222222222222:certificate/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    }
  }

  expect_failures = [var.custom_domain]
}
