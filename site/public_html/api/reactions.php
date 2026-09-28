<?

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Vary: Origin');

$allowedOrigin = 'https://glossalia-explorer.tuqo.ru';
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';

// Если запрос пришёл с основного сайта, разрешаем браузеру прочитать ответ
if ($requestOrigin === $allowedOrigin) { header('Access-Control-Allow-Origin: ' . $allowedOrigin); }

// Если сторонний сайт пытается отправить голос, не изменяем данные
if (($_SERVER['REQUEST_METHOD'] === 'POST') && ($requestOrigin !== $allowedOrigin)) {
    http_response_code(403);
    echo '{"error":"Origin is not allowed"}';
    exit;
}

// Если метод не предназначен для чтения или голосования, прекращаем обработку
if (!in_array($_SERVER['REQUEST_METHOD'], ['GET', 'POST'], true)) {
    header('Allow: GET, POST');
    http_response_code(405);
    echo '{"error":"Method is not allowed"}';
    exit;
}

$allowedKeys = ['T00014', 'T00016', 'T00017', 'T00018', 'T00019', 'T00020'];
$requestBody = null;

// Если посетитель голосует, проверяем размер и поля до открытия файла
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $requestLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);

    // Если тело слишком велико, не читаем и не сохраняем его
    if ($requestLength > 256) {
        http_response_code(413);
        echo '{"error":"Request is too large"}';
        exit;
    }

    $requestBody = json_decode(file_get_contents('php://input'), true);

    // Если голос или идентификатор не соответствует ожидаемому формату, отклоняем запрос
    if (
        !is_array($requestBody)
        || !isset($requestBody['key'], $requestBody['vote'], $requestBody['voterId'])
        || !in_array($requestBody['key'], $allowedKeys, true)
        || !in_array($requestBody['vote'], [-1, 0, 1], true)
        || !is_string($requestBody['voterId'])
        || !preg_match('/^[0-9a-f]{32}$/', $requestBody['voterId'])
    ) {
        http_response_code(400);
        echo '{"error":"Invalid reaction"}';
        exit;
    }
}

// Файл вне public_html не доступен посетителям напрямую
$storagePath = dirname(__DIR__, 2) . '/reactions.json';
$storageFile = @fopen($storagePath, 'c+');

// Если хостинг не позволяет сохранить данные, сообщаем о недоступности оценок
if ($storageFile === false) {
    http_response_code(503);
    echo '{"error":"Reactions are unavailable"}';
    exit;
}

try {
    // Исключительная блокировка сохраняет целостность файла при одновременных голосах
    if (!flock($storageFile, LOCK_EX)) { throw new RuntimeException('Cannot lock reactions'); }

    $storedJson = stream_get_contents($storageFile);
    $storedVotes = ($storedJson === '') ? [] : json_decode($storedJson, true);

    // Если сохранённый файл повреждён, не обнуляем накопленные оценки
    if (!is_array($storedVotes)) { throw new RuntimeException('Invalid reactions storage'); }

    // Если получен голос, заменяем или снимаем выбор того же браузера
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $entryKey = $requestBody['key'];
        $voterHash = hash('sha256', $requestBody['voterId']);

        // Если голос снят, удаляем прежний выбор
        if ($requestBody['vote'] === 0) {
            unset($storedVotes[$entryKey][$voterHash]);
        } else {
            $storedVotes[$entryKey][$voterHash] = $requestBody['vote'];
        }

        $updatedJson = json_encode($storedVotes);

        // Если данные не удалось сериализовать, оставляем прежний файл
        if ($updatedJson === false) { throw new RuntimeException('Cannot encode reactions'); }

        rewind($storageFile);

        // Если файл нельзя записать полностью, возвращаем ошибку
        if (fwrite($storageFile, $updatedJson) !== strlen($updatedJson) || !ftruncate($storageFile, strlen($updatedJson))) {
            throw new RuntimeException('Cannot save reactions');
        }

        fflush($storageFile);
    }

    $counts = [];

    foreach ($allowedKeys as $entryKey) {
        $likes = 0;
        $dislikes = 0;

        foreach ($storedVotes[$entryKey] ?? [] as $vote) {
            // Если выбор положительный, увеличиваем число лайков
            if ($vote === 1) { $likes++; }

            // Если выбор отрицательный, увеличиваем число дизлайков
            if ($vote === -1) { $dislikes++; }
        }

        $counts[$entryKey] = ['likes' => $likes, 'dislikes' => $dislikes];
    }

    $response = ($_SERVER['REQUEST_METHOD'] === 'POST') ? $counts[$requestBody['key']] : $counts;
    echo json_encode($response);
} catch (Throwable $exception) {
    http_response_code(503);
    echo '{"error":"Reactions are unavailable"}';
} finally {
    flock($storageFile, LOCK_UN);
    fclose($storageFile);
}
