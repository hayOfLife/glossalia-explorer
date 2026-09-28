<?

// Если скрипт открыт через веб-сервер, прекращаем выполнение до чтения данных
if (PHP_SAPI != 'cli') { exit(1); }

$siteRoot = dirname(__DIR__);
$configPath = $siteRoot . '/database/config.php';

// Если параметры подключения ещё не заданы, публикация снимка невозможна
if (!is_file($configPath)) { throw new RuntimeException('Create database/config.php from config.example.php'); }

/** Параметры подключения к БД @var array{host: string, database: string, username: string, password: string} $databaseConfig */
$databaseConfig = require $configPath;

/** Соединение с БД @var PDO $database */
$database = new PDO(
    'mysql:host=' . $databaseConfig['host'] . ';dbname=' . $databaseConfig['database'] . ';charset=utf8mb4',
    $databaseConfig['username'],
    $databaseConfig['password'],
    [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]
);

/**
 * Опубликованные записи
 * @var array<int, array{externalKey: string, entryType: string, title: string, entryGroup: string, calendarTimeUtc: int|string, dateNote: string, methodNote: string, bodyText: string, sourceUrl: string, statusNote: string}> $publishedRows
 */
$publishedRows = $database->query(<<< SQL
    SELECT
    external_key AS externalKey, entry_type AS entryType, title,
    entry_group AS entryGroup, calendar_time_utc AS calendarTimeUtc,
    date_note AS dateNote, method_note AS methodNote, body_text AS bodyText,
    source_url AS sourceUrl, status_note AS statusNote
    FROM entry
    WHERE published = 1
    ORDER BY calendar_time_utc, id
SQL)->fetchAll();

$moscowTimeZone = new DateTimeZone('Europe/Moscow');
/**
 * Снимок для посетителей
 * @var array<int, array{externalKey: string, type: string, title: string, group: string, calendarDate: string, dateNote: string, method: string, bodyText: string, sourceUrl: string, statusNote: string, published: bool}> $publicEntries
 */
$publicEntries = [];

foreach ($publishedRows as $publishedRow) {
    $publicEntries[] = [
        'externalKey' => $publishedRow['externalKey'],
        'type' => $publishedRow['entryType'],
        'title' => $publishedRow['title'],
        'group' => $publishedRow['entryGroup'],
        'calendarDate' => (new DateTimeImmutable('@' . $publishedRow['calendarTimeUtc']))->setTimezone($moscowTimeZone)->format('Y-m-d'),
        'dateNote' => $publishedRow['dateNote'],
        'method' => $publishedRow['methodNote'],
        'bodyText' => $publishedRow['bodyText'],
        'sourceUrl' => $publishedRow['sourceUrl'],
        'statusNote' => $publishedRow['statusNote'],
        'published' => true,
    ];
}

$snapshotPath = $siteRoot . '/public_html/data/entries.json';
$temporaryPath = $snapshotPath . '.tmp';
$snapshotJson = json_encode($publicEntries, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
$writtenBytes = file_put_contents($temporaryPath, $snapshotJson . PHP_EOL, LOCK_EX);

// Если временный файл записан не полностью, сохраняем прежний снимок
if ($writtenBytes === false || ($writtenBytes != strlen($snapshotJson . PHP_EOL))) {
    throw new RuntimeException('Cannot write complete publication snapshot');
}

// Если атомарная замена не удалась, сохраняем прежний снимок
if (!rename($temporaryPath, $snapshotPath)) { throw new RuntimeException('Cannot replace publication snapshot'); }

echo 'Published entries: ' . count($publicEntries) . PHP_EOL;
