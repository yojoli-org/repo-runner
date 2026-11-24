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

## Portal onboarding

Repo Runner is a Yojoli product. The public product page belongs on the main Yojoli site. Host the signed-in console on a dedicated Yojoli subdomain so its browser origin and tab storage are separate from the public site. Keep the portal backend in the operator AWS account and customer runner infrastructure in the customer's account. Yojoli routing, product-page deployment, DNS, and certificate validation are separate operator-approved changes.

Start with GitHub source control, GitHub Actions, and AWS runner hosting. The customer selects repositories and a starter pool, grants scoped access on the provider's own authorization pages, and chooses which setup steps to delegate. Where an API and the approved permissions allow it, Repo Runner makes the changes and verifies the result. For customer-owned steps, show the exact action and how to resume. Report missing privileges at the step that needs them.

Preview the target account, repositories, infrastructure, and capacity limits before applying. A backend worker will apply the exact approved plan and report progress, then run a smoke test and verify cleanup. Keep workflow edits a separately approved option. The CLI installer remains available for operators and self-hosters. Share deployment logic between the two once the terminal prompts have been separated from execution.

Keep source control, CI/CD, and runner hosting as separate integration roles. GitHub fills the first two today. Repository selection and optional workflow edits belong to source control. Job routing, runner registration, and smoke-test status belong to CI/CD. Provisioning, worker sizing, and teardown belong to the host integration. Keep GitHub and AWS details behind those boundaries. Add other providers when a supported customer use case warrants it and show only combinations we have verified. Portal outages should leave deployed runner pools able to process jobs.

### GitHub App handoff

Use [GitHub's App manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) to prefill a private, organization-owned App. The customer approves App creation and selects the permitted repository in GitHub. The manifest helper in `onboarding/` builds the form fields and validates the returned state. Run its synthetic tests with `node --test onboarding/github-app-manifest.test.mjs`.

The server-side exchange helper in `onboarding/` accepts an atomic attempt-claim operation and a scoped credential writer. The Parameter Store adapter writes the key and webhook secret as `SecureString` and writes the App ID last. It refuses overwrites. Run the mocked handoff tests with `node --test onboarding/*.test.mjs`.

The registration attempt adapter targets a DynamoDB table with a string `id` partition key and numeric `expiresAt` TTL. It stores a hash of the callback state and claims it only once, within ten minutes, for the same tenant and user. The attempt records the approved AWS destination. The callback obtains that destination from the claimed attempt.

Deploy a [shared attempt table per portal environment](../infra/portal-state/README.md) in Repo Runner's AWS account. Keep customer credentials and infrastructure in the customer account.

Before planning, use `verifyInstallationScope` in `onboarding/github-installation-scope.mjs` with the approved App ID and repository and a server-generated App JWT. It checks that GitHub granted access to exactly the selected private pilot repository. The verification token has metadata-only permissions and stays on the server. Wire this check into the installation handoff before exposing planning in the portal.

The framework-neutral portal handlers in `onboarding/portal-registration.mjs` connect authenticated start and callback requests to the attempt table and credential writer. Mount the start handler as a same-origin POST and the callback as a GET. Supply identity from the portal session and resolve approved installation settings on the server. The customer AWS client factory must assume the approved role and bind its SSM client to the recorded region. The handler checks the AWS caller account before writing credentials.

`createAwsPortalHandlers` in `onboarding/portal-aws.mjs` wires the AWS SDK clients. It verifies the portal AWS account, uses that account's DynamoDB table, and assumes the approved customer role with a per-installation external ID and a 15-minute session. The session grants writes to exactly three parameter names and limits encryption to the two secret parameters via SSM. The customer role must trust the portal runtime role only with the installation's external ID and allow the corresponding SSM and KMS actions. The credential writer uses standard parameters and the regional AWS-managed `alias/aws/ssm` key. Run `npm ci` and `npm test` for the synthetic onboarding checks.

Before enabling the flow, connect authenticated HTTP routes, provision the attempt table, and wire the AWS clients. Bind the AWS writer to the approved account, region, and parameter path. Redact callback URLs and conversion responses from logs. Verify the actual repository selection before planning. After the approved deployment, configure the webhook and verify delivery. Record step completion so a retry resumes the existing App and deployment. If code exchange succeeded but credential storage failed, stop and provide a credential recovery path because the code cannot be reused and Parameter Store writes may be partial. Until these steps pass in a fresh sandbox, use the guided operator setup.

### Sandbox HTTP runtime

`onboarding/portal-lambda.mjs` mounts the start and callback handlers for an API Gateway HTTP API using Lambda payload version 2.0. The sandbox accepts one configured issuer and subject and binds them to one approved installation. Configure a JWT authorizer with the approved issuer, audience, and scope on both routes. Limit Lambda invocation permissions to that gateway. Never use a public Lambda function URL or log callback query strings or event bodies.

The [portal API stack](../infra/portal-state/README.md) packages and configures the Lambda, JWT authorizer, and two routes. It supplies the portal origin, attempt table, and approved installation record server-side. The [sandbox browser page](../portal/README.md) signs in through Cognito with PKCE, removes sign-in and GitHub return parameters from browser history, and relays the GitHub callback to the protected API. Use the [sandbox hosting stack](../infra/portal-host/README.md) for HTTPS and invite-only sign-in, then validate the protected flow in the sandbox.
