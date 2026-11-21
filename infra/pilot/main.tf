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

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.sandbox_account_id]
}

module "pilot" {
  source  = "github-aws-runners/github-runner/aws"
  version = "8.1.1"

  prefix     = var.prefix
  aws_region = var.aws_region
  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  github_app                  = var.github_app_parameters
  repository_white_list       = [var.pilot_repository]
  runner_extra_labels         = ["repo-runner-pilot"]
  enable_organization_runners = false

  runner_os                               = "linux"
  runner_architecture                     = "arm64"
  instance_types                          = ["m7g.large"]
  instance_target_capacity_type           = "on-demand"
  runners_maximum_count                   = 1
  enable_ephemeral_runners                = true
  enable_jit_config                       = true
  enable_job_queued_check                 = true
  enable_runner_bidirectional_label_match = true
  enable_dynamic_labels                   = false
  enable_ssm_on_runners                   = false
  associate_public_ipv4_address           = true
  enable_managed_runner_security_group    = true
  pool_config                             = []
  idle_config                             = []
  logging_retention_in_days               = 7

  webhook_lambda_zip                = "${path.module}/artifacts/webhook.zip"
  runners_lambda_zip                = "${path.module}/artifacts/runners.zip"
  runner_binaries_syncer_lambda_zip = "${path.module}/artifacts/runner-binaries-syncer.zip"
}

output "webhook_endpoint" {
  description = "URL to configure on the dedicated pilot GitHub App."
  value       = module.pilot.webhook.endpoint
}
