# Portal registration API and state

Deploy one DynamoDB table per portal environment in Repo Runner's AWS account. Customers share the table within that environment. Attempts are scoped to a tenant and user in the [registration adapter](../../onboarding/registration-attempts.mjs). The table stores temporary onboarding metadata. GitHub App keys and webhook secrets belong in the customer's AWS Parameter Store.

Set the portal account, region, and table name explicitly. Initialize the S3 backend with a private, encrypted, versioned state bucket and a unique state key in Repo Runner's account. Use an approved portal deployment profile and review the Terraform plan before applying. This stack is independent of the customer runner stack.

The stack also defines a Node.js Lambda and two API Gateway HTTP routes. Both require a JWT from the approved issuer and audience with the configured scope. The runtime additionally restricts the sandbox to the approved subject. CORS allows the configured portal origin. There is no public Lambda URL or API Gateway access log configuration. Keep callback URLs and request bodies out of any upstream logs.

Build a Lambda ZIP from the reviewed checkout with `bash infra/portal-state/package-lambda.sh /absolute/private/path/portal.zip`, then supply that path as `lambda_zip`. Set `portal_origin` to the browser origin and provide the approved identity and installation as `sandbox`. The token issuer and scope must match the authorizer, and the GitHub redirect must target the portal's callback relay page. Provision the OIDC provider and browser relay separately before trying a live handoff.

The Lambda role has `dynamodb:PutItem` and `dynamodb:UpdateItem` on the attempt table, constrained log writes, and permission to assume only the configured customer role. Use the `portal_runtime_role_arn` output in the customer role's trust policy with the installation's external ID. The adapter enforces attempt expiry during the claim because DynamoDB TTL deletion is asynchronous.

For local checks, run `terraform fmt -check`, `terraform init -backend=false -lockfile=readonly`, `terraform validate`, and `terraform test` in this directory. The Terraform test uses a mocked AWS provider. Run `npm test` from the repository root after installing the locked dependencies.

The customer-hosted registration handler is packaged as `onboarding/customer-registration-lambda.handler`. It is intended for a separate stack in the runner pool's AWS account. Use the same two HTTPS routes and JWT protections, with an explicit approved issuer, audience, access-token scope, tenant and subject. Configure `PORTAL_ORIGIN`, `CUSTOMER_AWS_ACCOUNT_ID`, `REGISTRATION_ATTEMPT_TABLE`, and `CUSTOMER_REGISTRATION_CONFIGURATION` with the approved identity, App settings, and runner prefix. The App settings include the HTTPS portal return and the deployed runner webhook. Never log request bodies or query strings.

The customer handler uses its own execution identity. Scope it to the customer registration table and the three installation parameter writes. Use DynamoDB TTL on `expiresAt` and restrict invocation permissions to the approved API Gateway routes. The deployment wiring and live browser rehearsal are pending.
