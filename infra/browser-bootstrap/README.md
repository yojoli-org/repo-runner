# Browser launch proof

This rehearsal checks whether a customer can approve an AWS console deployment that starts a job in their own account. The template creates a dedicated CodeBuild project and log group, a Lambda launcher, and two service roles. The build verifies its AWS account and reads the regional Lambda concurrency quota. It uses no source checkout, GitHub credentials, privileged build container, or runner deployment permissions. The build can incur AWS charges.

1. Validate the template and review its IAM resources. Publish the reviewed template to a private S3 bucket and use a short-lived presigned URL for the rehearsal. Keep the URL out of logs and committed files.
2. Create a [CloudFormation Quick Create link](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html) using the customer's region, a unique stack name, the URL-encoded template URL, and `param_ExpectedAccountId` set to their AWS test account.
3. In the customer console, verify the account, region, and template. Acknowledge IAM resource creation and create the stack.
4. Check the `BuildId` stack output and confirm that exact CodeBuild execution reached `SUCCEEDED`. The build should print the regional quota and `Browser bootstrap proof passed`. Stack creation confirms dispatch only.
5. After the build finishes, delete the proof stack and verify that its project, log group, launcher, and roles are gone. Remove the staged template when the rehearsal is complete.

This proves the browser approval and in-account execution boundary. Repo Runner provisioning, GitHub approval, smoke testing and portal progress reporting are separate work.
