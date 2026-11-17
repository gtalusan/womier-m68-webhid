#!/bin/bash
# Run m68ctl in the VM. Usage: vm-run.sh <m68ctl args...>
set -e
VM_HOST="${M68_VM_HOST:-10.211.55.47}"
VM_USER="${M68_VM_USER:-parallels}"
KEY="$(dirname "$0")/vm_key"

ssh -i "$KEY" "$VM_USER@$VM_HOST" \
  "cd /home/$VM_USER/m68 && node packages/cli/src/cli.js $*"
