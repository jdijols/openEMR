<?php

/**
 * Resolve and bind the current appointment encounter for AgentForge launches.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Context;

use OpenEMR\Common\Session\EncounterSessionUtil;
use OpenEMR\Common\Session\SessionWrapperFactory;

final class AppointmentEncounterBinder
{
    private const SESSION_CONTEXT_PID = 'agentforge_appointment_context_pid';
    private const SESSION_CONTEXT_EID = 'agentforge_appointment_context_eid';
    private const SESSION_CONTEXT_DATE = 'agentforge_appointment_context_date';

    public function bindForCurrentPatient(int $pid): AppointmentEncounterBindingResult
    {
        if ($pid <= 0) {
            return new AppointmentEncounterBindingResult(null, '', '', false);
        }

        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $appointmentContext = $this->appointmentContextForPatient($pid);
        $appointment = null;
        $appointmentDate = null;
        $hasAppointmentContext = $appointmentContext !== null;

        if ($appointmentContext !== null) {
            $appointmentId = $appointmentContext['eid'] ?? null;
            if ($appointmentId !== null) {
                $appointment = $this->findAppointmentById($pid, $appointmentId);
                if ($appointment !== null) {
                    $appointmentDate = $this->normalizeDate($appointment['pc_eventDate'] ?? null);
                }
            }

            $appointmentDate ??= $appointmentContext['date'] ?? null;
        }

        $targetDate = $appointmentDate ?? (new \DateTimeImmutable('today'))->format('Y-m-d');
        $sessionEncounterId = $this->positiveInt($session->get('encounter'));

        if ($sessionEncounterId !== null) {
            $sessionEncounter = $this->findEncounterById($pid, $sessionEncounterId);
            if (
                $sessionEncounter !== null
                && (!$hasAppointmentContext || $sessionEncounter->encounterDate === $targetDate)
            ) {
                return $sessionEncounter;
            }
        }

        $linkedEncounter = $appointment !== null
            ? $this->findTrackerLinkedEncounterForAppointment($pid, $appointment)
            : $this->findTrackerLinkedEncounter($pid, $targetDate);
        if ($linkedEncounter !== null) {
            $this->setOpenEncounter($linkedEncounter->encounterId);
            return $linkedEncounter;
        }

        $sameDayEncounter = $this->findLatestSameDayEncounter($pid, $targetDate);
        if ($sameDayEncounter !== null) {
            $this->setOpenEncounter($sameDayEncounter->encounterId);
            return $sameDayEncounter;
        }

        $appointment ??= $this->findLatestSameDayAppointment($pid, $targetDate);
        if ($appointment === null) {
            return new AppointmentEncounterBindingResult(null, '', '', false);
        }

        $createdEncounterId = $this->createEncounterForAppointment($pid, $appointment);
        if ($createdEncounterId === null) {
            return new AppointmentEncounterBindingResult(null, '', '', false);
        }

        $this->linkTrackerToEncounter($appointment, $pid, $createdEncounterId);
        $this->setOpenEncounter($createdEncounterId);

        $createdEncounter = $this->findEncounterById($pid, $createdEncounterId);
        if ($createdEncounter !== null) {
            return new AppointmentEncounterBindingResult(
                $createdEncounter->encounterId,
                $createdEncounter->encounterDate,
                $createdEncounter->encounterCategory,
                true
            );
        }

        return new AppointmentEncounterBindingResult($createdEncounterId, $targetDate, '', true);
    }

    private function setOpenEncounter(?int $encounterId): void
    {
        if ($encounterId === null || $encounterId <= 0) {
            return;
        }

        EncounterSessionUtil::setEncounter((string) $encounterId);
    }

    private function findEncounterById(int $pid, int $encounterId): ?AppointmentEncounterBindingResult
    {
        $row = \sqlQuery(
            "SELECT fe.`encounter`, DATE(fe.`date`) AS encounter_date, COALESCE(cat.`pc_catname`, '') AS category
             FROM `form_encounter` fe
             LEFT JOIN `openemr_postcalendar_categories` cat ON cat.`pc_catid` = fe.`pc_catid`
             WHERE fe.`pid` = ? AND fe.`encounter` = ?
             LIMIT 1",
            [$pid, $encounterId]
        );

        return $this->resultFromEncounterRow($row, false);
    }

    private function findTrackerLinkedEncounter(int $pid, string $today): ?AppointmentEncounterBindingResult
    {
        $row = \sqlQuery(
            "SELECT fe.`encounter`, DATE(fe.`date`) AS encounter_date, COALESCE(cat.`pc_catname`, '') AS category
             FROM `patient_tracker` pt
             INNER JOIN `form_encounter` fe ON fe.`pid` = pt.`pid` AND fe.`encounter` = pt.`encounter`
             LEFT JOIN `openemr_postcalendar_categories` cat ON cat.`pc_catid` = fe.`pc_catid`
             WHERE pt.`pid` = ? AND pt.`apptdate` = ? AND pt.`encounter` > 0
             ORDER BY pt.`appttime` DESC, pt.`id` DESC
             LIMIT 1",
            [$pid, $today]
        );

        return $this->resultFromEncounterRow($row, false);
    }

    /**
     * @param array<string, mixed> $appointment
     */
    private function findTrackerLinkedEncounterForAppointment(int $pid, array $appointment): ?AppointmentEncounterBindingResult
    {
        $appointmentId = $this->positiveInt($appointment['pc_eid'] ?? null);
        $appointmentDate = $this->normalizeDate($appointment['pc_eventDate'] ?? null);
        $appointmentTime = \is_string($appointment['pc_startTime'] ?? null) ? $appointment['pc_startTime'] : '';

        if ($appointmentId === null || $appointmentDate === null || $appointmentTime === '') {
            return null;
        }

        $row = \sqlQuery(
            "SELECT fe.`encounter`, DATE(fe.`date`) AS encounter_date, COALESCE(cat.`pc_catname`, '') AS category
             FROM `patient_tracker` pt
             INNER JOIN `form_encounter` fe ON fe.`pid` = pt.`pid` AND fe.`encounter` = pt.`encounter`
             LEFT JOIN `openemr_postcalendar_categories` cat ON cat.`pc_catid` = fe.`pc_catid`
             WHERE pt.`pid` = ? AND pt.`eid` = ? AND pt.`apptdate` = ? AND pt.`appttime` = ? AND pt.`encounter` > 0
             ORDER BY pt.`id` DESC
             LIMIT 1",
            [$pid, $appointmentId, $appointmentDate, $appointmentTime]
        );

        return $this->resultFromEncounterRow($row, false);
    }

    private function findLatestSameDayEncounter(int $pid, string $today): ?AppointmentEncounterBindingResult
    {
        $row = \sqlQuery(
            "SELECT fe.`encounter`, DATE(fe.`date`) AS encounter_date, COALESCE(cat.`pc_catname`, '') AS category
             FROM `form_encounter` fe
             LEFT JOIN `openemr_postcalendar_categories` cat ON cat.`pc_catid` = fe.`pc_catid`
             WHERE fe.`pid` = ? AND DATE(fe.`date`) = ?
             ORDER BY fe.`date` DESC, fe.`encounter` DESC
             LIMIT 1",
            [$pid, $today]
        );

        return $this->resultFromEncounterRow($row, false);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findLatestSameDayAppointment(int $pid, string $today): ?array
    {
        $row = \sqlQuery(
            "SELECT `pc_eid`, `pc_pid`, `pc_eventDate`, `pc_startTime`, `pc_title`, `pc_hometext`,
                    `pc_facility`, `pc_billing_location`, `pc_aid`, `pc_catid`, `pc_apptstatus`, `pc_room`
             FROM `openemr_postcalendar_events`
             WHERE `pc_pid` = ? AND `pc_eventDate` = ? AND `pc_recurrtype` = 0
             ORDER BY `pc_startTime` DESC, `pc_eid` DESC
             LIMIT 1",
            [$pid, $today]
        );

        return \is_array($row) && $row !== [] ? $row : null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findAppointmentById(int $pid, int $appointmentId): ?array
    {
        $row = \sqlQuery(
            "SELECT `pc_eid`, `pc_pid`, `pc_eventDate`, `pc_startTime`, `pc_title`, `pc_hometext`,
                    `pc_facility`, `pc_billing_location`, `pc_aid`, `pc_catid`, `pc_apptstatus`, `pc_room`
             FROM `openemr_postcalendar_events`
             WHERE `pc_pid` = ? AND `pc_eid` = ?
             LIMIT 1",
            [$pid, $appointmentId]
        );

        return \is_array($row) && $row !== [] ? $row : null;
    }

    /**
     * @param array<string, mixed> $appointment
     */
    private function createEncounterForAppointment(int $pid, array $appointment): ?int
    {
        $this->requireEncounterEvents();

        if (!\function_exists('todaysEncounterCheck')) {
            return null;
        }

        $title = \trim((string) ($appointment['pc_title'] ?? ''));
        $homeText = \trim((string) ($appointment['pc_hometext'] ?? ''));
        $reason = $title !== '' ? $title : $homeText;

        $encounter = \todaysEncounterCheck(
            $pid,
            (string) ($appointment['pc_eventDate'] ?? ''),
            $reason,
            (string) ($appointment['pc_facility'] ?? ''),
            (string) ($appointment['pc_billing_location'] ?? ''),
            (string) ($appointment['pc_aid'] ?? ''),
            (string) ($appointment['pc_catid'] ?? ''),
            false
        );

        $encounterId = $this->positiveInt($encounter);
        return $encounterId !== null ? $encounterId : null;
    }

    /**
     * @param array<string, mixed> $appointment
     */
    private function linkTrackerToEncounter(array $appointment, int $pid, int $encounterId): void
    {
        $this->requireEncounterEvents();

        if (!\function_exists('manage_tracker_status')) {
            return;
        }

        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $authUser = $session->get('authUser');
        \manage_tracker_status(
            (string) ($appointment['pc_eventDate'] ?? ''),
            (string) ($appointment['pc_startTime'] ?? ''),
            (int) ($appointment['pc_eid'] ?? 0),
            $pid,
            \is_string($authUser) && $authUser !== '' ? $authUser : 'oe-system',
            (string) ($appointment['pc_apptstatus'] ?? ''),
            (string) ($appointment['pc_room'] ?? ''),
            (string) $encounterId
        );
    }

    /**
     * @param array<string, mixed>|false|null $row
     */
    private function resultFromEncounterRow($row, bool $created): ?AppointmentEncounterBindingResult
    {
        if (!\is_array($row) || $row === []) {
            return null;
        }

        $encounterId = $this->positiveInt($row['encounter'] ?? null);
        if ($encounterId === null) {
            return null;
        }

        $date = \is_string($row['encounter_date'] ?? null) ? $row['encounter_date'] : '';
        $category = \is_string($row['category'] ?? null) ? $row['category'] : '';

        return new AppointmentEncounterBindingResult($encounterId, $date, $category, $created);
    }

    private function requireEncounterEvents(): void
    {
        if (\function_exists('todaysEncounterCheck') && \function_exists('manage_tracker_status')) {
            return;
        }

        $srcdir = $GLOBALS['srcdir'] ?? '';
        if (\is_string($srcdir) && $srcdir !== '') {
            require_once $srcdir . '/encounter_events.inc.php';
        }
    }

    /**
     * @return array{eid?: int, date?: string}|null
     */
    private function appointmentContextForPatient(int $pid): ?array
    {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $contextPid = $this->positiveInt($session->get(self::SESSION_CONTEXT_PID));
        if ($contextPid === null || $contextPid !== $pid) {
            return null;
        }

        $appointmentId = $this->positiveInt($session->get(self::SESSION_CONTEXT_EID));
        $appointmentDate = $this->normalizeDate($session->get(self::SESSION_CONTEXT_DATE));

        if ($appointmentId === null && $appointmentDate === null) {
            return null;
        }

        $context = [];
        if ($appointmentId !== null) {
            $context['eid'] = $appointmentId;
        }

        if ($appointmentDate !== null) {
            $context['date'] = $appointmentDate;
        }

        return $context;
    }

    /**
     * @param mixed $value
     */
    private function normalizeDate($value): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $date = \trim($value);
        if (\preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) === 1) {
            return $date;
        }

        if (\preg_match('/^\d{8}$/', $date) === 1) {
            return \substr($date, 0, 4) . '-' . \substr($date, 4, 2) . '-' . \substr($date, 6, 2);
        }

        return null;
    }

    /**
     * @param mixed $value
     */
    private function positiveInt($value): ?int
    {
        if (\is_int($value)) {
            return $value > 0 ? $value : null;
        }

        if (\is_string($value) && \is_numeric($value)) {
            $intValue = (int) $value;
            return $intValue > 0 ? $intValue : null;
        }

        return null;
    }
}
