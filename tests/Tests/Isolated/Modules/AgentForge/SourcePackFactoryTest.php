<?php

/**
 * Gate 2 — Source pack contract (PRD §4.5.1).
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
}
