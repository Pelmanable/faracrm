#!/usr/bin/env bash
# Переход на PostgreSQL 18, шаг 2 из 2: заливка дампа pg17-backup в новый кластер.
# Работает в образе postgres:18 от пользователя postgres до старта postgres.
# Кластер собирается во временном каталоге и переименовывается целиком:
# postgres видит либо готовую базу, либо пустой том — никогда половину.
set -Eeo pipefail

FINAL=/var/lib/postgresql/18/docker

if [ -s "$FINAL/PG_VERSION" ]; then
	echo "[pg18-restore] кластер 18 уже есть — пропускаю"
	exit 0
fi
# Смотрим на старый том, а не на наличие дампов: дампы прошлого перехода
# лежат в backups и после «пересоздания с нуля».
if [ ! -s /pg17/PG_VERSION ]; then
	echo "[pg18-restore] старого кластера нет — обычная установка"
	exit 0
fi
# Дамп только что снял pg17-backup; имена pg17-<дата> сортируются по времени.
dumps=(/backups/pg17-*)
dump=${dumps[-1]}
echo "[pg18-restore] восстанавливаю $dump"

# Инициализация — функциями официального entrypoint: тот же суперпользователь,
# пароль и pg_hba, что при обычном первом старте.
source /usr/local/bin/docker-entrypoint.sh
export PGDATA=$FINAL.tmp
rm -rf "$PGDATA"
docker_setup_env
docker_create_db_directories
docker_verify_minimum_env
docker_init_database_dir
pg_setup_hba_conf
docker_temp_server_start
docker_setup_db

# Роль POSTGRES_USER уже создана initdb: её CREATE пропускаем, ALTER вернёт
# прежний пароль и атрибуты.
grep -vxF "CREATE ROLE $POSTGRES_USER;" "$dump/globals.sql" | docker_process_sql
pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$dump/$POSTGRES_DB.dump"
docker_process_sql -c ANALYZE

docker_temp_server_stop
mv "$PGDATA" "$FINAL"
echo "[pg18-restore] готово"
