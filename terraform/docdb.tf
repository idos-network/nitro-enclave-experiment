# Create a subnet group for DocumentDB
resource "aws_docdb_subnet_group" "docdb" {
  name       = "${var.project_name}-docdb-subnet-group"
  subnet_ids = data.aws_subnets.default.ids
  tags = {
    Name = "${var.project_name}-docdb-subnet-group"
  }
}

# Create security group for DocumentDB
resource "aws_security_group" "docdb_sg" {
  name        = "${var.project_name}-docdb-sg"
  description = "Security group for DocumentDB"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Allow access from EC2"
    protocol        = "tcp"
    from_port       = 27017
    to_port         = 27017
    security_groups = [aws_security_group.web_sg.id]
  }

  egress {
    description = "Allow all outbound"
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-docdb-sg"
  }
}

# Create DocumentDB cluster
resource "aws_docdb_cluster" "docdb" {
  cluster_identifier              = "${var.project_name}-docdb-cluster"
  engine                          = "docdb"
  master_username                 = var.docdb_username
  master_password                 = var.docdb_password
  db_subnet_group_name            = aws_docdb_subnet_group.docdb.name
  vpc_security_group_ids          = [aws_security_group.docdb_sg.id]
  db_cluster_parameter_group_name = aws_docdb_cluster_parameter_group.docdb.name
  skip_final_snapshot             = true
  deletion_protection             = false

  tags = {
    Name = "${var.project_name}-docdb-cluster"
  }
}

# Create DocumentDB cluster parameter group
resource "aws_docdb_cluster_parameter_group" "docdb" {
  family      = "docdb5.0"
  name        = "${var.project_name}-docdb-parameter-group"
  description = "DocDB parameter group for ${var.project_name}"

  parameter {
    name  = "tls"
    value = "disabled"
  }

  tags = {
    Name = "${var.project_name}-docdb-parameter-group"
  }
}

# Create DocumentDB instance
resource "aws_docdb_cluster_instance" "docdb_instances" {
  count              = 1
  identifier         = "${var.project_name}-docdb-instance-${count.index}"
  cluster_identifier = aws_docdb_cluster.docdb.id
  instance_class     = var.docdb_instance_class

  tags = {
    Name = "${var.project_name}-docdb-instance-${count.index}"
  }
}
