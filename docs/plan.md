# Repo Runner implementation plan

## Product

Customers authorize scoped GitHub and AWS access. We provision and verify a runner pool in their AWS account. They pay AWS for compute and can ask us to change capacity or add pools. The open-source installer exposes the upstream scaling configuration. The managed service owns onboarding, monitoring, upgrades and recovery.

## Milestones

1. **Isolated pilot.** Pin a released `github-aws-runners/github-runner/aws` module and use its webhook-based path. Test with a dedicated GitHub scope and sandbox AWS account or environment. Start with Linux ARM64, one On-Demand worker maximum, zero idle workers and an explicit budget. Validate infrastructure locally before requesting an apply. The manual smoke workflow is the first artifact. Run it only after the pilot pool is ready. Verify launch from zero, job completion and deletion of the instance and its job-specific resources separately in AWS.
2. **Yojoli acceptance.** Carry over the root-owned allowlist and pinned job-container requirements from Yojoli's runner placement contract. Test a representative heavy job and separately verify that a job requesting an unapproved image is rejected. Demonstrate cancellation, duplicate delivery, failed launch and eventual cleanup. Confirm the runner cannot access control-plane credentials. Measure queue latency and billed worker time. Request approval before switching workflow selectors or routing real jobs.
3. **Repeatable package.** Ship a versioned installer, example inputs, upgrade and uninstall instructions, and diagnostics. Prove a second organization can install a pinned release using the published guide. Keep the upstream MIT license documented and retain its notices with any distributed upstream code.
4. **Managed service.** Add stuck-job and runaway-worker alerts, bounded recovery and human escalation. Record approved capacity limits and quote changes before raising them. Start with assisted onboarding. Build portal automation once the second installation exposes which steps need it.

## Decisions before a live pilot

- Maintainer approves AWS sandbox, region, budget, and GitHub App and runner group scope.
- Choose a tagged upstream release after reviewing module inputs, supported providers, and bootstrap hooks. Confirm whether the Yojoli isolation layer fits those hooks.
- Define ownership of runner IAM, credentials, Terraform state, alerts, and teardown. Verify the architecture has a recovery path for missed webhook deliveries.

## Event boundaries

The CI system queues a job. The autoscaler provisions capacity for matching queued jobs. Yojoli's own eligibility rules decide when its workflows should create jobs. Keep that policy with Yojoli and treat removal of idle scheduled jobs as a separate acceptance check before cutover.
