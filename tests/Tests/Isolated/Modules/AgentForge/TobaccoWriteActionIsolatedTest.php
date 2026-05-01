<?php

/**
 * Gate 4 G4-03 — tobacco confirmed-write harness + strict payload enum parsing.
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
use OpenEMR\Modules\AgentForge\Write\PatientTobaccoHistoryWritePort;
use OpenEMR\Modules\AgentForge\Write\TobaccoWriteAction;
use OpenEMR\Modules\AgentForge\Write\TobaccoWritePayload;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'PatientTobaccoHistoryWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'TobaccoWritePayload.php';
require_once $writeDir . 'TobaccoWriteAction.php';

final class TobaccoWriteActionIsolatedTest extends TestCase
{
    /** Pipe encoding matches SmokingStatusType (HIS demographics / history tobacco field). */
    public function testNeverSmokerPipeEncoding(): void
    {
        [$p, $e] = TobaccoWritePayload::parse(['status' => 'never_smoker']);
        self::assertNull($e);
        self::assertSame('|nevertobacco||4|0', $p?->toHistoryDataTobaccoValue());
    }

    /** PRD `unknown` → HIS list option id 9 (“Unknown if ever smoked”). */
    public function testUnknownMapsToListNine(): void
    {
        [$p, $e] = TobaccoWritePayload::parse(['status' => 'unknown']);
        self::assertNull($e);
        self::assertSame('|0||9|0', $p?->toHistoryDataTobaccoValue());
    }

    /** Enum violation path (PRD strict status vocabulary). */
    public function testInvalidStatusRejectedAtParse(): void
    {
        [$p, $e] = TobaccoWritePayload::parse(['status' => 'former_smoking']);
        self::assertNull($p);
        self::assertSame('invalid_tobacco_status', $e);
    }

    /** Unsupported keys mirror allergy-delete-style §4.7.4 guard tone. */
    public function testUnknownPayloadKeyParsesUnsupported(): void
    {
        [$p, $e] = TobaccoWritePayload::parse(['status' => 'never_smoker', 'action' => 'delete']);
        self::assertNull($p);
        self::assertSame('unsupported_payload', $e);
    }

    public function testHappyPathInsertsPatientTobaccoAndMarksLedger(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public bool $wasMarkedSuccessful = false;

            /** @var array<string, string> */
            public array $successful = [];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
                $this->wasMarkedSuccessful = true;
                $this->successful[$proposalId] = $writeTarget;
            }
        };

        [$payload, $err] = TobaccoWritePayload::parse(['status' => 'current_every_day']);
        self::assertNotNull($payload);
        self::assertNull($err);

        $port = $this->getMockBuilder(PatientTobaccoHistoryWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertTobaccoForPatient'])
            ->getMock();

        $expectedPipe = '|currenttobacco||1|0';

        $port->expects(self::once())
            ->method('insertTobaccoForPatient')
            ->with(self::equalTo(99), self::equalTo($expectedPipe))
            ->willReturn(ConfirmedWriteOutcome::accepted(0));

        $action = new TobaccoWriteAction($port, $ledger);

        $result = $action->execute(99, 'prop-z1', $payload);

        self::assertInstanceOf(ConfirmedWriteOutcome::class, $result);
        self::assertTrue($result->isAccepted());
        self::assertTrue($ledger->wasMarkedSuccessful);
        self::assertSame('tobacco', $ledger->successful['prop-z1'] ?? '');
    }

    public function testDuplicateProposalSkipsPortSecondCall(): void
    {
        [$payload] = TobaccoWritePayload::parse(['status' => 'former_smoker']);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-dupe' => 'tobacco'];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(PatientTobaccoHistoryWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertTobaccoForPatient'])
            ->getMock();

        $port->expects(self::never())->method('insertTobaccoForPatient');

        $action = new TobaccoWriteAction($port, $ledger);

        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(1, 'prop-dupe', $payload);
    }

    /** OpenEMR / service rejects insert — ledger untouched. */
    public function testOpenEmrRejectedWhenPortReturnsRejected(): void
    {
        [$payload] = TobaccoWritePayload::parse(['status' => 'unknown']);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = [];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return false;
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
                $this->successful[$proposalId] = $writeTarget;
            }
        };

        $port = $this->getMockBuilder(PatientTobaccoHistoryWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertTobaccoForPatient'])
            ->getMock();

        $port->expects(self::once())
            ->method('insertTobaccoForPatient')
            ->willReturn(ConfirmedWriteOutcome::openemrRejected('write failed'));

        $action = new TobaccoWriteAction($port, $ledger);

        $result = $action->execute(2, 'prop-r1', $payload);

        self::assertFalse($result->isAccepted());
        self::assertSame('write failed', $result->failureReason());
        self::assertSame([], $ledger->successful);
    }
}
