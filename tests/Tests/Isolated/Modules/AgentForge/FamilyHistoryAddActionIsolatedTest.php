<?php

/**
 * G2-Early-23 — family history add: relation→column mapping + happy path + dedupe.
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
use OpenEMR\Modules\AgentForge\Write\FamilyHistoryAddAction;
use OpenEMR\Modules\AgentForge\Write\FamilyHistoryAddPayload;
use OpenEMR\Modules\AgentForge\Write\PatientFamilyHistoryWritePort;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'PatientFamilyHistoryWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'FamilyHistoryAddPayload.php';
require_once $writeDir . 'FamilyHistoryAddAction.php';

final class FamilyHistoryAddActionIsolatedTest extends TestCase
{
    public function testRejectsUnknownRelation(): void
    {
        [$p, $err] = FamilyHistoryAddPayload::parse(['relation' => 'cousin', 'condition' => 'T2DM']);
        self::assertNull($p);
        self::assertSame('unsupported_payload', $err);
    }

    public function testMapsBrotherToHistorySiblings(): void
    {
        [$p, $err] = FamilyHistoryAddPayload::parse(['relation' => 'brother', 'condition' => 'CAD']);
        self::assertNull($err);
        self::assertNotNull($p);
        self::assertSame('history_siblings', $p->columnName());
        self::assertSame('brother', $p->relation());
        self::assertSame('CAD', $p->condition());
    }

    public function testMapsMotherToHistoryMother(): void
    {
        [$p] = FamilyHistoryAddPayload::parse(['relation' => 'mother', 'condition' => 'T2DM']);
        self::assertNotNull($p);
        self::assertSame('history_mother', $p->columnName());
    }

    public function testRejectsEmptyCondition(): void
    {
        [$p, $err] = FamilyHistoryAddPayload::parse(['relation' => 'father', 'condition' => '']);
        self::assertNull($p);
        self::assertSame('invalid_payload', $err);
    }

    public function testHappyAppendCallsPortThenLedger(): void
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

        [$payload] = FamilyHistoryAddPayload::parse([
            'relation' => 'father',
            'condition' => 'Hypertension',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(PatientFamilyHistoryWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['appendFamilyHistoryEntry'])
            ->getMock();
        $port->expects(self::once())
            ->method('appendFamilyHistoryEntry')
            ->with(self::equalTo(42), self::equalTo('history_father'), self::equalTo('Hypertension'))
            ->willReturn(ConfirmedWriteOutcome::accepted(0));

        $action = new FamilyHistoryAddAction($port, $ledger);
        $result = $action->execute(42, 'prop-fh-1', $payload);

        self::assertTrue($result->isAccepted());
        self::assertSame('family_history_add', $ledger->successful['prop-fh-1'] ?? '');
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = FamilyHistoryAddPayload::parse([
            'relation' => 'mother',
            'condition' => 'T2DM',
        ]);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-fh-dup' => 'family_history_add'];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(PatientFamilyHistoryWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['appendFamilyHistoryEntry'])
            ->getMock();
        $port->expects(self::never())->method('appendFamilyHistoryEntry');

        $action = new FamilyHistoryAddAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(42, 'prop-fh-dup', $payload);
    }
}
