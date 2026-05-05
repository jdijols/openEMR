<?php

/**
 * W2 G2-MVP-20 — DocumentUploadAction isolated test.
 *
 * Five scenarios:
 *  (a) happy path — payload + non-existing → port mint, audit success.
 *  (b) idempotent re-upload — existing (patient, sha256) → returns existing
 *      DocRef without minting (S13).
 *  (c) cross-patient binding mismatch — claimed != canonical → throws
 *      CrossPatientBindingException, audit logs failure (S1, S15).
 *  (d) audit row on happy path contains no patient name / MRN / DOB / raw
 *      bytes / full sha256 — only docref_uuid, doc_type, mime, size_bytes,
 *      sha256_prefix, re_upload (S10, S11).
 *  (e) payload parse: unsupported MIME → returns [null, 'unsupported_payload'].
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Documents\CrossPatientBindingException;
use OpenEMR\Modules\AgentForge\Documents\DocumentAuditSink;
use OpenEMR\Modules\AgentForge\Documents\DocumentUploadAction;
use OpenEMR\Modules\AgentForge\Documents\DocumentUploadPayload;
use OpenEMR\Modules\AgentForge\Documents\DocumentUploadPort;
use OpenEMR\Modules\AgentForge\Documents\DocumentUploadResult;
use PHPUnit\Framework\TestCase;

$documentsDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/';
require_once $documentsDir . 'DocumentUploadPayload.php';
require_once $documentsDir . 'DocumentUploadPort.php';
require_once $documentsDir . 'DocumentUploadResult.php';
require_once $documentsDir . 'DocumentAuditSink.php';
require_once $documentsDir . 'CrossPatientBindingException.php';
require_once $documentsDir . 'DocumentUploadAction.php';

final class DocumentUploadActionIsolatedTest extends TestCase
{
    private const PATIENT_UUID = '11111111-2222-4333-a444-aaaaaaaaaaaa';
    private const OTHER_PATIENT_UUID = '99999999-2222-4333-a444-bbbbbbbbbbbb';
    private const CORRELATION_ID = 'corr-w2-mvp-20-test';
    private const AUTH_USER = 'physician';
    private const AUTH_PROVIDER = 'Default';
    private const PATIENT_ID = 11;

    public function testHappyPathMintsAndPersists(): void
    {
        [$payload, $err] = DocumentUploadPayload::parse([
            'doc_type' => 'lab_pdf',
            'mime_type' => 'application/pdf',
            'file_bytes' => 'fake-pdf-bytes-for-test',
        ]);
        self::assertNull($err);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(DocumentUploadPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['findExistingDocRef', 'mintAndPersistDocument'])
            ->getMock();

        $port->expects(self::once())
            ->method('findExistingDocRef')
            ->with(self::PATIENT_UUID, $payload->sha256)
            ->willReturn(null);

        $port->expects(self::once())
            ->method('mintAndPersistDocument')
            ->with(self::PATIENT_UUID, $payload)
            ->willReturn('docref-uuid-aaaa');

        $audit = self::makeRecordingAudit();
        $action = new DocumentUploadAction($port, $audit);

        $result = $action->execute(
            self::AUTH_USER,
            self::AUTH_PROVIDER,
            self::PATIENT_ID,
            self::PATIENT_UUID,
            self::PATIENT_UUID,
            self::CORRELATION_ID,
            $payload,
        );

        self::assertInstanceOf(DocumentUploadResult::class, $result);
        self::assertSame('docref-uuid-aaaa', $result->docrefUuid);
        self::assertFalse($result->wasReUpload);
        self::assertCount(1, $audit->records);
        self::assertTrue($audit->records[0]['success']);
    }

    public function testIdempotentReUploadReturnsExistingDocRef(): void
    {
        [$payload] = DocumentUploadPayload::parse([
            'doc_type' => 'intake_form',
            'mime_type' => 'image/png',
            'file_bytes' => 'fake-png-bytes',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(DocumentUploadPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['findExistingDocRef', 'mintAndPersistDocument'])
            ->getMock();

        $port->expects(self::once())
            ->method('findExistingDocRef')
            ->with(self::PATIENT_UUID, $payload->sha256)
            ->willReturn('docref-uuid-existing');

        $port->expects(self::never())->method('mintAndPersistDocument');

        $audit = self::makeRecordingAudit();
        $action = new DocumentUploadAction($port, $audit);

        $result = $action->execute(
            self::AUTH_USER,
            self::AUTH_PROVIDER,
            self::PATIENT_ID,
            self::PATIENT_UUID,
            self::PATIENT_UUID,
            self::CORRELATION_ID,
            $payload,
        );

        self::assertSame('docref-uuid-existing', $result->docrefUuid);
        self::assertTrue($result->wasReUpload);
        self::assertCount(1, $audit->records);
        self::assertTrue($audit->records[0]['payload']['re_upload']);
    }

    public function testCrossPatientBindingMismatchThrowsAndAudits(): void
    {
        [$payload] = DocumentUploadPayload::parse([
            'doc_type' => 'lab_pdf',
            'mime_type' => 'application/pdf',
            'file_bytes' => 'fake-pdf-bytes',
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(DocumentUploadPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['findExistingDocRef', 'mintAndPersistDocument'])
            ->getMock();
        $port->expects(self::never())->method('findExistingDocRef');
        $port->expects(self::never())->method('mintAndPersistDocument');

        $audit = self::makeRecordingAudit();
        $action = new DocumentUploadAction($port, $audit);

        try {
            $action->execute(
                self::AUTH_USER,
                self::AUTH_PROVIDER,
                self::PATIENT_ID,
                self::PATIENT_UUID,
                self::OTHER_PATIENT_UUID,
                self::CORRELATION_ID,
                $payload,
            );
            self::fail('Expected CrossPatientBindingException');
        } catch (CrossPatientBindingException $e) {
            self::assertSame('active_chart_mismatch', $e->getMessage());
        }

        self::assertCount(1, $audit->records);
        self::assertFalse($audit->records[0]['success']);
        self::assertSame('active_chart_mismatch', $audit->records[0]['payload']['reason']);
    }

    public function testAuditRowOnHappyPathCarriesNoPhi(): void
    {
        // Use sample bytes that include "fake PHI shape" content; the audit
        // payload must NOT echo the bytes back, must NOT carry the full sha256,
        // and must NOT include patient name/MRN/DOB. Only the approved
        // metadata keys are allowed.
        [$payload] = DocumentUploadPayload::parse([
            'doc_type' => 'intake_form',
            'mime_type' => 'application/pdf',
            'file_bytes' => "Patient: Margaret Chen\nDOB: 1967-08-14\nMRN: 04481\n[fake intake bytes]",
        ]);
        self::assertNotNull($payload);

        $port = $this->getMockBuilder(DocumentUploadPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['findExistingDocRef', 'mintAndPersistDocument'])
            ->getMock();
        $port->method('findExistingDocRef')->willReturn(null);
        $port->method('mintAndPersistDocument')->willReturn('docref-uuid-bbbb');

        $audit = self::makeRecordingAudit();
        $action = new DocumentUploadAction($port, $audit);

        $action->execute(
            self::AUTH_USER,
            self::AUTH_PROVIDER,
            self::PATIENT_ID,
            self::PATIENT_UUID,
            self::PATIENT_UUID,
            self::CORRELATION_ID,
            $payload,
        );

        self::assertCount(1, $audit->records);
        $auditPayload = $audit->records[0]['payload'];
        self::assertSame(
            ['docref_uuid', 'doc_type', 'mime', 'size_bytes', 'sha256_prefix', 're_upload'],
            array_keys($auditPayload),
            'audit payload must contain ONLY the approved PHI-safe keys',
        );
        // The full sha256 is 64 hex chars; the prefix shipped is 8.
        self::assertSame(8, strlen((string) $auditPayload['sha256_prefix']));
        // No patient name, MRN, or DOB anywhere in the payload.
        $serialized = json_encode($auditPayload, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('Margaret', $serialized);
        self::assertStringNotContainsString('1967-08-14', $serialized);
        self::assertStringNotContainsString('04481', $serialized);
        self::assertStringNotContainsString('Patient:', $serialized);
    }

    public function testParseRejectsUnsupportedMime(): void
    {
        [$payload, $err] = DocumentUploadPayload::parse([
            'doc_type' => 'lab_pdf',
            'mime_type' => 'application/x-shockwave-flash',
            'file_bytes' => 'irrelevant',
        ]);
        self::assertNull($payload);
        self::assertSame('unsupported_payload', $err);

        [$payload2, $err2] = DocumentUploadPayload::parse([
            'doc_type' => 'referral_fax',                // not in §6 enum
            'mime_type' => 'application/pdf',
            'file_bytes' => 'irrelevant',
        ]);
        self::assertNull($payload2);
        self::assertSame('unsupported_payload', $err2);
    }

    private static function makeRecordingAudit(): object
    {
        return new class implements DocumentAuditSink {
            /** @var list<array{user:string, provider:string, pid:?int, correlation_id:string, success:bool, payload:array<string,mixed>}> */
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
                    'user' => $authUser,
                    'provider' => $authProvider,
                    'pid' => $patientId,
                    'correlation_id' => $correlationId,
                    'success' => $success,
                    'payload' => $payload,
                ];
            }
        };
    }
}
