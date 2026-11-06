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
use core_external\external_value;
use local_steplearn\courses;

/**
 * 現在のユーザーが開いた・閉じたセクションを、Moodle のコース画面と同じユーザー設定に記録する。
 *
 * @package    local_steplearn
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class set_sections_collapsed extends external_api {
    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'course id'),
            'sectionids' => new external_multiple_structure(new external_value(PARAM_INT, 'section id')),
            'collapsed' => new external_value(PARAM_BOOL, 'true to collapse, false to expand'),
        ]);
    }

    /**
     * @param int $courseid
     * @param int[] $sectionids
     * @param bool $collapsed
     * @return null
     */
    public static function execute(int $courseid, array $sectionids, bool $collapsed) {
        $params = self::validate_parameters(
            self::execute_parameters(),
            ['courseid' => $courseid, 'sectionids' => $sectionids, 'collapsed' => $collapsed]
        );
        self::validate_context(\context_system::instance());
        [$course] = courses::require_access($params['courseid']);

        $modinfo = get_fast_modinfo($course);
        $ids = array_values(array_filter($params['sectionids'], fn($id) => $modinfo->get_section_info_by_id($id) !== null));
        if (!$ids) {
            return null;
        }
        // set_sections_preference で一覧ごと置き換えないのは、STEP Learn に出していないセクション（未来の週など）の記録を消さないため
        $format = course_get_format($course);
        if ($params['collapsed']) {
            $format->add_section_preference_ids('contentcollapsed', $ids);
        } else {
            $format->remove_section_preference_ids('contentcollapsed', $ids);
        }
        return null;
    }

    /**
     * @return null
     */
    public static function execute_returns() {
        return null;
    }
}
