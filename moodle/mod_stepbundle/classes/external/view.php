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

namespace mod_stepbundle\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_value;

/**
 * STEP Learn の画面で開いたことを記録し、「開いたら完了」の条件を満たす。
 *
 * @package    mod_stepbundle
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class view extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'course module id'),
        ]);
    }

    /**
     * @param int $cmid
     * @return null
     */
    public static function execute(int $cmid) {
        global $CFG, $DB;
        ['cmid' => $cmid] = self::validate_parameters(self::execute_parameters(), ['cmid' => $cmid]);
        [$course, $cm] = get_course_and_cm_from_cmid($cmid, 'stepbundle');
        $context = \context_module::instance($cm->id);
        self::validate_context($context);
        require_capability('mod/stepbundle:view', $context);
        require_once($CFG->dirroot . '/mod/stepbundle/lib.php');
        $bundle = $DB->get_record('stepbundle', ['id' => $cm->instance], '*', MUST_EXIST);
        stepbundle_view($bundle, $course, $cm, $context);
        return null;
    }

    /**
     * @return null
     */
    public static function execute_returns() {
        return null;
    }
}
