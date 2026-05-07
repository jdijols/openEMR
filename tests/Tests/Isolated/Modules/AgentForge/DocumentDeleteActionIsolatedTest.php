<?php

/**
 * G2-Early-24 — document delete: payload + cascade soft-delete + duplicate dedupe.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Documents\DocumentDeleteAction;
use OpenEMR\Modules\AgentForge\Documents\DocumentDeletePayload;
use OpenEMR\Modules\AgentForge\Documents\DocumentDeletePort;
use OpenEMR\Modules\AgentForge\Write\CompletedWriteProposalLedgerInterface;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use PHPUnit\Framework\TestCase;

$writeDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/';
$docDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/';
require_once $writeDir . 'CompletedWriteProposalLedgerInterface.php';
require_once $writeDir . 'DuplicateProposalExecutionException.php';
require_once $docDir . 'DocumentDeletePort.php';
require_once $docDir . 'DocumentDeletePayload.php';
require_once $docDir . 'DocumentDeleteAction.php';

final class DocumentDeleteActionIsolatedTest extends TestCase
{
    public function testRejectsMissingUuid(): void
    {
        [$p, $err] = DocumentDeletePayload::parse([]);
        self::assertNull($p);
        self::assertSame('missing_uuid', $err);
    }

    public function testHappyDeleteCascadesAndMarksLedger(): void
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

        [$payload] = DocumentDeletePayload::parse([
            'docref_uuid' => '33333333-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(DocumentDeletePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['softDeleteDocRefAndCascadeObservations'])
            ->getMock();
        $port->expects(self::once())
            ->method('softDeleteDocRefAndCascadeObservations')
            ->with(
                self::equalTo('33333333-2222-4333-a444-aaaaaaaaaaaa'),
                self::equalTo('aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee'),
            )
            ->willReturn(['ok' => true, 'observations_deleted' => 5]);

        $action = new DocumentDeleteAction($port, $ledger);
        $result = $action->execute(
            'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
            'prop-doc-1',
            $payload,
        );

        self::assertTrue($result['accepted']);
        self::assertSame(5, $result['observations_deleted']);
        self::assertSame('document_delete', $ledger->successful['prop-doc-1'] ?? '');
    }

    public function testCrossPatientReturnsRejectedWithoutMarkingLedger(): void
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

        [$payload] = DocumentDeletePayload::parse([
            'docref_uuid' => '33333333-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(DocumentDeletePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['softDeleteDocRefAndCascadeObservations'])
            ->getMock();
        $port->expects(self::once())
            ->method('softDeleteDocRefAndCascadeObservations')
            ->willReturn(['ok' => false, 'observations_deleted' => 0]);

        $action = new DocumentDeleteAction($port, $ledger);
        $result = $action->execute(
            'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee',
            'prop-doc-2',
            $payload,
        );

        self::assertFalse($result['accepted']);
        self::assertSame('document not found', $result['reason']);
        self::assertArrayNotHasKey('prop-doc-2', $ledger->successful);
    }

    public function testDuplicateProposalSkipsPort(): void
    {
        [$payload] = DocumentDeletePayload::parse([
            'docref_uuid' => '33333333-2222-4333-a444-aaaaaaaaaaaa',
        ]);
        self::assertNotNull($payload);

        /** @phpstan-ignore-next-line */
        $ledger = new class implements CompletedWriteProposalLedgerInterface {
            /** @var array<string, string> */
            public array $successful = ['prop-doc-dup' => 'document_delete'];

            public function hasSuccessfulCompletion(string $proposalId): bool
            {
                return isset($this->successful[$proposalId]);
            }

            public function markSuccessful(string $proposalId, string $writeTarget): void
            {
            }
        };

        $port = $this->getMockBuilder(DocumentDeletePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['softDeleteDocRefAndCascadeObservations'])
            ->getMock();
        $port->expects(self::never())->method('softDeleteDocRefAndCascadeObservations');

        $action = new DocumentDeleteAction($port, $ledger);
        $this->expectException(DuplicateProposalExecutionException::class);
        $action->execute('aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee', 'prop-doc-dup', $payload);
    }
}
