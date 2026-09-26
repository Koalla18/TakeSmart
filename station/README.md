# TakeSmart Station — установка приложений на iPhone

Программа для Mac в павильоне. Ставит на iPhone покупателя приложения, которых
нет в App Store (Сбер, Т-Банк и другие), скачивая их из истории покупок Apple ID
покупателя и устанавливая по кабелю оригинальным файлом Apple. Без сертификатов,
джейлбрейка и переподписи.

## Что нужно один раз

1. Mac с macOS 12 или новее, кабель Lightning/USB-C.
2. Homebrew (https://brew.sh), затем утилиты:
   ```bash
   brew tap majd/repo && brew install ipatool libimobiledevice ideviceinstaller
   ```
3. В админке TakeSmart: раздел «Приложения на iPhone» → «Станции» → «Добавить станцию».
   Токен показывается один раз.
4. Сохранить настройки станции (адрес сайта и токен):
   ```bash
   python3 takesmart_station.py --setup --backend https://takesmart.ru --token ts_...
   ```

## Каждый день

```bash
python3 takesmart_station.py
```
Откроется страница станции http://127.0.0.1:8765. Дальше всё из админки:
сотрудник выбирает заявку, отмечает приложения и жмёт «Отправить на станцию».

Порядок у прилавка:
1. Подключить iPhone кабелем, разблокировать, на телефоне нажать «Доверять».
2. На странице станции покупатель вводит свой Apple ID, пароль и код подтверждения.
   Данные уходят напрямую в Apple с этого Mac, на сервер TakeSmart не попадают.
3. Станция показывает историю покупок аккаунта и ставит выбранные приложения.
   Чего нет в истории покупок, помечается «нет в покупках» — за это денег не берём.
4. После задания станция сама выходит из Apple ID и удаляет скачанные файлы.

## Полезное

- `--simulate` — проверить связку без телефона (эмуляция iPhone и Apple ID).
- `--no-auto-logout` — не выходить из Apple ID после задания (если ставим ещё).
- `--port 9000` — другой порт локальной страницы.
- Журнал: `~/Library/Application Support/TakeSmart Station/station.log`.
- Автозапуск при входе в macOS: Системные настройки → Основные → Объекты входа →
  добавить `Терминал` с командой запуска, либо LaunchAgent по образцу ниже.

```xml
<!-- ~/Library/LaunchAgents/ru.takesmart.station.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ru.takesmart.station</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string>
    <string>/Users/ИМЯ/TakeSmart/takesmart_station.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
```

## Ограничения, о которых говорим покупателю

- Ставится только то, что было в истории покупок Apple ID. Иначе — Apple ID
  родственника: при первом запуске приложение попросит его код подтверждения.
- Версия приложения — последняя, что была в App Store на момент удаления.
- Пуш-уведомления у снятых с витрины приложений могут не приходить.
