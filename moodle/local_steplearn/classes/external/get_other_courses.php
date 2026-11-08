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
use local_steplearn\courses;

/**
 * 参加していないコースを、ロールなし・進捗付きで返す。サイト全体のコースを見られる人（管理者）だけが使える。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_other_courses extends external_api {
    /** @var int 一覧に返すコースの上限 */
    const LIMIT = 200;

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([]);
    }

    /**
     * @return array
     */
    public static function execute(): array {
        global $DB;
        $context = \context_system::instance();
        self::validate_context($context);
        require_capability('moodle/course:view', $context);

        $enrolled = array_keys(enrol_get_my_courses('id'));
        // 参加しているコースを get_my_courses と重ねて返さないのは、STEP Learn が両方を足して一覧にするため
        [$notin, $params] = $DB->get_in_or_equal(array_merge([SITEID], $enrolled), SQL_PARAMS_NAMED, 'c', false);
        $result = [];
        foreach ($DB->get_records_select('course', "id $notin", $params, 'fullname ASC', '*', 0, self::LIMIT) as $course) {
            $access = courses::access($course);
            if ($access) {
                $result[] = courses::export($course, $access);
            }
        }
        return $result;
    }

    /**
     * @return external_multiple_structure
     */
    public static function execute_returns(): external_multiple_structure {
        return new external_multiple_structure(courses::structure());
    }
}
