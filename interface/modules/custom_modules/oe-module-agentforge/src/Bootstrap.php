<?php

/**
 * Module event wiring (menu/header hooks land in Gate 2)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge;

use Symfony\Component\EventDispatcher\EventDispatcherInterface;

final class Bootstrap
{
    public function __construct(
        private readonly EventDispatcherInterface $eventDispatcher
    ) {
    }

    public function subscribeToEvents(): void
    {
        // Gate 2 — MenuEvent / header injection for rail icon
    }
}
