#!/usr/bin/env bash
# Переход на PostgreSQL 18, шаг 1 из 2: дамп старого кластера 17.
# Работает в образе postgres:17 до старта postgres (см. docker-compose.yml).
# Старый том не меняется — он остаётся для отката на postgres:17.
set -Eeo pipefail

if [ ! -s "$PGDATA/PG_VERSION" ]; then
	echo "[pg17-backup] старого кластера нет — пропускаю"
	exit 0
fi
if [ -s /pg18/18/docker/PG_VERSION ]; then
	echo "[pg17-backup] кластер 18 уже есть — пропускаю"
	exit 0
fi
# compose запускает этот шаг ДО остановки старого postgres. Второй сервер на
# том же каталоге испортит данные, а защита postmaster.pid между контейнерами
# не срабатывает (у них разные PID-пространства) — поэтому просим остановить стек.
if pg_isready -q -h postgres; then
	echo "[pg17-backup] старый postgres ещё работает. Выполните: docker compose down && docker compose up -d" >&2
	exit 1
fi

# Пишем во временный каталог: pg18-restore берёт только завершённый дамп.
tmp=/backups/pg17.tmp
dump=/backups/pg17-$(date +%Y%m%d-%H%M%S)
rm -rf "$tmp"
install -d -o postgres -g postgres -m 700 "$tmp"

gosu postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start
gosu postgres pg_dumpall -U "$POSTGRES_USER" --globals-only -f "$tmp/globals.sql"
gosu postgres pg_dump -U "$POSTGRES_USER" -Fc -f "$tmp/$POSTGRES_DB.dump" "$POSTGRES_DB"
gosu postgres pg_ctl -D "$PGDATA" -m fast -w stop

mv "$tmp" "$dump"
echo "[pg17-backup] дамп готов: backups/postgres/${dump#/backups/}"
