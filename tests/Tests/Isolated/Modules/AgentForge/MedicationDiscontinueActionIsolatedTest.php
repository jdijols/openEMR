<?php

/**
 * G2-Early-21 — medication discontinue: payload + happy path + duplicate dedupe.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Write\CompletedWriteProposalLedgerInterface;
use OpenEMR\Modules\AgentForge\Write\ConfirmedWriteOutcome;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\MedicationDiscontinueAction;
use OpenEMR\Modules\AgentForge\Write\MedicationDiscontinuePayload;
use OpenEMR\Modules\AgentForge\Write\PatientMedicationWritePort;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'PatientMedicationWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'MedicationDiscontinuePayload.php';
require_once $writeDir . 'MedicationDiscontinueAction.php';

final class MedicationDiscontinueActionIsolatedTest extends TestCase
{
    public function testRejectsMissingUuid(): void
    {
        [$p, $err] = MedicationDiscontinuePayload::parse([]);
        self::assertNull($p);
        self::assertSame('missing_uuid', $err);
    }

    public function testRejectsMalformedUuid(): void
    {
        [$p, $err] = MedicationDiscontinuePayload::parse(['medication_uuid' => 'not-a-uuid']);
        self::assertNull($p);
        self::assertSame('missing_uuid', $err);
    }

    public function testHappySoftDeleteCallsPortThenLedger(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = [];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget, ?string $sourceDocrefUuid = null): void
            {
                $this->successful[$proposalId] = $writeTarget;
            }
        };

        [$payload] = MedicationDiscontinuePayload::parse([
            'medication_uuid' => '11111111-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(PatientMedicationWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertMedicationForPatient', 'softDeleteMedicationByUuid'])
            ->getMock();
        $port->expects(self::once())
            ->method('softDeleteMedicationByUuid')
            ->with(
                self::equalTo(42),
                self::equalTo('11111111-2222-4333-a444-aaaaaaaaaaaa'),
            )
            ->willReturn(ConfirmedWriteOutcome::accepted(0));
        $port->expects(self::never())->method('insertMedicationForPatient');

        $action = new MedicationDiscontinueAction($port, $ledger);
        $result = $action->execute(42, 'prop-md-1', $payload);

        self::assertTrue($result->isAccepted());
        self::assertSame('medication_discontinue', $ledger->successful['prop-md-1'] ?? '');
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = MedicationDiscontinuePayload::parse([
            'medication_uuid' => '11111111-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-md-dup' => 'medication_discontinue'];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget, ?string $sourceDocrefUuid = null): void
            {
            }
        };

        $port = $this->getMockBuilder(PatientMedicationWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertMedicationForPatient', 'softDeleteMedicationByUuid'])
            ->getMock();
        $port->expects(self::never())->method('softDeleteMedicationByUuid');

        $action = new MedicationDiscontinueAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(42, 'prop-md-dup', $payload);
    }
}
