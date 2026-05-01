<?php

/**
 * Gate 4 G4-01 — chief complaint confirmed write harness (adapted §4.7.4 vitals scenarios).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Write\ChiefComplaintPayload;
use OpenEMR\Modules\AgentForge\Write\ChiefComplaintWriteAction;
use OpenEMR\Modules\AgentForge\Write\CompletedWriteProposalLedgerInterface;
use OpenEMR\Modules\AgentForge\Write\ConfirmedWriteOutcome;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\EncounterChiefComplaintPort;
use OpenEMR\Validators\ProcessingResult;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'EncounterChiefComplaintPort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'ChiefComplaintPayload.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'ChiefComplaintWriteAction.php';

final class ChiefComplaintWriteActionIsolatedTest extends TestCase
{
    private function fixturePayload(): ChiefComplaintPayload
    {
        [$payload, $err] = ChiefComplaintPayload::parse(['reason' => 'Cough × 5 days']);

        self::assertNotNull($payload);
        self::assertNull($err);

        return $payload;
    }

    /** Scenario: UC-B chief complaint write happy path → encounter port persists + ledger marks duplicate guard. */
    public function testHappyPathCallsUpdateEncounterThenLedger(): void
    {
        [$payload] = ChiefComplaintPayload::parse(['reason' => 'Sore throat']);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public bool $wasMarkedSuccessful = false;

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

        $encRow = [
            'puuid' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'euuid' => '11111111-2222-3333-4444-555555555555',
            'facility_id' => 1,
        ];

        $pr = new ProcessingResult();
        $pr->setData([['eid' => 42]]);

        $port = $this->getMockBuilder(EncounterChiefComplaintPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getOneByPidEid', 'updateEncounterReason'])
            ->getMock();
        $port->expects(self::once())->method('getOneByPidEid')->with(99, 42)->willReturn($encRow);
        $port->expects(self::once())->method('updateEncounterReason')->willReturn($pr);

        $action = new ChiefComplaintWriteAction($port, $ledger);

        $result = $action->execute(99, 42, 'prop-77', 'reynolds', 'Default', $payload);

        self::assertInstanceOf(ConfirmedWriteOutcome::class, $result);
        self::assertTrue($result->isAccepted());
        self::assertTrue($ledger->wasMarkedSuccessful);
        self::assertSame('chief_complaint', $ledger->successful['prop-77'] ?? '');
    }

    /** Scenario duplicate proposal execution → second POST rejects before EncounterService executes again. */
    public function testDuplicateProposalSkipsEncounterServiceSecondCall(): void
    {
        [$payload] = ChiefComplaintPayload::parse(['reason' => 'Fever']);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public array $successful = [];

            public function __construct()
            {
                $this->successful['prop-77'] = 'chief_complaint';
            }

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(EncounterChiefComplaintPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getOneByPidEid', 'updateEncounterReason'])
            ->getMock();
        $port->expects(self::never())->method('getOneByPidEid');
        $port->expects(self::never())->method('updateEncounterReason');

        $action = new ChiefComplaintWriteAction($port, $ledger);

        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(1, 42, 'prop-77', 'drx', 'Default', $payload);
    }

    /** Encounter row missing ⇒ accepted:false with safe denial message (adapted §4.7.4 encounter not found path). */
    public function testOpenEmrRejectedWhenEncounterRowMissing(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
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

        $port = $this->getMockBuilder(EncounterChiefComplaintPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getOneByPidEid', 'updateEncounterReason'])
            ->getMock();
        $port->expects(self::once())->method('getOneByPidEid')->willReturn([]);
        $port->expects(self::never())->method('updateEncounterReason');

        $action = new ChiefComplaintWriteAction($port, $ledger);

        $result = $action->execute(2, 99, 'prop-88', 'drx', 'Default', self::fixturePayload());

        self::assertFalse($result->isAccepted());
        self::assertSame('encounter not found', $result->failureReason());
        self::assertSame([], $ledger->successful);
    }

    /** Adapted allergy-delete scenario ⇒ reject unknown payload verbs with unsupported_write sentinel. */
    public function testPayloadWithDeleteActionParsesUnsupported(): void
    {
        [$parsed, $err] = ChiefComplaintPayload::parse(['action' => 'delete']);

        self::assertNull($parsed);
        self::assertSame('unsupported_payload', $err);
    }

    /**
     * Regression for the "encounter not found" mystery: EncounterService::updateEncounter sometimes
     * returns a raw string (sensitivities ACL deny) instead of a ProcessingResult. The action must
     * surface that core string verbatim in failureReason() so the audit row self-explains, not
     * squash everything non-ProcessingResult to a misleading "encounter not found".
     */
    public function testNonProcessingResultStringIsSurfacedVerbatim(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public bool $marked = false;

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return false;
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
                $this->marked = true;
            }
        };

        $encRow = [
            'puuid' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'euuid' => '11111111-2222-3333-4444-555555555555',
            'facility_id' => 1,
        ];

        $port = $this->getMockBuilder(EncounterChiefComplaintPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getOneByPidEid', 'updateEncounterReason'])
            ->getMock();
        $port->expects(self::once())->method('getOneByPidEid')->willReturn($encRow);
        $port->expects(self::once())->method('updateEncounterReason')
            ->willReturn('You are not authorized to see this encounter.');

        $action = new ChiefComplaintWriteAction($port, $ledger);

        $result = $action->execute(99, 280, 'prop-acl', 'admin', 'Default', $this->fixturePayload());

        self::assertFalse($result->isAccepted());
        self::assertSame('You are not authorized to see this encounter', $result->failureReason());
        self::assertFalse($ledger->marked);
    }

    /** Empty/non-string from the port falls back to the existing generic 'write failed' sentinel. */
    public function testNonProcessingResultEmptyStringFallsBackToWriteFailed(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return false;
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $encRow = [
            'puuid' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'euuid' => '11111111-2222-3333-4444-555555555555',
            'facility_id' => 1,
        ];

        $port = $this->getMockBuilder(EncounterChiefComplaintPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getOneByPidEid', 'updateEncounterReason'])
            ->getMock();
        $port->expects(self::once())->method('getOneByPidEid')->willReturn($encRow);
        $port->expects(self::once())->method('updateEncounterReason')->willReturn('');

        $action = new ChiefComplaintWriteAction($port, $ledger);

        $result = $action->execute(99, 280, 'prop-empty', 'admin', 'Default', $this->fixturePayload());

        self::assertFalse($result->isAccepted());
        self::assertSame('write failed', $result->failureReason());
    }

    /** Length-cap: oversized core strings are truncated to keep audit comments single-line-friendly. */
    public function testNonProcessingResultStringIsLengthCapped(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return false;
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $encRow = [
            'puuid' => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            'euuid' => '11111111-2222-3333-4444-555555555555',
            'facility_id' => 1,
        ];

        $longReason = str_repeat('x', 250);

        $port = $this->getMockBuilder(EncounterChiefComplaintPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getOneByPidEid', 'updateEncounterReason'])
            ->getMock();
        $port->expects(self::once())->method('getOneByPidEid')->willReturn($encRow);
        $port->expects(self::once())->method('updateEncounterReason')->willReturn($longReason);

        $action = new ChiefComplaintWriteAction($port, $ledger);

        $result = $action->execute(99, 280, 'prop-long', 'admin', 'Default', $this->fixturePayload());

        self::assertFalse($result->isAccepted());
        self::assertSame(120, strlen($result->failureReason()));
    }
}
