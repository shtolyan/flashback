# Контракт API и подключение агентов

Production: `https://flashback.62-146-235-120.sslip.io/api/bugs/v1`. Прежний `https://163-245-204-96.sslip.io/api/bugs/v1` прозрачно проксируется в ту же базу.

Базовый адрес: `http://localhost:4310/api/bugs/v1`. Полная схема — `/openapi.json`. Все операции используют JSON. Все API-запросы требуют `Authorization: Bearer <token>` либо браузерную сессию. Игра, веб и агенты работают с одной PostgreSQL-базой выбранного экземпляра.

| Метод и путь относительно базы | Результат |
| --- | --- |
| GET `/reports` | Массив полных отчётов, ID по возрастанию; `status` и `archived=false` как в HexLive |
| GET `/reports/{id}` | Один полный отчёт или 404 |
| POST `/reports` | Создание; `text`, необязательные `context`, `reportedInVersion`; 201 |
| POST `/reports/{id}` | Частичное изменение; пропущенные и null-поля сохраняют прежнее значение |
| POST `/reports/{id}/comments` | Добавление; `author`, `text` |
| POST `/reports/{id}/comments/{ordinal}` | Правка текста; ordinal начинается с 0, исходный автор сохраняется |
| DELETE `/reports/{id}` | Удаление отчёта и дочерних строк; 204 |
| POST `/reports/{id}/delete` | То же, для прежних клиентов |
| GET `/commits` | Список SHA сохранённых патчей |
| GET `/commits/{sha}` | Патч по полному SHA или однозначному префиксу от 7 символов |
| PUT `/commits/{sha}` | Загрузка патча; полный SHA; длинный diff обрезается до 1 000 000 UTF-16 символов с `truncated=true` |

## Совместимость

`Report` сохраняет все поля HexLive: `id`, `createdUtc`, `status`, `text`, `context`, `assignedAgent`, `agentHandoff`, `fixCommits`, `fixCommit`, `reportedInVersion`, `readyForTestInVersion`, `fixedInVersion`, `archived`, `comments`, `revision`.

`expectedRevision` необязателен для старых клиентов. Новый интерфейс передаёт его при изменении отчёта. Если версия устарела, сервер отвечает 409 с `{ "error": "...", "actualRevision": N }`; запись не происходит. Обычные ошибки — `{ "error": "..." }`.

Переданный `fixCommits` **заменяет** список, как в старом API. Агент, добавляющий коммит, должен прочитать текущий список и передать прежние SHA вместе с новыми. `fixCommit` остаётся для совместимости старых импортированных записей.

В UI редактируются только комментарии `user`; API сохраняет возможность правки любого комментария действующим ключом; доверенная атрибуция хранится отдельно от поля author. Неизвестный ordinal, как в HexLive, не меняет запись и возвращает отчёт. Архив — отдельный флаг, не статус.

## Дополнения Flashback

GET `/query?view=open&status=ready_for_test&q=текст&page=1` возвращает `{ items, total, page, pageSize, pages, counts, statuses }`.

- `view`: open / fixed / archive. Страница — 24 отчёта, новые ID сверху.
- `q`: буквальный поиск без wildcard-семантики по описанию, контексту и агенту; номер можно искать как `375` или `#375`.
- `items`: поля карточки без длинного handoff, комментариев и массива коммитов; вместо массивов `commentCount` и `commitCount`.
- `counts`: общие размеры трёх разделов. `statuses`: счётчики в выбранном разделе и поиске до применения фильтра статуса.
- Запрошенная страница ограничивается существующими страницами; пустой результат имеет `pages=1`.

POST `/reports/{id}/transition`: `{ action: "confirm" | "rework", expectedRevision, text?: string }`. Действие игрока из `ready_for_test` выполняется одной транзакцией с комментарием. Возврат на доработку очищает build-штампы и архивный флаг, сохраняя агента, handoff и коммиты.

WebSocket `/events`:

```json
{"type":"connected"}
{"type":"report.changed","id":375,"revision":4}
{"type":"report.deleted","id":375}
{"type":"commit.changed","sha":"..."}
```

Событие публикуется после фиксации транзакции. Это сигнал перечитать данные, а не новая копия отчёта. После каждого переподключения клиент обновляет открытые запросы; постоянная история событий не требуется. HTTP API остаётся достаточным для старых клиентов с polling.

## Рабочий процесс агента

1. Очередь — `created` и `rework`. Прочитать весь отчёт, контекст, комментарии и handoff.
2. До начала работы поставить `in_progress`, указать стабильное имя в `assignedAgent`, обновить handoff и оставить комментарий от `codex`/`claude`.
3. Исправления фиксировать отдельными коммитами. Дописывать SHA к сохранённым `fixCommits`, загружать патчи через CLI из checkout соответствующего репозитория.
4. После реализации поставить `ready_for_test` и описать результат проверки в комментарии и handoff.
5. Только игрок подтверждает `fixed`, возвращает `rework` и архивирует. Сервер проверяет разрешённые ключу целевые статусы.

Прежний Python-клиент принимает `--api <новый-base-url>`. Поставляемый `scripts/bugs.py` также читает `FLASHBACK_API`, по умолчанию работает с production Flashback и принимает ключ только из файла этого устройства или явного `--token-file`. В HexLive параметр игры — `-hexlive-bugs-api <новый-base-url>`.

## Доступ

`POST /api/auth/session {token}` создаёт 30-дневную HttpOnly-cookie. `GET /api/auth/me` возвращает имя, ID и права ключа. `POST /api/auth/logout` удаляет текущую сессию. Небезопасные методы с cookie требуют заголовок Origin, совпадающий с PUBLIC_ORIGIN; CLI с Bearer не требует Origin. Отсутствующий/отозванный ключ — 401, запрещённый статус — 403.

