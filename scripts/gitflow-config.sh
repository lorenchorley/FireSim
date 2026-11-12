#!/usr/bin/env bash
# Point the git-flow CLI (git-flow-avh) at this repository's branch names, with no prompts.
# Run once per clone: scripts/gitflow-config.sh
# The settings live in .git/config, which is not shared, so every clone needs this once.
set -euo pipefail
git rev-parse --git-dir >/dev/null
git config gitflow.branch.master main
git config gitflow.branch.develop develop
git config gitflow.prefix.feature feature/
git config gitflow.prefix.bugfix bugfix/
git config gitflow.prefix.release release/
git config gitflow.prefix.hotfix hotfix/
git config gitflow.prefix.support support/
git config gitflow.prefix.versiontag v
git config gitflow.path.hooks "$(git rev-parse --git-path hooks)"
echo "gitflow configured: main / develop, prefixes feature/ bugfix/ release/ hotfix/ support/, version tags v<X.Y.Z>"
