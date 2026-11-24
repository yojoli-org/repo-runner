# Portal sign-in

This stack creates the invite-only Cognito user pool and public PKCE client for the Cloudflare-hosted console. User invitations and customer account access are separate operator steps.

Use the approved Repo Runner portal AWS account and its encrypted, versioned Terraform backend. Give this stack a separate state key from the portal API and both runner pilots. Choose a unique `prefix` and review the plan before applying.

Set `portal_origin` to `https://repo-runner-stg.dansward.workers.dev` for invite-only staging. Reserve `https://repo-runner.yojoli.com` for the customer console. Keep state keys, callback URLs, Cognito clients, and attempt tables separate between environments.

1. Deploy the reviewed identity plan. Use the `portal_sign_in` output to get the portal origin, callback URL, login origin, Cognito issuer, audience, scope, and pool ID. An authorized operator invites the sandbox user in Cognito and obtains the user's `sub` for the API configuration.
2. Configure the [protected portal API](../portal-state/README.md) with those values, the approved user subject, and the customer installation record. The manifest redirect URL must match `callback_url`. Review the API plan, deploy it when approved, and configure the customer role trust using the portal runtime role ARN and installation external ID.
3. Configure and deploy the [browser portal](../../portal/README.md) to Cloudflare after approval. Confirm unsigned API requests are rejected and an approved sandbox user can sign in. Verify the GitHub return page removes callback parameters from browser history.

Run `terraform fmt -check`, `terraform init -backend=false -lockfile=readonly`, `terraform validate`, and `terraform test` from this directory for local verification.
