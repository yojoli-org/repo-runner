variable "aws_region" {
  description = "Approved AWS sandbox region."
  type        = string
}

variable "sandbox_account_id" {
  description = "AWS account ID authorized for this pilot."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.sandbox_account_id))
    error_message = "Provide the approved 12-digit AWS account ID."
  }
}

variable "prefix" {
  description = "Unique resource prefix in the sandbox account and region."
  type        = string
  default     = "rr-pilot"
}

variable "vpc_id" {
  description = "ID of the existing sandbox VPC."
  type        = string
}

variable "subnet_ids" {
  description = "Existing public subnets with an internet gateway route. The runner security group allows no inbound traffic."
  type        = list(string)
}

variable "pilot_repository" {
  description = "Full name (owner/repo) of the dedicated private pilot GitHub repository."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.pilot_repository))
    error_message = "Use the full GitHub owner/repo name."
  }
}

variable "github_app_parameters" {
  description = "References to existing SSM parameters for the pilot GitHub App. Supply identifiers only."
  type = object({
    id_ssm             = object({ arn = string, name = string })
    key_base64_ssm     = object({ arn = string, name = string })
    webhook_secret_ssm = object({ arn = string, name = string })
  })
}

variable "scale_up_reserved_concurrent_executions" {
  description = "Reserve one scale-up Lambda slot, or use shared concurrency for an isolated smoke test."
  type        = number
  default     = 1

  validation {
    condition     = contains([-1, 1], var.scale_up_reserved_concurrent_executions)
    error_message = "Use 1 for a reserved slot or -1 for shared concurrency."
  }
}

variable "runtime_permissions_boundary_arn" {
  description = "Customer-managed permissions boundary for IAM roles created for this runner pool."
  type        = string
  default     = null

  validation {
    condition = var.runtime_permissions_boundary_arn == null ? true : can(regex(
      "^arn:aws:iam::${var.sandbox_account_id}:policy/[A-Za-z0-9_+=,.@/-]+$",
      var.runtime_permissions_boundary_arn,
    ))
    error_message = "The permissions boundary must be a managed policy in the approved sandbox account."
  }
}
