<?php

/**
 * W2 G2-MVP-21..24 — production adapter implementing DocumentUploadPort +
 * DocumentBytesPort over a sites/default/documents/agentforge_w2/ filesystem
 * store.
 *
 * Layout:
 *   sites/default/documents/agentforge_w2/{uuid}.bin      — raw source bytes
 *   sites/default/documents/agentforge_w2/{uuid}.json     — metadata sidecar
 *
 * Idempotency on `(patient_uuid_canonical, sha256)` is a linear scan of the
 * sidecar JSON files. The MVP cohort is 4 patients × ≤2 documents each, so
 * scan latency is negligible. A proper `documents` / FHIR DocumentReference
 * round-trip is a Thursday-grade refinement; the MVP brief only requires
 * "store the source document in OpenEMR" and "round-trip without duplicate
 * or untraceable records" — both satisfied here at file-system grain.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class OpenEmrDocumentRepository implements DocumentUploadPort, DocumentBytesPort, DocumentDeletePort
{
    public function __construct(private readonly string $storageRoot)
    {
        if (!is_dir($this->storageRoot) && !mkdir($this->storageRoot, 0775, true) && !is_dir($this->storageRoot)) {
            throw new \RuntimeException('Unable to create AgentForge document store: ' . $this->storageRoot);
        }
    }

    public function findExistingDocRef(string $patientUuidCanonical, string $sha256): ?string
    {
        foreach (glob($this->storageRoot . '/*.json') ?: [] as $sidecarPath) {
            $meta = $this->readSidecar($sidecarPath);
            if ($meta === null) {
                continue;
            }
            if (isset($meta['deleted_at'])) {
                continue;
            }
            if (
                ($meta['patient_uuid_canonical'] ?? '') === $patientUuidCanonical
                && ($meta['sha256'] ?? '') === $sha256
            ) {
                return (string) ($meta['docref_uuid'] ?? '');
            }
        }
        return null;
    }

    public function mintAndPersistDocument(
        string $patientUuidCanonical,
        DocumentUploadPayload $payload,
    ): string {
        $docrefUuid = $this->mintUuid();

        $bytesPath = $this->bytesPath($docrefUuid);
        if (file_put_contents($bytesPath, $payload->fileBytes) === false) {
            throw new \RuntimeException('Failed to write document bytes for ' . $docrefUuid);
        }

        $sidecar = [
            'docref_uuid' => $docrefUuid,
            'patient_uuid_canonical' => $patientUuidCanonical,
            'sha256' => $payload->sha256,
            'doc_type' => $payload->docType,
            'mime' => $payload->mimeType,
            'size' => $payload->fileSize,
            'created_at' => date(\DATE_ATOM),
        ];
        if (file_put_contents($this->sidecarPath($docrefUuid), json_encode($sidecar, JSON_THROW_ON_ERROR)) === false) {
            throw new \RuntimeException('Failed to write document metadata for ' . $docrefUuid);
        }

        return $docrefUuid;
    }

    public function fetch(string $docrefUuid, string $expectedPatientUuidCanonical): ?DocumentBytesResult
    {
        $sidecarPath = $this->sidecarPath($docrefUuid);
        $meta = $this->readSidecar($sidecarPath);
        if ($meta === null) {
            return null;
        }

        if (isset($meta['deleted_at'])) {
            return null;
        }

        if (($meta['patient_uuid_canonical'] ?? '') !== $expectedPatientUuidCanonical) {
            throw new CrossPatientDocumentAccessException();
        }

        $bytesPath = $this->bytesPath($docrefUuid);
        if (!is_file($bytesPath)) {
            return null;
        }

        $bytes = file_get_contents($bytesPath);
        if ($bytes === false) {
            return null;
        }

        return new DocumentBytesResult(
            $bytes,
            (string) ($meta['mime'] ?? 'application/octet-stream'),
            (int) ($meta['size'] ?? strlen($bytes)),
            (string) ($meta['doc_type'] ?? ''),
        );
    }

    public function softDeleteDocRefAndCascadeObservations(
        string $docrefUuid,
        string $expectedPatientUuidCanonical,
    ): array {
        $sidecarPath = $this->sidecarPath($docrefUuid);
        $meta = $this->readSidecar($sidecarPath);
        if ($meta === null) {
            return ['ok' => false, 'observations_deleted' => 0];
        }

        if (($meta['patient_uuid_canonical'] ?? '') !== $expectedPatientUuidCanonical) {
            // Cross-patient soft-delete attempt — surface as not-found to avoid leaking the
            // existence of the other patient's DocRef. The binding check happens at the HTTP
            // layer too; this is defense-in-depth.
            return ['ok' => false, 'observations_deleted' => 0];
        }

        if (isset($meta['deleted_at'])) {
            // Idempotent — already deleted. Treat as accept.
            return ['ok' => true, 'observations_deleted' => 0];
        }

        $meta['deleted_at'] = date(\DATE_ATOM);
        if (file_put_contents($sidecarPath, json_encode($meta, JSON_THROW_ON_ERROR)) === false) {
            throw new \RuntimeException('Failed to soft-delete document for ' . $docrefUuid);
        }

        $obsRoot = $this->storageRoot . '/_obs';
        $observationsDeleted = 0;
        if (is_dir($obsRoot)) {
            foreach (glob($obsRoot . '/*.json') ?: [] as $obsPath) {
                $obsMeta = $this->readSidecar($obsPath);
                if ($obsMeta === null) {
                    continue;
                }
                if (($obsMeta['docref_uuid'] ?? '') !== $docrefUuid) {
                    continue;
                }
                if (isset($obsMeta['deleted_at'])) {
                    continue;
                }

                $obsMeta['deleted_at'] = $meta['deleted_at'];
                if (file_put_contents($obsPath, json_encode($obsMeta, JSON_THROW_ON_ERROR)) !== false) {
                    $observationsDeleted++;
                }
            }
        }

        return ['ok' => true, 'observations_deleted' => $observationsDeleted];
    }

    private function bytesPath(string $uuid): string
    {
        return $this->storageRoot . '/' . $uuid . '.bin';
    }

    private function sidecarPath(string $uuid): string
    {
        return $this->storageRoot . '/' . $uuid . '.json';
    }

    /**
     * @return array<string, mixed>|null
     */
    private function readSidecar(string $path): ?array
    {
        if (!is_file($path)) {
            return null;
        }
        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }
        try {
            $decoded = json_decode($raw, true, 16, JSON_THROW_ON_ERROR);
            return is_array($decoded) ? $decoded : null;
        } catch (\JsonException) {
            return null;
        }
    }

    /**
     * Mint a UUIDv4-shaped identifier. Production would use UuidRegistry, but
     * the MVP demo only needs uniqueness, not full registry round-trip.
     */
    private function mintUuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12),
        );
    }
}
