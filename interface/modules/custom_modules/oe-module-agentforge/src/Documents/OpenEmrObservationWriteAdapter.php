<?php

/**
 * W2 G2-MVP-25 — production adapter implementing ObservationWritePort over a
 * sites/default/documents/agentforge_w2/_obs/ filesystem store keyed by
 * `(patient_uuid, docref_uuid, field_path)`.
 *
 * Filesystem here keeps the MVP demo end-to-end without inventing a new
 * `agentforge_w2_observations` table. Thursday upgrade: persist as proper
 * FHIR Observation rows linked to the DocumentReference via `derivedFrom`.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class OpenEmrObservationWriteAdapter implements ObservationWritePort
{
    public function __construct(private readonly string $storageRoot)
    {
        if (!is_dir($this->storageRoot) && !mkdir($this->storageRoot, 0775, true) && !is_dir($this->storageRoot)) {
            throw new \RuntimeException('Unable to create AgentForge observation store: ' . $this->storageRoot);
        }
    }

    public function existsForKey(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
    ): bool {
        return is_file($this->keyPath($patientUuidCanonical, $docrefUuid, $extractionFieldPath));
    }

    public function insert(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
        array $payload,
    ): void {
        $this->writeRow($patientUuidCanonical, $docrefUuid, $extractionFieldPath, $payload, true);
    }

    public function update(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
        array $payload,
    ): void {
        $this->writeRow($patientUuidCanonical, $docrefUuid, $extractionFieldPath, $payload, false);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function writeRow(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
        array $payload,
        bool $isInsert,
    ): void {
        $body = [
            'patient_uuid_canonical' => $patientUuidCanonical,
            'docref_uuid' => $docrefUuid,
            'extraction_field_path' => $extractionFieldPath,
            'derived_from' => 'DocumentReference/' . $docrefUuid,
            'payload' => $payload,
            $isInsert ? 'created_at' : 'updated_at' => date(\DATE_ATOM),
        ];
        $path = $this->keyPath($patientUuidCanonical, $docrefUuid, $extractionFieldPath);
        if (file_put_contents($path, json_encode($body, JSON_THROW_ON_ERROR)) === false) {
            throw new \RuntimeException('Failed to persist observation for ' . $extractionFieldPath);
        }
    }

    private function keyPath(string $patientUuid, string $docrefUuid, string $fieldPath): string
    {
        $slug = hash('sha256', $patientUuid . '|' . $docrefUuid . '|' . $fieldPath);
        return $this->storageRoot . '/' . $slug . '.json';
    }
}
