<?php

/**
 * Gate 4 G4-04 — allergy write harness + §4.7.4 delete refusal at parse boundary.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Write\AllergyWriteAction;
use OpenEMR\Modules\AgentForge\Write\AllergyWritePayload;
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
require_once $writeDir . 'AllergyWritePayload.php';
require_once $writeDir . 'AllergyWriteAction.php';

final class AllergyWriteActionIsolatedTest extends TestCase
{
    public function testDeleteActionParsesUnsupportedWrite(): void
    {
        [$p, $e] = AllergyWritePayload::parse(['action' => 'delete']);
        self::assertNull($p);
        self::assertSame('unsupported_payload', $e);
    }

    public function testHappyAddCallsInsertThenLedger(): void
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

        [$payload, $err] = AllergyWritePayload::parse([
            'action' => 'add',
            'substance' => 'Penicillin',
            'reaction' => 'rash',
            'severity' => 'mild',
        ]);
        self::assertNull($err);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(PatientAllergyWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['insertAllergy', 'updateAllergy', 'softDeleteAllergyByUuid'])
            ->getMock();

        $port->expects(self::once())
            ->method('insertAllergy')
            ->with(
                self::equalTo('11111111-2222-4333-a444-aaaaaaaaaaaa'),
                self::equalTo([
                    'title' => 'Penicillin',
                    'comments' => 'rash',
                    'severity_al' => 'mild',
                ])
            )->willReturn(ConfirmedWriteOutcome::accepted(0));

        $port->expects(self::never())->method('updateAllergy');

        $action = new AllergyWriteAction($port, $ledger);
        $result = $action->execute(
            '11111111-2222-4333-a444-aaaaaaaaaaaa',
            'prop-a1',
            $payload,
        );

        self::assertTrue($result->isAccepted());
        self::assertTrue($ledger->wasMarkedSuccessful);
        self::assertSame('allergy', $ledger->successful['prop-a1'] ?? '');
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = AllergyWritePayload::parse([
            'action' => 'add',
            'substance' => 'Sulfa drug',
        ]);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-dup' => 'allergy'];

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
        $port->expects(self::never())->method('insertAllergy');
        $port->expects(self::never())->method('updateAllergy');

        $action = new AllergyWriteAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute('11111111-2222-4333-a444-aaaaaaaaaaaa', 'prop-dup', $payload);
    }
}
