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

/**
 * セクションの名前と概要を変える。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class update_section extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
            'sectionid' => new external_value(PARAM_INT, 'section id'),
            'name' => new external_value(PARAM_TEXT, 'section name'),
            'summary' => new external_value(PARAM_RAW, 'summary in plain text'),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $sectionid
     * @param string $name
     * @param string $summary
     * @return null
     */
    public static function execute(int $courseid, int $sectionid, string $name, string $summary) {
        $params = self::validate_parameters(
            self::execute_parameters(),
            ['courseid' => $courseid, 'sectionid' => $sectionid, 'name' => $name, 'summary' => $summary]
        );
        self::validate_context(\context_system::instance());
        $course = courses::require_manage($params['courseid']);
        require_capability('moodle/course:update', \context_course::instance($course->id));

        $section = get_fast_modinfo($course)->get_section_info_by_id($params['sectionid']);
        if (!$section) {
            throw new \moodle_exception('notfound', 'local_steplearn');
        }
        formatactions::section($course)->update(
            $section,
            ['name' => $params['name'], 'summary' => $params['summary'], 'summaryformat' => FORMAT_PLAIN]
        );
        return null;
    }

    /**
     * @return null
     */
    public static function execute_returns() {
        return null;
    }
}
