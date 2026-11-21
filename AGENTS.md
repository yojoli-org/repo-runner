# Agent instructions

Read [the implementation plan](docs/plan.md) before starting. Pick one milestone task at a time and state its acceptance checks. Preserve unrelated work. Record what you actually verified and any open decisions in the PR.

Use a pinned upstream Terraform module. Prefer documented configuration and bootstrap hooks. Propose upstream changes before committing to a fork.

Keep customer code, credentials, Terraform state and plan files out of the repository. Use synthetic fixtures and sandbox infrastructure. Cloud applies, IAM and GitHub access changes, paid resources, and Yojoli workflow routing changes require explicit maintainer authorization. The smoke workflow is manual and must only be dispatched against an approved pilot pool.
