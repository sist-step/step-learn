<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

namespace local_steplearn;

use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use core_external\util;

/**
 * STEP Learn から見たコースの情報。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class courses {
    /**
     * 現在のユーザーのコースでのロール。参加しておらず編集もできないコースは null。
     *
     * @param \stdClass $course
     * @return array{role: string, canmanage: bool}|null
     */
    public static function access(\stdClass $course): ?array {
        $context = \context_course::instance($course->id);
        if ($course->id == SITEID) {
            return null;
        }
        if (!$course->visible && !has_capability('moodle/course:viewhiddencourses', $context)) {
            return null;
        }
        $canmanage = has_capability('moodle/course:manageactivities', $context);
        $enrolled = is_enrolled($context, null, '', true);
        if (!$canmanage && !$enrolled) {
            return null;
        }
        return ['role' => $enrolled ? ($canmanage ? 'teacher' : 'student') : '', 'canmanage' => $canmanage];
    }

    /**
     * アクセスできるコースを取得する。できなければ存在しないものとして例外にする。
     *
     * @param int $courseid
     * @return array{0: \stdClass, 1: array{role: string, canmanage: bool}}
     */
    public static function require_access(int $courseid): array {
        global $DB;
        $course = $DB->get_record('course', ['id' => $courseid]);
        $access = $course ? self::access($course) : null;
        if (!$access) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        return [$course, $access];
    }

    /**
     * 編集できるコースを取得する。
     *
     * @param int $courseid
     * @return \stdClass
     */
    public static function require_manage(int $courseid): \stdClass {
        [$course, $access] = self::require_access($courseid);
        if (!$access['canmanage']) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        return $course;
    }

    /**
     * @param \stdClass $course
     * @param array{role: string, canmanage: bool} $access
     * @return array
     */
    public static function export(\stdClass $course, array $access): array {
        global $CFG, $USER;
        require_once($CFG->libdir . '/completionlib.php');
        require_once($CFG->dirroot . '/course/lib.php');
        $context = \context_course::instance($course->id);
        [$summary, $summaryformat] = util::format_text($course->summary, $course->summaryformat, $context, 'course', 'summary', 0);

        $completion = new \completion_info($course);
        $total = 0;
        $done = 0;
        if ($completion->is_enabled()) {
            foreach (get_fast_modinfo($course)->get_cms() as $cm) {
                if ($cm->completion == COMPLETION_TRACKING_NONE || !$cm->uservisible || $cm->deletioninprogress) {
                    continue;
                }
                $total++;
                $state = $completion->get_data($cm, true, $USER->id)->completionstate;
                if ($state == COMPLETION_COMPLETE || $state == COMPLETION_COMPLETE_PASS) {
                    $done++;
                }
            }
        }

        $element = new \core_course_list_element($course);
        $imageurl = '';
        foreach ($element->get_course_overviewfiles() as $file) {
            if ($file->is_valid_image()) {
                $imageurl = \moodle_url::make_webservice_pluginfile_url(
                    $file->get_contextid(),
                    $file->get_component(),
                    $file->get_filearea(),
                    null,
                    $file->get_filepath(),
                    $file->get_filename()
                )->out(false);
                break;
            }
        }
        $teachers = array_values(array_unique(array_map(fn($contact) => $contact['username'], $element->get_course_contacts())));

        return [
            'id' => (int) $course->id,
            'shortname' => format_string($course->shortname, true, ['context' => $context]),
            'fullname' => format_string($course->fullname, true, ['context' => $context]),
            'summary' => $summary,
            'summaryformat' => $summaryformat,
            'visible' => (bool) $course->visible,
            'completionenabled' => $completion->is_enabled(),
            'role' => $access['role'],
            'canmanage' => $access['canmanage'],
            'total' => $total,
            'done' => $done,
            'inprogress' => course_classify_for_timeline($course, null, $completion) === COURSE_TIMELINE_INPROGRESS,
            'members' => count_enrolled_users($context, '', 0, true),
            'teachers' => $teachers,
            'imageurl' => $imageurl,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function structure(): external_single_structure {
        return new external_single_structure([
            'id' => new external_value(PARAM_INT, 'course id'),
            'shortname' => new external_value(PARAM_TEXT, 'short name'),
            'fullname' => new external_value(PARAM_TEXT, 'full name'),
            'summary' => new external_value(PARAM_RAW, 'summary'),
            'summaryformat' => new external_value(PARAM_INT, 'summary format'),
            'visible' => new external_value(PARAM_BOOL, 'visible to students'),
            'completionenabled' => new external_value(PARAM_BOOL, 'completion tracking enabled'),
            'role' => new external_value(PARAM_ALPHA, 'teacher, student, or empty when not enrolled'),
            'canmanage' => new external_value(PARAM_BOOL, 'can edit the course contents'),
            'total' => new external_value(PARAM_INT, 'activities with completion visible to the user'),
            'done' => new external_value(PARAM_INT, 'completed activities'),
            'inprogress' => new external_value(PARAM_BOOL, 'in progress on the Moodle dashboard timeline (not ended, not completed, started)'),
            'members' => new external_value(PARAM_INT, 'active participants'),
            'teachers' => new external_multiple_structure(new external_value(PARAM_TEXT, 'name'), 'course contacts'),
            'imageurl' => new external_value(PARAM_URL, 'course image (webservice/pluginfile.php) or empty'),
        ]);
    }
}
