#!/usr/bin/env bash
# ============================================================
# poppy-video - CONFIG (Wan 2.2 A14B self-hosted, dedicated g6e box)
# Reuses the existing inference-aws VPC / SG / key. Adds a subnet in an AZ
# that offers g6e (eu-north-1a) and one g6e.xlarge instance. Isolated from the
# known-good A10G box (separate instance, ComfyUI-only on :8188).
# ============================================================
export AWS_REGION="eu-north-1"
export PROJECT="poppy-video"
export INSTANCE_TYPE="g6e.xlarge"          # 1x L40S 45GB
export AMI_ID="ami-0c529ddfae5d7771b"      # DLAMI base OSS NVIDIA driver, Ubuntu 22.04 (docker preinstalled)

# Reused network (from Plans/inference-aws/.state).
export VPC_ID="vpc-02c8f88cce5cab4e0"
export ROUTE_TABLE_ID="rtb-0dc44e39c885aaf77"   # routes 0.0.0.0/0 -> IGW (public)
export SG_ID="sg-01919df2d05641da4"             # already allows owner IP on 22 + 8188
export KEY_NAME="poppy-inference-key"
export KEY_PEM="Plans/inference-aws/keys/poppy-inference-key.pem"

# New subnet in a g6e-capable AZ (VPC is 10.42.0.0/16; .1.0/24 already used).
export AZ="eu-north-1a"
export SUBNET_CIDR="10.42.2.0/24"

export EBS_SIZE_GB="250"                    # ~35GB weights + docker + headroom
export COMFYUI_IMAGE="aidockorg/comfyui-cuda:latest"

# State file for created resource ids (gitignored scratch).
export VSTATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.state"
