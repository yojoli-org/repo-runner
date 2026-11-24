mock_provider "aws" {}

variables {
  portal_aws_account_id = "111111111111"
  portal_aws_region     = "us-east-2"
  prefix                = "example-repo-runner"
  portal_origin         = "https://repo-runner-stg.example.workers.dev"
}

run "use_workers_origin_for_invite_only_sign_in" {
  command = plan

  assert {
    condition = output.portal_sign_in.callback_url == "https://repo-runner-stg.example.workers.dev/" && contains(
      aws_cognito_user_pool_client.portal.callback_urls, output.portal_sign_in.callback_url
      ) && !aws_cognito_user_pool_client.portal.generate_secret && alltrue([
        for config in aws_cognito_user_pool.portal.admin_create_user_config : config.allow_admin_create_user_only
    ])
    error_message = "Use the Workers callback and an invite-only public client."
  }
}

run "reject_callback_path_as_origin" {
  command = plan

  variables {
    portal_origin = "https://repo-runner-stg.example.workers.dev/callback"
  }

  expect_failures = [var.portal_origin]
}
