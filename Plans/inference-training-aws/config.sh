#!/usr/bin/env bash
# ============================================================
# poppy-lora-training - CONFIG
#
# Ephemeral scale-to-zero g5.xlarge for per-character SDXL LoRA
# training. Completely separate from the inference box (different
# instance, same VPC/SG). Reuses the key pair from inference-aws.
#
# Edit values here; deploy.sh and start.sh source this file.
# ============================================================

export AWS_REGION="eu-north-1"
export PROJECT="poppy-lora-training"
export INSTANCE_TYPE="g5.xlarge"         # A10G 24GB, 16GB RAM

# DLAMI: latest deep-learning base AMI with NVIDIA driver + Docker
export AMI_SSM_PARAM="/aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id"

# Reuse existing VPC/SG/key from Plans/inference-aws/.
# (No new VPC or key pair needed.)
export VPC_ID="vpc-02c8f88cce5cab4e0"
export ROUTE_TABLE_ID="rtb-0dc44e39c885aaf77"
export SG_ID="sg-01919df2d05641da4"
export KEY_NAME="poppy-inference-key"
export KEY_PEM="Plans/inference-aws/keys/poppy-inference-key.pem"

# Use the eu-north-1c subnet (proven g5 capacity; inference box is there).
# Set FORCE_AZ to try a different AZ if InsufficientInstanceCapacity.
export SUBNET_ID="subnet-0ae6c25f9896cd851"   # eu-north-1c, 10.42.1.0/24
export FORCE_AZ=""                             # e.g. "eu-north-1a" to override

export EBS_SIZE_GB="200"                       # ~40GB model weights + swap + headroom
export SHUTDOWN_BEHAVIOR="stop"               # preserve EBS on idle-stop
export IDLE_MINUTES="30"

# S3 bucket (must match POPPY_S3_BUCKET_GENERATED on the backend side).
# Training checkpoints are uploaded under lora/ in this bucket.
# Gallery images (images/* prefix) are read from this same bucket.
export S3_BUCKET="poppy-generated"
export AWS_REGION_S3="eu-north-1"             # bucket region (must match S3_BUCKET)

# IAM instance profile (created by deploy.sh if it does not exist).
export IAM_ROLE_NAME="poppy-lora-training-role"
export IAM_PROFILE_NAME="poppy-lora-training-instance-profile"

# Models (baked into EBS via user-data.sh on first boot).
# Juggernaut: public on HuggingFace, no token required.
export JUGGERNAUT_MODEL_URL="https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors"
# RealVisXL V5.0: HuggingFace public repo.
export REALVISXL_MODEL_URL="https://huggingface.co/SG161222/RealVisXL_V5.0/resolve/main/RealVisXL_V5.0.safetensors"
# HF/CivitAI tokens (leave blank if the models do not require auth).
export HF_TOKEN=""
export CIVITAI_TOKEN=""

# ComfyUI image for validation renders on the training box.
export COMFYUI_IMAGE="aidockorg/comfyui-cuda:latest"

# Budget alarm (email when spend hits 80% / 100% of cap).
export MONTHLY_BUDGET_USD="400"
export ALERT_EMAIL=""          # set to receive budget emails

# State file (gitignored; stores instance ID, IP, subnet ID).
export VSTATE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.state"
