# AWS Nitro Enclave Kernel

This repository contains a customized kernel configuration for AWS Nitro Enclaves with FUSE filesystem support enabled.

## Prerequisites

- [Nix](https://nixos.org/download.html) package manager
- Git

## Build Instructions

### 1. Clone the Bootstrap Repository

```bash
git clone https://github.com/aws/aws-nitro-enclaves-sdk-bootstrap.git
```

### 2. Enable FUSE Filesystem Support

Modify the kernel configuration file to enable FUSE support:

**File:** `kernel/microvm-kernel-config-x86_64` (or appropriate architecture-specific config)

**Change:**
```diff
- # CONFIG_FUSE_FS is not set
+ CONFIG_FUSE_FS=y
```

**Location:** Line 2901-2902

### 3. Build the Kernel

Execute the build process using Nix:

```bash
nix-build -A all
```

### 4. Extract Build Artifacts

After successful compilation, copy the generated files from the `blobs` directory. These artifacts will be used later in the `nitro-cli build-image` process.
