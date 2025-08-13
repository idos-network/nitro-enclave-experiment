resource "aws_s3_bucket" "idos-nitro-facetec" {
  bucket = "idos-nitro-facetec"
}

data "aws_iam_policy_document" "idos-nitro-facetec-r" {
  statement {
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]

    resources = [
      "${aws_s3_bucket.idos-nitro-facetec.arn}/*",
    ]
  }

  statement {
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation",
    ]

    resources = [
      aws_s3_bucket.idos-nitro-facetec.arn,
    ]
  }

  statement {
    actions = [
      "s3:ListAllMyBuckets",
    ]

    resources = [
      "*",
    ]
  }
}


resource "aws_iam_policy" "idos-nitro-facetec-rw" {
  policy = data.aws_iam_policy_document.idos-nitro-facetec-r.json
}

resource "aws_iam_role_policy_attachment" "idos-nitro-facetec-rw" {
  role       = aws_iam_role.enclave_instance_role.id
  policy_arn = aws_iam_policy.idos-nitro-facetec-rw.arn
}
