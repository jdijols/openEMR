<?php

/**
 * Canonical module HTTP paths — must match agentforge/contracts/module-http-paths.json
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Http;

final class ModuleHttpContract
{
    /**
     * @return list<string>
     */
    public static function pathsFromManifest(): array
    {
        $jsonPath = \dirname(__DIR__, 6) . '/agentforge/contracts/module-http-paths.json';
        $raw = file_get_contents($jsonPath);
        if ($raw === false) {
            throw new \RuntimeException('Missing contract file: ' . $jsonPath);
        }

        /** @var array{paths: list<string>} $data */
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        $paths = $data['paths'];
        sort($paths);

        return $paths;
    }

    /**
     * @return list<string>
     */
    public static function pathsFromPhpAnchors(): array
    {
        $paths = [
            ReadIdentity::RELATIVE_SCRIPT_PATH,
            ReadEncounters::RELATIVE_SCRIPT_PATH,
            ReadProblems::RELATIVE_SCRIPT_PATH,
            ReadAllergies::RELATIVE_SCRIPT_PATH,
            ReadMeds::RELATIVE_SCRIPT_PATH,
            ReadVitals::RELATIVE_SCRIPT_PATH,
            ReadLabs::RELATIVE_SCRIPT_PATH,
            ReadNotesMetadata::RELATIVE_SCRIPT_PATH,
            ReadSocialHistory::RELATIVE_SCRIPT_PATH,
            WriteChiefComplaint::RELATIVE_SCRIPT_PATH,
            WriteVitals::RELATIVE_SCRIPT_PATH,
            WriteTobacco::RELATIVE_SCRIPT_PATH,
            WriteAllergy::RELATIVE_SCRIPT_PATH,
            WriteAllergyDelete::RELATIVE_SCRIPT_PATH,
            WriteMedicationAdd::RELATIVE_SCRIPT_PATH,
            WriteMedicationDiscontinue::RELATIVE_SCRIPT_PATH,
            WriteFamilyHistoryAdd::RELATIVE_SCRIPT_PATH,
            WriteDemographicsUpdate::RELATIVE_SCRIPT_PATH,
            WriteObservationFromExtraction::RELATIVE_SCRIPT_PATH,
            UploadDocument::RELATIVE_SCRIPT_PATH,
            ReadDocumentBytes::RELATIVE_SCRIPT_PATH,
            DeleteDocument::RELATIVE_SCRIPT_PATH,
        ];
        sort($paths);

        return $paths;
    }
}
