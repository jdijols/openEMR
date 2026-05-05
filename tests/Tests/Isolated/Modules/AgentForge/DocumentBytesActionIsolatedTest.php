<?php

/**
 * W2 G2-MVP-22 — DocumentBytesAction isolated test.
 *
 * Three scenarios:
 *  (a) happy — DocRef belongs to active chart → returns bytes + content-type.
 *  (b) ACL fail — port returns null (treated as not-found / forbidden).
 *  (c) cross-patient binding fail — port throws CrossPatientDocumentAccessException
 *      (S15 hard-gate boundary).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Documents\CrossPatientDocumentAccessException;
use OpenEMR\Modules\AgentForge\Documents\DocumentBytesAction;
use OpenEMR\Modules\AgentForge\Documents\DocumentBytesPort;
use OpenEMR\Modules\AgentForge\Documents\DocumentBytesResult;
use OpenEMR\Modules\AgentForge\Documents\DocumentNotFoundException;
use PHPUnit\Framework\TestCase;

$documentsDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/';
require_once $documentsDir . 'DocumentBytesPort.php';
require_once $documentsDir . 'DocumentBytesResult.php';
require_once $documentsDir . 'CrossPatientDocumentAccessException.php';
require_once $documentsDir . 'DocumentNotFoundException.php';
require_once $documentsDir . 'DocumentBytesAction.php';

final class DocumentBytesActionIsolatedTest extends TestCase
{
    private const PATIENT_UUID = '11111111-2222-4333-a444-aaaaaaaaaaaa';

    public function testHappyPathReturnsBytesAndMime(): void
    {
        $port = $this->getMockBuilder(DocumentBytesPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['fetch'])
            ->getMock();
        $expected = new DocumentBytesResult('fake-pdf-bytes', 'application/pdf', 14, 'lab_pdf');
        $port->expects(self::once())
            ->method('fetch')
            ->with('docref-uuid-aaaa', self::PATIENT_UUID)
            ->willReturn($expected);

        $action = new DocumentBytesAction($port);
        $result = $action->execute('docref-uuid-aaaa', self::PATIENT_UUID);

        self::assertSame('fake-pdf-bytes', $result->bytes);
        self::assertSame('application/pdf', $result->mimeType);
        self::assertSame('lab_pdf', $result->docType);
        self::assertSame(14, $result->fileSize);
    }

    public function testNotFoundDocRefThrows(): void
    {
        $port = $this->getMockBuilder(DocumentBytesPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['fetch'])
            ->getMock();
        $port->method('fetch')->willReturn(null);

        $action = new DocumentBytesAction($port);
        $this->expectException(DocumentNotFoundException::class);
        $action->execute('does-not-exist', self::PATIENT_UUID);
    }

    public function testCrossPatientAccessIsRefused(): void
    {
        $port = $this->getMockBuilder(DocumentBytesPort::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['fetch'])
            ->getMock();
        $port->method('fetch')
            ->willThrowException(new CrossPatientDocumentAccessException());

        $action = new DocumentBytesAction($port);
        $this->expectException(CrossPatientDocumentAccessException::class);
        $action->execute('docref-uuid-other-patient', self::PATIENT_UUID);
    }
}
