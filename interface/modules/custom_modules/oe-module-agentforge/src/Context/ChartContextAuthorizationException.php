<?php

/**
 * HTTP-shaped failure for Context Service auth (mapped to JSON by public scripts).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Context;

final class ChartContextAuthorizationException extends \RuntimeException
{
    public function __construct(
        public readonly int $httpStatus,
        public readonly string $errorCode,
        ?\Throwable $previous = null
    ) {
        parent::__construct($errorCode, 0, $previous);
    }
}
