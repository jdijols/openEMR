<?php

/**
 * Thrown when session token binding disagrees with requested patient (PRD §4.6).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

final class ActiveChartBindingException extends \RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        ?\Throwable $previous = null
    ) {
        parent::__construct($errorCode, 0, $previous);
    }
}
