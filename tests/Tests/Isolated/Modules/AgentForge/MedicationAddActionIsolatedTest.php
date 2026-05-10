<?php

/**
 * G2-Early-20 — medication add: payload parsing + happy path + duplicate dedupe.
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
use OpenEMR\Modules\AgentForge\Write\MedicationAddAction;
use OpenEMR\Modules\AgentForge\Write\MedicationAddPayload;
use OpenEMR\Modules\AgentForge\Write\PatientMedicationWritePort;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'PatientMedicationWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'MedicationAddPayload.php';
require_once $writeDir . 'MedicationAddAction.php';

final class MedicationAddActionIsolatedTest extends TestCase
{
    public function testRejectsUnknownTopLevelKey(): void
    {
        [$p, $err] = MedicationAddPayload::parse(['name' => 'Lisinopril 10mg', 'unknown_field' => 'value']);
        self::assertNull($p);
        self::assertSame('unsupported_payload', $err);
    }

    public function testRejectsMissingName(): void
    {
        [$p, $err] = MedicationAddPayload::parse(['dose' => '10 mg']);
        self::assertNull($p);
        self::assertSame('invalid_payload', $err);
    }

    public function testHappyParseWithFullDoseFrequency(): void
    {
        [$payload, $err] = MedicationAddPayload::parse([
            'name' => 'Lisinopril',
            'dose' => '10 mg',
            'frequency' => 'PO daily',
        ]);
        self::assertNull($err);
        self::assertNotNull($payload);
        self::assertSame('Lisinopril', $payload->name());
        self::assertSame('10 mg · PO daily', $payload->commentsBody());
    }

    public function testHappyAddCallsInsertThenLedger(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public bool $marked = false;

            /** @var array<string, string> */
            public array $successful = [];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget, ?string $sourceDocrefUuid = null): void
            {
                $this->marked = true;
                $this->successful[$proposalId] = $writeTarget;
            }
        };

        [$payload] = MedicationAddPayload::parse([
            'name' => 'Atorvastatin',
            'dose' => '40 mg',
            'frequency' => 'PO HS',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(PatientMedicationWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertMedicationForPatient', 'softDeleteMedicationByUuid'])
            ->getMock();
        $port->expects(self::once())
            ->method('insertMedicationForPatient')
            ->with(
                self::equalTo(42),
                self::callback(static function ($f): bool {
                    return is_array($f)
                        && ($f['title'] ?? null) === 'Atorvastatin'
                        && ($f['comments'] ?? null) === '40 mg · PO HS';
                }),
            )
            ->willReturn(ConfirmedWriteOutcome::accepted(0));
        $port->expects(self::never())->method('softDeleteMedicationByUuid');

        $action = new MedicationAddAction($port, $ledger);
        $result = $action->execute(42, 'prop-med-1', $payload);

        self::assertTrue($result->isAccepted());
        self::assertTrue($ledger->marked);
        self::assertSame('medication_add', $ledger->successful['prop-med-1'] ?? '');
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = MedicationAddPayload::parse(['name' => 'Atorvastatin', 'dose' => '40 mg']);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-med-dup' => 'medication_add'];

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
        $port->expects(self::never())->method('insertMedicationForPatient');
        $port->expects(self::never())->method('softDeleteMedicationByUuid');

        $action = new MedicationAddAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(42, 'prop-med-dup', $payload);
    }
}