`GET/POST /api/access-keys` доступны администратору. Создание: `{name,isAdmin,allowedStatuses}`; ответ 201 `{key,secret}`, секрет показывается только один раз. `POST /api/access-keys/{id}/revoke` отзывает ключ, сессии и WebSocket; последний администратор не отзывается (409). Администратор всегда имеет все статусы. Для обычного ключа проверяется целевой status, включая переходы confirm/rework. Создание требует `created`; архив, удаление и непустой `fixedInVersion` требуют `fixed`. Чтение, текст, комментарии и патчи доступны любому действующему ключу.

`GET /reports/{id}/access` возвращает trusted stamps `created`, `updated`, `status`, `ready`, `fixed` с названием/ID ключа и временем. Отчёты сохраняют legacy-форму. Переданное клиентом имя автора не подменяет атрибуцию.

Перед WebSocket клиент вызывает `POST /api/auth/socket-ticket`, затем подключается к `/api/bugs/v1/events?ticket=...`. Билет одноразовый, действует 30 секунд. Долгоживущий токен в URL не передаётся; CLI также может передать Bearer в заголовке upgrade. Отзыв ключа/сессии завершает соединение кодом 4401.

## Projects, screenshots and voice reports

Legacy requests without a project header still select **HexLive**. Send `X-Flashback-Project: first-signal` for First Signal. `GET /api/projects` lists projects; an administrator can create another project with `POST /api/projects {slug,name,repository}`. Lists, counts, report reads, mutations and file downloads are scoped to the selected project. Existing IDs and revisions are preserved. Links to First Signal cards include `?project=first-signal&bug=ID`.

`POST /reports` additionally accepts an optional UUID `requestId` and `attachments: [{filename,contentType,dataBase64}]`. The report, attribution, screenshot bytes and submission identity commit in **one transaction**. Retrying the same request ID with the same key returns its existing report. Invalid attachments roll back creation. A game reporter submits one screenshot; ordinary clients can include up to four at creation. The report JSON includes an `attachments` array with `id`, `filename`, `contentType`, `size`, `sha256`, `createdAt`, and a relative authenticated `url`; it never embeds image bytes in report lists.

- `POST /reports/{id}/attachments?filename=scene.png&expectedRevision=N` — raw PNG/JPEG body with the matching Content-Type; updates the revision and observes conflicts. Up to 4 MiB per image, 8 attachments per report.
- `GET /reports/{id}/attachments` — metadata list.
- `GET /reports/{id}/attachments/{uuid}?project=first-signal` — original bytes. Requires the agent's normal Bearer key or browser session; responds with the real image type, `nosniff`, private/no-store and a SHA-256 ETag. No public media directory or long-lived secret in URLs.

The ordinary agent/device key can read First Signal using the project header. Verify the device identity before writes, then use:

```sh
python3 scripts/bugs.py --project first-signal whoami
python3 scripts/bugs.py --project first-signal queue
python3 scripts/bugs.py --project first-signal get 123
python3 scripts/bugs.py --project first-signal attachments 123 --output /tmp/bug-123
python3 scripts/bugs.py --project first-signal attach 123 screenshot.png
```

The CLI uses only `--token-file` or this device's `~/.config/hexlive/bug-token`. An explicitly missing/empty file fails closed. Repository keys and inherited `HEXLIVE_BUG_TOKEN` never choose identity. Downloads validate the server's SHA-256 before writing a usable image. In First Signal, `Tools/bugs.py` defaults to the First Signal project.

A key with `reporterProject: "first-signal"` is a **write-only game capability**, always non-admin with `created` only. It may create reports and its own transcription drafts. It cannot list/read reports, download attachments, add comments, change statuses, obtain a browser session/socket ticket or manage keys. The player binary uses this separate capability, never an agent or administrator key. It can be revoked in the existing access-key UI. Creation is rate-limited, the recognition queue is bounded, and game-origin screenshots have a per-project 1 GiB quota. Nothing falls back to anonymous report creation.

### Recognition before confirmation

`POST /transcriptions` sends raw PCM WAV, mono 16 kHz / 16 bit, 0.25–90 seconds. Returns **202** `{id,status:"queued"}`. Poll `GET /transcriptions/{id}` with the same key: `{id,status,text,error}` where status is `queued`, `running`, `complete` or `failed`. IDs are random; other keys receive 404. Drafts do **not** create reports. Audio is cleared after recognition or failure; drafts expire after one day. Cancellation in the game does not submit a bug. Unconfirmed drafts cannot enter an agent's queue.

Whisper runs on the VPS's private Docker network, CPU int8, in a separate service with memory/CPU limits. `WHISPER_URL` is server-only. No paid external transcription API or full tracker credential is included in the game. A failed recognizer leaves manual text submission available. Attachments live in PostgreSQL `bytea`, so existing PostgreSQL backups include both report metadata and files. The historical JSON importer only accepts legacy HexLive snapshots without attachments; use database backups for current media-bearing data.

For a separate worker host, `WHISPER_URL` may be an HTTPS endpoint and `WHISPER_TOKEN` supplies its server-only Bearer credential. The worker checks `VOICE_SERVICE_TOKEN` in constant time before reading audio. The game never sees this upstream credential. Existing central HexLive identity validation and its independent `bugs.read` / `bugs.create` / `bugs.manage` permissions remain active; the production identity migration is kept as migration 3, and projects/media/voice are migration 4.
