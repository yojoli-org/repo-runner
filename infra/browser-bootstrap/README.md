# Browser launch proof

This rehearsal checks whether a customer can approve an AWS console deployment that starts a job in their own account. The template creates a dedicated CodeBuild project and log group, a Lambda launcher, and two service roles. The build verifies its AWS account and reads the regional Lambda concurrency quota. It uses no source checkout, GitHub credentials, privileged build container, or runner deployment permissions. The build can incur AWS charges.

1. Validate the template and review its IAM resources. Publish the reviewed template to a private S3 bucket and use a short-lived presigned URL for the rehearsal. Keep the URL out of logs and committed files.
2. Create a [CloudFormation Quick Create link](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html) using the customer's region, a unique stack name, the URL-encoded template URL, and `param_ExpectedAccountId` set to their AWS test account.
3. In the customer console, verify the account, region, and template. Acknowledge IAM resource creation and create the stack.
4. Check the `BuildId` stack output and confirm that exact CodeBuild execution reached `SUCCEEDED`. The build should print the regional quota and `Browser bootstrap proof passed`. Stack creation confirms dispatch only.
5. After the build finishes, delete the proof stack and verify that its project, log group, launcher, and roles are gone. Remove the staged template when the rehearsal is complete.

This proves the browser approval and in-account execution boundary. Repo Runner provisioning, GitHub approval, smoke testing and portal progress reporting are separate work.

## Browser-started Terraform preview

The next rehearsal uses the same CloudFormation approval and launcher to generate a real plan for a new runner pool. It starts from empty local state, scopes the build to one versioned source ZIP, and gives the build role only source read, logs, and AWS discovery permissions. The build prints a create-only summary and discards the temporary plan. This preview is for inspection. It cannot authorize deployment.

From a reviewed checkout, download the pinned assets as described in [the pilot README](../pilot/README.md). Then generate the preview artifacts:

```bash
bash infra/browser-bootstrap/package-plan.sh /absolute/path/to/runner-assets /private/path/plan-source.zip
node infra/browser-bootstrap/make-plan-template.mjs > /private/path/plan-template.json
```

Stage the source ZIP at a unique key under `browser-bootstrap/` in a private, versioned bucket in the customer account. Stage the generated template separately. Use the source object’s exact version in the Quick Create link. Prefill `ExpectedAccountId`, `SourceBucket`, `SourceKey`, `SourceVersion`, `Repository`, `PilotPrefix`, `VpcId`, and the comma-separated `SubnetIds`. Use nonsecret sandbox inputs. The selected subnets must belong to the target VPC. For eventual runner deployment, they must also provide outbound access as described in the pilot README.

In the live rehearsal, verify that the exact build reaches `SUCCEEDED` and reports `preview_ready`, the number of planned resources, and the selected Lambda reservation. A 10-slot account should report shared concurrency (`-1`) for this preview. No runner pool should appear in the account. Delete the proof stack and staged source and template versions afterward.

The customer-facing flow will offer details on demand. Applying an approved deployment, wiring GitHub, and showing the result in the portal are separate milestones.
