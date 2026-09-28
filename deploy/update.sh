#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/finance-agent/app
DATA_DIR=/var/lib/finance-agent
BACKUP_DIR=/var/backups/finance-agent
SERVICE=finance-agent
REPO=https://github.com/thisNorm/finance-agent.git

[[ $EUID -eq 0 ]] || { echo "sudo로 실행하세요." >&2; exit 1; }
for command in git node npm curl tar systemctl; do
  command -v "$command" >/dev/null || { echo "$command 설치가 필요합니다." >&2; exit 1; }
done
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 24 ]] || {
  echo "Node.js 24 이상이 필요합니다." >&2
  exit 1
}

id finance-agent >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin finance-agent
install -d -o finance-agent -g finance-agent -m 700 "$DATA_DIR" "$BACKUP_DIR"
if [[ ! -d "$APP_DIR/.git" ]]; then
  install -d "$(dirname "$APP_DIR")"
  git clone "$REPO" "$APP_DIR"
fi

cd "$APP_DIR"
[[ -z $(git status --porcelain) ]] || { echo "서버 코드에 수정사항이 있어 업데이트를 중단합니다." >&2; exit 1; }
old=$(git rev-parse HEAD)
git fetch origin master
git merge --ff-only origin/master

rollback_code() {
  git reset --hard "$old"
  npm ci
  npm run build
}

if ! npm ci || ! npm run build; then
  echo "빌드 실패. 이전 코드를 복구합니다." >&2
  rollback_code || true
  exit 1
fi

sed "s|@@NODE@@|$(command -v node)|" deploy/finance-agent.service > /etc/systemd/system/finance-agent.service
systemctl daemon-reload
systemctl stop "$SERVICE" 2>/dev/null || true

backup="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -C "$DATA_DIR" -czf "$backup" .
chown finance-agent:finance-agent "$backup"
systemctl enable --now "$SERVICE"

for _ in {1..20}; do
  if curl -fsS http://127.0.0.1:4317/api/session >/dev/null; then
    mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -name 'backup-*.tar.gz' -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
    for ((i=10; i<${#backups[@]}; i++)); do rm -f -- "${backups[$i]}"; done
    echo "배포 완료: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

echo "상태 확인 실패. 코드와 데이터를 이전 상태로 복구합니다." >&2
systemctl stop "$SERVICE" || true
rollback_code
find "$DATA_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -C "$DATA_DIR" -xzf "$backup"
chown -R finance-agent:finance-agent "$DATA_DIR"
systemctl start "$SERVICE"
exit 1
