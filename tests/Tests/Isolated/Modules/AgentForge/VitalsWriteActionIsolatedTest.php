<?php

/**
 * Gate 4 G4-02 — vitals confirmed write harness (mirrors chief complaint §4.7.4-style cases).
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
use OpenEMR\Modules\AgentForge\Write\EncounterVitalsWritePort;
use OpenEMR\Modules\AgentForge\Write\VitalsWriteAction;
use OpenEMR\Modules\AgentForge\Write\VitalsWritePayload;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'EncounterVitalsWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'VitalsWritePayload.php';
require_once $writeDir . 'VitalsWriteAction.php';

final class VitalsWriteActionIsolatedTest extends TestCase
{
    private function fixturePayload(): VitalsWritePayload
    {
        [$payload, $err] = VitalsWritePayload::parse(['bp' => '132/84', 'hr' => 72]);

        self::assertNotNull($payload);
        self::assertNull($err);

        return $payload;
    }

    /** Happy path: port persists vitals-shaped row, ledger dedupe fires. */
    public function testHappyPathCallsInsertThenLedger(): void
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

        $port = $this->getMockBuilder(EncounterVitalsWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertVitalsForEncounter'])
            ->getMock();

        $port->expects(self::once())
            ->method('insertVitalsForEncounter')
            ->with(
                self::equalTo(99),
                self::equalTo(42),
                self::callback(static function (array $row): bool {
                    return $row['bps'] === '132'
                        && $row['bpd'] === '84'
                        && $row['pulse'] === '72'
                        && isset($row['user'], $row['groupname']);
                })
            )->willReturn(ConfirmedWriteOutcome::accepted(0));

        $action = new VitalsWriteAction($port, $ledger);

        $result = $action->execute(99, 42, 'prop-77', 'reynolds', 'Default', $this->fixturePayload());

        self::assertInstanceOf(ConfirmedWriteOutcome::class, $result);
        self::assertTrue($result->isAccepted());
        self::assertTrue($ledger->wasMarkedSuccessful);
        self::assertSame('vitals', $ledger->successful['prop-77'] ?? '');
    }

    /** Duplicate proposal: second POST never reaches EncounterService adapter. */
    public function testDuplicateProposalSkipsPortSecondCall(): void
    {
        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = [];

            public function __construct()
            {
                $this->successful['prop-77'] = 'vitals';
            }

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(EncounterVitalsWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertVitalsForEncounter'])
            ->getMock();

        $port->expects(self::never())->method('insertVitalsForEncounter');

        $action = new VitalsWriteAction($port, $ledger);

        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(1, 42, 'prop-77', 'drx', 'Default', $this->fixturePayload());
    }

    /** Validation / service rejection path: ledger must not advance. */
    public function testOpenEmrRejectedWhenPortReturnsRejected(): void
    {
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

        $port = $this->getMockBuilder(EncounterVitalsWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertVitalsForEncounter'])
            ->getMock();

        $port->expects(self::once())
            ->method('insertVitalsForEncounter')
            ->willReturn(ConfirmedWriteOutcome::openemrRejected('validation failed'));

        $action = new VitalsWriteAction($port, $ledger);

        $result = $action->execute(2, 88, 'prop-88', 'drx', 'Default', $this->fixturePayload());

        self::assertFalse($result->isAccepted());
        self::assertSame('validation failed', $result->failureReason());
        self::assertSame([], $ledger->successful);
    }

    /** Unknown vitals verb keys ⇒ unsupported_payload (mirrors allergy scenario tone). */
    public function testPayloadWithUnknownKeyParsesUnsupported(): void
    {
        [$parsed, $err] = VitalsWritePayload::parse(['delete' => true]);

        self::assertNull($parsed);
        self::assertSame('unsupported_payload', $err);
    }

    /** Malformed BP string ⇒ invalid_vitals without touching EncounterService port. */
    public function testPayloadWithMalformedBpParsesInvalid(): void
    {
        [$parsed, $err] = VitalsWritePayload::parse(['bp' => 'not-a-fraction']);

        self::assertNull($parsed);
        self::assertSame('invalid_vitals', $err);
    }
}
