<?php

/**
 * AgentForge module package metadata (module manager)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

return [
    'name' => 'AgentForge Clinical Co-Pilot',
    'description' => 'V1 embedded co-pilot: right rail CUI, Context Service, Agent API handoff (PRD AgentForge).',
    'version' => '0.1.0-gate0',
    'author' => 'AgentForge',
    'license' => 'GPL-3.0',
    'acl_category' => 'patients',
    'acl_section' => 'notes',
    'require' => [
        'openemr' => '>=7.0.0',
    ],
    'tables' => [],
];
