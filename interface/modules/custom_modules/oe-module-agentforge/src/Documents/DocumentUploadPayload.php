<?php

/**
 * W2 G2-MVP-20 — parsed payload for an `attach_and_extract` document upload.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final readonly class DocumentUploadPayload
{
    /** @var list<string> */
    public const SUPPORTED_DOC_TYPES = ['lab_pdf', 'intake_form'];

    /** @var list<string> */
    public const SUPPORTED_MIMES = [
        'application/pdf',
        'image/png',
        'image/jpeg',
    ];

    public const MAX_FILE_BYTES = 10 * 1024 * 1024;     // 10 MB

    public function __construct(
        public string $docType,                          // 'lab_pdf' | 'intake_form'
        public string $mimeType,                         // application/pdf, image/png, image/jpeg
        public int $fileSize,                            // bytes; 1 <= n <= MAX_FILE_BYTES
        public string $sha256,                           // hex(64), pre-computed
        public string $fileBytes,                        // raw bytes (kept off audit log)
    ) {
    }

    /**
     * Parse a raw multipart payload into a typed payload, or return a typed
     * error code suitable for an HTTP 400 response.
     *
     * @param array<string, mixed>|null $rawPayload
     * @return array{0: ?self, 1: ?string}
     */
    public static function parse(?array $rawPayload): array
    {
        if ($rawPayload === null) {
            return [null, 'invalid_request'];
        }

        $docType = $rawPayload['doc_type'] ?? null;
        if (!is_string($docType) || !in_array($docType, self::SUPPORTED_DOC_TYPES, true)) {
            return [null, 'unsupported_payload'];
        }

        $mimeType = $rawPayload['mime_type'] ?? null;
        if (!is_string($mimeType) || !in_array($mimeType, self::SUPPORTED_MIMES, true)) {
            return [null, 'unsupported_payload'];
        }

        $bytes = $rawPayload['file_bytes'] ?? null;
        if (!is_string($bytes) || $bytes === '') {
            return [null, 'invalid_request'];
        }

        $fileSize = strlen($bytes);
        if ($fileSize > self::MAX_FILE_BYTES) {
            return [null, 'file_too_large'];
        }

        // Computed locally so the caller cannot poison the idempotency key.
        $sha256 = hash('sha256', $bytes);

        return [new self($docType, $mimeType, $fileSize, $sha256, $bytes), null];
    }

    /**
     * Audit-safe metadata payload. Excludes raw bytes and full hash; emits a
     * truncated sha256 prefix so an operator can correlate without exposing
     * the full content fingerprint.
     *
     * @return array<string, mixed>
     */
    public function toAuditPayload(string $docrefUuid, bool $wasReUpload): array
    {
        return [
            'docref_uuid' => $docrefUuid,
            'doc_type' => $this->docType,
            'mime' => $this->mimeType,
            'size_bytes' => $this->fileSize,
            'sha256_prefix' => substr($this->sha256, 0, 8),
            're_upload' => $wasReUpload,
        ];
    }
}
