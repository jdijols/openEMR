<?php

/**
 * W2 G2-MVP-25 — ObservationWriter isolated test.
 *
 * Three scenarios:
 *  (a) first call inserts (port.existsForKey=false → port.insert called).
 *  (b) second call with same key updates not duplicates (S13 idempotency).
 *  (c) audit row written with PHI-safe payload — only docref_uuid, field_path,
 *      inserted; raw clinical payload never appears in the audit (S10, S11).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Documents\DocumentAuditSink;
use OpenEMR\Modules\AgentForge\Documents\ObservationWritePort;
use OpenEMR\Modules\AgentForge\Documents\ObservationWriter;
use PHPUnit\Framework\TestCase;

$documentsDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/';
require_once $documentsDir . 'DocumentAuditSink.php';
require_once $documentsDir . 'ObservationWritePort.php';
require_once $documentsDir . 'ObservationWriter.php';

final class ObservationWriterIsolatedTest extends TestCase
{
    private const PATIENT_UUID = '11111111-2222-4333-a444-aaaaaaaaaaaa';
    private const DOCREF_UUID = 'docref-uuid-cccc';
    private const FIELD_PATH = 'lab_results[2].value';
    private const CORR = 'corr-w2-mvp-25-test';

    public function testFirstCallInserts(): void
    {
        $port = $this->getMockBuilder(ObservationWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['existsForKey', 'insert', 'update'])
            ->getMock();
        $port->expects(self::once())->method('existsForKey')->willReturn(false);
        $port->expects(self::once())->method('insert')
            ->with(self::PATIENT_UUID, self::DOCREF_UUID, self::FIELD_PATH, ['value' => 158, 'unit' => 'mg/dL']);
        $port->expects(self::never())->method('update');

        $audit = self::makeRecordingAudit();
        $writer = new ObservationWriter($port, $audit);

        $isInsert = $writer->upsert(
            'physician',
            'Default',
            11,
            self::PATIENT_UUID,
            self::DOCREF_UUID,
            self::FIELD_PATH,
            self::CORR,
            ['value' => 158, 'unit' => 'mg/dL'],
        );

        self::assertTrue($isInsert);
    }

    public function testSecondCallWithSameKeyUpdatesNotDuplicates(): void
    {
        $port = $this->getMockBuilder(ObservationWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['existsForKey', 'insert', 'update'])
            ->getMock();
        $port->expects(self::once())->method('existsForKey')->willReturn(true);
        $port->expects(self::never())->method('insert');
        $port->expects(self::once())->method('update')
            ->with(self::PATIENT_UUID, self::DOCREF_UUID, self::FIELD_PATH, ['value' => 162, 'unit' => 'mg/dL']);

        $audit = self::makeRecordingAudit();
        $writer = new ObservationWriter($port, $audit);

        $isInsert = $writer->upsert(
            'physician',
            'Default',
            11,
            self::PATIENT_UUID,
            self::DOCREF_UUID,
            self::FIELD_PATH,
            self::CORR,
            ['value' => 162, 'unit' => 'mg/dL'],
        );

        self::assertFalse($isInsert);
    }

    public function testAuditRowCarriesNoRawPhi(): void
    {
        $port = $this->getMockBuilder(ObservationWritePort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['existsForKey', 'insert', 'update'])
            ->getMock();
        $port->method('existsForKey')->willReturn(false);

        $audit = self::makeRecordingAudit();
        $writer = new ObservationWriter($port, $audit);

        // Pass a payload that intentionally contains "PHI-shape" content. The
        // audit must NOT echo any of it back.
        $writer->upsert(
            'physician',
            'Default',
            11,
            self::PATIENT_UUID,
            self::DOCREF_UUID,
            self::FIELD_PATH,
            self::CORR,
            [
                'patient_name' => 'Margaret Chen',
                'dob' => '1967-08-14',
                'mrn' => 'MRN-2026-04481',
                'value' => 158,
                'unit' => 'mg/dL',
            ],
        );

        self::assertCount(1, $audit->records);
        $auditPayload = $audit->records[0]['payload'];
        self::assertSame(
            ['action', 'docref_uuid', 'field_path', 'inserted'],
            array_keys($auditPayload),
            'audit payload must contain ONLY the approved PHI-safe keys',
        );
        $serialized = json_encode($auditPayload, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('Margaret', $serialized);
        self::assertStringNotContainsString('1967-08-14', $serialized);
        self::assertStringNotContainsString('04481', $serialized);
        self::assertStringNotContainsString('158', $serialized);
    }

    private static function makeRecordingAudit(): object
    {
        return new class implements DocumentAuditSink {
            /** @var list<array{success:bool, payload:array<string,mixed>}> */
            public array $records = [];

            public function recordDocUpload(
                string $authUser,
                string $authProvider,
                ?int $patientId,
                string $correlationId,
                bool $success,
                array $payload,
            ): void {
                $this->records[] = [
                    'success' => $success,
                    'payload' => $payload,
                ];
            }
        };
    }
}
