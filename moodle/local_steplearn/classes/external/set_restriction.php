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
use core_external\external_value;
use local_steplearn\courses;
use local_steplearn\restrictions;

/**
 * セクションか活動のアクセス制限を置き換える。
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
            'availability' => new external_value(PARAM_RAW, 'the availability JSON, or an empty string to remove the restriction'),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $sectionid
     * @param int $cmid
     * @param string $availability
     * @return null
     */
    public static function execute(int $courseid, int $sectionid, int $cmid, string $availability) {
        global $CFG, $DB;
        $params = self::validate_parameters(
            self::execute_parameters(),
            compact('courseid', 'sectionid', 'cmid', 'availability')
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
        $json = restrictions::validate($params['availability'], $course, $modinfo, $cm);

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
