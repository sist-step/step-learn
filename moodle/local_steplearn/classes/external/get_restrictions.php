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

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use local_steplearn\courses;
use local_steplearn\restrictions;

/**
 * 編集できるコースの、アクセス制限のあるセクションと活動と、制限の編集で選べるもの。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_restrictions extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
        ]);
    }

    /**
     * @param int $courseid
     * @return array
     */
    public static function execute(int $courseid): array {
        global $CFG;
        ['courseid' => $courseid] = self::validate_parameters(self::execute_parameters(), ['courseid' => $courseid]);
        self::validate_context(\context_system::instance());
        $course = courses::require_manage($courseid);
        require_once($CFG->libdir . '/completionlib.php');
        if (empty($CFG->enableavailability)) {
            return [
                'enabled' => false,
                'restrictions' => [],
                'options' => ['plugins' => [], 'grades' => [], 'profilefields' => [], 'groups' => [], 'groupings' => []],
            ];
        }

        $modinfo = get_fast_modinfo($course);
        $list = [];
        foreach ($modinfo->get_section_info_all() as $section) {
            if ($section->availability) {
                $info = restrictions::describe(new \core_availability\info_section($section), $course);
                $list[] = restrictions::export((int) $section->id, 0, $section->availability, $info);
            }
        }
        foreach ($modinfo->get_cms() as $cm) {
            if ($cm->availability && !$cm->deletioninprogress) {
                $info = restrictions::describe(new \core_availability\info_module($cm), $course);
                $list[] = restrictions::export(0, (int) $cm->id, $cm->availability, $info);
            }
        }
        return ['enabled' => true, 'restrictions' => $list, 'options' => restrictions::options($course)];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'enabled' => new external_value(PARAM_BOOL, 'restrict access is enabled on the site'),
            'restrictions' => new external_multiple_structure(restrictions::structure()),
            'options' => restrictions::options_structure(),
        ]);
    }
}
