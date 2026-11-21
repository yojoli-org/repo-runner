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
  description = "Existing private subnets with outbound HTTPS and no inbound access."
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
