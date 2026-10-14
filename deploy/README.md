# Развёртывание VoidCore на Ubuntu 24.04

VPS: 31.76.64.235. Сайт: crymoooreee.ru. API: api.crymoooreee.ru.
Команды ниже выполняются ВАМИ на VPS; создание архива не изменило сервер.
Не сбрасывайте firewall, не отключайте другие сервисы и не удаляйте существующие DNS MX/TXT.

## 1. Передайте исходники на сервер

Распакуйте Void-Core-0.5.0-Accounts-Steam.zip на своём компьютере.
Из PowerShell в распакованной папке передайте только серверные файлы:

```powershell
ssh root@31.76.64.235 "mkdir -p /opt/voidcore"
scp -r backend deploy compose.yaml root@31.76.64.235:/opt/voidcore/
```

Не передавайте пароль/ключ в чат. Если root SSH недоступен, используйте пользователя
из панели провайдера и sudo. Не запускайте сервер от root без контейнерного ограничения.

## 2. Установите компоненты

На VPS:

```bash
apt update
apt install -y nginx certbot docker.io docker-compose-v2
systemctl enable --now docker nginx
cd /opt/voidcore
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

Если пакет docker-compose-v2 не найден, не устанавливайте случайный скрипт из интернета:
пришлите текст ошибки или используйте официальную инструкцию Docker для Ubuntu.
Docker может добавлять правила iptables; проверьте совместимость с другими
сетевыми сервисами VPS. Указанный Compose публикует API только на 127.0.0.1:3000.
Не меняйте это на публичный 0.0.0.0.

## 3. Сначала проверьте backend локально

```bash
cd /opt/voidcore
docker compose up -d --build
curl --fail http://127.0.0.1:3000/health
docker compose ps
```

Без SMTP ожидается mailConfigured:false, без Steam API key — steamAPIConfigured:false.
Это нормально для начальной проверки. Регистрация НЕ будет работать до настройки SMTP.
Если запуск неудачен, посмотрите `docker compose logs --tail=50 api`; не публикуйте
логи, содержащие ваши секреты. Контейнер и зависимости здесь не были собраны
в среде ассистента — нужна проверка сборки на VPS с доступом к интернету.

Перед публичным запуском проверьте почтовую зависимость на VPS:

```bash
cd /opt/voidcore/backend
# Выполняется в одноразовом контейнере; генерирует lock-файл в backend.
docker run --rm -v "$PWD:/work" -w /work node:24-bookworm-slim sh -c 'npm install --ignore-scripts && npm audit --omit=dev'
```

Если аудит сообщает об уязвимостях, не открывайте регистрацию: обновите зависимости,
проверьте их, затем пересоберите API. Не применяйте npm audit fix --force вслепую.
При фиксации проверенного lock-файла замените установку в Dockerfile на npm ci
и скопируйте package-lock.json вместе с package.json для воспроизводимых сборок.

## 4. Подготовьте HTTP для сертификата

```bash
install -d /var/www/voidcore
cp deploy/website/index.html /var/www/voidcore/index.html
cp deploy/nginx-bootstrap.conf /etc/nginx/sites-available/voidcore
ln -s /etc/nginx/sites-available/voidcore /etc/nginx/sites-enabled/voidcore
nginx -t && systemctl reload nginx
```

Если ссылка уже существует, не создавайте её повторно. Прежде чем заменить
существующий файл voidcore, сделайте его резервную копию. Другие сайты не удаляйте.
Bootstrap-конфигурация ещё не публикует API по незащищённому HTTP.

На этом этапе порты TCP 80/443 должны быть доступны снаружи. UFW у вас был inactive,
но может быть firewall провайдера или другие правила. Не включайте UFW и не очищайте
iptables без плана сохранения SSH и существующих сервисов.

## 5. Дождитесь DNS, затем выпустите HTTPS

```bash
getent ahostsv4 crymoooreee.ru
getent ahostsv4 api.crymoooreee.ru
```

Оба имени должны возвращать 31.76.64.235 при прямых A-записях. Удалите/исправьте
AAAA для этих имён, если они ведут на другой сервер. Если используется прокси CDN,
при первичной диагностике используйте DNS only. Доступность HTTP извне проверьте
со своего компьютера, не только curl на самом VPS.

ТОЛЬКО после корректного DNS и доступного TCP 80:

```bash
certbot certonly --webroot -w /var/www/voidcore -d crymoooreee.ru -d api.crymoooreee.ru
```

Certbot попросит email для уведомлений и согласие с условиями. Адрес укажите сами.
Если сертификат не выпущен, HTTPS-конфигурацию ниже не устанавливайте.
Если Certbot создал имя сертификата с суффиксом -0001, исправьте два пути в конфиге
согласно `certbot certificates`.

После успешной выдачи:

```bash
cp /etc/nginx/sites-available/voidcore /etc/nginx/sites-available/voidcore.before-https
cp deploy/nginx-https.conf /etc/nginx/sites-available/voidcore
nginx -t && systemctl reload nginx
curl --fail https://api.crymoooreee.ru/health
certbot renew --dry-run
systemctl list-timers --all | grep certbot
```

Добавьте deploy hook для перезагрузки Nginx после успешного продления:

```bash
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\n/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/voidcore-nginx
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/voidcore-nginx
```

Сначала прочитайте существующий файл hook, если он уже есть. HTTPS API не должен
переадресовывать клиент на другой origin. Не отключайте проверку сертификатов.

## 6. Настройте SMTP и Steam

Откройте `backend/.env` на VPS в редакторе. Заполните SMTP_HOST, SMTP_PORT,
SMTP_SECURE, SMTP_USER, SMTP_PASSWORD и SMTP_FROM согласно вашему почтовому сервису.
Для 587 обычно false (обязательный STARTTLS), для 465 true. Нужен отправитель,
разрешённый сервисом; при собственном домене настройте SPF/DKIM/DMARC.

STEAM_API_KEY добавляется только сюда, для профиля и библиотеки.
Ключ можно получить на https://steamcommunity.com/dev/apikey при соблюдении условий Valve.
Для подтверждения SteamID через OpenID ключ не требуется.

Не вводите секреты в команду, которая попадёт в историю, и не присылайте .env в чат.

```bash
cd /opt/voidcore
docker compose up -d --force-recreate api
curl --fail https://api.crymoooreee.ru/health
```

Перед публичным запуском проверьте реальную доставку email, запись sender domain,
вход Steam и закрытую библиотеку. health подтверждает наличие настроек, а не успешную
доставку почты или валидность ключа.

## 7. Соберите клиент

На Windows из корня исходников:

```bash
npm install
npm run version:check
npm run test:accounts
npm run test:backend
npm run build
```

Backend-тесты требуют Node.js 24. Адрес API клиента уже настроен:
`electron/service-config.json` → https://api.crymoooreee.ru.
Steam API key и SMTP_PASSWORD НЕ добавляются в клиент.

Подготовленная версия — 0.5.0. Никакой релиз не опубликован автоматически.
Серверные файлы не включаются в Electron-установщик.

## Резервные копии

Для первой простой консистентной копии остановите API на время архивации volume:

```bash
cd /opt/voidcore
docker compose stop api
docker compose run --rm --no-deps --user root --entrypoint sh -v /opt/voidcore:/backup api -c 'tar -czf /backup/account-backup.tgz -C /app/data .'
chmod 600 /opt/voidcore/account-backup.tgz
docker compose start api
```

Проверьте результат до удаления любых данных. Храните бэкап отдельно и зашифрованно.
Не запускайте `docker compose down -v`: это удалит volume аккаунтов.
В публичном проекте также нужны проверенная политика конфиденциальности,
процедура удаления аккаунта и план резервного копирования.
