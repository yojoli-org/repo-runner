# Agent instructions

Read [the implementation plan](docs/plan.md) before starting. Pick one milestone task at a time and state its acceptance checks. Preserve unrelated work. Record what you actually verified and any open decisions in the PR.

Repo Runner provides generic runner infrastructure. Read [the Yojoli pilot](docs/pilots/yojoli.md) when working on that installation. Its eligibility rules, runner labels and container allowlist belong to that installation. Promoting a pilot requirement to a product default requires an explicit maintainer decision.

Use a pinned upstream Terraform module. Prefer documented configuration and bootstrap hooks. Propose upstream changes before committing to a fork.

Keep customer code, credentials, Terraform state and plan files out of the repository. Use synthetic fixtures and sandbox infrastructure. Cloud applies, IAM and GitHub access changes, paid resources, and customer workflow routing changes require explicit maintainer authorization. Copy the manual smoke workflow to the approved private sandbox repository and dispatch it there against the dedicated pilot pool.
