<?php

/**
 * G2-Final-11 — demographics partial update: payload mapping + happy path + dedupe.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Write\CompletedWriteProposalLedgerInterface;
use OpenEMR\Modules\AgentForge\Write\ConfirmedWriteOutcome;
use OpenEMR\Modules\AgentForge\Write\DemographicsUpdateAction;
use OpenEMR\Modules\AgentForge\Write\DemographicsUpdatePayload;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\PatientDemographicsWritePort;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'PatientDemographicsWritePort.php';
require_once $writeDir . 'ConfirmedWriteOutcome.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $writeDir . 'DemographicsUpdatePayload.php';
require_once $writeDir . 'DemographicsUpdateAction.php';

final class DemographicsUpdateActionIsolatedTest extends TestCase
{
    public function testRejectsEmptyPayload(): void
    {
        [$p, $err] = DemographicsUpdatePayload::parse([]);
        self::assertNull($p);
        self::assertSame('invalid_payload', $err);
    }

    public function testRejectsUnknownKey(): void
    {
        [$p, $err] = DemographicsUpdatePayload::parse(['rogue' => 'x']);
        self::assertNull($p);
        self::assertSame('unsupported_payload', $err);
    }

    public function testRejectsInvalidDob(): void
    {
        [$p, $err] = DemographicsUpdatePayload::parse(['dob' => '1980/01/15']);
        self::assertNull($p);
        self::assertSame('invalid_payload', $err);
    }

    public function testRejectsUnknownSex(): void
    {
        [$p, $err] = DemographicsUpdatePayload::parse(['sex' => 'other']);
        self::assertNull($p);
        self::assertSame('invalid_payload', $err);
    }

    public function testHappyMapsLogicalKeysToPatientDataColumns(): void
    {
        [$payload, $err] = DemographicsUpdatePayload::parse([
            'first_name' => 'Margaret',
            'last_name' => 'Chen',
            'dob' => '1967-08-14',
            'sex' => 'Female',
            'contact_phone' => '(510) 555-0148',
        ]);
        self::assertNull($err);
        self::assertNotNull($payload);

        self::assertSame(
            ['fname' => 'Margaret', 'lname' => 'Chen', 'DOB' => '1967-08-14', 'sex' => 'Female', 'phone_cell' => '(510) 555-0148'],
            $payload->columnPatch(),
        );
    }

    public function testHappyUpdateCallsPortThenLedger(): void
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

        [$payload] = DemographicsUpdatePayload::parse([
            'first_name' => 'Margaret',
            'sex' => 'Female',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(PatientDemographicsWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['updateDemographicsForPatient'])
            ->getMock();
        $port->expects(self::once())
            ->method('updateDemographicsForPatient')
            ->with(
                self::equalTo(42),
                self::equalTo(['fname' => 'Margaret', 'sex' => 'Female']),
            )
            ->willReturn(ConfirmedWriteOutcome::accepted(0));

        $action = new DemographicsUpdateAction($port, $ledger);
        $result = $action->execute(42, 'prop-demo-1', $payload);

        self::assertTrue($result->isAccepted());
        self::assertSame('demographics_update', $ledger->successful['prop-demo-1'] ?? '');
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = DemographicsUpdatePayload::parse(['contact_phone' => '555']);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-demo-dup' => 'demographics_update'];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(PatientDemographicsWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['updateDemographicsForPatient'])
            ->getMock();
        $port->expects(self::never())->method('updateDemographicsForPatient');

        $action = new DemographicsUpdateAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute(42, 'prop-demo-dup', $payload);
    }
}
