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

namespace local_steplearn\external;

use core_courseformat\formatactions;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_value;
use local_steplearn\courses;
use local_steplearn\restrictions;

/**
 * セクションか活動のアクセス制限を、日付と活動の完了の条件で置き換える。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class set_restriction extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
            'sectionid' => new external_value(PARAM_INT, 'section id, or 0 to restrict a course module'),
            'cmid' => new external_value(PARAM_INT, 'course module id, or 0 to restrict a section'),
            'from' => new external_value(PARAM_INT, 'available from, or 0'),
            'until' => new external_value(PARAM_INT, 'available until, or 0'),
            'after' => new external_multiple_structure(
                new external_value(PARAM_INT, 'course module id, or -1 for the previous activity'),
                'activities that must be marked complete',
                VALUE_DEFAULT,
                []
            ),
            'hideunmet' => new external_value(
                PARAM_BOOL,
                'hide entirely from users who do not meet the conditions',
                VALUE_DEFAULT,
                false
            ),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $sectionid
     * @param int $cmid
     * @param int $from
     * @param int $until
     * @param int[] $after
     * @param bool $hideunmet
     * @return null
     */
    public static function execute(
        int $courseid,
        int $sectionid,
        int $cmid,
        int $from,
        int $until,
        array $after = [],
        bool $hideunmet = false
    ) {
        global $CFG, $DB;
        $params = self::validate_parameters(
            self::execute_parameters(),
            compact('courseid', 'sectionid', 'cmid', 'from', 'until', 'after', 'hideunmet')
        );
        self::validate_context(\context_system::instance());
        $course = courses::require_manage($params['courseid']);
        require_once($CFG->libdir . '/completionlib.php');
        if (empty($CFG->enableavailability) || !$params['sectionid'] === !$params['cmid']) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }

        $modinfo = get_fast_modinfo($course);
        $cms = $modinfo->get_cms();
        $section = $params['sectionid'] ? $modinfo->get_section_info_by_id($params['sectionid']) : null;
        $cm = $params['cmid'] ? ($cms[$params['cmid']] ?? null) : null;
        // 一般（0 番）のセクションを対象にしないのは、Moodle の画面でも制限を付けられないため
        $missing = $params['sectionid'] ? !$section || !$section->section : !$cm || $cm->deletioninprogress;
        if ($missing) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        require_capability(
            $cm ? 'moodle/course:manageactivities' : 'moodle/course:update',
            $cm ? \context_module::instance($cm->id) : \context_course::instance($course->id)
        );
        // Moodle の画面で付けた、STEP Learn の画面で扱えない条件を黙って消さないため
        if (restrictions::parse($cm ? $cm->availability : $section->availability) === null) {
            throw new \moodle_exception('restrictionnoteditable', 'local_steplearn');
        }

        $after = array_values(array_unique($params['after']));
        $completion = new \completion_info($course);
        foreach ($after as $id) {
            $target = $cms[$id] ?? null;
            $valid = $id === -1
                ? (bool) $cm
                : $target && !$target->deletioninprogress && $target->id !== $cm?->id
                    && $target->completion != COMPLETION_TRACKING_NONE;
            if (!$valid || !$completion->is_enabled()) {
                throw new \invalid_parameter_exception('after');
            }
        }
        $from = $params['from'];
        $until = $params['until'];
        if ($from < 0 || $until < 0 || ($from && $until && $until <= $from)) {
            throw new \invalid_parameter_exception('from or until');
        }
        $json = restrictions::build($from, $until, $after, $params['hideunmet']);

        if ($section) {
            formatactions::section($course)->update($section, ['availability' => $json]);
            // サブセクションの活動の制限も消すのは、Moodle 5.1 は null を活動に写さず、活動の側に古い制限が残るため
            $delegate = $section->get_component_instance();
            if ($json === null && $delegate instanceof \core_courseformat\sectiondelegatemodule) {
                $DB->set_field('course_modules', 'availability', null, ['id' => $delegate->get_cm()->id]);
                rebuild_course_cache($course->id, true);
            }
            return null;
        }
        // update_moduleinfo を使わないのは、活動の種類ごとの設定をすべて組み立て直すことになり、制限だけを変えられないため
        $DB->set_field('course_modules', 'availability', $json, ['id' => $cm->id]);
        \course_modinfo::purge_course_module_cache($course->id, $cm->id);
        rebuild_course_cache($course->id, true, true);
        \core\event\course_module_updated::create_from_cm($cm)->trigger();
        return null;
    }

    /**
     * @return null
     */
    public static function execute_returns() {
        return null;
    }
}
