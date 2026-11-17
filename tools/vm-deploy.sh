#!/bin/bash
# Deploy the packages + tools to the Parallels Ubuntu VM.
set -e
VM_HOST="${M68_VM_HOST:-10.211.55.47}"
VM_USER="${M68_VM_USER:-parallels}"
KEY="$(dirname "$0")/vm_key"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

rsync -az --delete \
  -e "ssh -i $KEY" \
  "$ROOT/package.json" "$ROOT/packages" "$ROOT/tools/99-m68.rules" \
  "$VM_USER@$VM_HOST:/home/$VM_USER/m68/" 2>/dev/null || {
    scp -q -i "$KEY" "$ROOT/package.json" "$VM_USER@$VM_HOST:/home/$VM_USER/m68/package.json"
    scp -q -i "$KEY" -r "$ROOT/packages" "$VM_USER@$VM_HOST:/home/$VM_USER/m68/packages"
  }
ssh -i "$KEY" "$VM_USER@$VM_HOST" "cd /home/$VM_USER/m68 && npm install --no-audit --no-fund 2>&1 | tail -1"
echo "deployed to $VM_HOST:/home/$VM_USER/m68"
