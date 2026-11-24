locals {
  assets = {
    "index.html" = "text/html; charset=utf-8"
    "portal.css" = "text/css; charset=utf-8"
    "portal.mjs" = "text/javascript; charset=utf-8"
    "oauth.mjs"  = "text/javascript; charset=utf-8"
  }
}

resource "aws_s3_bucket" "portal" {
  bucket = "${var.prefix}-${var.portal_aws_account_id}-portal"
}

resource "aws_s3_bucket_public_access_block" "portal" {
  bucket                  = aws_s3_bucket.portal.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "portal" {
  name                              = var.prefix
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "portal" {
  name = "${var.prefix}-portal"
  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src ${join(" ", compact(["'self'", local.cognito_origin, var.api_origin]))}; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'"
      override                = true
    }
    content_type_options {
      override = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
  }
}

resource "aws_cloudfront_distribution" "portal" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.portal.bucket_regional_domain_name
    origin_id                = "private-portal"
    origin_access_control_id = aws_cloudfront_origin_access_control.portal.id
  }

  default_cache_behavior {
    target_origin_id           = "private-portal"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    viewer_protocol_policy     = "https-only"
    cache_policy_id            = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # AWS managed CachingDisabled
    response_headers_policy_id = aws_cloudfront_response_headers_policy.portal.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }
}

resource "aws_s3_bucket_policy" "portal" {
  bucket = aws_s3_bucket.portal.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Service = "cloudfront.amazonaws.com" }, Action = "s3:GetObject",
    Resource  = "${aws_s3_bucket.portal.arn}/*",
    Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.portal.arn } },
  }] })
}

resource "aws_s3_object" "asset" {
  for_each      = local.assets
  bucket        = aws_s3_bucket.portal.id
  key           = each.key
  source        = "${path.module}/../../portal/${each.key}"
  source_hash   = filesha256("${path.module}/../../portal/${each.key}")
  content_type  = each.value
  cache_control = "no-store"
}

resource "aws_s3_object" "config" {
  count         = var.api_origin == null ? 0 : 1
  bucket        = aws_s3_bucket.portal.id
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-store"
  content = jsonencode({
    cognitoOrigin = local.cognito_origin
    apiOrigin     = var.api_origin
    clientId      = aws_cognito_user_pool_client.portal.id
    scope         = local.api_scope
  })
}
