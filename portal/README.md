# Sandbox browser portal

Serve `index.html`, `portal.css`, `portal.mjs`, `oauth.mjs`, and `aws-deployment.mjs` from an approved HTTPS origin. Publish a `config.json` based on `config.example.json`. It contains public endpoints and the public Cognito app client ID only. Use a dedicated sandbox origin and serve no third-party scripts or resources.

Staging uses the `repo-runner-stg` Cloudflare Worker and its `workers.dev` route. The Wrangler config and asset allowlist are in this directory. After the portal API and identity stacks exist, use their outputs to fill `config.json` and configure the response CSP described below. With Cloudflare deployment approval, run `wrangler deploy --config portal/wrangler.jsonc` from the repo root on the approved account. Verify that the returned hostname matches the planned staging URL. Production uses the same static assets with a separately approved Worker configuration and custom domain.

1. Configure a Cognito public app client with authorization-code flow and PKCE, no client secret, and the API's custom access-token scope. Register the exact portal page URL as its callback URL. Use the same page URL as the approved GitHub App manifest redirect. The browser distinguishes the two returns using separate state values held in the originating tab.
2. Configure the gateway authorizer for the Cognito user-pool issuer, the app client ID or configured resource audience, and the same scope. Set the sandbox configuration to the approved Cognito subject. The Cognito managed login domain and the token issuer are separate settings.
3. Match `apiOrigin` to the portal API output and `portal_origin` to the browser origin. Disable query logging for the portal return page and API callback at every layer. Configure a response CSP with `connect-src` restricted to your portal, Cognito domain, and API origin, and add `frame-ancestors 'none'` and `Cache-Control: no-store` on the return page.
4. Sign in and continue to GitHub in the same tab. The page removes the return query from browser history before exchanging or relaying the code. Only the access token is retained in tab storage until its expiry. Clearing the tab session does not sign out of Cognito.

The page completes App registration and credential delivery only. App installation, repository scope verification, webhook configuration, and runner deployment are separate steps. Run `npm test` from the repository root for synthetic protocol checks. A live sandbox rehearsal requires the configured gateway and identity provider.

To enable the AWS-first rehearsal, add an `awsDeployment` object to the staging config:

```json
{
  "account": "123456789012",
  "region": "us-east-2",
  "bucket": "example-private-bucket",
  "templateKey": "browser-bootstrap/sandbox-1/combined.json",
  "stackName": "rr-browser-sandbox",
  "repository": "example-org/repo-runner-test"
}
```

Use the nonsecret identifiers from the approved [combined deployment settings](../infra/browser-bootstrap/README.md#one-aws-approval-for-the-deployment-rehearsal). The portal uses the configured destination to build the AWS link. It shows the AWS action after sandbox sign-in. Keep the S3 object private, omit presigned URLs, and grant the customer access through their AWS session. Without this optional object, staging continues to offer its existing GitHub registration flow. After verifying the pool deployment, set `awsDeployment.registrationApiOrigin` to the customer registration stack’s HTTPS output and add it to the response CSP. The signed-in page then offers GitHub connection and sends its approved access token to the customer API. Deployment status is still configured by the operator in this rehearsal.
