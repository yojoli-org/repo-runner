# Easy start

Run a GitHub Actions job on an on-demand runner in your AWS account. Start with one private test repository and one Linux ARM64 worker. The worker starts when a matching job queues and is removed after the job.

## Try the pilot today

The pilot is operator-assisted today. The web portal is planned.

1. **Pick a sandbox.** Choose a private GitHub test repository and an AWS account and region you can use for testing. An existing sandbox account is fine. Agree on a spending target with your operator.
2. **Approve access.** Your GitHub owner approves the pilot App for the test repository. Your AWS administrator approves access for the installation. Your operator can guide you through both steps. Keep keys and tokens in the designated secret store.
3. **Review and run.** Your operator prepares the deployment plan and shows what it will create. Once you approve it, they deploy the pool and run the included smoke test with you.
4. **Check the result.** Look for a passing job and confirmation that the worker, boot disk, and GitHub runner registration were removed. The AWS control plane stays deployed and can still incur usage between jobs.

Setting it up yourself? The [advanced operator guide](pilots/operator-guide.md) covers the GitHub settings, AWS configuration, installer commands, troubleshooting, and teardown.

## What the portal will do

The goal is to let you choose how much help you want. Connect the accounts you want to use, select repositories and a runner pool, review the changes, and approve the steps you want Repo Runner to perform. The portal will show setup progress and the test result. You can keep steps such as deployment or workflow edits under your own control.

GitHub Actions and AWS are the first supported combination for this design. See the [portal plan](plan.md#portal-onboarding) for how other platforms could fit later.
