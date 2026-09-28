CREATE TABLE entry (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    external_key VARCHAR(32) NOT NULL,
    entry_type VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL,
    entry_group VARCHAR(80) NOT NULL,
    -- Полночь по Москве хранится в секундах UTC и не обозначает время аудиозаписи
    calendar_time_utc BIGINT SIGNED NOT NULL,
    date_note VARCHAR(255) NOT NULL,
    method_note TEXT NOT NULL,
    body_text MEDIUMTEXT NOT NULL,
    source_url VARCHAR(512) NOT NULL,
    status_note TEXT NOT NULL,
    published TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_time_utc BIGINT SIGNED NOT NULL,
    updated_time_utc BIGINT SIGNED NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq__e__external_key (external_key),
    KEY idx__e__published__calendar_time_utc (published, calendar_time_utc),
    KEY idx__e__entry_type__published__calendar_time_utc (entry_type, published, calendar_time_utc)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
