# Repo Runner implementation plan

## Product

Customers authorize scoped GitHub and AWS access. We provision and verify a runner pool in their AWS account. They pay AWS for compute and can ask us to change capacity or add pools. The open-source installer exposes the upstream scaling configuration. The managed service owns onboarding, monitoring, upgrades and recovery.

The standard Linux pool supports shell jobs and Docker workflows on one disposable VM per job. Docker-capable jobs can control that VM. Scope runner access to approved repositories, separate pools by trust level, and keep control-plane and deployment access off the worker. Test the worker role and its network access before customer use. Image restrictions are a separate pool policy for customers who need them.

## Milestones

1. **Isolated pilot.** Pin a released `github-aws-runners/github-runner/aws` module and use its webhook-based path. Test with a dedicated GitHub scope and sandbox AWS account or environment. Start with Linux ARM64, one On-Demand worker maximum, zero idle workers and an explicit budget. Validate infrastructure locally before requesting an apply. The manual smoke workflow is the first artifact. Run it only after the pilot pool is ready. Verify launch from zero, job completion and deletion of the instance and its job-specific resources separately in AWS.
2. **First customer acceptance.** Validate the customer-specific runner profile and isolation requirements against a representative job. Demonstrate cancellation, duplicate delivery, failed launch and eventual cleanup. Confirm the runner cannot access control-plane credentials. Measure queue latency and billed worker time. Request approval before switching workflow selectors or routing real jobs. Keep installation-specific details in the corresponding [pilot brief](pilots/yojoli.md).
3. **Repeatable package.** Ship a versioned installer, example inputs, upgrade and uninstall instructions, and diagnostics. Prove a second organization can install a pinned release using the published guide. Keep the upstream MIT license documented and retain its notices with any distributed upstream code.
4. **Managed service.** Add stuck-job and runaway-worker alerts, bounded recovery and human escalation. Record approved capacity limits and quote changes before raising them. Start with assisted onboarding. Build portal automation once the second installation exposes which steps need it.

## Decisions before a live pilot

- Maintainer approves AWS sandbox, region, budget, and GitHub App and runner group scope.
- Choose a tagged upstream release after reviewing module inputs, supported providers, and bootstrap hooks. Confirm whether the pilot's isolation requirements fit those hooks.
- Define ownership of runner IAM, credentials, Terraform state, alerts, and teardown. Verify the architecture has a recovery path for missed webhook deliveries.

## Event boundaries

Customers define when their CI workflows should queue jobs. Repo Runner provisions capacity for matching queued jobs. Assess whether the customer's triggers queue unnecessary jobs as a separate check before cutover.
