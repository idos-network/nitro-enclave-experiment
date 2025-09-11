# AWS Nitro Enclave Kernel

This repository contains a customized kernel configuration for AWS Nitro Enclaves with FUSE filesystem support enabled.

## Prerequisites

- Git
- Docker

## Build Instructions

### 1. Clone the Bootstrap Repository

```bash
git clone https://github.com/aws/aws-nitro-enclaves-sdk-bootstrap.git
git checkout ed24913346a34d719afa2031299253160a2e3460 # this is the version from Feb 22
```


### 2. Enable FUSE Filesystem Support

Modify the kernel configuration file to enable FUSE support:

**File:** `configs/microvm-kernel-config-x86_64` (or *appropriate* architecture-specific config)

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
docker build -t kernel_builder --build-arg BUILD_ARCH=x86_64 .
```

### 4. Extract Build Artifacts

```
docker create --name extract_blobs kernel_builder
docker cp extract_blobs:/build/blobs ./blobs
docker rm extract_blobs
```

After successful compilation, copy the generated files from the `blobs` directory. These artifacts will be used later in the `nitro-cli build-image` process.
