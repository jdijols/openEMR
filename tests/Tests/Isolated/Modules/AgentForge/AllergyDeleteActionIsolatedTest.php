<?php

/**
 * G2-Early-22 — allergy soft-delete action.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Write\AllergyDeleteAction;
use OpenEMR\Modules\AgentForge\Write\AllergyDeletePayload;
use OpenEMR\Modules\AgentForge\Write\CompletedWriteProposalLedgerInterface;
use OpenEMR\Modules\AgentForge\Write\ConfirmedWriteOutcome;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\PatientAllergyWritePort;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'PatientAllergyWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'AllergyDeletePayload.php';
require_once $writeDir . 'AllergyDeleteAction.php';

final class AllergyDeleteActionIsolatedTest extends TestCase
{
    public function testRejectsMissingUuid(): void
    {
        [$p, $err] = AllergyDeletePayload::parse([]);
        self::assertNull($p);
        self::assertSame('missing_uuid', $err);
    }

    public function testHappyDeleteCallsPortThenLedger(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = [];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
                $this->successful[$proposalId] = $writeTarget;
            }
        };

        [$payload] = AllergyDeletePayload::parse([
            'allergy_uuid' => '22222222-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(PatientAllergyWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertAllergy', 'updateAllergy', 'softDeleteAllergyByUuid'])
            ->getMock();
        $port->expects(self::once())
            ->method('softDeleteAllergyByUuid')
            ->with(self::equalTo(42), self::equalTo('22222222-2222-4333-a444-aaaaaaaaaaaa'))
            ->willReturn(ConfirmedWriteOutcome::accepted(0));

        $action = new AllergyDeleteAction($port, $ledger);
        $result = $action->execute(42, 'prop-ad-1', $payload);

        self::assertTrue($result->isAccepted());
        self::assertSame('allergy_delete', $ledger->successful['prop-ad-1'] ?? '');
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = AllergyDeletePayload::parse([
            'allergy_uuid' => '22222222-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-ad-dup' => 'allergy_delete'];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(PatientAllergyWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertAllergy', 'updateAllergy', 'softDeleteAllergyByUuid'])
            ->getMock();
        $port->expects(self::never())->method('softDeleteAllergyByUuid');

        $action = new AllergyDeleteAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(42, 'prop-ad-dup', $payload);
    }
}
