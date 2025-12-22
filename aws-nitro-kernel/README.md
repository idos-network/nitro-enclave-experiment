# AWS Nitro Enclave Kernel

This repository contains a customized kernel configuration for AWS Nitro Enclaves with NBD support enabled.

## Prerequisites

- Git
- Docker

## Build Instructions

### 1. Clone the Bootstrap Repository

```bash
git clone https://github.com/aws/aws-nitro-enclaves-sdk-bootstrap.git
```


### 2. Enable FUSE Filesystem Support

Modify the kernel configuration file to enable FUSE support:

**File:** `kernel/microvm-kernel-config-x86_64` (or *appropriate* architecture-specific config)

**Change:**
```diff
- # CONFIG_BLK_DEV_NBD is not set
+ CONFIG_DAX=y
+ CONFIG_PNFS_BLOCK=y
+ CONFIG_MD=y
+ CONFIG_BLK_DEV_DM_BUILTIN=y
+ CONFIG_BLK_DEV_DM=y
+ CONFIG_DM_CRYPT=y
+ CONFIG_BLK_DEV_NBD=y
```

**Location:** Line 2901-2902

### 3. Build the Kernel

Execute the build process using Nix:

```bash
docker build -t blobs_all .
```

### 4. Extract Build Artifacts

```
docker create --name extract_blobs blobs_all
docker cp extract_blobs:/blobs ./blobs
docker rm extract_blobs
```

After successful compilation, copy the generated files from the `blobs` directory. These artifacts will be used later in the `nitro-cli build-image` process.
