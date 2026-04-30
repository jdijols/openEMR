<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
http_response_code(503);
echo json_encode(['error' => 'not_implemented', 'gate' => 0], JSON_THROW_ON_ERROR);
