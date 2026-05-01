<?php

/**
 * Gate 2 — Source pack contract (PRD §4.5.1) + Gate 3 factory completeness.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/SourcePackFactory.php';

use OpenEMR\Modules\AgentForge\Context\SourcePackFactory;
use PHPUnit\Framework\TestCase;

final class SourcePackFactoryTest extends TestCase
{
    public function testIdentityPackHasRequiredKeys(): void
    {
        $asOf = new \DateTimeImmutable('2026-04-30T14:00:00+00:00');
        $pack = SourcePackFactory::identity($asOf, 12, 'abc-def');
        self::assertSame('identity', $pack['resource_family']);
        self::assertSame('patient_data', $pack['table']);
        self::assertSame(12, $pack['row_id']);
        self::assertSame('abc-def', $pack['uuid']);
        self::assertSame('2026-04-30T14:00:00+00:00', $pack['as_of']);
        self::assertArrayHasKey('navigation_hint', $pack);
        self::assertSame('chart_section', $pack['navigation_hint']['kind']);
    }

    public function testAllergyPackHasRequiredKeys(): void
    {
        $asOf = new \DateTimeImmutable('2026-04-30T15:00:00+00:00');
        $pack = SourcePackFactory::allergy(9, 'allergy-uuid', $asOf);
        self::assertSame('allergy', $pack['resource_family']);
        self::assertSame('lists', $pack['table']);
        self::assertSame(9, $pack['row_id']);
        self::assertSame('allergy-uuid', $pack['uuid']);
    }

    public function testGate3FactoriesEmitNavigationHintsAndPrimitives(): void
    {
        $asOf = new \DateTimeImmutable('2026-05-01T12:00:00+00:00');

        /** @var list<array{string, array<string,mixed>}> */
        $packs = [
            ['encounter', SourcePackFactory::encounter(42, 'eu-uuid', $asOf)],
            ['problem', SourcePackFactory::problem(77, 'p-uuid', $asOf)],
            ['medication', SourcePackFactory::medication('prescriptions', 101, 'm-uuid', $asOf)],
            ['vital', SourcePackFactory::vital(500, 'v-uuid', $asOf)],
            ['lab', SourcePackFactory::lab(9001, 'l-uuid', $asOf)],
            ['note', SourcePackFactory::note(303, 'n-uuid', $asOf)],
            ['social_history', SourcePackFactory::socialHistory(44, 'sh-uuid', $asOf)],
        ];

        foreach ($packs as [$family, $pack]) {
            self::assertSame($family, $pack['resource_family']);
            foreach (['resource_family', 'table', 'row_id', 'uuid', 'as_of', 'retrieval_path', 'navigation_hint'] as $key) {
                self::assertArrayHasKey($key, $pack, $family . ' missing ' . $key);
            }

            self::assertIsArray($pack['navigation_hint']);
            self::assertArrayHasKey('kind', $pack['navigation_hint']);
        }
    }
}
