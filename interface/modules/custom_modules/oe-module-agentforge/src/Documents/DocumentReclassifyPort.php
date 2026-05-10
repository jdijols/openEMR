<?php

/**
 * Persistence port for the post-extraction reclassify hook (Clinical Copilot
 * inbox → stock OpenEMR category). Looks up the OpenEMR `documents.id`
 * stamped on the AgentForge sidecar at upload time, replaces the row's
 * `categories_to_documents` link, and reports back which category id won.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface DocumentReclassifyPort
{
    public const TARGET_LAB_REPORT = 'lab_report';
    public const TARGET_PATIENT_INFORMATION = 'patient_information';
    public const TARGET_CLINICAL_COPILOT = 'clinical_copilot';

    /** @var list<string> */
    public const SUPPORTED_TARGETS = [
        self::TARGET_LAB_REPORT,
        self::TARGET_PATIENT_INFORMATION,
        self::TARGET_CLINICAL_COPILOT,
    ];

    /**
     * Move the document associated with `$docrefUuid` into the
     * `$targetCategory` folder. Idempotent — calling twice with the same
     * target is a no-op accept.
     *
     * Returns the chosen `categories.id` on success; null when the OpenEMR
     * document mapping is unknown (registrar projection failed at upload
     * time, or the docref was deleted) — the caller treats null as a soft
     * skip, never an error.
     */
    public function reclassify(string $docrefUuid, string $targetCategory): ?int;
}
