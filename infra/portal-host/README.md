# Sandbox portal hosting and sign-in

This stack serves the sandbox browser page through CloudFront from a private S3 bucket and creates an invite-only Cognito user pool. It uses the default CloudFront HTTPS domain and a Cognito managed login domain. It does not create a user or grant access to customer AWS accounts.

Use the approved Repo Runner portal AWS account and its encrypted, versioned Terraform backend. Give this stack a separate state key from the portal API and both runner pilots. Choose a unique `prefix` and review the plan before applying.

1. Deploy this stack with `api_origin` unset. Use the `portal_sign_in` output to get the portal origin, callback URL, Cognito issuer, audience, scope, and pool ID. An authorized operator invites the sandbox user in Cognito and obtains the user's `sub` for the API configuration.
2. Configure the [protected portal API](../portal-state/README.md) with those values, the approved user subject, and the customer installation record. The manifest redirect URL must match `callback_url`. Review the API plan, deploy it when approved, and configure the customer role trust using the portal runtime role ARN and installation external ID.
3. Set `api_origin` to the API stack's `portal_api_url` and review the host plan. This publishes the browser configuration and adds the API origin to the response CSP. After applying, confirm unsigned API requests are rejected and an authorized sandbox user can sign in. Verify the GitHub return page does not retain the callback query in browser history.

CloudFront does not forward callback query strings to S3, and this stack does not configure request logging. Keep queries out of any additional proxy logs. CloudFront, Cognito, and S3 usage may incur charges. Teardown and user changes require separate approval.

Run `terraform fmt -check`, `terraform init -backend=false -lockfile=readonly`, `terraform validate`, and `terraform test` from this directory for local verification.
