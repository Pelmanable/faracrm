"""Живой смоук: сотрудник не может указать, где лежит файл вложения.

Атака (до фикса): POST /auto/attachments с storage_id + storage_file_url
(путь на диске сервера) и public=true, затем GET /attachments/<id> отдаёт
этот файл; DELETE того же вложения удаляет его с диска.

Целью служит файл-канарейка, который скрипт создаёт сам во временной папке:
на старом коде скрипт прочитает и удалит только его. Поэтому бэкенд должен
быть на этой же машине (локальный dev).

Не pytest (имя не test_*). Пользователь — НЕ администратор (у is_admin
полный доступ, проверка полей для него не работает):
    set FARA_URL=http://127.0.0.1:8090
    set FARA_LOGIN=<логин сотрудника>
    set FARA_PASSWORD=<пароль>
    .venv3.14\\Scripts\\python.exe tests\\security\\smoke_attachment_storage_live.py
"""

import os
import sys
import tempfile

import httpx

URL = os.environ.get("FARA_URL", "http://127.0.0.1:8090")

failures: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    print(f"  {'OK  ' if passed else 'FAIL'} {name}")
    if not passed:
        print(f"       {detail[:300]}")
        failures.append(name)


def main() -> None:
    canary_dir = tempfile.mkdtemp(prefix="fara_canary_")
    canary = os.path.join(canary_dir, "canary.env")
    with open(canary, "wb") as f:
        f.write(b"CANARY_SECRET=do-not-leak")

    client = httpx.Client(base_url=URL, timeout=30)
    r = client.post(
        "/signin",
        json={
            "login": os.environ["FARA_LOGIN"],
            "password": os.environ["FARA_PASSWORD"],
        },
    )
    r.raise_for_status()
    session = r.json()
    if session["user_id"].get("is_admin"):
        sys.exit("Нужен НЕ администратор: у is_admin полный доступ к полям.")
    client.headers["Authorization"] = f"Bearer {session['token']}"
    print(f"Вошли как {session['user_id']['name']} на {URL}")

    # 1. Атака на создании: клиент сам указывает путь файла.
    r = client.post(
        "/auto/attachments",
        json={
            "name": "x.txt",
            "public": True,
            "storage_id": 1,
            "storage_file_url": canary,
        },
    )
    check("POST со storage_file_url -> 403", r.status_code == 403, r.text)
    if r.status_code == 200:
        planted = r.json()["id"]
        leaked = client.get(f"/attachments/{planted}")
        print(
            f"       уязвимо: GET -> {leaked.status_code} {leaked.content!r}"
        )
        # DELETE на старом коде удалит файл по storage_file_url — это только
        # канарейка, чужого не тронет.
        client.delete(f"/auto/attachments/{planted}")

    # 2. Обычная загрузка сотрудником работает, скачивание отдаёт файл.
    # Файл — загрузкой частями (одна часть), во вложение — upload_id.
    data = b"smoke attachment content"
    r = client.post(
        "/attachments/uploads",
        json={
            "name": "smoke.txt",
            "mimetype": "text/plain",
            "size": len(data),
        },
    )
    check("POST /attachments/uploads -> 200", r.status_code == 200, r.text)
    if r.status_code != 200:
        return
    upload_id = r.json()["id"]
    r = client.patch(
        f"/attachments/uploads/{upload_id}",
        content=data,
        headers={
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
        },
    )
    check("PATCH части -> 200", r.status_code == 200, r.text)
    r = client.post(
        "/auto/attachments",
        json={
            "name": "smoke.txt",
            "mimetype": "text/plain",
            "size": len(data),
            "public": True,
            "upload_id": upload_id,
        },
    )
    check("POST обычной загрузки -> 200", r.status_code == 200, r.text)
    if r.status_code != 200:
        return
    own = r.json()["id"]
    r = client.get(f"/attachments/{own}")
    check(
        "GET своего файла отдаёт содержимое",
        r.status_code == 200 and r.content == data,
        f"{r.status_code} {r.content[:100]!r}",
    )

    # 3. Атака на обновлении своего вложения.
    for field, value in (
        ("storage_file_url", canary),
        ("storage_parent_id", canary_dir),
        ("storage_file_id", "SOME_DRIVE_FILE_ID"),
    ):
        r = client.put(f"/auto/attachments/{own}", json={field: value})
        check(f"PUT {field} -> 403", r.status_code == 403, r.text)

    # 4. Обычная правка (имя) по-прежнему работает.
    r = client.put(f"/auto/attachments/{own}", json={"name": "smoke2.txt"})
    check("PUT name -> 200", r.status_code == 200, r.text)

    # 5. Уборка: своё вложение удаляется, канарейка цела.
    r = client.delete(f"/auto/attachments/{own}")
    check("DELETE своего вложения -> 200", r.status_code == 200, r.text)
    check("канарейка на месте", os.path.exists(canary), canary)


if __name__ == "__main__":
    main()
    print("ВСЁ ОК" if not failures else f"ПРОВАЛЕНО: {len(failures)}")
    sys.exit(1 if failures else 0)
