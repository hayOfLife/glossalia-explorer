<?

// Если скрипт открыт через веб-сервер, прекращаем выполнение до чтения данных
if (PHP_SAPI != 'cli') { exit(1); }

$siteRoot = dirname(__DIR__);
$configPath = $siteRoot . '/database/config.php';

// Если параметры подключения ещё не заданы, импортировать данные нельзя
if (!is_file($configPath)) { throw new RuntimeException('Create database/config.php from config.example.php'); }

/** Параметры подключения к БД @var array{host: string, database: string, username: string, password: string} $databaseConfig */
$databaseConfig = require $configPath;
$seedJson = file_get_contents($siteRoot . '/database/seed.json');

// Если файл начальных записей недоступен, не начинаем транзакцию
if ($seedJson === false) { throw new RuntimeException('Cannot read database/seed.json'); }

/**
 * Начальные публикации
 * @var array<int, array{externalKey: string, type: string, title: string, group: string, calendarDate: string, dateNote: string, method: string, bodyText: string, sourceUrl: string, statusNote: string, published: bool}> $seedEntries
 */
$seedEntries = json_decode($seedJson, true, 512, JSON_THROW_ON_ERROR);

// Если начальные данные не являются списком, останавливаем импорт
if (!is_array($seedEntries) || !array_is_list($seedEntries)) { throw new RuntimeException('Invalid seed data'); }

/** Соединение с БД @var PDO $database */
$database = new PDO(
    'mysql:host=' . $databaseConfig['host'] . ';dbname=' . $databaseConfig['database'] . ';charset=utf8mb4',
    $databaseConfig['username'],
    $databaseConfig['password'],
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

$insertEntry = $database->prepare(<<< SQL
    INSERT INTO entry (
        external_key, entry_type, title, entry_group, calendar_time_utc, date_note,
        method_note, body_text, source_url, status_note, published,
        created_time_utc, updated_time_utc
    ) VALUES (
        :externalKey, :entryType, :title, :entryGroup, :calendarTimeUtc, :dateNote,
        :methodNote, :bodyText, :sourceUrl, :statusNote, :published,
        :createdTimeUtc, :updatedTimeUtc
    )
SQL);

$moscowTimeZone = new DateTimeZone('Europe/Moscow');
$currentTimeUtc = time();
$allowedExternalKeys = ['T00014', 'T00016', 'T00017', 'T00018', 'T00019', 'T00020'];
$database->beginTransaction();

try {
    foreach ($seedEntries as $seedEntry) {
        // Если идентификатор не принадлежит выбранным карточкам, не импортируем запись
        if (!isset($seedEntry['externalKey']) || !in_array($seedEntry['externalKey'], $allowedExternalKeys, true)) {
            throw new RuntimeException('Invalid transcription identifier');
        }

        /** Календарная дата получения текста @var DateTimeImmutable|false $calendarDate */
        $calendarDate = DateTimeImmutable::createFromFormat('!Y-m-d', $seedEntry['calendarDate'], $moscowTimeZone);

        // Если календарная дата некорректна, не записываем частичный набор данных
        if ($calendarDate === false || ($calendarDate->format('Y-m-d') != $seedEntry['calendarDate'])) {
            throw new RuntimeException('Invalid calendar date for ' . $seedEntry['externalKey']);
        }

        $insertEntry->execute([
            ':externalKey' => $seedEntry['externalKey'],
            ':entryType' => $seedEntry['type'],
            ':title' => $seedEntry['title'],
            ':entryGroup' => $seedEntry['group'],
            ':calendarTimeUtc' => $calendarDate->getTimestamp(),
            ':dateNote' => $seedEntry['dateNote'],
            ':methodNote' => $seedEntry['method'],
            ':bodyText' => $seedEntry['bodyText'],
            ':sourceUrl' => $seedEntry['sourceUrl'],
            ':statusNote' => $seedEntry['statusNote'],
            ':published' => (($seedEntry['published']) ? 1 : 0),
            ':createdTimeUtc' => $currentTimeUtc,
            ':updatedTimeUtc' => $currentTimeUtc,
        ]);
    }

    $database->commit();
} catch (Throwable $exception) {
    $database->rollBack();
    throw $exception;
}

echo 'Imported entries: ' . count($seedEntries) . PHP_EOL;
